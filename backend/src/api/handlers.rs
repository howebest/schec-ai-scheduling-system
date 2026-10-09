use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::error::AppError;
use crate::models::{JobCreateRequest, JobFilter, JobStatus};
use crate::AppState;

#[derive(Deserialize, Default)]
pub struct JobQuery {
    status: Option<String>,
    dataset_id: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
pub struct RuleUpdateRequest {
    pub expected_version: i64,
    pub actor_id: String,
    pub actor_role: String,
    pub reason: String,
    pub values: Value,
}

#[derive(Deserialize)]
pub struct FeedbackRequest {
    pub employee_id: String,
    pub feedback_type: String,
    #[serde(default)]
    pub schedule_id: Option<String>,
    pub payload: Value,
}

#[derive(Deserialize, Default)]
pub struct FeedbackQuery {
    employee_id: Option<String>,
    schedule_id: Option<String>,
    limit: Option<usize>,
}

pub async fn list_jobs(
    State(state): State<AppState>,
    Query(query): Query<JobQuery>,
) -> Result<Json<Value>, AppError> {
    let status = query.status.as_deref().map(parse_job_status).transpose()?;
    let items = state.db.list(JobFilter {
        status,
        dataset_id: query.dataset_id,
        limit: query.limit.unwrap_or(100),
    })?;
    Ok(Json(json!({"items":items})))
}

pub async fn get_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({"job":state.db.get(&id)?.ok_or(AppError::NotFound)?})))
}

pub async fn create_job(
    State(state): State<AppState>,
    Json(request): Json<JobCreateRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if request.dataset_id.trim().is_empty() {
        return Err(AppError::InvalidInput("dataset_id 为必填项。".into()));
    }
    if request.actor_id.trim().is_empty() || request.reason.trim().is_empty() {
        return Err(AppError::InvalidInput("任务操作人和提交原因均为必填项。".into()));
    }
    if !matches!(request.actor_role.as_str(), "计划员" | "班组长" | "主管" | "系统管理员") {
        return Err(AppError::InvalidInput("当前角色没有创建排班任务的权限。".into()));
    }
    let dataset = state.db.get_dataset(&request.dataset_id)?.ok_or(AppError::NotFound)?;
    let mut input_files = Map::new();
    let input = dataset_input_path(&state.config.package_root, &dataset)?;
    if matches!(request.kind.adapter_task(), "info" | "solve_demo" | "solve_full" | "verify_baseline" | "reschedule" | "validate_schedule") {
        input_files.insert("input".into(), Value::String(input.clone()));
    }
    let selected_schedule = match request.baseline_schedule_id.as_deref() {
        Some(id) => Some(state.db.get_schedule(id)?.ok_or(AppError::NotFound)?),
        None => None,
    };
    if selected_schedule.as_ref().is_some_and(|schedule| schedule.dataset_id != dataset.id) {
        return Err(AppError::InvalidInput("方案基准与所选数据集版本不一致。".into()));
    }
    if let Some(schedule) = selected_schedule.as_ref() {
        if matches!(request.kind.adapter_task(), "reschedule" | "validate_schedule") {
            if let Some(path) = schedule_demand_override_path(&state, schedule)? {
                if request.kind.adapter_task() == "validate_schedule"
                    && request.parameters.get("demand_profile").and_then(Value::as_str)
                        .is_some_and(|value| value != "solver")
                {
                    return Err(AppError::InvalidInput("事件版本必须使用该版本保存的有效需求口径核验。".into()));
                }
                input_files.insert("demand_override".into(), Value::String(path));
            }
        }
    }
    if request.kind.adapter_task() == "reschedule" && selected_schedule.is_none() {
        return Err(AppError::InvalidInput("异常重排必须指定当前数据集的基准方案版本。".into()));
    }
    let default_baseline = "data/baseline_schedule_FULL62_W1.csv".to_owned();
    let baseline_path = selected_schedule.as_ref()
        .map(|schedule| schedule.artifact_path.clone())
        .unwrap_or(default_baseline);
    match request.kind.adapter_task() {
        "verify_baseline" | "reschedule" | "kpi" => {
            input_files.insert("baseline".into(), Value::String(baseline_path));
        }
        "validate_schedule" => {
            let schedule = selected_schedule.as_ref().ok_or_else(|| {
                AppError::InvalidInput("核验任务必须指定 baseline_schedule_id。".into())
            })?;
            input_files.insert("schedule".into(), Value::String(schedule.artifact_path.clone()));
        }
        _ => {}
    }
    if request.kind.adapter_task() == "reschedule" && request.event.is_none() {
        return Err(AppError::InvalidInput("重排任务必须提供事件参数。".into()));
    }
    let mut adapter_request = json!({
        "schema_version":1,
        "task":request.kind.adapter_task(),
        "dataset_version":dataset.version,
        "input_files":input_files,
        "parameters":request.parameters.clone(),
    });
    if let Some(event) = request.event.as_ref() {
        adapter_request["event"] = serde_json::to_value(event)
            .map_err(|_| AppError::InvalidInput("事件参数格式无效。".into()))?;
    }
    if request.kind.adapter_task() == "reschedule" {
        let schedule = selected_schedule.as_ref().ok_or_else(|| {
            AppError::InvalidInput("异常重排必须指定当前数据集的基准方案版本。".into())
        })?;
        adapter_request["schedule_group_id"] = json!(schedule.schedule_id);
        adapter_request["target_schedule_id"] = json!(schedule.schedule_id);
        adapter_request["expected_version"] = json!(schedule.version);
        let event = adapter_request.get("event").cloned()
            .ok_or_else(|| AppError::InvalidInput("重排任务必须提供事件参数。".into()))?;
        state.python.preflight_event(&input, &event, Duration::from_secs(30)).await?;
    }
    let requested_timeout = request.parameters.get("time_limit_seconds")
        .and_then(Value::as_u64);
    let maximum = match request.kind.adapter_task() {
        "reschedule" => 60,
        _ => state.config.default_job_timeout_seconds,
    };
    let timeout_seconds = requested_timeout.unwrap_or(maximum).min(maximum).max(1);
    let record = state.jobs.submit(
        request,
        adapter_request,
        &state.config.package_root,
        Some(Duration::from_secs(timeout_seconds)),
    ).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({"job":record}))))
}

pub async fn cancel_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({"job":state.jobs.cancel(&id).await?})))
}

pub async fn list_rules(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let latest = state.db.latest_rules()?;
    Ok(Json(json!({"latest":latest,"history":state.db.list_rules(50)?})))
}

pub async fn update_rules(
    State(state): State<AppState>,
    Json(request): Json<RuleUpdateRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if !matches!(request.actor_role.as_str(), "计划员" | "系统管理员") {
        return Err(AppError::InvalidInput("当前角色没有修改规则的权限。".into()));
    }
    if request.actor_id.trim().is_empty() || request.reason.trim().is_empty() {
        return Err(AppError::InvalidInput("操作人和修改原因均为必填项。".into()));
    }
    validate_rule_values(&request.values)?;
    let saved = state.db.create_rule_version(
        request.expected_version, request.values, &request.actor_id, &request.actor_role, &request.reason,
    )?;
    Ok((StatusCode::CREATED, Json(json!({"rule":saved}))))
}

pub async fn create_feedback(
    State(state): State<AppState>,
    Json(request): Json<FeedbackRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if request.employee_id.trim().is_empty() || request.feedback_type.trim().is_empty() {
        return Err(AppError::InvalidInput("employee_id 与 feedback_type 均为必填项。".into()));
    }
    validate_feedback_satisfaction(&request.payload)?;
    let schedule_record_id = request.schedule_id.as_deref().map(|id| {
        state.db.get_schedule(id).and_then(|record| record.map(|value| value.id).ok_or(AppError::NotFound))
    }).transpose()?;
    let feedback = state.db.add_feedback(
        schedule_record_id.as_deref(), &request.employee_id, &request.feedback_type,
        request.payload, "simulated_feedback",
    )?;
    state.db.write_audit(
        &request.employee_id, "员工", "submit_feedback", "feedback",
        feedback["id"].as_str().unwrap_or_default(), "员工提交本机模拟反馈。",
        None, Some(feedback.clone()),
    )?;
    Ok((StatusCode::CREATED, Json(json!({"feedback":feedback}))))
}

pub async fn list_feedback(
    State(state): State<AppState>,
    Query(query): Query<FeedbackQuery>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({"items":state.db.list_feedback(query.employee_id.as_deref(), query.schedule_id.as_deref(), query.limit.unwrap_or(100))?})))
}

fn parse_job_status(value: &str) -> Result<JobStatus, AppError> {
    match value {
        "queued" => Ok(JobStatus::Queued),
        "running" => Ok(JobStatus::Running),
        "succeeded" => Ok(JobStatus::Succeeded),
        "failed" => Ok(JobStatus::Failed),
        "cancelled" => Ok(JobStatus::Cancelled),
        _ => Err(AppError::InvalidInput("status 筛选值无效。".into())),
    }
}

pub(crate) fn dataset_input_path(
    package_root: &std::path::Path,
    dataset: &crate::models::DatasetRecord,
) -> Result<String, AppError> {
    let relative = if dataset.id == "accepted-baseline-v1" {
        "data/raw_dataset.xlsx".to_owned()
    } else if dataset.source_type == "user_import"
        && dataset.manifest.get("schema_id").and_then(Value::as_str) != Some("raw_dataset")
    {
        return Err(AppError::InvalidInput(
            "该导入数据集不是原始求解工作簿；CSV、事件和分析模板不能用于排班求解。".into(),
        ));
    } else {
        dataset.manifest.get("files")
            .and_then(|files| files.get("primary"))
            .and_then(|primary| primary.get("path"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| AppError::InvalidInput("所选数据集没有可供求解使用的原始工作簿。".into()))?
    };
    let path = package_root.join(&relative).canonicalize()
        .map_err(|_| AppError::InvalidInput("数据集输入文件不存在。".into()))?;
    if !path.starts_with(package_root) || !path.is_file() {
        return Err(AppError::InvalidInput("数据集输入文件不在工程包目录中。".into()));
    }
    Ok(relative)
}

pub(crate) fn schedule_demand_override_path(
    state: &AppState,
    schedule: &crate::models::ScheduleRecord,
) -> Result<Option<String>, AppError> {
    let Some(job_id) = schedule.job_id.as_deref() else { return Ok(None) };
    let Some(job) = state.db.get(job_id)? else { return Ok(None) };
    let Some(artifacts) = job.result.as_ref().and_then(|value| value.get("artifacts"))
        .and_then(Value::as_array) else { return Ok(None) };
    let Some(relative) = artifacts.iter().filter_map(|item| item.get("path").and_then(Value::as_str))
        .find(|path| path.ends_with("/scenario_result.json") || path.ends_with("/effective_demand.json"))
    else { return Ok(None) };
    let root = state.config.package_root.canonicalize()?;
    let path = root.join(relative).canonicalize()
        .map_err(|_| AppError::InvalidInput("方案有效需求文件不存在。".into()))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(AppError::InvalidInput("方案有效需求文件路径无效。".into()));
    }
    let package_relative = path.strip_prefix(&root)
        .map_err(|_| AppError::InvalidInput("方案有效需求文件路径无效。".into()))?;
    Ok(Some(package_relative.to_string_lossy().replace('\\', "/")))
}

fn validate_rule_values(value: &Value) -> Result<(), AppError> {
    let object = value.as_object().ok_or_else(|| AppError::InvalidInput("规则值必须为 JSON 对象。".into()))?;
    let ranges = [
        ("standard_hours_per_day", 1.0, 24.0),
        ("daily_overtime_hours_max", 0.0, 24.0),
        ("monthly_overtime_hours_max", 0.0, 240.0),
        ("rolling_rest_days", 1.0, 31.0),
        ("minimum_rest_hours", 0.0, 48.0),
    ];
    for (field, minimum, maximum) in ranges {
        if let Some(number) = object.get(field) {
            let number = number.as_f64().ok_or_else(|| AppError::InvalidInput(format!("规则字段 {field} 必须为数字。")))?;
            if !(minimum..=maximum).contains(&number) {
                return Err(AppError::InvalidInput(format!("规则字段 {field} 超出允许范围。")));
            }
        }
    }
    Ok(())
}

fn validate_feedback_satisfaction(payload: &Value) -> Result<(), AppError> {
    let Some(value) = payload.get("satisfaction_score") else { return Ok(()) };
    let score = value.as_f64().ok_or_else(|| AppError::InvalidInput("满意度评分必须为 1 至 5 的整数。".into()))?;
    if score.fract() != 0.0 || !(1.0..=5.0).contains(&score) {
        return Err(AppError::InvalidInput("满意度评分必须为 1 至 5 的整数。".into()));
    }
    Ok(())
}

#[cfg(test)]
mod feedback_validation_tests {
    use super::validate_feedback_satisfaction;
    use serde_json::json;

    #[test]
    fn optional_satisfaction_score_accepts_integer_ratings_from_one_to_five() {
        assert!(validate_feedback_satisfaction(&json!({})).is_ok());
        for score in 1..=5 {
            assert!(validate_feedback_satisfaction(&json!({"satisfaction_score":score})).is_ok());
        }
    }

    #[test]
    fn satisfaction_score_rejects_out_of_range_fractional_and_text_values() {
        for payload in [
            json!({"satisfaction_score":0}),
            json!({"satisfaction_score":6}),
            json!({"satisfaction_score":3.5}),
            json!({"satisfaction_score":"4"}),
        ] {
            assert!(validate_feedback_satisfaction(&payload).is_err());
        }
    }
}
