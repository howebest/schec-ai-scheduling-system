use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::config::AppConfig;
use crate::error::AppError;
use crate::models::JobOutput;

#[derive(Clone, Debug)]
pub struct PythonRunner {
    package_root: PathBuf,
    python_bin: PathBuf,
    vendor_dir: PathBuf,
}

impl PythonRunner {
    pub fn new(config: &AppConfig) -> Self {
        Self {
            package_root: config.package_root.clone(),
            python_bin: config.python_bin.clone(),
            vendor_dir: config.python_vendor_dir.clone(),
        }
    }

    pub async fn run(&self, job_id: &str, request_path: &Path,
                     timeout: Duration) -> Result<JobOutput, AppError> {
        self.run_with_cancel(job_id, request_path, timeout, CancellationToken::new()).await
    }

    pub async fn preflight_event(&self, input_path: &str, event: &Value,
                                 timeout: Duration) -> Result<(), AppError> {
        let adapter = self.package_root.join("src/service_adapter.py");
        if !adapter.is_file() {
            return Err(AppError::Configuration("缺少 Python 任务适配器 src/service_adapter.py。".into()));
        }
        let source_dir = self.package_root.join("src");
        let python_path = std::env::join_paths([self.vendor_dir.as_os_str(), source_dir.as_os_str()])
            .map_err(|_| AppError::Configuration("Python vendor 路径格式无效。".into()))?;
        let event_json = serde_json::to_string(event)
            .map_err(|_| AppError::InvalidInput("事件参数格式无效。".into()))?;
        if event_json.len() > 16 * 1024 {
            return Err(AppError::InvalidInput("事件参数超过 16 KiB 限制。".into()));
        }
        let mut command = Command::new(&self.python_bin);
        command.arg(adapter)
            .arg("--preflight-event")
            .arg("--input").arg(input_path)
            .arg("--event-json").arg(event_json)
            .arg("--package-root").arg(&self.package_root)
            .current_dir(&self.package_root)
            .env("PYTHONPATH", python_path)
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("PYTHONUTF8", "1")
            .env_remove("PYTHONHOME")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let output = tokio::time::timeout(timeout, command.output()).await
            .map_err(|_| AppError::Timeout)?
            .map_err(|_| AppError::Python("无法启动 Python 事件预检进程。".into()))?;
        let response: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| AppError::Python("Python 事件预检未返回有效 JSON。".into()))?;
        if response.get("valid").and_then(Value::as_bool) == Some(true) && output.status.success() {
            return Ok(());
        }
        let code = response.pointer("/error/code").and_then(Value::as_str).unwrap_or("INVALID_EVENT");
        let message = response.pointer("/error/message").and_then(Value::as_str)
            .unwrap_or("事件参数未通过数据引用校验。");
        let details = response.pointer("/error/details").and_then(Value::as_array)
            .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("、"))
            .unwrap_or_default();
        let message = if details.is_empty() { message.to_owned() } else { format!("{message}：{details}") };
        if matches!(code, "INVALID_EVENT" | "INVALID_REQUEST" | "PATH_OUTSIDE_PACKAGE") {
            Err(AppError::InvalidInput(message))
        } else {
            Err(AppError::Python(message))
        }
    }

    pub async fn run_with_cancel(&self, job_id: &str, request_path: &Path,
                                 timeout: Duration, cancel: CancellationToken)
                                 -> Result<JobOutput, AppError> {
        let request_relative = request_path.strip_prefix(&self.package_root)
            .map_err(|_| AppError::InvalidInput("任务请求文件必须位于工程包目录内。".into()))?;
        let request_text = request_relative.to_str()
            .ok_or_else(|| AppError::InvalidInput("任务请求路径包含不支持的字符。".into()))?;
        let adapter = self.package_root.join("src/service_adapter.py");
        if !adapter.is_file() {
            return Err(AppError::Configuration("缺少 Python 任务适配器 src/service_adapter.py。".into()));
        }
        let source_dir = self.package_root.join("src");
        let python_path = std::env::join_paths([self.vendor_dir.as_os_str(), source_dir.as_os_str()])
            .map_err(|_| AppError::Configuration("Python vendor 路径格式无效。".into()))?;

        let mut command = Command::new(&self.python_bin);
        command
            .arg(adapter)
            .arg("--request")
            .arg(request_text)
            .arg("--package-root")
            .arg(&self.package_root)
            .current_dir(&self.package_root)
            .env("PYTHONPATH", python_path)
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("PYTHONUTF8", "1")
            .env_remove("PYTHONHOME")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = command.spawn()
            .map_err(|_| AppError::Python("无法启动 Python 任务进程，请检查 CPython 3.11 配置。".into()))?;
        let mut stdout_pipe = child.stdout.take()
            .ok_or_else(|| AppError::Python("无法读取 Python 标准输出。".into()))?;
        let mut stderr_pipe = child.stderr.take()
            .ok_or_else(|| AppError::Python("无法读取 Python 错误输出。".into()))?;
        let stdout_task = tokio::spawn(async move {
            let mut bytes = Vec::new();
            let _ = stdout_pipe.read_to_end(&mut bytes).await;
            bytes
        });
        let stderr_task = tokio::spawn(async move {
            let mut bytes = Vec::new();
            let _ = stderr_pipe.read_to_end(&mut bytes).await;
            bytes
        });
        enum Completion { Cancelled, Timeout, Exited(std::io::Result<std::process::ExitStatus>) }
        let completion = tokio::select! {
            _ = cancel.cancelled() => Completion::Cancelled,
            _ = tokio::time::sleep(timeout) => Completion::Timeout,
            status = child.wait() => Completion::Exited(status),
        };
        let process_status = match completion {
            Completion::Exited(Ok(status)) => status,
            Completion::Exited(Err(_)) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                let _ = stdout_task.await;
                let _ = stderr_task.await;
                return Err(AppError::Python("无法读取 Python 任务进程退出状态。".into()));
            }
            reason => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                let stdout = stdout_task.await.unwrap_or_default();
                let mut stderr = stderr_task.await.unwrap_or_default();
                let message = match &reason {
                    Completion::Cancelled => "Python 任务因取消或服务停止而终止。",
                    _ => "Python 任务超过允许时限，已终止子进程。",
                };
                stderr.extend_from_slice(format!("\n{message}\n").as_bytes());
                let artifact_dir = request_path.parent().unwrap_or(&self.package_root).join("artifacts");
                if std::fs::create_dir_all(&artifact_dir).is_ok() {
                    let _ = std::fs::write(artifact_dir.join("stdout.log"), stdout);
                    let _ = std::fs::write(artifact_dir.join("stderr.log"), stderr);
                }
                return match reason {
                    Completion::Cancelled => Err(AppError::Cancelled),
                    _ => Err(AppError::Timeout),
                };
            }
        };
        let stdout = stdout_task.await.unwrap_or_default();
        let stderr = stderr_task.await.unwrap_or_default();
        let process_code = process_status.code().unwrap_or(-1);
        let response: JobOutput = serde_json::from_slice(&stdout)
            .map_err(|_| {
                let artifact_dir = request_path.parent().unwrap_or(&self.package_root).join("artifacts");
                let _ = std::fs::create_dir_all(&artifact_dir);
                let _ = std::fs::write(artifact_dir.join("python.stdout.log"), &stdout);
                let _ = std::fs::write(artifact_dir.join("python.stderr.log"), &stderr);
                AppError::Python("Python 任务未返回有效的 JSON 响应；原始标准输出和错误输出已写入任务产物目录。".into())
            })?;
        if response.schema != "schec.job-response/v1" {
            return Err(AppError::Python("Python 响应 schema 版本不匹配。".into()));
        }
        if response.job_id != job_id {
            return Err(AppError::Python("Python 响应任务编号与请求不一致。".into()));
        }
        if response.exit_code != process_code {
            return Err(AppError::Python("Python 进程退出码与任务响应不一致。".into()));
        }
        if !matches!(response.status.as_str(), "succeeded" | "failed" | "cancelled") {
            return Err(AppError::Python("Python 返回了不支持的任务状态。".into()));
        }
        Ok(response)
    }
}

pub fn solver_termination(output: &JobOutput) -> Option<String> {
    let summary = output.summary.as_ref()?.as_object()?;
    summary.get("termination")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn solver_termination_is_kept_separate_from_job_status() {
        let output: JobOutput = serde_json::from_value(json!({
            "schema":"schec.job-response/v1","job_id":"j1","status":"failed",
            "exit_code":4,"summary":{"termination":"feasible","incumbent":100,"bound":90},
            "verification":{"all_pass":false},"timings":{"wall_seconds":3.2},
            "artifacts":[],"error":{"code":"TASK_FAILED","message":"failed"}
        })).unwrap();
        assert_eq!(output.status, "failed");
        assert_eq!(solver_termination(&output).as_deref(), Some("feasible"));
        assert_eq!(output.summary.unwrap()["bound"], 90);
    }
}
