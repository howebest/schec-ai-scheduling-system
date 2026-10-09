use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::models::JobFilter;
use crate::AppState;

#[derive(Deserialize, Default)]
pub struct ArchiveQuery {
    dataset_id: Option<String>,
    employee_id: Option<String>,
    factory_code: Option<String>,
    line_code: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
    shift_code: Option<String>,
    event_type: Option<String>,
    source_type: Option<String>,
    limit: Option<usize>,
}

pub async fn list_archive(
    State(state): State<AppState>,
    Query(query): Query<ArchiveQuery>,
) -> Result<Json<Value>, AppError> {
    if query.date_from.is_some() != query.date_to.is_some()
        || query.date_from.as_ref().zip(query.date_to.as_ref()).is_some_and(|(from, to)| from > to)
    {
        return Err(AppError::InvalidInput("date_from 与 date_to 必须同时提供，且起始日期不得晚于结束日期。".into()));
    }
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let records = state.db.list_schedule_history(query.dataset_id.as_deref(), 1000)?;
    let mut items = Vec::new();
    for record in records {
        if let Some(source_type) = query.source_type.as_deref() {
            if record.source_type != source_type { continue; }
        }
        let job = record.job_id.as_deref()
            .and_then(|id| state.db.get(id).ok().flatten());
        if let Some(event_type) = query.event_type.as_deref() {
            if job.as_ref().and_then(|value| value.request.get("event"))
                .and_then(|event| event.get("type")).and_then(Value::as_str) != Some(event_type) {
                continue;
            }
        }
        if any_schedule_filter(&query) {
            let path = resolve_relative(&state.config.package_root, &record.artifact_path)?;
            if !matches_assignment_filter(&path, &query)? { continue; }
        }
        let download_id = record.sha256.clone();
        let record_source = record.source_type.clone();
        items.push(json!({
            "schedule":record,
            "job":job,
            "download_id":download_id,
            "source_type":record_source
        }));
        if items.len() >= limit { break; }
    }
    Ok(Json(json!({
        "items":items,
        "count":items.len(),
        "filters":{"dataset_id":query.dataset_id,"employee_id":query.employee_id,
            "factory_code":query.factory_code,"line_code":query.line_code,
            "date_from":query.date_from,"date_to":query.date_to,
            "shift_code":query.shift_code,"event_type":query.event_type,
            "source_type":query.source_type}
    })))
}

pub async fn download_file(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Response, AppError> {
    if id.len() != 64 || !id.chars().all(|value| value.is_ascii_hexdigit()) {
        return Err(AppError::NotFound);
    }
    let schedules = state.db.list_schedule_history(None, 1000)?;
    for schedule in schedules {
        if schedule.sha256 == id {
            return response_for_file(&state.config.package_root, &schedule.artifact_path, &id);
        }
    }
    let jobs = state.db.list(JobFilter { limit: 500, ..Default::default() })?;
    for job in jobs {
        let Some(result) = job.result else { continue };
        let Some(artifacts) = result.get("artifacts").and_then(Value::as_array) else { continue };
        for artifact in artifacts {
            if artifact.get("sha256").and_then(Value::as_str) == Some(id.as_str()) {
                let Some(path) = artifact.get("path").and_then(Value::as_str) else { continue };
                return response_for_file(&state.config.package_root, path, &id);
            }
        }
    }
    Err(AppError::NotFound)
}

fn any_schedule_filter(query: &ArchiveQuery) -> bool {
    query.employee_id.is_some() || query.factory_code.is_some() || query.line_code.is_some()
        || query.date_from.is_some() || query.date_to.is_some() || query.shift_code.is_some()
}

fn matches_assignment_filter(path: &Path, query: &ArchiveQuery) -> Result<bool, AppError> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_path(path)
        .map_err(|_| AppError::InvalidInput("方案 CSV 无法读取。".into()))?;
    for result in reader.records() {
        let row = result.map_err(|_| AppError::InvalidInput("方案 CSV 存在格式错误。".into()))?;
        if row.get(2) == Some("日期") || row.len() < 15 { continue; }
        if query.employee_id.as_deref().is_some_and(|value| row.get(5) != Some(value)) { continue; }
        if query.factory_code.as_deref().is_some_and(|value| row.get(0) != Some(value)) { continue; }
        if query.line_code.as_deref().is_some_and(|value| row.get(1) != Some(value)) { continue; }
        if query.shift_code.as_deref().is_some_and(|value| row.get(4) != Some(value) && row.get(3) != Some(value)) { continue; }
        let date = row.get(2).unwrap_or_default();
        if query.date_from.as_deref().is_some_and(|value| date < value) { continue; }
        if query.date_to.as_deref().is_some_and(|value| date > value) { continue; }
        return Ok(true);
    }
    Ok(false)
}

fn response_for_file(root: &Path, relative: &str, expected_sha256: &str) -> Result<Response, AppError> {
    let path = resolve_relative(root, relative)?;
    let bytes = std::fs::read(&path)?;
    let actual_sha256 = hex::encode(Sha256::digest(&bytes));
    if actual_sha256 != expected_sha256 {
        return Err(AppError::Conflict("文件内容与登记哈希不一致，下载已阻止。".into()));
    }
    let filename = path.file_name().and_then(|value| value.to_str()).unwrap_or("artifact.csv");
    let content_type = if path.extension().and_then(|value| value.to_str()) == Some("json") {
        "application/json; charset=utf-8"
    } else {
        "text/csv; charset=utf-8"
    };
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    let disposition = format!("attachment; filename=\"{}\"", filename.replace('"', ""));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).map_err(|_| AppError::InvalidInput("下载文件名无效。".into()))?,
    );
    Ok(response)
}

fn resolve_relative(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() || relative_path.components().any(|part| part == std::path::Component::ParentDir) {
        return Err(AppError::InvalidInput("文件路径超出工程包目录。".into()));
    }
    let root = root.canonicalize()?;
    let path = root.join(relative_path).canonicalize()
        .map_err(|_| AppError::NotFound)?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(AppError::NotFound);
    }
    Ok(path)
}
