use std::path::{Path, PathBuf};

use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Local;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::db::{new_id, timestamp_now};
use crate::error::AppError;
use crate::models::DatasetRecord;
use crate::python::PythonRunner;
use crate::AppState;

#[derive(Deserialize)]
pub struct CommitImportRequest {
    pub preview_id: String,
    pub display_name: String,
    pub actor_id: String,
    pub actor_role: String,
    pub reason: String,
}

pub async fn list_datasets(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(json!({"items":state.db.list_datasets()?})))
}

pub async fn preview_import(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let mut schema_id = None;
    let mut file_name = None;
    let mut bytes = None;
    while let Some(field) = multipart.next_field().await
        .map_err(|_| AppError::InvalidInput("无法解析上传表单。".into()))?
    {
        let field_name = field.name().unwrap_or_default().to_owned();
        match field_name.as_str() {
            "schema_id" => {
                schema_id = Some(field.text().await.map_err(|_| AppError::InvalidInput("schema_id 字段格式无效。".into()))?);
            }
            "file" => {
                file_name = field.file_name().map(str::to_owned);
                bytes = Some(field.bytes().await.map_err(|_| AppError::InvalidInput("无法读取上传文件。".into()))?);
            }
            _ => {}
        }
    }
    let schema_id = schema_id.ok_or_else(|| AppError::InvalidInput("请选择导入模板。".into()))?;
    let bytes = bytes.ok_or_else(|| AppError::InvalidInput("请选择待预览的文件。".into()))?;
    let original_name = file_name.unwrap_or_else(|| "upload.bin".into());
    let extension = Path::new(&original_name).extension().and_then(|value| value.to_str())
        .unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "csv" | "xlsx" | "json") {
        return Err(AppError::InvalidInput("仅支持 CSV、XLSX 或 JSON 文件。".into()));
    }
    if bytes.is_empty() {
        return Err(AppError::InvalidInput("上传文件为空。".into()));
    }
    let preview_id = new_id("preview");
    let preview_dir = ensure_package_directory(
        &state.config.package_root, Path::new("out/import-previews").join(&preview_id).as_path(),
    )?;
    let upload_path = preview_dir.join(format!("upload.{extension}"));
    std::fs::write(&upload_path, &bytes)?;
    let digest = hex::encode(Sha256::digest(&bytes));
    let relative_upload = upload_path.strip_prefix(&state.config.package_root)
        .map_err(|_| AppError::InvalidInput("上传文件保存位置无效。".into()))?
        .to_string_lossy().replace('\\', "/");
    let request_path = preview_dir.join("request.json");
    let request = json!({
        "schema_version":1,"job_id":preview_id,"task":"preview_import",
        "dataset_version":"pending-import","input_files":{"upload":relative_upload},
        "parameters":{"schema_id":schema_id}
    });
    std::fs::write(&request_path, serde_json::to_vec_pretty(&request)
        .map_err(|_| AppError::InvalidInput("无法创建导入预览请求。".into()))?)?;
    let runner = PythonRunner::new(&state.config);
    let output = runner.run(&preview_id, &request_path, std::time::Duration::from_secs(45)).await?;
    if output.status != "succeeded" {
        let message = output.error.as_ref()
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("导入文件预览失败。");
        return Err(AppError::Python(message.to_owned()));
    }
    let preview = output.summary.unwrap_or(Value::Null);
    let metadata = json!({
        "preview_id":preview_id,"file_name":Path::new(&original_name).file_name().and_then(|v|v.to_str()).unwrap_or("upload"),
        "schema_id":schema_id,"relative_path":relative_upload,"sha256":digest,
        "source_type":"user_import","preview":preview,"created_at":timestamp_now()
    });
    std::fs::write(preview_dir.join("preview.json"), serde_json::to_vec_pretty(&metadata)
        .map_err(|_| AppError::InvalidInput("无法保存导入预览记录。".into()))?)?;
    Ok((StatusCode::OK, Json(json!({
        "preview_id":preview_id,
        "dataset_id":Value::Null,
        "source_type":"user_import",
        "sha256":digest,
        "accepted":preview.get("accepted").and_then(Value::as_bool).unwrap_or(false),
        "accepted_rows":preview.get("accepted_rows").and_then(Value::as_u64).unwrap_or(0),
        "rejected_rows":preview.get("rejected_rows").and_then(Value::as_u64).unwrap_or(0),
        "row_count":preview.get("row_count").and_then(Value::as_u64).unwrap_or(0),
        "field_errors":preview.get("field_errors").cloned().unwrap_or_else(||json!([])),
        "columns":preview.get("columns").cloned().unwrap_or_else(||json!([])),
        "sheets":preview.get("sheets").cloned().unwrap_or(Value::Null),
        "file_name":metadata["file_name"]
    }))))
}

pub async fn commit_import(
    State(state): State<AppState>,
    Json(request): Json<CommitImportRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if request.display_name.trim().is_empty() || request.actor_id.trim().is_empty()
        || request.reason.trim().is_empty()
    {
        return Err(AppError::InvalidInput("数据集名称、操作人和提交原因均为必填项。".into()));
    }
    if request.actor_role != "系统管理员" && request.actor_role != "计划员" {
        return Err(AppError::InvalidInput("当前角色没有提交数据集的权限。".into()));
    }
    if !valid_generated_id(&request.preview_id, "preview-") {
        return Err(AppError::InvalidInput("preview_id 格式无效。".into()));
    }
    let metadata_relative = format!("out/import-previews/{}/preview.json", request.preview_id);
    let metadata_path = resolve_package_file(&state.config.package_root, &metadata_relative)?;
    let metadata: Value = serde_json::from_slice(&std::fs::read(&metadata_path)
        .map_err(|_| AppError::NotFound)?)
        .map_err(|_| AppError::InvalidInput("导入预览记录已损坏。".into()))?;
    if !metadata["preview"]["accepted"].as_bool().unwrap_or(false) {
        return Err(AppError::InvalidInput("字段检查未通过，不能提交该数据集。".into()));
    }
    let source_rel = metadata["relative_path"].as_str()
        .ok_or_else(|| AppError::InvalidInput("预览文件路径缺失。".into()))?;
    let source_path = resolve_package_file(&state.config.package_root, source_rel)?;
    let expected_hash = metadata["sha256"].as_str().unwrap_or_default();
    let actual_hash = hash_file(&source_path)?;
    if actual_hash != expected_hash {
        return Err(AppError::Conflict("预览后文件内容发生变化，请重新上传并检查。".into()));
    }
    let dataset_id = new_id("import");
    let destination_dir = ensure_package_directory(
        &state.config.package_root, Path::new("data/imported").join(&dataset_id).as_path(),
    )?;
    let original_extension = source_path.extension().and_then(|value| value.to_str()).unwrap_or("dat");
    let stored_name = format!("source.{original_extension}");
    let destination = destination_dir.join(&stored_name);
    let temporary = destination_dir.join(format!("{stored_name}.tmp"));
    std::fs::copy(&source_path, &temporary)?;
    std::fs::rename(&temporary, &destination)?;
    let relative_path = destination.strip_prefix(&state.config.package_root)
        .map_err(|_| AppError::InvalidInput("数据集文件保存位置无效。".into()))?
        .to_string_lossy().replace('\\', "/");
    let now = Local::now().to_rfc3339();
    let manifest = json!({
        "schema_version":1,"dataset_version":dataset_id,"source_type":"user_import",
        "schema_id":metadata["schema_id"],"files":{"primary":{"path":relative_path,"sha256":actual_hash}},
        "preview":metadata["preview"],"actor_id":request.actor_id,"reason":request.reason,
        "created_at":now
    });
    let record = DatasetRecord {
        id: dataset_id.clone(), version: dataset_id.clone(), source_type: "user_import".into(),
        display_name: request.display_name.trim().into(), manifest: manifest.clone(), created_at: now,
    };
    if let Err(error) = state.db.add_dataset(&record) {
        let _ = std::fs::remove_dir_all(&destination_dir);
        return Err(error);
    }
    state.db.write_audit(
        &request.actor_id, &request.actor_role, "import_dataset", "dataset", &dataset_id,
        &request.reason, None, Some(manifest),
    )?;
    Ok((StatusCode::CREATED, Json(json!({"dataset":record}))))
}

fn valid_generated_id(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() <= 80
        && value[prefix.len()..].chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn resolve_package_file(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() || relative_path.components().any(|part| part == std::path::Component::ParentDir) {
        return Err(AppError::InvalidInput("数据文件路径无效。".into()));
    }
    let root = root.canonicalize()?;
    let path = root.join(relative_path).canonicalize()?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(AppError::InvalidInput("数据文件不在工程包目录中。".into()));
    }
    Ok(path)
}

fn hash_file(path: &Path) -> Result<String, AppError> {
    let bytes = std::fs::read(path)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn ensure_package_directory(root: &Path, relative: &Path) -> Result<PathBuf, AppError> {
    let canonical_root = root.canonicalize()?;
    if relative.is_absolute() || relative.components().any(|part| part == std::path::Component::ParentDir) {
        return Err(AppError::InvalidInput("目录路径无效。".into()));
    }
    let mut current = canonical_root.clone();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else { continue };
        current.push(name);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(AppError::InvalidInput("目标目录包含符号链接或非目录路径。".into()));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => std::fs::create_dir(&current)?,
            Err(error) => return Err(AppError::Io(error)),
        }
    }
    let resolved = current.canonicalize()?;
    if !resolved.starts_with(&canonical_root) {
        return Err(AppError::InvalidInput("目标目录超出工程包目录。".into()));
    }
    Ok(resolved)
}
