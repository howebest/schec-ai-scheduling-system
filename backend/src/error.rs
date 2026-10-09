use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct FieldValidationError {
    pub path: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("配置错误：{0}")]
    Configuration(String),
    #[error("本机存储错误。")]
    Database(#[from] rusqlite::Error),
    #[error("文件操作失败。")]
    Io(#[from] std::io::Error),
    #[error("任务不存在。")]
    NotFound,
    #[error("任务状态冲突。")]
    Conflict(String),
    #[error("任务输入无效。")]
    InvalidInput(String),
    #[error("配置字段校验失败。")]
    FieldValidation(Vec<FieldValidationError>),
    #[error("任务超时。")]
    Timeout,
    #[error("任务已取消。")]
    Cancelled,
    #[error("Python 求解进程启动或执行失败。")]
    Python(String),
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: String,
    details: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    field_errors: Option<&'a [FieldValidationError]>,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Configuration(_) => "CONFIGURATION_ERROR",
            Self::Database(_) => "LOCAL_STORAGE_ERROR",
            Self::Io(_) => "FILE_OPERATION_ERROR",
            Self::NotFound => "NOT_FOUND",
            Self::Conflict(_) => "VERSION_CONFLICT",
            Self::InvalidInput(_) => "INVALID_INPUT",
            Self::FieldValidation(_) => "VALIDATION_FAILED",
            Self::Timeout => "JOB_TIMEOUT",
            Self::Cancelled => "JOB_CANCELLED",
            Self::Python(_) => "PYTHON_TASK_ERROR",
        }
    }

    fn status_code(&self) -> StatusCode {
        match self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::InvalidInput(_) | Self::FieldValidation(_) => StatusCode::BAD_REQUEST,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::Cancelled => StatusCode::CONFLICT,
            Self::Configuration(_) | Self::Database(_) | Self::Io(_) | Self::Python(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    fn user_message(&self) -> String {
        match self {
            Self::Configuration(message) | Self::Conflict(message) | Self::InvalidInput(message) => message.clone(),
            Self::FieldValidation(_) => "请修正标记的字段后重试。".into(),
            Self::NotFound => "未找到指定记录。".into(),
            Self::Timeout => "任务超过允许时限，已请求停止求解进程。".into(),
            Self::Cancelled => "任务已取消。".into(),
            Self::Database(_) => "本机数据库操作失败，请检查运行目录权限与磁盘空间。".into(),
            Self::Io(_) => "文件读写失败，请检查文件是否存在及运行目录权限。".into(),
            Self::Python(message) => message.clone(),
        }
    }

    fn details(&self) -> Vec<String> {
        match self {
            Self::Conflict(message) | Self::InvalidInput(message) | Self::Configuration(message) => vec![message.clone()],
            Self::FieldValidation(_) => Vec::new(),
            Self::Python(message) => vec![message.clone()],
            _ => Vec::new(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = ErrorBody {
            code: self.code(),
            message: self.user_message(),
            details: self.details(),
            field_errors: match &self {
                AppError::FieldValidation(errors) => Some(errors.as_slice()),
                _ => None,
            },
        };
        (status, axum::Json(body)).into_response()
    }
}
