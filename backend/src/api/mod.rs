pub mod analytics;
pub mod archive;
pub mod datasets;
pub mod handlers;
pub mod schedules;
pub mod scheduling;

use axum::routing::{get, post};
use axum::Router;

use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/datasets", get(datasets::list_datasets))
        .route("/api/v1/datasets/import/preview", post(datasets::preview_import))
        .route("/api/v1/datasets/import/commit", post(datasets::commit_import))
        .route("/api/v1/rules", get(handlers::list_rules).post(handlers::update_rules))
        .route("/api/v1/jobs", get(handlers::list_jobs).post(handlers::create_job))
        .route("/api/v1/jobs/{id}", get(handlers::get_job))
        .route("/api/v1/jobs/{id}/cancel", post(handlers::cancel_job))
        .route("/api/v1/schedules/{id}", get(schedules::get_schedule))
        .route("/api/v1/schedules/{id}/adjustments", post(schedules::adjust_schedule))
        .route("/api/v1/schedules/{id}/validate", post(schedules::validate_schedule))
        .route("/api/v1/schedules/{id}/approval", post(schedules::approve_schedule))
        .route("/api/v1/analytics/kpis", get(analytics::kpis))
        .route("/api/v1/analytics/attendance", get(analytics::attendance))
        .route("/api/v1/archive", get(archive::list_archive))
        .route("/api/v1/feedback", post(handlers::create_feedback).get(handlers::list_feedback))
        .route("/api/v1/files/{id}", get(archive::download_file))
        .merge(scheduling::routes())
}
