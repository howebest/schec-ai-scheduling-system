use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Info,
    SolveDemo,
    SolveFull,
    VerifyBaseline,
    Reschedule,
    Kpi,
    ValidateSchedule,
    AdjustSchedule,
}

impl JobKind {
    pub fn adapter_task(&self) -> &'static str {
        match self {
            Self::Info => "info",
            Self::SolveDemo => "solve_demo",
            Self::SolveFull => "solve_full",
            Self::VerifyBaseline => "verify_baseline",
            Self::Reschedule => "reschedule",
            Self::Kpi => "kpi",
            Self::ValidateSchedule => "validate_schedule",
            Self::AdjustSchedule => "adjust_schedule",
        }
    }

    pub fn as_str(&self) -> &'static str {
        self.adapter_task()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn can_transition_to(&self, next: &Self) -> bool {
        matches!(
            (self, next),
            (Self::Queued, Self::Running | Self::Cancelled | Self::Failed)
                | (Self::Running, Self::Succeeded | Self::Failed | Self::Cancelled)
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JobCreateRequest {
    pub kind: JobKind,
    pub dataset_id: String,
    #[serde(default = "default_actor_id")]
    pub actor_id: String,
    #[serde(default = "default_actor_role")]
    pub actor_role: String,
    #[serde(default = "default_action_reason")]
    pub reason: String,
    #[serde(default)]
    pub baseline_schedule_id: Option<String>,
    #[serde(default)]
    pub event: Option<EventPayload>,
    #[serde(default)]
    pub parameters: BTreeMap<String, Value>,
}

fn default_actor_id() -> String { "本机计划员".into() }
fn default_actor_role() -> String { "计划员".into() }
fn default_action_reason() -> String { "提交本机任务".into() }

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EventPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JobRecord {
    pub id: String,
    pub kind: JobKind,
    pub dataset_id: String,
    pub status: JobStatus,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub solver_termination: Option<String>,
    pub request: Value,
    pub result: Option<Value>,
    pub error: Option<Value>,
}

#[derive(Clone, Debug, Default)]
pub struct JobUpdate {
    pub status: Option<JobStatus>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub solver_termination: Option<String>,
    pub result: Option<Value>,
    pub error: Option<Value>,
}

#[derive(Clone, Debug, Default)]
pub struct JobFilter {
    pub status: Option<JobStatus>,
    pub dataset_id: Option<String>,
    pub limit: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct JobOutput {
    pub schema: String,
    pub job_id: String,
    pub status: String,
    pub exit_code: i32,
    pub summary: Option<Value>,
    pub verification: Option<Value>,
    pub timings: Value,
    pub artifacts: Vec<ArtifactRef>,
    pub error: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ArtifactRef {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DatasetRecord {
    pub id: String,
    pub version: String,
    pub source_type: String,
    pub display_name: String,
    pub manifest: Value,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ScheduleRecord {
    pub id: String,
    pub schedule_id: String,
    pub dataset_id: String,
    pub job_id: Option<String>,
    pub version: i64,
    pub artifact_path: String,
    pub sha256: String,
    pub verification: Value,
    pub source_type: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RuleVersionRecord {
    pub id: String,
    pub version: i64,
    pub values: Value,
    pub actor_id: String,
    pub reason: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AnalyticsResponse {
    pub metric_id: String,
    pub value: Option<f64>,
    pub unit: String,
    pub group_by: Vec<String>,
    pub date_range: Option<[String; 2]>,
    pub sample_count: u64,
    pub source_type: String,
    pub definition: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_job_states_cannot_transition_back_to_running() {
        assert!(!JobStatus::Succeeded.can_transition_to(&JobStatus::Running));
        assert!(!JobStatus::Cancelled.can_transition_to(&JobStatus::Succeeded));
        assert!(JobStatus::Queued.can_transition_to(&JobStatus::Running));
        assert!(JobStatus::Running.can_transition_to(&JobStatus::Failed));
    }

    #[test]
    fn job_kind_serializes_to_adapter_task_name() {
        assert_eq!(JobKind::SolveDemo.adapter_task(), "solve_demo");
        assert_eq!(serde_json::to_string(&JobStatus::Queued).unwrap(), "\"queued\"");
    }
}
