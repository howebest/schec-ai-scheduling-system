use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, FieldValidationError};
use crate::scheduling::{
    CalendarQuery, ConfigFilter, EmployeeEquipmentWrite, EmployeeFilter, EmployeeWrite,
    EquipmentFilter, QualificationFilter, QualificationWrite, ScheduleConfigDraft, TeamFilter,
    TeamWrite,
};
use crate::AppState;

const DEFAULT_ACTOR_ID: &str = "本机计划员";
const DEFAULT_ACTOR_ROLE: &str = "计划员";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/scheduling/configurations",
            get(list_configurations).post(create_configuration),
        )
        .route(
            "/api/v1/scheduling/configurations/validate",
            post(validate_configuration),
        )
        .route(
            "/api/v1/scheduling/configurations/{id}",
            get(get_configuration).put(update_configuration),
        )
        .route(
            "/api/v1/scheduling/configurations/{id}/copy",
            post(copy_configuration),
        )
        .route(
            "/api/v1/scheduling/configurations/{id}/activate",
            post(activate_configuration),
        )
        .route(
            "/api/v1/scheduling/configurations/{id}/deactivate",
            post(deactivate_configuration),
        )
        .route("/api/v1/scheduling/calendar", get(calendar))
        .route(
            "/api/v1/scheduling/employees",
            get(list_employees).post(create_employee),
        )
        .route(
            "/api/v1/scheduling/employees/{id}",
            get(get_employee).put(update_employee),
        )
        .route(
            "/api/v1/scheduling/employees/{id}/equipment",
            get(list_employee_equipment).put(replace_employee_equipment),
        )
        .route("/api/v1/scheduling/equipment", get(list_equipment))
        .route("/api/v1/scheduling/teams", get(list_teams).post(create_team))
        .route("/api/v1/scheduling/teams/{id}", get(get_team).put(update_team))
        .route(
            "/api/v1/scheduling/qualifications",
            get(list_qualifications).post(create_qualification),
        )
        .route(
            "/api/v1/scheduling/qualifications/{id}",
            get(get_qualification).put(update_qualification),
        )
        .route("/api/v1/scheduling/lines", get(lines))
        .route("/api/v1/scheduling/positions", get(positions))
}

#[derive(Debug, Deserialize)]
struct Mutation<T> {
    data: T,
    #[serde(default)]
    actor_id: Option<String>,
    #[serde(default)]
    actor_role: Option<String>,
    reason: String,
}

impl<T> Mutation<T> {
    fn actor(&self) -> (String, String) {
        (
            self.actor_id.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| DEFAULT_ACTOR_ID.into()),
            self.actor_role.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| DEFAULT_ACTOR_ROLE.into()),
        )
    }
}

#[derive(Debug, Deserialize)]
struct ReasonRequest {
    #[serde(default)]
    actor_id: Option<String>,
    #[serde(default)]
    actor_role: Option<String>,
    reason: String,
}

impl ReasonRequest {
    fn actor(&self) -> (String, String) {
        (
            self.actor_id.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| DEFAULT_ACTOR_ID.into()),
            self.actor_role.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| DEFAULT_ACTOR_ROLE.into()),
        )
    }
}

#[derive(Debug, Deserialize)]
struct CopyRequest {
    name: String,
    start_date: NaiveDate,
    end_date: Option<NaiveDate>,
    #[serde(default)]
    actor_id: Option<String>,
    #[serde(default)]
    actor_role: Option<String>,
    reason: String,
}

impl CopyRequest {
    fn actor(&self) -> (String, String) {
        (
            self.actor_id.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| DEFAULT_ACTOR_ID.into()),
            self.actor_role.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| DEFAULT_ACTOR_ROLE.into()),
        )
    }
}

#[derive(Debug, Deserialize)]
struct CalendarParams {
    line_id: String,
    start_date: String,
    end_date: String,
    config_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ValidationResponse {
    valid: bool,
    field_errors: Vec<FieldValidationError>,
}

#[derive(Debug, Serialize)]
struct ItemsResponse<T> {
    items: Vec<T>,
}

async fn list_configurations(
    State(state): State<AppState>,
    Query(filter): Query<ConfigFilter>,
) -> Result<Json<crate::scheduling::Page<crate::scheduling::ScheduleConfigRecord>>, AppError> {
    Ok(Json(state.scheduling.list_configurations(&filter)?))
}

async fn get_configuration(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::scheduling::ScheduleConfigRecord>, AppError> {
    state.scheduling.get_configuration(&id)?.map(Json).ok_or(AppError::NotFound)
}

async fn validate_configuration(
    State(state): State<AppState>,
    Json(draft): Json<ScheduleConfigDraft>,
) -> Result<Json<ValidationResponse>, AppError> {
    let field_errors = state.scheduling.validate_configuration(&draft, None)?;
    Ok(Json(ValidationResponse {
        valid: field_errors.is_empty(),
        field_errors,
    }))
}

async fn create_configuration(
    State(state): State<AppState>,
    Json(request): Json<Mutation<ScheduleConfigDraft>>,
) -> Result<(StatusCode, Json<crate::scheduling::ScheduleConfigRecord>), AppError> {
    let (actor_id, actor_role) = request.actor();
    let record = state.scheduling.create_configuration(&request.data, &actor_id, &actor_role, &request.reason)?;
    Ok((StatusCode::CREATED, Json(record)))
}

async fn update_configuration(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<Mutation<ScheduleConfigDraft>>,
) -> Result<Json<crate::scheduling::ScheduleConfigRecord>, AppError> {
    let (actor_id, actor_role) = request.actor();
    Ok(Json(state.scheduling.update_configuration(&id, &request.data, &actor_id, &actor_role, &request.reason)?))
}

async fn copy_configuration(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<CopyRequest>,
) -> Result<(StatusCode, Json<crate::scheduling::ScheduleConfigRecord>), AppError> {
    let (actor_id, actor_role) = request.actor();
    let record = state.scheduling.copy_configuration(
        &id,
        &request.name,
        request.start_date,
        request.end_date,
        &actor_id,
        &actor_role,
        &request.reason,
    )?;
    Ok((StatusCode::CREATED, Json(record)))
}

async fn activate_configuration(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ReasonRequest>,
) -> Result<Json<crate::scheduling::ScheduleConfigRecord>, AppError> {
    let (actor_id, actor_role) = request.actor();
    Ok(Json(state.scheduling.activate_configuration(&id, &actor_id, &actor_role, &request.reason)?))
}

async fn deactivate_configuration(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ReasonRequest>,
) -> Result<Json<crate::scheduling::ScheduleConfigRecord>, AppError> {
    let (actor_id, actor_role) = request.actor();
    Ok(Json(state.scheduling.deactivate_configuration(&id, &actor_id, &actor_role, &request.reason)?))
}

async fn calendar(
    State(state): State<AppState>,
    Query(params): Query<CalendarParams>,
) -> Result<Json<ItemsResponse<crate::scheduling::CalendarEntry>>, AppError> {
    let start_date = parse_query_date(&params.start_date, "start_date")?;
    let end_date = parse_query_date(&params.end_date, "end_date")?;
    let query = CalendarQuery {
        line_id: params.line_id,
        start_date,
        end_date,
        config_id: params.config_id,
    };
    let entries = state.scheduling.generate_calendar(&query)?;
    Ok(Json(ItemsResponse { items: entries }))
}

async fn list_employees(
    State(state): State<AppState>,
    Query(filter): Query<EmployeeFilter>,
) -> Result<Json<crate::scheduling::Page<crate::scheduling::EmployeeProfile>>, AppError> {
    Ok(Json(state.scheduling.list_employees(&filter)?))
}

async fn get_employee(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::scheduling::EmployeeProfile>, AppError> {
    state.scheduling.get_employee(&id)?.map(Json).ok_or(AppError::NotFound)
}

async fn create_employee(
    State(state): State<AppState>,
    Json(request): Json<Mutation<EmployeeWrite>>,
) -> Result<(StatusCode, Json<crate::scheduling::EmployeeProfile>), AppError> {
    let (actor_id, actor_role) = request.actor();
    let record = state.scheduling.create_employee(&request.data, &actor_id, &actor_role, &request.reason)?;
    Ok((StatusCode::CREATED, Json(record)))
}

async fn update_employee(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<Mutation<EmployeeWrite>>,
) -> Result<Json<crate::scheduling::EmployeeProfile>, AppError> {
    let (actor_id, actor_role) = request.actor();
    Ok(Json(state.scheduling.update_employee(&id, &request.data, &actor_id, &actor_role, &request.reason)?))
}

async fn list_equipment(
    State(state): State<AppState>,
    Query(filter): Query<EquipmentFilter>,
) -> Result<Json<crate::scheduling::Page<crate::scheduling::EquipmentRecord>>, AppError> {
    Ok(Json(state.scheduling.list_equipment(&filter)?))
}

async fn list_employee_equipment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ItemsResponse<crate::scheduling::EmployeeEquipmentRecord>>, AppError> {
    Ok(Json(ItemsResponse { items: state.scheduling.employee_equipment(&id)? }))
}

async fn replace_employee_equipment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<Mutation<Vec<EmployeeEquipmentWrite>>>,
) -> Result<Json<ItemsResponse<crate::scheduling::EmployeeEquipmentRecord>>, AppError> {
    let (actor_id, actor_role) = request.actor();
    let items = state.scheduling.replace_employee_equipment(
        &id, &request.data, &actor_id, &actor_role, &request.reason,
    )?;
    Ok(Json(ItemsResponse { items }))
}

async fn list_teams(
    State(state): State<AppState>,
    Query(filter): Query<TeamFilter>,
) -> Result<Json<crate::scheduling::Page<crate::scheduling::TeamRecord>>, AppError> {
    Ok(Json(state.scheduling.list_teams(&filter)?))
}

async fn get_team(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::scheduling::TeamRecord>, AppError> {
    state.scheduling.get_team(&id)?.map(Json).ok_or(AppError::NotFound)
}

async fn create_team(
    State(state): State<AppState>,
    Json(request): Json<Mutation<TeamWrite>>,
) -> Result<(StatusCode, Json<crate::scheduling::TeamRecord>), AppError> {
    let (actor_id, actor_role) = request.actor();
    let record = state.scheduling.create_team(&request.data, &actor_id, &actor_role, &request.reason)?;
    Ok((StatusCode::CREATED, Json(record)))
}

async fn update_team(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<Mutation<TeamWrite>>,
) -> Result<Json<crate::scheduling::TeamRecord>, AppError> {
    let (actor_id, actor_role) = request.actor();
    Ok(Json(state.scheduling.update_team(&id, &request.data, &actor_id, &actor_role, &request.reason)?))
}

async fn list_qualifications(
    State(state): State<AppState>,
    Query(filter): Query<QualificationFilter>,
) -> Result<Json<crate::scheduling::Page<crate::scheduling::QualificationRecord>>, AppError> {
    Ok(Json(state.scheduling.list_qualifications(&filter)?))
}

async fn get_qualification(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<crate::scheduling::QualificationRecord>, AppError> {
    state.scheduling.get_qualification(&id)?.map(Json).ok_or(AppError::NotFound)
}

async fn create_qualification(
    State(state): State<AppState>,
    Json(request): Json<Mutation<QualificationWrite>>,
) -> Result<(StatusCode, Json<crate::scheduling::QualificationRecord>), AppError> {
    let (actor_id, actor_role) = request.actor();
    let record = state.scheduling.create_qualification(&request.data, &actor_id, &actor_role, &request.reason)?;
    Ok((StatusCode::CREATED, Json(record)))
}

async fn update_qualification(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<Mutation<QualificationWrite>>,
) -> Result<Json<crate::scheduling::QualificationRecord>, AppError> {
    let (actor_id, actor_role) = request.actor();
    Ok(Json(state.scheduling.update_qualification(&id, &request.data, &actor_id, &actor_role, &request.reason)?))
}

async fn lines(State(state): State<AppState>) -> Result<Json<ItemsResponse<crate::scheduling::LineRecord>>, AppError> {
    Ok(Json(ItemsResponse { items: state.scheduling.list_lines()? }))
}

async fn positions(State(state): State<AppState>) -> Result<Json<ItemsResponse<crate::scheduling::PositionRecord>>, AppError> {
    Ok(Json(ItemsResponse { items: state.scheduling.list_positions()? }))
}

fn parse_query_date(value: &str, path: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| {
        AppError::FieldValidation(vec![FieldValidationError {
            path: path.to_owned(),
            code: "INVALID_DATE".to_owned(),
            message: "日期须采用 YYYY-MM-DD 格式。".to_owned(),
        }])
    })
}
