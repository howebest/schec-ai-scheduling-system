use std::collections::BTreeMap;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::handlers::{dataset_input_path, schedule_demand_override_path};
use crate::error::AppError;
use crate::models::{JobCreateRequest, JobKind, ScheduleRecord};
use crate::AppState;

#[derive(Deserialize)]
pub struct AdjustmentRequest {
    pub expected_version: i64,
    pub actor_id: String,
    pub actor_role: String,
    pub reason: String,
    pub operation: AdjustmentOperation,
}

#[derive(Deserialize, Serialize)]
pub struct AdjustmentOperation {
    #[serde(rename = "type")]
    pub operation_type: String,
    pub employee_id: String,
    pub position_code: String,
    pub date: String,
    pub shift_code: String,
}

#[derive(Deserialize)]
pub struct ValidationRequest {
    pub expected_version: i64,
    pub actor_id: String,
    pub actor_role: String,
    pub reason: String,
    #[serde(default = "default_demand_profile")]
    pub demand_profile: String,
}

#[derive(Deserialize)]
pub struct ApprovalRequest {
    pub expected_version: i64,
    pub action: String,
    pub actor_id: String,
    pub actor_role: String,
    pub reason: String,
}

pub async fn get_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let schedule = state.db.get_schedule(&id)?.ok_or(AppError::NotFound)?;
    let path = resolve_artifact(&state.config.package_root, &schedule.artifact_path)?;
    let content = read_schedule_preview(&path)?;
    Ok(Json(json!({"schedule":schedule,"content":content})))
}

pub async fn adjust_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<AdjustmentRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if !matches!(request.actor_role.as_str(), "计划员" | "班组长" | "主管" | "系统管理员") {
        return Err(AppError::InvalidInput("当前角色没有调整排班的权限。".into()));
    }
    if request.actor_id.trim().is_empty() || request.reason.trim().is_empty() {
        return Err(AppError::InvalidInput("操作人和调整原因均为必填项。".into()));
    }
    if !matches!(request.operation.operation_type.as_str(), "assign" | "remove") {
        return Err(AppError::InvalidInput("调整类型只能为 assign 或 remove。".into()));
    }
    let schedule = state.db.get_schedule(&id)?.ok_or(AppError::NotFound)?;
    if schedule.version != request.expected_version {
        return Err(AppError::Conflict(format!("方案版本已更新，当前版本为 {}。", schedule.version)));
    }
    reject_duplicate_pending(&state, &schedule.schedule_id).await?;
    let dataset = state.db.get_dataset(&schedule.dataset_id)?.ok_or(AppError::NotFound)?;
    let input = dataset_input_path(&state.config.package_root, &dataset)?;
    let _path = resolve_artifact(&state.config.package_root, &schedule.artifact_path)?;
    let mut parameters = BTreeMap::new();
    parameters.insert("adjustment".into(), serde_json::to_value(&request.operation)
        .map_err(|_| AppError::InvalidInput("调整参数格式无效。".into()))?);
    let mut input_files = json!({"input":input,"schedule":schedule.artifact_path});
    if let Some(path) = schedule_demand_override_path(&state, &schedule)? {
        input_files["demand_override"] = json!(path);
    }
    let adapter_request = json!({
        "schema_version":1,"task":"adjust_schedule","dataset_version":schedule.dataset_id,
        "input_files":input_files,
        "parameters":{"adjustment":request.operation}
    });
    let record = state.jobs.submit(
        JobCreateRequest {
            kind: JobKind::AdjustSchedule,
            dataset_id: schedule.dataset_id.clone(),
            actor_id: request.actor_id.clone(),
            actor_role: request.actor_role.clone(),
            reason: request.reason.clone(),
            baseline_schedule_id: Some(schedule.id.clone()),
            event: None,
            parameters,
        },
        with_schedule_revision(adapter_request, &schedule, request.expected_version),
        &state.config.package_root,
        Some(Duration::from_secs(120)),
    ).await?;
    state.db.write_audit(
        &request.actor_id, &request.actor_role, "adjust_schedule", "schedule",
        &schedule.schedule_id, &request.reason, Some(json!({"version":schedule.version})),
        Some(json!({"job_id":record.id,"operation":request.operation})),
    )?;
    Ok((StatusCode::ACCEPTED, Json(json!({"job":record,"expected_version":request.expected_version}))))
}

pub async fn validate_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ValidationRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if !matches!(request.actor_role.as_str(), "计划员" | "班组长" | "主管" | "系统管理员") {
        return Err(AppError::InvalidInput("当前角色没有提交方案核验的权限。".into()));
    }
    if request.actor_id.trim().is_empty() || request.reason.trim().is_empty() {
        return Err(AppError::InvalidInput("操作人和核验原因均为必填项。".into()));
    }
    if !matches!(request.demand_profile.as_str(), "solver" | "reference") {
        return Err(AppError::InvalidInput("demand_profile 只能为 solver 或 reference。".into()));
    }
    let schedule = state.db.get_schedule(&id)?.ok_or(AppError::NotFound)?;
    if schedule.version != request.expected_version {
        return Err(AppError::Conflict(format!("方案版本已更新，当前版本为 {}。", schedule.version)));
    }
    reject_duplicate_pending(&state, &schedule.schedule_id).await?;
    let dataset = state.db.get_dataset(&schedule.dataset_id)?.ok_or(AppError::NotFound)?;
    let input = dataset_input_path(&state.config.package_root, &dataset)?;
    let _path = resolve_artifact(&state.config.package_root, &schedule.artifact_path)?;
    let mut parameters = BTreeMap::new();
    parameters.insert("demand_profile".into(), json!(request.demand_profile));
    let adapter_request = with_schedule_revision(json!({
        "schema_version":1,"task":"validate_schedule","dataset_version":schedule.dataset_id,
        "input_files":{"input":input,"schedule":schedule.artifact_path},
        "parameters":{"demand_profile":request.demand_profile}
    }), &schedule, request.expected_version);
    let record = state.jobs.submit(
        JobCreateRequest {
            kind: JobKind::ValidateSchedule,
            dataset_id: schedule.dataset_id.clone(),
            actor_id: request.actor_id.clone(),
            actor_role: request.actor_role.clone(),
            reason: request.reason.clone(),
            baseline_schedule_id: Some(schedule.id.clone()),
            event: None,
            parameters,
        },
        adapter_request,
        &state.config.package_root,
        Some(Duration::from_secs(120)),
    ).await?;
    state.db.write_audit(
        &request.actor_id, &request.actor_role, "validate_schedule", "schedule",
        &schedule.schedule_id, &request.reason, None, Some(json!({"job_id":record.id})),
    )?;
    Ok((StatusCode::ACCEPTED, Json(json!({"job":record}))))
}

pub async fn approve_schedule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ApprovalRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if request.actor_id.trim().is_empty() || request.reason.trim().is_empty() {
        return Err(AppError::InvalidInput("操作人和审批原因均为必填项。".into()));
    }
    let schedule = state.db.get_schedule(&id)?.ok_or(AppError::NotFound)?;
    let current = state.db.get_schedule(&schedule.schedule_id)?.ok_or(AppError::NotFound)?;
    if current.id != schedule.id || current.version != schedule.version {
        return Err(AppError::Conflict(format!("仅可审批当前版本，当前版本为 {}。", current.version)));
    }
    if schedule.version != request.expected_version {
        return Err(AppError::Conflict(format!("方案版本已更新，当前版本为 {}。", schedule.version)));
    }
    let (status, required_previous) = match request.action.as_str() {
        "review" => ("reviewed", None),
        "lock" => ("locked", Some("reviewed")),
        "simulated_publish" => ("simulated_published", Some("locked")),
        "reject" => ("rejected", None),
        _ => return Err(AppError::InvalidInput("action 只能为 review、lock、simulated_publish 或 reject。".into())),
    };
    if request.action == "review" && !matches!(request.actor_role.as_str(), "班组长" | "主管" | "系统管理员") {
        return Err(AppError::InvalidInput("当前角色没有复核权限。".into()));
    }
    if request.action == "lock" && !matches!(request.actor_role.as_str(), "主管" | "系统管理员") {
        return Err(AppError::InvalidInput("当前角色没有锁定方案的权限。".into()));
    }
    if request.action == "simulated_publish" && request.actor_role != "系统管理员" {
        return Err(AppError::InvalidInput("当前角色没有模拟发布权限。".into()));
    }
    if request.action == "reject" && !matches!(request.actor_role.as_str(), "主管" | "系统管理员") {
        return Err(AppError::InvalidInput("当前角色没有驳回方案的权限。".into()));
    }
    if matches!(request.action.as_str(), "review" | "lock" | "simulated_publish")
        && schedule.verification.get("all_pass").and_then(Value::as_bool) != Some(true)
    {
        return Err(AppError::Conflict("方案尚未通过独立硬约束核验，不能复核、锁定或模拟发布。".into()));
    }
    let previous = state.db.latest_approval_status(&schedule.id)?;
    if let Some(required) = required_previous {
        if previous.as_deref() != Some(required) {
            return Err(AppError::Conflict(format!("当前审批状态不允许执行 {status} 操作。")));
        }
    }
    let approval = state.db.add_approval(
        &schedule.id, schedule.version, status, &request.actor_id, &request.reason,
    )?;
    state.db.write_audit(
        &request.actor_id, &request.actor_role, &request.action, "schedule",
        &schedule.schedule_id, &request.reason, previous.map(|value| json!({"status":value})),
        Some(approval.clone()),
    )?;
    Ok((StatusCode::CREATED, Json(json!({"approval":approval}))))
}

async fn reject_duplicate_pending(state: &AppState, schedule_id: &str) -> Result<(), AppError> {
    for job in state.db.list(crate::models::JobFilter { limit: 500, ..Default::default() })? {
        if matches!(job.status, crate::models::JobStatus::Queued | crate::models::JobStatus::Running)
            && job.request.get("schedule_group_id").and_then(Value::as_str) == Some(schedule_id)
        {
            return Err(AppError::Conflict("该方案已有未完成的核验或调整任务。".into()));
        }
    }
    Ok(())
}

fn with_schedule_revision(mut request: Value, schedule: &ScheduleRecord, expected_version: i64) -> Value {
    request["schedule_group_id"] = json!(schedule.schedule_id);
    request["expected_version"] = json!(expected_version);
    request["target_schedule_id"] = json!(schedule.schedule_id);
    request
}

fn resolve_artifact(root: &std::path::Path, relative: &str) -> Result<std::path::PathBuf, AppError> {
    let root = root.canonicalize()?;
    let path = root.join(relative).canonicalize()
        .map_err(|_| AppError::InvalidInput("方案文件不存在。".into()))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(AppError::InvalidInput("方案文件路径无效。".into()));
    }
    Ok(path)
}

fn read_schedule_preview(path: &std::path::Path) -> Result<Value, AppError> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_path(path)
        .map_err(|_| AppError::InvalidInput("方案 CSV 无法读取。".into()))?;
    let mut section = "assignments";
    let mut assignments = Vec::new();
    let mut gaps = Vec::new();
    let mut fractional_shifts = Vec::new();
    let mut assignment_count = 0_u64;
    let mut gap_count = 0_u64;
    let mut fractional_count = 0_u64;
    for result in reader.records() {
        let row = result.map_err(|_| AppError::InvalidInput("方案 CSV 存在格式错误。".into()))?;
        let first = row.get(0).unwrap_or_default();
        if first.starts_with("缺口记录") { section = "gaps"; continue; }
        if first.starts_with("非完整班次记录") { section = "fractional"; continue; }
        match section {
            "assignments" if row.get(2) != Some("日期") && row.len() >= 15 => {
                assignment_count += 1;
                if assignments.len() < 1000 {
                    assignments.push(json!({
                        "factory_code":row.get(0),"line_code":row.get(1),"date":row.get(2),
                        "shift":row.get(3),"shift_code":row.get(4),"employee_id":row.get(5),
                        "position_code":row.get(6),"position_name":row.get(7),
                        "key_position":row.get(8),"skill_level":row.get(9),
                        "paid_hours":row.get(10),"standard_hours":row.get(11),
                        "overtime_hours":row.get(12)
                    }));
                }
            }
            "gaps" if first != "岗位编码" && row.len() >= 6 => {
                gap_count += 1;
                if gaps.len() < 1000 {
                    gaps.push(json!({"position_code":row.get(0),"position_name":row.get(1),
                        "line_code":row.get(2),"date":row.get(3),"shift":row.get(4),"gap_shifts":row.get(5)}));
                }
            }
            "fractional" if first != "员工工号" && row.len() >= 5 => {
                fractional_count += 1;
                if fractional_shifts.len() < 1000 {
                    fractional_shifts.push(json!({"employee_id":row.get(0),"position_code":row.get(1),
                        "date":row.get(2),"shift_code":row.get(3),"hours":row.get(4)}));
                }
            }
            _ => {}
        }
    }
    Ok(json!({
        "assignment_count":assignment_count,"gap_record_count":gap_count,"fractional_record_count":fractional_count,
        "assignments":assignments,"gaps":gaps,"fractional_shifts":fractional_shifts,"row_limit":1000
    }))
}

fn default_demand_profile() -> String { "solver".into() }
