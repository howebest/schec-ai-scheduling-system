use std::fs;
use std::path::{Path, PathBuf};

use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::AppError;
use crate::models::{
    DatasetRecord, JobFilter, JobKind, JobRecord, JobUpdate,
    RuleVersionRecord, ScheduleRecord,
};

#[derive(Clone, Debug)]
pub struct JobRepository {
    database_path: PathBuf,
}

#[derive(Clone, Debug)]
pub struct NewJob {
    pub id: String,
    pub kind: JobKind,
    pub dataset_id: String,
    pub request: Value,
    pub actor_id: String,
    pub actor_role: String,
    pub reason: String,
    pub created_at: String,
}

impl JobRepository {
    pub fn open(database_path: impl AsRef<Path>) -> Result<Self, AppError> {
        let database_path = database_path.as_ref().to_path_buf();
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let repository = Self { database_path };
        let connection = repository.connect()?;
        connection.execute_batch(include_str!("../migrations/001_initial.sql"))?;
        connection.execute_batch(include_str!("../migrations/002_scheduling_config.sql"))?;
        connection.execute_batch(include_str!("../migrations/003_employee_equipment.sql"))?;
        connection.execute_batch(include_str!("../migrations/004_demo_data_catalog.sql"))?;
        Ok(repository)
    }

    fn connect(&self) -> Result<Connection, AppError> {
        let connection = Connection::open(&self.database_path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(connection)
    }

    pub fn create(&self, job: &NewJob) -> Result<JobRecord, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO jobs(id,kind,dataset_id,status,request_json,created_at) VALUES(?1,?2,?3,'queued',?4,?5)",
            params![job.id, job.kind.as_str(), job.dataset_id, job.request.to_string(), job.created_at],
        )?;
        transaction.execute(
            "INSERT INTO audit_log(id,actor_id,actor_role,action,entity_type,entity_id,reason,before_json,after_json,created_at) VALUES(?1,?2,?3,'create','job',?4,?5,NULL,?6,?7)",
            params![new_id("audit"), job.actor_id, job.actor_role, job.id, job.reason,
                    job.request.to_string(), job.created_at],
        )?;
        let record = get_with_connection(&transaction, &job.id)?.ok_or(AppError::NotFound)?;
        transaction.commit()?;
        Ok(record)
    }

    pub fn update_status(&self, id: &str, update: JobUpdate) -> Result<JobRecord, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let current = get_with_connection(&transaction, id)?.ok_or(AppError::NotFound)?;
        if let Some(next) = update.status.as_ref() {
            if current.status != *next && !current.status.can_transition_to(next) {
                return Err(AppError::Conflict(format!(
                    "任务状态不能从 {} 转换为 {}。",
                    current.status.as_str(),
                    next.as_str()
                )));
            }
        }
        transaction.execute(
            "UPDATE jobs SET status=COALESCE(?2,status), started_at=COALESCE(?3,started_at), finished_at=COALESCE(?4,finished_at), solver_termination=COALESCE(?5,solver_termination), result_json=COALESCE(?6,result_json), error_json=COALESCE(?7,error_json) WHERE id=?1",
            params![
                id,
                update.status.map(|value| value.as_str().to_owned()),
                update.started_at,
                update.finished_at,
                update.solver_termination,
                update.result.map(|value| value.to_string()),
                update.error.map(|value| value.to_string()),
            ],
        )?;
        transaction.commit()?;
        self.get(id)?.ok_or(AppError::NotFound)
    }

    pub fn get(&self, id: &str) -> Result<Option<JobRecord>, AppError> {
        let connection = self.connect()?;
        self.get_with_connection(&connection, id)
    }

    fn get_with_connection(&self, connection: &Connection, id: &str) -> Result<Option<JobRecord>, AppError> {
        get_with_connection(connection, id)
    }

    pub fn list(&self, filter: JobFilter) -> Result<Vec<JobRecord>, AppError> {
        let connection = self.connect()?;
        let status = filter.status.as_ref().map(|value| value.as_str().to_owned());
        let dataset_id = filter.dataset_id;
        let limit = if filter.limit == 0 { 100 } else { filter.limit.clamp(1, 500) } as i64;
        let mut statement = connection.prepare(
            "SELECT id,kind,dataset_id,status,request_json,result_json,solver_termination,error_json,created_at,started_at,finished_at FROM jobs WHERE (?1 IS NULL OR status=?1) AND (?2 IS NULL OR dataset_id=?2) ORDER BY created_at DESC LIMIT ?3",
        )?;
        let rows = statement.query_map(params![status, dataset_id, limit], row_to_job)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn get_dataset(&self, id: &str) -> Result<Option<DatasetRecord>, AppError> {
        let connection = self.connect()?;
        let record = connection.query_row(
            "SELECT id,version,source_type,display_name,manifest_json,created_at FROM datasets WHERE id=?1",
            [id],
            |row| {
                let manifest: String = row.get(4)?;
                Ok(DatasetRecord {
                    id: row.get(0)?,
                    version: row.get(1)?,
                    source_type: row.get(2)?,
                    display_name: row.get(3)?,
                    manifest: serde_json::from_str(&manifest).unwrap_or(Value::Null),
                    created_at: row.get(5)?,
                })
            },
        ).optional()?;
        Ok(record)
    }

    pub fn list_datasets(&self) -> Result<Vec<DatasetRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id,version,source_type,display_name,manifest_json,created_at FROM datasets ORDER BY created_at,id",
        )?;
        let rows = statement.query_map([], |row| {
            let manifest: String = row.get(4)?;
            Ok(DatasetRecord {
                id: row.get(0)?,
                version: row.get(1)?,
                source_type: row.get(2)?,
                display_name: row.get(3)?,
                manifest: serde_json::from_str(&manifest).unwrap_or(Value::Null),
                created_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn add_dataset(&self, dataset: &DatasetRecord) -> Result<(), AppError> {
        let connection = self.connect()?;
        connection.execute(
            "INSERT INTO datasets(id,version,source_type,display_name,manifest_json,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![dataset.id, dataset.version, dataset.source_type, dataset.display_name, dataset.manifest.to_string(), dataset.created_at],
        )?;
        Ok(())
    }

    pub fn update_dataset_manifest(&self, id: &str, manifest: Value) -> Result<(), AppError> {
        let connection = self.connect()?;
        connection.execute("UPDATE datasets SET manifest_json=?2 WHERE id=?1", params![id, manifest.to_string()])?;
        Ok(())
    }

    pub fn seed_expanded_demo_schedules(&self, package_root: &Path) -> Result<(), AppError> {
        let manifest_path = package_root.join("data/demo/expanded/scenario_manifest.json");
        let manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).map_err(|error| {
            AppError::Configuration(format!("无法读取扩充演示方案目录：{error}"))
        })?).map_err(|error| AppError::Configuration(format!("扩充演示方案目录格式无效：{error}")))?;
        let dataset_id = manifest.get("dataset_id").and_then(Value::as_str)
            .ok_or_else(|| AppError::Configuration("扩充演示方案目录缺少 dataset_id。".into()))?;
        let plans = manifest.get("plans").and_then(Value::as_array)
            .ok_or_else(|| AppError::Configuration("扩充演示方案目录缺少 plans 列表。".into()))?;

        for plan in plans {
            let schedule_id = required_string(plan, "schedule_id")?;
            let artifact_path = required_string(plan, "artifact_path")?;
            let relative = Path::new(artifact_path);
            if relative.is_absolute() || relative.components().any(|part| part == std::path::Component::ParentDir) {
                return Err(AppError::Configuration(format!("方案 {schedule_id} 的文件路径超出工程包目录。")));
            }
            let bytes = fs::read(package_root.join(relative)).map_err(|error| {
                AppError::Configuration(format!("无法读取方案 {schedule_id} 的数据文件：{error}"))
            })?;
            let sha256 = hex::encode(Sha256::digest(&bytes));
            if plan.get("sha256").and_then(Value::as_str) != Some(sha256.as_str()) {
                return Err(AppError::Configuration(format!("方案 {schedule_id} 的 SHA-256 与目录清单不一致。")));
            }
            let record = if let Some(existing) = self.get_schedule(schedule_id)? {
                existing
            } else {
                let verification = json!({
                    "all_pass": null,
                    "verification_state": plan.get("verification_state").cloned().unwrap_or(Value::Null),
                    "violation_count": plan.pointer("/metrics/rule_violation_count").cloned().unwrap_or(Value::Null),
                    "violations": plan.get("violations").cloned().unwrap_or_else(|| json!({})),
                    "scenario_code": plan.get("scenario_code").cloned().unwrap_or(Value::Null),
                    "scenario_name": plan.get("scenario_name").cloned().unwrap_or(Value::Null),
                    "scenario_family": plan.get("scenario_family").cloned().unwrap_or(Value::Null),
                    "strategy": plan.get("strategy").cloned().unwrap_or(Value::Null),
                    "comparison_group": plan.get("comparison_group").cloned().unwrap_or(Value::Null),
                    "demand_profile": plan.get("demand_profile").cloned().unwrap_or(Value::Null),
                    "comparison_dimensions": plan.get("comparison_dimensions").cloned().unwrap_or_else(|| json!([])),
                    "metrics": plan.get("metrics").cloned().unwrap_or_else(|| json!({})),
                    "notes": plan.get("notes").cloned().unwrap_or(Value::Null),
                    "source_type": "synthetic_demo",
                    "note": "场景规则指标仅用于本机对照分析，未替代独立硬约束核验。"
                });
                self.insert_schedule_version(
                    schedule_id, dataset_id, None, artifact_path, &sha256, verification,
                    "synthetic_demo", None,
                )?
            };

            let existing_feedback = self.list_feedback(None, Some(&record.id), 500)?;
            let existing_employees: std::collections::HashSet<String> = existing_feedback.iter()
                .filter_map(|item| item.get("employee_id").and_then(Value::as_str).map(ToOwned::to_owned))
                .collect();
            if let Some(samples) = plan.get("feedback_samples").and_then(Value::as_array) {
                for sample in samples {
                    let employee_id = required_string(sample, "employee_id")?;
                    if existing_employees.contains(employee_id) { continue; }
                    let score = sample.get("satisfaction_score").and_then(Value::as_i64)
                        .ok_or_else(|| AppError::Configuration(format!("方案 {schedule_id} 的模拟满意度评分无效。")))?;
                    if !(1..=5).contains(&score) {
                        return Err(AppError::Configuration(format!("方案 {schedule_id} 的模拟满意度评分须为 1 至 5。")));
                    }
                    self.add_feedback(
                        Some(&record.id), employee_id, "schedule_satisfaction",
                        json!({"satisfaction_score":score,"basis":"固定规则生成的本机模拟反馈样本，不代表真实问卷。"}),
                        "simulated_feedback",
                    )?;
                }
            }
        }
        Ok(())
    }

    pub fn write_audit(&self, actor_id: &str, actor_role: &str, action: &str,
                       entity_type: &str, entity_id: &str, reason: &str,
                       before: Option<Value>, after: Option<Value>) -> Result<(), AppError> {
        let connection = self.connect()?;
        connection.execute(
            "INSERT INTO audit_log(id,actor_id,actor_role,action,entity_type,entity_id,reason,before_json,after_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                Uuid::new_v4().to_string(), actor_id, actor_role, action, entity_type,
                entity_id, reason, before.map(|value| value.to_string()),
                after.map(|value| value.to_string()), timestamp_now(),
            ],
        )?;
        Ok(())
    }

    pub fn record_default_rule_version(&self) -> Result<(), AppError> {
        let connection = self.connect()?;
        connection.execute(
            "INSERT OR IGNORE INTO rules_versions(id,version,values_json,actor_id,reason,created_at) VALUES('rules-v1',1,?1,'system','内置演示规则初始化',?2)",
            params![json!({"standard_hours_per_day":8,"daily_overtime_hours_max":3,"monthly_overtime_hours_max":36,"rolling_rest_days":7,"minimum_rest_hours":11}).to_string(), timestamp_now()],
        )?;
        Ok(())
    }

    pub fn recover_interrupted_jobs(&self) -> Result<usize, AppError> {
        let connection = self.connect()?;
        let updated = connection.execute(
            "UPDATE jobs SET status='failed',finished_at=?1,error_json=?2 WHERE status IN ('queued','running')",
            params![timestamp_now(), json!({"code":"SERVICE_RESTARTED","message":"服务重新启动时将未完成任务标记为失败。"}).to_string()],
        )?;
        Ok(updated)
    }

    pub fn latest_rules(&self) -> Result<Option<RuleVersionRecord>, AppError> {
        let connection = self.connect()?;
        connection.query_row(
            "SELECT id,version,values_json,actor_id,reason,created_at FROM rules_versions ORDER BY version DESC LIMIT 1",
            [],
            |row| {
                let values: String = row.get(2)?;
                Ok(RuleVersionRecord {
                    id: row.get(0)?,
                    version: row.get(1)?,
                    values: serde_json::from_str(&values).unwrap_or(Value::Null),
                    actor_id: row.get(3)?,
                    reason: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        ).optional().map_err(AppError::from)
    }

    pub fn list_rules(&self, limit: usize) -> Result<Vec<RuleVersionRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id,version,values_json,actor_id,reason,created_at FROM rules_versions ORDER BY version DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([limit.clamp(1, 100) as i64], |row| {
            let values: String = row.get(2)?;
            Ok(RuleVersionRecord {
                id: row.get(0)?,
                version: row.get(1)?,
                values: serde_json::from_str(&values).unwrap_or(Value::Null),
                actor_id: row.get(3)?,
                reason: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn create_rule_version(&self, expected_version: i64, values: Value,
                               actor_id: &str, actor_role: &str, reason: &str) -> Result<RuleVersionRecord, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let current: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(version),0) FROM rules_versions", [], |row| row.get(0))?;
        if current != expected_version {
            return Err(AppError::Conflict(format!(
                "规则版本已更新，当前版本为 {current}，请刷新后重试。"
            )));
        }
        let previous: Option<String> = transaction.query_row(
            "SELECT values_json FROM rules_versions ORDER BY version DESC LIMIT 1",
            [], |row| row.get(0),
        ).optional()?;
        let version = current + 1;
        let id = format!("rules-v{version}");
        let created_at = timestamp_now();
        transaction.execute(
            "INSERT INTO rules_versions(id,version,values_json,actor_id,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![id, version, values.to_string(), actor_id, reason, created_at],
        )?;
        transaction.execute(
            "INSERT INTO audit_log(id,actor_id,actor_role,action,entity_type,entity_id,reason,before_json,after_json,created_at) VALUES(?1,?2,?3,'update','rules_version',?4,?5,?6,?7,?8)",
            params![Uuid::new_v4().to_string(), actor_id, actor_role, id, reason,
                    previous,
                    values.to_string(), created_at],
        )?;
        transaction.commit()?;
        Ok(RuleVersionRecord { id, version, values, actor_id: actor_id.into(), reason: reason.into(), created_at })
    }

    pub fn insert_schedule_version(&self, schedule_id: &str, dataset_id: &str,
                                   job_id: Option<&str>, artifact_path: &str,
                                   sha256: &str, verification: Value, source_type: &str,
                                   expected_version: Option<i64>) -> Result<ScheduleRecord, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let current: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(version),0) FROM schedule_versions WHERE schedule_id=?1",
            [schedule_id], |row| row.get(0))?;
        if let Some(expected) = expected_version {
            if current != expected {
                return Err(AppError::Conflict(format!(
                    "方案版本已更新，当前版本为 {current}，请刷新后重试。"
                )));
            }
        }
        let version = current + 1;
        let id = new_id("schedule");
        let created_at = timestamp_now();
        transaction.execute(
            "INSERT INTO schedule_versions(id,schedule_id,dataset_id,job_id,version,artifact_path,sha256,verification_json,source_type,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![id, schedule_id, dataset_id, job_id, version, artifact_path, sha256,
                    verification.to_string(), source_type, created_at],
        )?;
        transaction.commit()?;
        Ok(ScheduleRecord {
            id, schedule_id: schedule_id.into(), dataset_id: dataset_id.into(),
            job_id: job_id.map(str::to_owned), version, artifact_path: artifact_path.into(),
            sha256: sha256.into(), verification, source_type: source_type.into(), created_at,
        })
    }

    pub fn get_schedule(&self, id: &str) -> Result<Option<ScheduleRecord>, AppError> {
        let connection = self.connect()?;
        connection.query_row(
            "SELECT id,schedule_id,dataset_id,job_id,version,artifact_path,sha256,verification_json,source_type,created_at FROM schedule_versions WHERE id=?1 OR schedule_id=?1 ORDER BY version DESC LIMIT 1",
            [id], row_to_schedule,
        ).optional().map_err(AppError::from)
    }

    pub fn update_schedule_verification(&self, schedule_id: &str, expected_version: i64,
                                        verification: Value) -> Result<ScheduleRecord, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let current: Option<i64> = transaction.query_row(
            "SELECT version FROM schedule_versions WHERE id=?1 OR schedule_id=?1 ORDER BY version DESC LIMIT 1",
            [schedule_id], |row| row.get(0),
        ).optional()?;
        let current = current.ok_or(AppError::NotFound)?;
        if current != expected_version {
            return Err(AppError::Conflict(format!(
                "方案版本已更新，当前版本为 {current}，请刷新后重试。"
            )));
        }
        transaction.execute(
            "UPDATE schedule_versions SET verification_json=?2 WHERE schedule_id=(SELECT schedule_id FROM schedule_versions WHERE id=?1 OR schedule_id=?1 ORDER BY version DESC LIMIT 1) AND version=?3",
            params![schedule_id, verification.to_string(), current],
        )?;
        transaction.commit()?;
        self.get_schedule(schedule_id)?.ok_or(AppError::NotFound)
    }

    pub fn list_schedules(&self, dataset_id: Option<&str>, limit: usize) -> Result<Vec<ScheduleRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT s.id,s.schedule_id,s.dataset_id,s.job_id,s.version,s.artifact_path,s.sha256,s.verification_json,s.source_type,s.created_at FROM schedule_versions s JOIN (SELECT schedule_id,MAX(version) version FROM schedule_versions GROUP BY schedule_id) latest ON latest.schedule_id=s.schedule_id AND latest.version=s.version WHERE (?1 IS NULL OR s.dataset_id=?1) ORDER BY s.created_at DESC LIMIT ?2",
        )?;
        let rows = statement.query_map(params![dataset_id, limit.clamp(1, 500) as i64], row_to_schedule)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn list_schedule_history(&self, dataset_id: Option<&str>, limit: usize) -> Result<Vec<ScheduleRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id,schedule_id,dataset_id,job_id,version,artifact_path,sha256,verification_json,source_type,created_at FROM schedule_versions WHERE (?1 IS NULL OR dataset_id=?1) ORDER BY created_at DESC, schedule_id, version DESC LIMIT ?2",
        )?;
        let rows = statement.query_map(params![dataset_id, limit.clamp(1, 1000) as i64], row_to_schedule)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn add_approval(&self, schedule_id: &str, schedule_version: i64, status: &str,
                        actor_id: &str, reason: &str) -> Result<Value, AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let current: Option<(String, i64)> = transaction.query_row(
            "SELECT schedule_id,version FROM schedule_versions WHERE id=?1",
            [schedule_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        let (group_id, stored_version) = current.ok_or(AppError::NotFound)?;
        let latest_version: i64 = transaction.query_row(
            "SELECT MAX(version) FROM schedule_versions WHERE schedule_id=?1",
            [&group_id], |row| row.get(0),
        )?;
        if stored_version != schedule_version || latest_version != schedule_version {
            return Err(AppError::Conflict(format!(
                "方案版本已更新，当前版本为 {latest_version}，请刷新后重试。"
            )));
        }
        let id = new_id("approval");
        let created_at = timestamp_now();
        transaction.execute(
            "INSERT INTO approvals(id,schedule_id,schedule_version,status,actor_id,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![id, schedule_id, schedule_version, status, actor_id, reason, created_at],
        )?;
        transaction.commit()?;
        Ok(json!({"id":id,"schedule_id":schedule_id,"schedule_version":schedule_version,"status":status,"actor_id":actor_id,"reason":reason,"created_at":created_at}))
    }

    pub fn latest_approval_status(&self, schedule_id: &str) -> Result<Option<String>, AppError> {
        let connection = self.connect()?;
        connection.query_row(
            "SELECT status FROM approvals WHERE schedule_id=?1 ORDER BY created_at DESC LIMIT 1",
            [schedule_id], |row| row.get(0),
        ).optional().map_err(AppError::from)
    }

    pub fn add_feedback(&self, schedule_id: Option<&str>, employee_id: &str,
                        feedback_type: &str, payload: Value, source_type: &str) -> Result<Value, AppError> {
        let connection = self.connect()?;
        let id = new_id("feedback");
        let created_at = timestamp_now();
        connection.execute(
            "INSERT INTO feedback(id,schedule_id,employee_id,feedback_type,payload_json,source_type,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![id, schedule_id, employee_id, feedback_type, payload.to_string(), source_type, created_at],
        )?;
        Ok(json!({"id":id,"schedule_id":schedule_id,"employee_id":employee_id,"feedback_type":feedback_type,"payload":payload,"source_type":source_type,"created_at":created_at}))
    }

    pub fn list_feedback(&self, employee_id: Option<&str>, schedule_id: Option<&str>, limit: usize) -> Result<Vec<Value>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT id,schedule_id,employee_id,feedback_type,payload_json,source_type,created_at FROM feedback WHERE (?1 IS NULL OR employee_id=?1) AND (?2 IS NULL OR schedule_id=?2) ORDER BY created_at DESC LIMIT ?3",
        )?;
        let rows = statement.query_map(params![employee_id, schedule_id, limit.clamp(1, 500) as i64], |row| {
            let payload: String = row.get(4)?;
            Ok(json!({
                "id":row.get::<_,String>(0)?,"schedule_id":row.get::<_,Option<String>>(1)?,
                "employee_id":row.get::<_,String>(2)?,"feedback_type":row.get::<_,String>(3)?,
                "payload":serde_json::from_str::<Value>(&payload).unwrap_or(Value::Null),
                "source_type":row.get::<_,String>(5)?,"created_at":row.get::<_,String>(6)?
            }))
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AppError> {
    value.get(key).and_then(Value::as_str)
        .ok_or_else(|| AppError::Configuration(format!("扩充演示方案记录缺少有效的 {key} 字段。")))
}

fn get_with_connection(connection: &Connection, id: &str) -> Result<Option<JobRecord>, AppError> {
    connection.query_row(
        "SELECT id,kind,dataset_id,status,request_json,result_json,solver_termination,error_json,created_at,started_at,finished_at FROM jobs WHERE id=?1",
        [id], row_to_job,
    ).optional().map_err(AppError::from)
}

fn row_to_job(row: &rusqlite::Row<'_>) -> rusqlite::Result<JobRecord> {
    let kind_text: String = row.get(1)?;
    let status_text: String = row.get(3)?;
    let request_text: String = row.get(4)?;
    let result_text: Option<String> = row.get(5)?;
    let error_text: Option<String> = row.get(7)?;
    let kind = serde_json::from_value(json!(kind_text)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let status = serde_json::from_value(json!(status_text)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let request = serde_json::from_str(&request_text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let result = result_text.map(|text| serde_json::from_str(&text)).transpose().map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let error = error_text.map(|text| serde_json::from_str(&text)).transpose().map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(JobRecord {
        id: row.get(0)?, kind, dataset_id: row.get(2)?, status,
        request, result, solver_termination: row.get(6)?, error,
        created_at: row.get(8)?, started_at: row.get(9)?, finished_at: row.get(10)?,
    })
}

fn row_to_schedule(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduleRecord> {
    let verification: String = row.get(7)?;
    let verification = serde_json::from_str(&verification).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(ScheduleRecord {
        id: row.get(0)?, schedule_id: row.get(1)?, dataset_id: row.get(2)?,
        job_id: row.get(3)?, version: row.get(4)?, artifact_path: row.get(5)?,
        sha256: row.get(6)?, verification, source_type: row.get(8)?, created_at: row.get(9)?,
    })
}

pub fn timestamp_now() -> String {
    Local::now().to_rfc3339()
}

pub fn new_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::JobStatus;
    use tempfile::tempdir;

    #[test]
    fn job_record_survives_repository_reopen() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("store.sqlite3");
        let repo = JobRepository::open(&path).unwrap();
        let job = NewJob {
            id: "job-reopen-test".into(),
            kind: JobKind::Info,
            dataset_id: "accepted-baseline-v1".into(),
            request: json!({"schema_version":1}),
            actor_id: "本机计划员".into(),
            actor_role: "计划员".into(),
            reason: "测试任务记录持久化".into(),
            created_at: timestamp_now(),
        };
        repo.create(&job).unwrap();
        drop(repo);
        let reopened = JobRepository::open(&path).unwrap();
        assert_eq!(reopened.get("job-reopen-test").unwrap().unwrap().status, JobStatus::Queued);
    }

    #[test]
    fn feedback_can_be_filtered_by_schedule_version() {
        let dir = tempdir().unwrap();
        let repo = JobRepository::open(dir.path().join("store.sqlite3")).unwrap();
        let schedule_a = repo.insert_schedule_version("schedule-a", "accepted-baseline-v1", None,
            "data/demo/a.csv", "a".repeat(64).as_str(), json!({"all_pass":true}), "accepted_baseline", None).unwrap();
        let _schedule_b = repo.insert_schedule_version("schedule-b", "accepted-baseline-v1", None,
            "data/demo/b.csv", "b".repeat(64).as_str(), json!({"all_pass":true}), "accepted_baseline", None).unwrap();
        repo.add_feedback(Some(&schedule_a.id), "E1", "schedule_issue",
            json!({"satisfaction_score":5}), "simulated_feedback").unwrap();
        repo.add_feedback(Some(&_schedule_b.id), "E2", "schedule_issue",
            json!({"satisfaction_score":2}), "simulated_feedback").unwrap();

        let matching = repo.list_feedback(None, Some(&schedule_a.id), 500).unwrap();

        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0]["schedule_id"], schedule_a.id);
        assert_eq!(matching[0]["payload"]["satisfaction_score"], 5);
    }
}
