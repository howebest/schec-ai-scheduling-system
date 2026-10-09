use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;

use crate::config::AppConfig;
use crate::db::{new_id, timestamp_now, JobRepository, NewJob};
use crate::error::AppError;
use crate::models::{JobCreateRequest, JobFilter, JobOutput, JobRecord, JobStatus, JobUpdate};
use crate::python::{solver_termination, PythonRunner};

#[derive(Clone)]
struct QueueItem {
    id: String,
    request_path: PathBuf,
    timeout: Duration,
}

#[derive(Clone)]
pub struct JobManager {
    sender: mpsc::Sender<QueueItem>,
    repository: JobRepository,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    shutdown: CancellationToken,
    worker: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    default_timeout_seconds: u64,
}

impl JobManager {
    pub fn new(repository: JobRepository, runner: PythonRunner,
               config: AppConfig) -> Self {
        let (sender, mut receiver) = mpsc::channel::<QueueItem>(64);
        let cancellations = Arc::new(Mutex::new(HashMap::new()));
        let worker_cancellations = cancellations.clone();
        let worker_shutdown = CancellationToken::new();
        let shutdown_for_worker = worker_shutdown.clone();
        let worker_repository = repository.clone();
        let worker_root = config.package_root.clone();
        let worker = tokio::spawn(async move {
            loop {
                let queued = tokio::select! {
                    _ = shutdown_for_worker.cancelled() => break,
                    item = receiver.recv() => match item { Some(item) => item, None => break },
                };
                let token = worker_cancellations.lock().await.get(&queued.id).cloned()
                    .unwrap_or_else(CancellationToken::new);
                if token.is_cancelled() {
                    let _ = worker_repository.update_status(&queued.id, JobUpdate {
                        status: Some(JobStatus::Cancelled), finished_at: Some(timestamp_now()), ..Default::default()
                    });
                    worker_cancellations.lock().await.remove(&queued.id);
                    continue;
                }
                if worker_repository.update_status(&queued.id, JobUpdate {
                    status: Some(JobStatus::Running), started_at: Some(timestamp_now()), ..Default::default()
                }).is_err() {
                    worker_cancellations.lock().await.remove(&queued.id);
                    continue;
                }
                let result = runner.run_with_cancel(&queued.id, &queued.request_path, queued.timeout, token).await;
                let result = match result {
                    Ok(mut output) => {
                        if let Err(error) = register_output(&worker_repository, &worker_root, &queued.id, &output) {
                            output.status = "failed".into();
                            output.exit_code = 3;
                            output.error = Some(json!({
                                "code":"OUTPUT_REGISTRATION_FAILED",
                                "message":"任务结果已保留，但方案登记失败。",
                                "details":[error.to_string()]
                            }));
                        }
                        Ok(output)
                    }
                    Err(error) => Err(error),
                };
                let update = update_from_result(result);
                let _ = worker_repository.update_status(&queued.id, update);
                worker_cancellations.lock().await.remove(&queued.id);
            }
        });
        Self {
            sender, repository, cancellations, shutdown: worker_shutdown,
            worker: Arc::new(Mutex::new(Some(worker))),
            default_timeout_seconds: config.default_job_timeout_seconds,
        }
    }

    pub async fn submit(&self, request: JobCreateRequest, mut adapter_request: Value,
                        package_root: &Path, timeout: Option<Duration>) -> Result<JobRecord, AppError> {
        let id = new_id("job");
        let object = adapter_request.as_object_mut()
            .ok_or_else(|| AppError::InvalidInput("内部任务请求必须为 JSON 对象。".into()))?;
        object.insert("job_id".into(), Value::String(id.clone()));
        object.insert("dataset_version".into(), Value::String(request.dataset_id.clone()));
        object.insert("schema_version".into(), json!(1));

        let root = package_root.canonicalize()?;
        let resolved = ensure_package_directory(&root, Path::new("out/jobs").join(&id).as_path())?;
        let request_path = resolved.join("request.json");
        let temporary = resolved.join("request.json.tmp");
        std::fs::write(&temporary, serde_json::to_vec_pretty(&adapter_request)
            .map_err(|_| AppError::InvalidInput("无法序列化任务请求。".into()))?)?;
        std::fs::rename(&temporary, &request_path)?;

        let record = self.repository.create(&NewJob {
            id: id.clone(), kind: request.kind, dataset_id: request.dataset_id,
            request: adapter_request,
            actor_id: request.actor_id,
            actor_role: request.actor_role,
            reason: request.reason,
            created_at: timestamp_now(),
        })?;
        let cancellation = CancellationToken::new();
        self.cancellations.lock().await.insert(id.clone(), cancellation);
        let item = QueueItem {
            id: id.clone(), request_path,
            timeout: timeout.unwrap_or(Duration::from_secs(self.default_timeout_seconds)),
        };
        if self.sender.send(item).await.is_err() {
            let _ = self.repository.update_status(&id, JobUpdate {
                status: Some(JobStatus::Failed), finished_at: Some(timestamp_now()),
                error: Some(json!({"code":"QUEUE_CLOSED","message":"任务队列已关闭。"})),
                ..Default::default()
            });
            return Err(AppError::Conflict("任务队列已关闭。".into()));
        }
        Ok(record)
    }

    pub async fn get(&self, id: &str) -> Result<Option<JobRecord>, AppError> {
        self.repository.get(id)
    }

    pub async fn list(&self, filter: JobFilter) -> Result<Vec<JobRecord>, AppError> {
        self.repository.list(filter)
    }

    pub async fn cancel(&self, id: &str) -> Result<JobRecord, AppError> {
        let record = self.repository.get(id)?.ok_or(AppError::NotFound)?;
        match &record.status {
            JobStatus::Queued => {
                if let Some(token) = self.cancellations.lock().await.get(id) {
                    token.cancel();
                }
                match self.repository.update_status(id, JobUpdate {
                    status: Some(JobStatus::Cancelled), finished_at: Some(timestamp_now()), ..Default::default()
                }) {
                    Ok(updated) => Ok(updated),
                    Err(AppError::Conflict(_)) => self.repository.get(id)?.ok_or(AppError::NotFound),
                    Err(error) => Err(error),
                }
            }
            JobStatus::Running => {
                let cancellations = self.cancellations.lock().await;
                if let Some(token) = cancellations.get(id) {
                    token.cancel();
                }
                Ok(record)
            }
            _ => Err(AppError::Conflict("已结束的任务不能取消。".into())),
        }
    }

    pub async fn shutdown(&self) {
        self.shutdown.cancel();
        let tokens = self.cancellations.lock().await;
        for token in tokens.values() {
            token.cancel();
        }
        drop(tokens);
        if let Ok(queued) = self.repository.list(JobFilter {
            status: Some(JobStatus::Queued), dataset_id: None, limit: 500,
        }) {
            for record in queued {
                let _ = self.repository.update_status(&record.id, JobUpdate {
                    status: Some(JobStatus::Cancelled), finished_at: Some(timestamp_now()),
                    error: Some(json!({"code":"SERVICE_STOPPED","message":"服务停止时取消排队任务。"})),
                    ..Default::default()
                });
            }
        }
        if let Some(worker) = self.worker.lock().await.take() {
            let _ = worker.await;
        }
    }
}

fn ensure_package_directory(root: &Path, relative: &Path) -> Result<PathBuf, AppError> {
    let canonical_root = root.canonicalize()?;
    if relative.is_absolute() || relative.components().any(|part| part == Component::ParentDir) {
        return Err(AppError::InvalidInput("任务工作目录路径无效。".into()));
    }
    let mut current = canonical_root.clone();
    for component in relative.components() {
        let Component::Normal(name) = component else { continue };
        current.push(name);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(AppError::InvalidInput("任务工作目录包含符号链接或非目录路径。".into()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => std::fs::create_dir(&current)?,
            Err(error) => return Err(AppError::Io(error)),
        }
    }
    let resolved = current.canonicalize()?;
    if !resolved.starts_with(&canonical_root) {
        return Err(AppError::InvalidInput("任务工作目录超出工程包目录。".into()));
    }
    Ok(resolved)
}

fn register_output(repository: &JobRepository, package_root: &Path, job_id: &str, output: &JobOutput) -> Result<(), AppError> {
    let job = repository.get(job_id)?.ok_or(AppError::NotFound)?;
    let root = package_root.canonicalize()?;
    for artifact in &output.artifacts {
        if artifact.path.is_empty() || Path::new(&artifact.path).is_absolute()
            || artifact.path.contains('\\')
            || Path::new(&artifact.path).components().any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(AppError::InvalidInput("任务产物路径必须为工程包内的 POSIX 相对路径。".into()));
        }
        let path = root.join(&artifact.path).canonicalize()
            .map_err(|_| AppError::InvalidInput("任务产物文件不存在。".into()))?;
        if !path.starts_with(&root) || !path.is_file() {
            return Err(AppError::InvalidInput("任务产物路径超出工程包目录。".into()));
        }
        let bytes = std::fs::read(&path)?;
        if bytes.len() as u64 != artifact.size_bytes
            || hex::encode(Sha256::digest(&bytes)) != artifact.sha256
        {
            return Err(AppError::Conflict("任务产物大小或 SHA-256 与 Python 声明不一致。".into()));
        }
    }
    if job.kind.as_str() == "validate_schedule" {
        if let (Some(target_schedule_id), Some(verification)) = (
            job.request.get("target_schedule_id").and_then(Value::as_str),
            output.verification.clone(),
        ) {
            let expected = job.request.get("expected_version").and_then(Value::as_i64)
                .ok_or_else(|| AppError::InvalidInput("核验任务缺少 expected_version。".into()))?;
            repository.update_schedule_verification(target_schedule_id, expected, verification)?;
        }
    }
    if output.status != "succeeded" {
        return Ok(());
    }
    let artifact = output.artifacts.iter().find(|artifact| {
        artifact.path.ends_with("/schedule.csv") || artifact.path.ends_with("/rescheduled_schedule.csv")
    });
    if artifact.is_some() && output.verification.as_ref()
        .and_then(|value| value.get("all_pass")).and_then(Value::as_bool) != Some(true)
    {
        return Ok(());
    }
    if let Some(artifact) = artifact {
        let schedule_id = job.request.get("schedule_group_id").and_then(Value::as_str).unwrap_or(job_id);
        let expected = job.request.get("expected_version").and_then(Value::as_i64);
        let source_type = repository.get_dataset(&job.dataset_id)?
            .map(|dataset| dataset.source_type)
            .unwrap_or_else(|| "unknown".into());
        repository.insert_schedule_version(
            schedule_id,
            &job.dataset_id,
            Some(job_id),
            &artifact.path,
            &artifact.sha256,
            output.verification.clone().unwrap_or_else(|| json!({"all_pass":null})),
            &source_type,
            expected,
        )?;
    }
    Ok(())
}

fn update_from_result(result: Result<JobOutput, AppError>) -> JobUpdate {
    let finished_at = Some(timestamp_now());
    match result {
        Ok(output) => {
            let status = match output.status.as_str() {
                "succeeded" => JobStatus::Succeeded,
                "cancelled" => JobStatus::Cancelled,
                _ => JobStatus::Failed,
            };
            let error = output.error.clone();
            JobUpdate {
                status: Some(status), finished_at,
                solver_termination: solver_termination(&output),
                result: Some(serde_json::to_value(output).unwrap_or(Value::Null)),
                error,
                ..Default::default()
            }
        }
        Err(error) => {
            let status = if matches!(error, AppError::Cancelled) { JobStatus::Cancelled } else { JobStatus::Failed };
            let code = error.code();
            JobUpdate {
                status: Some(status), finished_at,
                error: Some(json!({"code":code,"message":error.to_string()})),
                ..Default::default()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::JobOutput;

    #[test]
    fn nonzero_solver_exit_is_persisted_as_failed_job() {
        let result = Ok(JobOutput {
            schema: "schec.job-response/v1".into(), job_id: "job1".into(),
            status: "failed".into(), exit_code: 4, summary: None, verification: None,
            timings: json!({"wall_seconds":1}), artifacts: vec![],
            error: Some(json!({"code":"TASK_FAILED"})),
        });
        let update = update_from_result(result);
        assert_eq!(update.status, Some(JobStatus::Failed));
    }
}
