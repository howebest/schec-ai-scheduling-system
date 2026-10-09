use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use crate::error::AppError;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub package_root: PathBuf,
    pub bind_addr: SocketAddr,
    pub database_path: PathBuf,
    pub frontend_dir: PathBuf,
    pub python_bin: PathBuf,
    pub python_vendor_dir: PathBuf,
    pub default_job_timeout_seconds: u64,
    pub request_limit_bytes: usize,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, AppError> {
        let package_root = match env::var_os("SCHED_PACKAGE_ROOT") {
            Some(path) => PathBuf::from(path).canonicalize().map_err(AppError::Io)?,
            None => discover_package_root()?,
        };
        let host = env::var("SCHED_HOST").unwrap_or_else(|_| "127.0.0.1".to_owned());
        let port = env::var("SCHED_PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| AppError::Configuration("SCHED_PORT 必须为 1 至 65535 的整数。".into()))?
            .unwrap_or(8080);
        if port == 0 {
            return Err(AppError::Configuration("SCHED_PORT 必须为 1 至 65535 的整数。".into()));
        }
        let bind_addr = format!("{host}:{port}")
            .parse()
            .map_err(|_| AppError::Configuration("SCHED_HOST 与 SCHED_PORT 不是有效监听地址。".into()))?;
        let database_path = env::var_os("SCHED_DB_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| package_root.join("data/runtime/scheduling.sqlite3"));
        let frontend_dir = env::var_os("SCHED_FRONTEND_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| package_root.join("frontend/dist"));
        let python_bin = env::var_os("SCHED_PYTHON_BIN")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("python3.11"));
        let python_vendor_dir = package_root.join("vendor/python/macos-arm64-cp311");
        let default_job_timeout_seconds = env::var("SCHED_JOB_TIMEOUT_SECONDS")
            .ok()
            .map(|value| value.parse::<u64>())
            .transpose()
            .map_err(|_| AppError::Configuration("SCHED_JOB_TIMEOUT_SECONDS 必须为正整数。".into()))?
            .unwrap_or(600);
        let request_limit_bytes = env::var("SCHED_REQUEST_LIMIT_BYTES")
            .ok()
            .map(|value| value.parse::<usize>())
            .transpose()
            .map_err(|_| AppError::Configuration("SCHED_REQUEST_LIMIT_BYTES 必须为正整数。".into()))?
            .unwrap_or(128 * 1024 * 1024);
        if default_job_timeout_seconds == 0 || request_limit_bytes == 0 {
            return Err(AppError::Configuration("任务时限与请求大小限制必须大于零。".into()));
        }
        Ok(Self {
            package_root,
            bind_addr,
            database_path,
            frontend_dir,
            python_bin,
            python_vendor_dir,
            default_job_timeout_seconds,
            request_limit_bytes,
        })
    }
}

fn discover_package_root() -> Result<PathBuf, AppError> {
    let executable = env::current_exe().map_err(AppError::Io)?;
    let candidates = executable.ancestors().chain([Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap_or(Path::new("."))]);
    for candidate in candidates {
        if candidate.join("src/sched_solver.py").is_file()
            && candidate.join("backend/Cargo.toml").is_file()
        {
            return candidate.canonicalize().map_err(AppError::Io);
        }
    }
    Err(AppError::Configuration(
        "无法定位工程包根目录；请通过 SCHED_PACKAGE_ROOT 指定包含 src/sched_solver.py 的目录。".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_root_discovery_finds_source_root() {
        assert!(discover_package_root().is_ok());
    }
}
