mod config;
mod db;
mod error;
mod jobs;
mod models;
mod python;
mod scheduling;
mod api;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tower_http::limit::RequestBodyLimitLayer;
use tracing_subscriber::EnvFilter;

use crate::config::AppConfig;
use crate::db::JobRepository;
use crate::error::AppError;
use crate::jobs::JobManager;
use crate::python::PythonRunner;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db: JobRepository,
    pub scheduling: scheduling::SchedulingRepository,
    pub jobs: JobManager,
    pub python: PythonRunner,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let config = AppConfig::from_env()?;
    if !config.frontend_dir.join("index.html").is_file() {
        return Err(AppError::Configuration(format!(
            "前端静态资源不完整：缺少 {}。请先构建 frontend/dist。",
            config.frontend_dir.display()
        )).into());
    }
    let listener = TcpListener::bind(config.bind_addr).await.map_err(|error| {
        std::io::Error::new(error.kind(), format!("无法监听 {}；请检查端口是否被占用。原因：{error}", config.bind_addr))
    })?;
    let repository = JobRepository::open(&config.database_path)?;
    repository.recover_interrupted_jobs()?;
    repository.record_default_rule_version()?;
    seed_local_catalog(&repository, &config.package_root)?;
    repository.seed_expanded_demo_schedules(&config.package_root)?;
    let scheduling = scheduling::SchedulingRepository::new(&config.database_path);
    scheduling.seed_demo_catalog_once()?;
    scheduling.seed_employee_equipment_once()?;
    scheduling.seed_expanded_demo_catalog_once(&config.package_root)?;
    let runner = PythonRunner::new(&config);
    let jobs = JobManager::new(repository.clone(), runner.clone(), config.clone());
    let state = AppState { config: Arc::new(config.clone()), db: repository, scheduling, jobs: jobs.clone(), python: runner };
    let app = router(state, config.request_limit_bytes);
    tracing::info!(address = %config.bind_addr, package_root = %config.package_root.display(), "本机排班服务已启动");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(jobs))
        .await?;
    Ok(())
}

pub fn router(state: AppState, request_limit_bytes: usize) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/bootstrap", get(bootstrap))
        .merge(api::routes())
        .fallback(fallback)
        .layer(RequestBodyLimitLayer::new(request_limit_bytes))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "status":"ok",
        "service":"local-scheduling-service",
        "version":env!("CARGO_PKG_VERSION"),
        "platform":std::env::consts::OS,
        "architecture":std::env::consts::ARCH,
        "python_executable":state.config.python_bin.file_name().and_then(|v|v.to_str()).unwrap_or("python3.11")
    }))
}

async fn bootstrap() -> Json<serde_json::Value> {
    Json(json!({
        "application":"AI 智能排班本机工作台",
        "version":env!("CARGO_PKG_VERSION"),
        "roles":["计划员","班组长","主管","HR/考勤管理员","系统管理员","员工"],
        "source_types":["原始样本","已验收基准","用户导入","合成演示","本机模拟反馈","本机配置"],
        "integrations":{"status":"未连接","message":"HR、APS、MES、考勤与消息能力使用本机演示数据。"},
        "model_catalog":{"optimization":"SCHEC-MIP-V1.0","trained_models":[]}
    }))
}

async fn fallback(State(state): State<AppState>, request: Request) -> Response {
    let request_path = request.uri().path();
    let method = request.method().clone();
    if request_path.starts_with("/api/") {
        return (StatusCode::NOT_FOUND, Json(json!({
            "code":"NOT_FOUND","message":"未找到指定 API 接口。","details":[]
        }))).into_response();
    }
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }
    let root = match state.config.frontend_dir.canonicalize() {
        Ok(path) => path,
        Err(_) => return (StatusCode::SERVICE_UNAVAILABLE, "前端静态资源目录不可用。").into_response(),
    };
    let relative = request_path.trim_start_matches('/');
    let candidate = root.join(relative);
    let candidate = match candidate.canonicalize() {
        Ok(path) if path.starts_with(&root) && path.is_file() => path,
        _ if relative.is_empty() || Path::new(relative).extension().is_none() => root.join("index.html"),
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    static_file(candidate, method == Method::HEAD).await
}

async fn static_file(path: PathBuf, head_only: bool) -> Response {
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let content_type = match path.extension().and_then(|value| value.to_str()).unwrap_or("") {
                "html" => "text/html; charset=utf-8",
                "js" | "mjs" => "text/javascript; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "json" => "application/json; charset=utf-8",
                "svg" => "image/svg+xml",
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "woff2" => "font/woff2",
                _ => "application/octet-stream",
            };
            let mut response = Response::new(if head_only { Body::empty() } else { Body::from(bytes) });
            *response.status_mut() = StatusCode::OK;
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static(content_type),
            );
            if path.file_name().is_some_and(|name| name == "index.html") {
                response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
            } else {
                response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
            }
            response
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn shutdown_signal(jobs: JobManager) {
    #[cfg(unix)]
    {
        let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("无法注册 SIGTERM 处理器");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("正在停止排班服务并清理运行任务");
    jobs.shutdown().await;
}

fn seed_local_catalog(repository: &JobRepository, root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let demo_manifest_path = root.join("data/demo/manifest.json");
    if demo_manifest_path.is_file() {
        let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(demo_manifest_path)?)?;
        repository.update_dataset_manifest("synthetic-demo-20260930-v1", manifest)?;
    }
    let expanded_manifest_path = root.join("data/demo/expanded/dataset_manifest.json");
    if expanded_manifest_path.is_file() {
        let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(expanded_manifest_path)?)?;
        repository.update_dataset_manifest("synthetic-demo-expanded-20261008-v1", manifest)?;
    }
    let baseline_id = "baseline-full62-w1";
    if repository.get_schedule(baseline_id)?.is_none() {
        let relative = "data/baseline_schedule_FULL62_W1.csv";
        let bytes = std::fs::read(root.join(relative))?;
        let digest = hex::encode(Sha256::digest(&bytes));
        repository.insert_schedule_version(
            baseline_id,
            "accepted-baseline-v1",
            None,
            relative,
            &digest,
            json!({
                "all_pass":null,
                "source_type":"accepted_baseline",
                "verification_state":"本机待核验",
                "note":"保留已验收登记结果；本机硬约束核验需单独运行。"
            }),
            "accepted_baseline",
            None,
        )?;
    }
    Ok(())
}
