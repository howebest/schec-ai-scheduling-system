use std::path::{Path, PathBuf};
use std::collections::HashSet;

use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::AppError;
pub use crate::error::FieldValidationError;

const EQUIPMENT_REFERENCE_CSV: &str = include_str!("../../data/reference/input_04_position_requirements.csv");
const DEMO_EMPLOYEE_NAMES: [&str; 36] = [
    "王晨曦", "李明轩", "张语桐", "刘昱辰", "陈思远", "杨可欣",
    "赵一鸣", "黄梓涵", "周雨桐", "吴嘉言", "徐子墨", "孙清妍",
    "胡宇航", "朱若琳", "高逸凡", "林婉清", "何承泽", "郭欣妍",
    "马嘉树", "罗心怡", "梁景行", "宋知夏", "郑博文", "谢安琪",
    "韩沐阳", "唐依诺", "冯睿哲", "于佳宁", "董子谦", "萧雨晴",
    "程嘉树", "曹语彤", "袁景澄", "邓书瑶", "许皓然", "沈清禾",
];

#[derive(Clone, Debug)]
pub struct SchedulingRepository {
    database_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RotationObjectType {
    Team,
    Employee,
}

impl RotationObjectType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Team => "team",
            Self::Employee => "employee",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShiftDefinition {
    pub shift_code: String,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub remarks: String,
    #[serde(default)]
    pub display_order: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CycleDay {
    pub cycle_day: i64,
    pub shift_code: Option<String>,
    pub is_rest: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RotationTarget {
    pub object_type: RotationObjectType,
    pub object_id: String,
    pub offset_days: i64,
    #[serde(default = "default_active")]
    pub is_active: bool,
}

fn default_active() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScheduleConfigDraft {
    pub name: String,
    pub line_id: String,
    pub object_type: RotationObjectType,
    pub start_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub cycle_length: i64,
    pub shifts: Vec<ShiftDefinition>,
    pub cycle_days: Vec<CycleDay>,
    pub targets: Vec<RotationTarget>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScheduleConfigRecord {
    pub config_id: String,
    pub name: String,
    pub line_id: String,
    pub line_name: String,
    pub object_type: RotationObjectType,
    pub start_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub cycle_length: i64,
    pub shifts: Vec<ShiftDefinition>,
    pub cycle_days: Vec<CycleDay>,
    pub targets: Vec<RotationTarget>,
    pub source_type: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ConfigFilter {
    pub name: Option<String>,
    pub line_id: Option<String>,
    pub is_active: Option<bool>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmployeeSkill {
    pub skill_code: String,
    pub skill_name: String,
    pub skill_score: Option<f64>,
    #[serde(default = "default_active")]
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmployeeProfile {
    pub employee_id: String,
    pub name: String,
    pub position_id: String,
    pub position_name: String,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
    pub line_ids: Vec<String>,
    pub skills: Vec<EmployeeSkill>,
    pub equipment_mappings: Vec<EmployeeEquipmentRecord>,
    pub skill_score: Option<f64>,
    pub collaboration_score: Option<f64>,
    pub composite_score: Option<f64>,
    pub source_type: String,
    pub is_archived: bool,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmployeeWrite {
    pub employee_id: String,
    pub name: String,
    pub position_id: String,
    pub team_id: Option<String>,
    pub skills: Vec<EmployeeSkill>,
    pub collaboration_score: Option<f64>,
    #[serde(default)]
    pub is_archived: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EmployeeFilter {
    pub query: Option<String>,
    pub line_id: Option<String>,
    pub position_id: Option<String>,
    pub team_id: Option<String>,
    pub is_archived: Option<bool>,
    pub equipment_id: Option<String>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EquipmentRecord {
    pub equipment_id: String,
    pub equipment_code: String,
    pub equipment_name: String,
    pub equipment_category: String,
    pub line_id: String,
    pub line_name: String,
    pub source_line_code: String,
    pub source_line_name: String,
    pub position_name: String,
    pub source_type: String,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmployeeEquipmentRecord {
    pub equipment_id: String,
    pub equipment_code: String,
    pub equipment_name: String,
    pub equipment_category: String,
    pub line_id: String,
    pub line_name: String,
    pub source_line_code: String,
    pub source_line_name: String,
    pub position_name: String,
    pub ability_level: i64,
    pub source_type: String,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmployeeEquipmentWrite {
    pub equipment_id: String,
    pub ability_level: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EquipmentFilter {
    pub query: Option<String>,
    pub line_id: Option<String>,
    pub category: Option<String>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeamRecord {
    pub team_id: String,
    pub name: String,
    pub team_category: String,
    pub description: String,
    pub is_active: bool,
    pub member_count: usize,
    pub members: Vec<TeamMemberSummary>,
    pub qualification_line_count: usize,
    pub source_type: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeamMemberSummary {
    pub employee_id: String,
    pub name: String,
    pub position_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeamWrite {
    pub team_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_active")]
    pub is_active: bool,
    #[serde(default)]
    pub member_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TeamFilter {
    pub query: Option<String>,
    pub line_id: Option<String>,
    pub is_active: Option<bool>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QualificationRecord {
    pub qualification_id: String,
    pub object_type: RotationObjectType,
    pub object_id: String,
    pub object_name: String,
    pub position_id: String,
    pub position_name: String,
    pub line_id: String,
    pub line_name: String,
    pub description: String,
    pub is_active: bool,
    pub source_type: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QualificationWrite {
    pub qualification_id: Option<String>,
    pub object_type: RotationObjectType,
    pub object_id: String,
    pub position_id: String,
    pub line_id: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_active")]
    pub is_active: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct QualificationFilter {
    pub query: Option<String>,
    pub line_id: Option<String>,
    pub position_id: Option<String>,
    pub object_type: Option<RotationObjectType>,
    pub is_active: Option<bool>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LineRecord {
    pub line_id: String,
    pub display_name: String,
    pub line_type: String,
    pub source_type: String,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PositionRecord {
    pub position_id: String,
    pub display_name: String,
    pub source_type: String,
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalendarQuery {
    pub line_id: String,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub config_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalendarEntry {
    pub date: NaiveDate,
    pub end_date: NaiveDate,
    pub config_id: String,
    pub config_name: String,
    pub object_type: RotationObjectType,
    pub object_id: String,
    pub object_name: String,
    pub personnel: Vec<CalendarPersonnel>,
    pub line_id: String,
    pub line_name: String,
    pub status: String,
    pub shift_code: Option<String>,
    pub shift_name: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub crosses_midnight: bool,
    pub source_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalendarPersonnel {
    pub employee_id: String,
    pub name: String,
    pub position_name: String,
}

impl SchedulingRepository {
    pub fn new(database_path: impl AsRef<Path>) -> Self {
        Self {
            database_path: database_path.as_ref().to_path_buf(),
        }
    }

    fn connect(&self) -> Result<Connection, AppError> {
        if let Some(parent) = self.database_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(&self.database_path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(connection)
    }

    pub fn list_lines(&self) -> Result<Vec<LineRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT line_id,display_name,line_type,source_type,is_active FROM rotation_lines ORDER BY line_id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(LineRecord {
                line_id: row.get(0)?,
                display_name: row.get(1)?,
                line_type: row.get(2)?,
                source_type: row.get(3)?,
                is_active: row.get::<_, i64>(4)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn list_positions(&self) -> Result<Vec<PositionRecord>, AppError> {
        let connection = self.connect()?;
        let mut statement = connection.prepare(
            "SELECT position_id,display_name,source_type,is_active FROM rotation_positions ORDER BY display_name",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(PositionRecord {
                position_id: row.get(0)?,
                display_name: row.get(1)?,
                source_type: row.get(2)?,
                is_active: row.get::<_, i64>(3)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    }

    pub fn list_equipment(&self, filter: &EquipmentFilter) -> Result<Page<EquipmentRecord>, AppError> {
        let connection = self.connect()?;
        let (page, page_size, offset) = paging(filter.page, filter.page_size);
        let query = normalized_like(filter.query.as_deref());
        let line_id = normalized(filter.line_id.as_deref());
        let category = normalized(filter.category.as_deref());
        let where_clause = "WHERE e.is_active=1 AND (?1 IS NULL OR e.equipment_code LIKE ?1 OR e.equipment_name LIKE ?1) AND (?2 IS NULL OR e.line_id=?2) AND (?3 IS NULL OR e.equipment_category=?3)";
        let total: i64 = connection.query_row(
            &format!("SELECT COUNT(*) FROM rotation_equipment e {where_clause}"),
            params![query, line_id, category],
            |row| row.get(0),
        )?;
        let mut statement = connection.prepare(&format!(
            "SELECT e.equipment_id,e.equipment_code,e.equipment_name,e.equipment_category,e.line_id,l.display_name,e.source_line_code,e.source_line_name,e.position_name,e.source_type,e.is_active FROM rotation_equipment e JOIN rotation_lines l ON l.line_id=e.line_id {where_clause} ORDER BY l.display_name,e.equipment_category,e.equipment_name LIMIT ?4 OFFSET ?5"
        ))?;
        let items = statement
            .query_map(params![query, line_id, category, page_size as i64, offset as i64], |row| {
                Ok(EquipmentRecord {
                    equipment_id: row.get(0)?, equipment_code: row.get(1)?, equipment_name: row.get(2)?,
                    equipment_category: row.get(3)?, line_id: row.get(4)?, line_name: row.get(5)?,
                    source_line_code: row.get(6)?, source_line_name: row.get(7)?, position_name: row.get(8)?,
                    source_type: row.get(9)?, is_active: row.get::<_, i64>(10)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Page { items, total: total as usize, page, page_size })
    }

    pub fn list_configurations(&self, filter: &ConfigFilter) -> Result<Page<ScheduleConfigRecord>, AppError> {
        let connection = self.connect()?;
        let (page, page_size, offset) = paging(filter.page, filter.page_size);
        let name = normalized_like(filter.name.as_deref());
        let line_id = normalized(filter.line_id.as_deref());
        let active = filter.is_active.map(|value| if value { 1_i64 } else { 0_i64 });
        let total: i64 = connection.query_row(
            "SELECT COUNT(*) FROM rotation_configs WHERE (?1 IS NULL OR name LIKE ?1) AND (?2 IS NULL OR line_id=?2) AND (?3 IS NULL OR is_active=?3)",
            params![name, line_id, active],
            |row| row.get(0),
        )?;
        let mut statement = connection.prepare(
            "SELECT config_id FROM rotation_configs WHERE (?1 IS NULL OR name LIKE ?1) AND (?2 IS NULL OR line_id=?2) AND (?3 IS NULL OR is_active=?3) ORDER BY updated_at DESC,config_id LIMIT ?4 OFFSET ?5",
        )?;
        let ids = statement
            .query_map(params![name, line_id, active, page_size as i64, offset as i64], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let items = ids
            .iter()
            .map(|id| self.get_configuration(id))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect();
        Ok(Page { items, total: total as usize, page, page_size })
    }

    pub fn get_configuration(&self, id: &str) -> Result<Option<ScheduleConfigRecord>, AppError> {
        let connection = self.connect()?;
        get_configuration_with_connection(&connection, id)
    }

    pub fn validate_configuration(
        &self,
        draft: &ScheduleConfigDraft,
        exclude_id: Option<&str>,
    ) -> Result<Vec<FieldValidationError>, AppError> {
        let connection = self.connect()?;
        validate_configuration_with_connection(&connection, draft, exclude_id)
    }

    pub fn create_configuration(
        &self,
        draft: &ScheduleConfigDraft,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<ScheduleConfigRecord, AppError> {
        require_reason(reason)?;
        let errors = self.validate_configuration(draft, None)?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let id = new_id("rot-config");
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        insert_configuration(&transaction, &id, draft, "local_config", false, &now)?;
        write_audit(&transaction, actor_id, actor_role, "create", "rotation_config", &id, reason, None, Some(json!(draft)))?;
        transaction.commit()?;
        self.get_configuration(&id)?.ok_or(AppError::NotFound)
    }

    pub fn update_configuration(
        &self,
        id: &str,
        draft: &ScheduleConfigDraft,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<ScheduleConfigRecord, AppError> {
        require_reason(reason)?;
        let before = self.get_configuration(id)?.ok_or(AppError::NotFound)?;
        let errors = self.validate_configuration(draft, Some(id))?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE rotation_configs SET name=?2,line_id=?3,object_type=?4,start_date=?5,end_date=?6,cycle_length=?7,updated_at=?8 WHERE config_id=?1",
            params![id, draft.name.trim(), draft.line_id, draft.object_type.as_str(), draft.start_date.to_string(),
                    draft.end_date.map(|date| date.to_string()), draft.cycle_length, timestamp_now()],
        )?;
        replace_configuration_children(&transaction, id, draft)?;
        let after = json!(draft);
        write_audit(&transaction, actor_id, actor_role, "update", "rotation_config", id, reason, Some(json!(before)), Some(after))?;
        transaction.commit()?;
        self.get_configuration(id)?.ok_or(AppError::NotFound)
    }

    pub fn copy_configuration(
        &self,
        id: &str,
        new_name: &str,
        start_date: NaiveDate,
        end_date: Option<NaiveDate>,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<ScheduleConfigRecord, AppError> {
        require_reason(reason)?;
        let original = self.get_configuration(id)?.ok_or(AppError::NotFound)?;
        let mut draft = config_record_to_draft(&original);
        draft.name = new_name.trim().to_owned();
        draft.start_date = start_date;
        draft.end_date = end_date;
        // The inactive copy intentionally inherits the source date window; exclude
        // the source row while still detecting any other active overlap.
        let errors = self.validate_configuration(&draft, Some(id))?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let new_config_id = new_id("rot-config");
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        insert_configuration(&transaction, &new_config_id, &draft, "local_config", false, &now)?;
        write_audit(&transaction, actor_id, actor_role, "copy", "rotation_config", &new_config_id, reason,
                    Some(json!(original)), Some(json!(draft)))?;
        transaction.commit()?;
        self.get_configuration(&new_config_id)?.ok_or(AppError::NotFound)
    }

    pub fn activate_configuration(
        &self,
        id: &str,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<ScheduleConfigRecord, AppError> {
        require_reason(reason)?;
        let current = self.get_configuration(id)?.ok_or(AppError::NotFound)?;
        let draft = config_record_to_draft(&current);
        let errors = self.validate_configuration(&draft, Some(id))?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE rotation_configs SET is_active=1,updated_at=?2 WHERE config_id=?1",
            params![id, timestamp_now()],
        )?;
        write_audit(&transaction, actor_id, actor_role, "activate", "rotation_config", id, reason,
                    Some(json!(current)), Some(json!({"is_active":true})))?;
        transaction.commit()?;
        self.get_configuration(id)?.ok_or(AppError::NotFound)
    }

    pub fn deactivate_configuration(
        &self,
        id: &str,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<ScheduleConfigRecord, AppError> {
        require_reason(reason)?;
        let current = self.get_configuration(id)?.ok_or(AppError::NotFound)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE rotation_configs SET is_active=0,updated_at=?2 WHERE config_id=?1",
            params![id, timestamp_now()],
        )?;
        write_audit(&transaction, actor_id, actor_role, "deactivate", "rotation_config", id, reason,
                    Some(json!(current)), Some(json!({"is_active":false})))?;
        transaction.commit()?;
        self.get_configuration(id)?.ok_or(AppError::NotFound)
    }
}

impl SchedulingRepository {
    pub fn list_employees(&self, filter: &EmployeeFilter) -> Result<Page<EmployeeProfile>, AppError> {
        let connection = self.connect()?;
        let (page, page_size, offset) = paging(filter.page, filter.page_size);
        let query = normalized_like(filter.query.as_deref());
        let line_id = normalized(filter.line_id.as_deref());
        let position_id = normalized(filter.position_id.as_deref());
        let team_id = normalized(filter.team_id.as_deref());
        let is_archived = filter.is_archived.map(|value| if value { 1_i64 } else { 0_i64 });
        let equipment_id = normalized(filter.equipment_id.as_deref());
        let where_clause = "WHERE (?1 IS NULL OR e.name LIKE ?1 OR e.employee_id LIKE ?1) AND (?2 IS NULL OR EXISTS(SELECT 1 FROM rotation_qualifications q WHERE q.object_type='employee' AND q.object_id=e.employee_id AND q.line_id=?2 AND q.is_active=1)) AND (?3 IS NULL OR e.position_id=?3) AND (?4 IS NULL OR e.team_id=?4) AND (?5 IS NULL OR e.is_archived=?5) AND (?6 IS NULL OR EXISTS(SELECT 1 FROM rotation_employee_equipment ee WHERE ee.employee_id=e.employee_id AND ee.equipment_id=?6))";
        let total: i64 = connection.query_row(
            &format!("SELECT COUNT(*) FROM rotation_employees e {where_clause}"),
            params![query, line_id, position_id, team_id, is_archived, equipment_id],
            |row| row.get(0),
        )?;
        let mut statement = connection.prepare(&format!(
            "SELECT e.employee_id FROM rotation_employees e {where_clause} ORDER BY e.updated_at DESC,e.employee_id LIMIT ?7 OFFSET ?8"
        ))?;
        let ids = statement
            .query_map(params![query, line_id, position_id, team_id, is_archived, equipment_id, page_size as i64, offset as i64], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let records = ids
            .iter()
            .map(|id| self.get_employee(id))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect();
        Ok(Page { items: records, total: total as usize, page, page_size })
    }

    pub fn get_employee(&self, id: &str) -> Result<Option<EmployeeProfile>, AppError> {
        let connection = self.connect()?;
        get_employee_with_connection(&connection, id)
    }

    pub fn employee_equipment(&self, id: &str) -> Result<Vec<EmployeeEquipmentRecord>, AppError> {
        let connection = self.connect()?;
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_employees WHERE employee_id=?1)", [id], |row| row.get(0),
        )?;
        if !exists { return Err(AppError::NotFound); }
        employee_equipment_with_connection(&connection, id)
    }

    pub fn replace_employee_equipment(
        &self,
        id: &str,
        mappings: &[EmployeeEquipmentWrite],
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<Vec<EmployeeEquipmentRecord>, AppError> {
        require_reason(reason)?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let employee = transaction.query_row(
            "SELECT is_archived FROM rotation_employees WHERE employee_id=?1", [id], |row| row.get::<_, i64>(0),
        ).optional()?.ok_or(AppError::NotFound)?;
        if employee != 0 {
            return Err(AppError::Conflict("已归档员工只允许查看既有设备关系。".into()));
        }
        let mut errors = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (index, mapping) in mappings.iter().enumerate() {
            let equipment_id = mapping.equipment_id.trim();
            if equipment_id.is_empty() {
                errors.push(field_error(&format!("data.{index}.equipment_id"), "REQUIRED", "请选择设备。"));
                continue;
            }
            if !seen.insert(equipment_id.to_owned()) {
                errors.push(field_error(&format!("data.{index}.equipment_id"), "DUPLICATE_EQUIPMENT", "同一员工的设备关系不得重复。"));
            }
            if !(1..=5).contains(&mapping.ability_level) {
                errors.push(field_error(&format!("data.{index}.ability_level"), "ABILITY_LEVEL_OUT_OF_RANGE", "设备能力等级须为 1 至 5 的整数。"));
            }
            let equipment = transaction.query_row(
                "SELECT line_id FROM rotation_equipment WHERE equipment_id=?1 AND is_active=1",
                [equipment_id], |row| row.get::<_, String>(0),
            ).optional()?;
            match equipment {
                None => errors.push(field_error(&format!("data.{index}.equipment_id"), "EQUIPMENT_NOT_FOUND", "所选设备不存在或已停用。")),
                Some(line_id) => {
                    let qualified: bool = transaction.query_row(
                        "SELECT EXISTS(SELECT 1 FROM rotation_qualifications WHERE object_type='employee' AND object_id=?1 AND line_id=?2 AND is_active=1)",
                        params![id, line_id], |row| row.get(0),
                    )?;
                    if !qualified {
                        errors.push(field_error(&format!("data.{index}.equipment_id"), "EMPLOYEE_LINE_NOT_QUALIFIED", "员工未登记该设备所属产线的有效岗位资格。"));
                    }
                }
            }
        }
        if !errors.is_empty() { return Err(AppError::FieldValidation(errors)); }

        let before = employee_equipment_with_connection(&transaction, id)?;
        transaction.execute("DELETE FROM rotation_employee_equipment WHERE employee_id=?1", [id])?;
        let now = timestamp_now();
        for mapping in mappings {
            transaction.execute(
                "INSERT INTO rotation_employee_equipment(employee_id,equipment_id,ability_level,source_type,updated_at) VALUES(?1,?2,?3,'local_config',?4)",
                params![id, mapping.equipment_id.trim(), mapping.ability_level, now],
            )?;
        }
        let after = employee_equipment_with_connection(&transaction, id)?;
        write_audit(
            &transaction, actor_id, actor_role, "replace", "rotation_employee_equipment", id,
            reason, Some(json!(before)), Some(json!(after)),
        )?;
        transaction.commit()?;
        Ok(after)
    }

    pub fn create_employee(
        &self,
        draft: &EmployeeWrite,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<EmployeeProfile, AppError> {
        require_reason(reason)?;
        let connection = self.connect()?;
        let errors = validate_employee_with_connection(&connection, draft, None)?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO rotation_employees(employee_id,name,position_id,team_id,collaboration_score,source_type,is_archived,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'local_config',?6,?7,?7)",
            params![draft.employee_id.trim(), draft.name.trim(), draft.position_id, draft.team_id,
                    draft.collaboration_score, bool_i64(draft.is_archived), now],
        )?;
        replace_employee_skills(&transaction, &draft.employee_id, &draft.skills, &now)?;
        write_audit(&transaction, actor_id, actor_role, "create", "rotation_employee", &draft.employee_id, reason, None, Some(json!(draft)))?;
        transaction.commit()?;
        self.get_employee(&draft.employee_id)?.ok_or(AppError::NotFound)
    }

    pub fn update_employee(
        &self,
        id: &str,
        draft: &EmployeeWrite,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<EmployeeProfile, AppError> {
        require_reason(reason)?;
        let before = self.get_employee(id)?.ok_or(AppError::NotFound)?;
        if draft.employee_id.trim() != id {
            return Err(AppError::InvalidInput("员工编号不可在更新时修改。".into()));
        }
        let connection = self.connect()?;
        let errors = validate_employee_with_connection(&connection, draft, Some(id))?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE rotation_employees SET name=?2,position_id=?3,team_id=?4,collaboration_score=?5,is_archived=?6,updated_at=?7 WHERE employee_id=?1",
            params![id, draft.name.trim(), draft.position_id, draft.team_id,
                    draft.collaboration_score, bool_i64(draft.is_archived), now],
        )?;
        replace_employee_skills(&transaction, id, &draft.skills, &now)?;
        write_audit(&transaction, actor_id, actor_role, "update", "rotation_employee", id, reason, Some(json!(before)), Some(json!(draft)))?;
        transaction.commit()?;
        self.get_employee(id)?.ok_or(AppError::NotFound)
    }

    pub fn list_teams(&self, filter: &TeamFilter) -> Result<Page<TeamRecord>, AppError> {
        let connection = self.connect()?;
        let (page, page_size, offset) = paging(filter.page, filter.page_size);
        let query = normalized_like(filter.query.as_deref());
        let line_id = normalized(filter.line_id.as_deref());
        let is_active = filter.is_active.map(bool_i64);
        let where_clause = "WHERE (?1 IS NULL OR t.name LIKE ?1) AND (?2 IS NULL OR EXISTS(SELECT 1 FROM rotation_qualifications q WHERE q.object_type='team' AND q.object_id=t.team_id AND q.line_id=?2 AND q.is_active=1)) AND (?3 IS NULL OR t.is_active=?3)";
        let total: i64 = connection.query_row(
            &format!("SELECT COUNT(*) FROM rotation_teams t {where_clause}"),
            params![query, line_id, is_active],
            |row| row.get(0),
        )?;
        let mut statement = connection.prepare(&format!(
            "SELECT t.team_id FROM rotation_teams t {where_clause} ORDER BY t.updated_at DESC,t.team_id LIMIT ?4 OFFSET ?5"
        ))?;
        let ids = statement
            .query_map(params![query, line_id, is_active, page_size as i64, offset as i64], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let items = ids
            .iter()
            .map(|id| self.get_team(id))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect();
        Ok(Page { items, total: total as usize, page, page_size })
    }

    pub fn get_team(&self, id: &str) -> Result<Option<TeamRecord>, AppError> {
        let connection = self.connect()?;
        get_team_with_connection(&connection, id)
    }

    pub fn create_team(
        &self,
        draft: &TeamWrite,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<TeamRecord, AppError> {
        require_reason(reason)?;
        let mut errors = validate_team(draft);
        let team_id = draft.team_id.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| new_id("rot-team"));
        let connection = self.connect()?;
        if team_name_exists(&connection, &draft.name, None)? {
            errors.push(field_error("name", "DUPLICATE_TEAM_NAME", "班组名称已存在。"));
        }
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let member_errors = validate_team_members(&transaction, draft.member_ids.as_deref().unwrap_or(&[]))?;
        if !member_errors.is_empty() {
            return Err(AppError::FieldValidation(member_errors));
        }
        transaction.execute(
            "INSERT INTO rotation_teams(team_id,name,description,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,'local_config',?4,?5,?5)",
            params![team_id, draft.name.trim(), draft.description.trim(), bool_i64(draft.is_active), now],
        )?;
        replace_team_members(&transaction, &team_id, draft.member_ids.as_deref().unwrap_or(&[]), &now)?;
        write_audit(&transaction, actor_id, actor_role, "create", "rotation_team", &team_id, reason, None, Some(json!(draft)))?;
        transaction.commit()?;
        self.get_team(&team_id)?.ok_or(AppError::NotFound)
    }

    pub fn update_team(
        &self,
        id: &str,
        draft: &TeamWrite,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<TeamRecord, AppError> {
        require_reason(reason)?;
        let before = self.get_team(id)?.ok_or(AppError::NotFound)?;
        let mut errors = validate_team(draft);
        if team_name_exists(&self.connect()?, &draft.name, Some(id))? {
            errors.push(field_error("name", "DUPLICATE_TEAM_NAME", "班组名称已存在。"));
        }
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        if let Some(member_ids) = draft.member_ids.as_deref() {
            let member_errors = validate_team_members(&transaction, member_ids)?;
            if !member_errors.is_empty() {
                return Err(AppError::FieldValidation(member_errors));
            }
        }
        transaction.execute(
            "UPDATE rotation_teams SET name=?2,description=?3,is_active=?4,updated_at=?5 WHERE team_id=?1",
            params![id, draft.name.trim(), draft.description.trim(), bool_i64(draft.is_active), now],
        )?;
        if let Some(member_ids) = draft.member_ids.as_deref() {
            replace_team_members(&transaction, id, member_ids, &now)?;
        }
        write_audit(&transaction, actor_id, actor_role, "update", "rotation_team", id, reason, Some(json!(before)), Some(json!(draft)))?;
        transaction.commit()?;
        self.get_team(id)?.ok_or(AppError::NotFound)
    }

    pub fn list_qualifications(&self, filter: &QualificationFilter) -> Result<Page<QualificationRecord>, AppError> {
        let connection = self.connect()?;
        let (page, page_size, offset) = paging(filter.page, filter.page_size);
        let query = normalized_like(filter.query.as_deref());
        let line_id = normalized(filter.line_id.as_deref());
        let position_id = normalized(filter.position_id.as_deref());
        let object_type = filter.object_type.as_ref().map(RotationObjectType::as_str);
        let is_active = filter.is_active.map(bool_i64);
        let where_clause = "WHERE (?1 IS NULL OR q.line_id=?1) AND (?2 IS NULL OR q.position_id=?2) AND (?3 IS NULL OR q.object_type=?3) AND (?4 IS NULL OR q.is_active=?4) AND (?5 IS NULL OR CASE q.object_type WHEN 'team' THEN t.name ELSE e.name END LIKE ?5)";
        let total: i64 = connection.query_row(
            &format!("SELECT COUNT(*) FROM rotation_qualifications q LEFT JOIN rotation_teams t ON q.object_type='team' AND t.team_id=q.object_id LEFT JOIN rotation_employees e ON q.object_type='employee' AND e.employee_id=q.object_id {where_clause}"),
            params![line_id, position_id, object_type, is_active, query],
            |row| row.get(0),
        )?;
        let mut statement = connection.prepare(&format!(
            "SELECT q.qualification_id FROM rotation_qualifications q LEFT JOIN rotation_teams t ON q.object_type='team' AND t.team_id=q.object_id LEFT JOIN rotation_employees e ON q.object_type='employee' AND e.employee_id=q.object_id {where_clause} ORDER BY q.updated_at DESC,q.qualification_id LIMIT ?6 OFFSET ?7"
        ))?;
        let ids = statement
            .query_map(params![line_id, position_id, object_type, is_active, query, page_size as i64, offset as i64], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let items = ids
            .iter()
            .map(|id| self.get_qualification(id))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect();
        Ok(Page { items, total: total as usize, page, page_size })
    }

    pub fn get_qualification(&self, id: &str) -> Result<Option<QualificationRecord>, AppError> {
        let connection = self.connect()?;
        get_qualification_with_connection(&connection, id)
    }

    pub fn create_qualification(
        &self,
        draft: &QualificationWrite,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<QualificationRecord, AppError> {
        require_reason(reason)?;
        let id = draft.qualification_id.clone().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| new_id("rot-qualification"));
        let connection = self.connect()?;
        let errors = validate_qualification_with_connection(&connection, draft, None)?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        insert_qualification(&transaction, &id, draft, "local_config", &now)?;
        write_audit(&transaction, actor_id, actor_role, "create", "rotation_qualification", &id, reason, None, Some(json!(draft)))?;
        transaction.commit()?;
        self.get_qualification(&id)?.ok_or(AppError::NotFound)
    }

    pub fn update_qualification(
        &self,
        id: &str,
        draft: &QualificationWrite,
        actor_id: &str,
        actor_role: &str,
        reason: &str,
    ) -> Result<QualificationRecord, AppError> {
        require_reason(reason)?;
        let before = self.get_qualification(id)?.ok_or(AppError::NotFound)?;
        let errors = validate_qualification_with_connection(&self.connect()?, draft, Some(id))?;
        if !errors.is_empty() {
            return Err(AppError::FieldValidation(errors));
        }
        let now = timestamp_now();
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE rotation_qualifications SET object_type=?2,object_id=?3,position_id=?4,line_id=?5,description=?6,is_active=?7,updated_at=?8 WHERE qualification_id=?1",
            params![id, draft.object_type.as_str(), draft.object_id.trim(), draft.position_id.trim(),
                    draft.line_id.trim(), draft.description.trim(), bool_i64(draft.is_active), now],
        )?;
        write_audit(&transaction, actor_id, actor_role, "update", "rotation_qualification", id, reason, Some(json!(before)), Some(json!(draft)))?;
        transaction.commit()?;
        self.get_qualification(id)?.ok_or(AppError::NotFound)
    }

    pub fn generate_calendar(&self, query: &CalendarQuery) -> Result<Vec<CalendarEntry>, AppError> {
        if query.end_date < query.start_date {
            return Err(AppError::InvalidInput("查询结束日期不得早于开始日期。".into()));
        }
        let span_days = query.end_date.signed_duration_since(query.start_date).num_days() + 1;
        if span_days > 62 {
            return Err(AppError::InvalidInput("日历查询范围最多为 62 个自然日。".into()));
        }
        let connection = self.connect()?;
        let line_name: Option<String> = connection
            .query_row("SELECT display_name FROM rotation_lines WHERE line_id=?1 AND is_active=1", [&query.line_id], |row| row.get(0))
            .optional()?;
        let line_name = line_name.ok_or_else(|| AppError::InvalidInput("请选择有效的本机产线。".into()))?;
        let mut statement = connection.prepare(
            "SELECT config_id FROM rotation_configs WHERE line_id=?1 AND is_active=1 AND (?2 IS NULL OR config_id=?2) ORDER BY start_date,config_id",
        )?;
        let config_ids = statement
            .query_map(params![query.line_id, query.config_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let mut entries = Vec::new();
        for config_id in config_ids {
            let Some(config) = get_configuration_with_connection(&connection, &config_id)? else { continue };
            let range_start = std::cmp::max(query.start_date, config.start_date);
            let range_end = std::cmp::min(query.end_date, config.end_date.unwrap_or(query.end_date));
            if range_start > range_end {
                continue;
            }
            for target in config.targets.iter().filter(|target| target.is_active) {
                let object_name = get_object_name(&connection, &target.object_type, &target.object_id)?;
                let Some(object_name) = object_name else { continue };
                let personnel = calendar_personnel_for_target(&connection, &target.object_type, &target.object_id)?;
                let mut date = range_start;
                while date <= range_end {
                    let day_offset = date.signed_duration_since(config.start_date).num_days();
                    let index = (day_offset + target.offset_days).rem_euclid(config.cycle_length) + 1;
                    let cycle_day = config.cycle_days.iter().find(|item| item.cycle_day == index);
                    if let Some(cycle_day) = cycle_day {
                        let shift = cycle_day.shift_code.as_ref().and_then(|code| config.shifts.iter().find(|item| &item.shift_code == code));
                        let crosses_midnight = shift.is_some_and(|value| value.end_time < value.start_time);
                        let end_date = if crosses_midnight { date + Duration::days(1) } else { date };
                        entries.push(CalendarEntry {
                            date,
                            end_date,
                            config_id: config.config_id.clone(),
                            config_name: config.name.clone(),
                            object_type: target.object_type.clone(),
                            object_id: target.object_id.clone(),
                            object_name: object_name.clone(),
                            personnel: personnel.clone(),
                            line_id: config.line_id.clone(),
                            line_name: line_name.clone(),
                            status: if cycle_day.is_rest { "rest" } else { "scheduled" }.to_owned(),
                            shift_code: shift.map(|item| item.shift_code.clone()),
                            shift_name: shift.map(|item| item.name.clone()),
                            start_time: shift.map(|item| item.start_time.clone()),
                            end_time: shift.map(|item| item.end_time.clone()),
                            crosses_midnight,
                            source_type: config.source_type.clone(),
                        });
                    }
                    date += Duration::days(1);
                }
            }
        }
        entries.sort_by(|a, b| a.date.cmp(&b.date).then(a.object_name.cmp(&b.object_name)));
        Ok(entries)
    }
}

fn get_configuration_with_connection(
    connection: &Connection,
    id: &str,
) -> Result<Option<ScheduleConfigRecord>, AppError> {
    let header = connection
        .query_row(
            "SELECT c.config_id,c.name,c.line_id,l.display_name,c.object_type,c.start_date,c.end_date,c.cycle_length,c.source_type,c.is_active,c.created_at,c.updated_at FROM rotation_configs c JOIN rotation_lines l ON l.line_id=c.line_id WHERE c.config_id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                ))
            },
        )
        .optional()?;
    let Some((config_id, name, line_id, line_name, object_type, start, end, cycle_length, source_type, is_active, created_at, updated_at)) = header else {
        return Ok(None);
    };
    let mut shift_statement = connection.prepare(
        "SELECT shift_code,name,start_time,end_time,remarks,display_order FROM rotation_shifts WHERE config_id=?1 ORDER BY display_order,shift_code",
    )?;
    let shifts = shift_statement
        .query_map([&config_id], |row| {
            Ok(ShiftDefinition {
                shift_code: row.get(0)?,
                name: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                remarks: row.get(4)?,
                display_order: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut cycle_statement = connection.prepare(
        "SELECT d.cycle_day,s.shift_code,d.is_rest FROM rotation_cycle_days d LEFT JOIN rotation_shifts s ON s.shift_id=d.shift_id WHERE d.config_id=?1 ORDER BY d.cycle_day",
    )?;
    let cycle_days = cycle_statement
        .query_map([&config_id], |row| {
            Ok(CycleDay {
                cycle_day: row.get(0)?,
                shift_code: row.get(1)?,
                is_rest: row.get::<_, i64>(2)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut target_statement = connection.prepare(
        "SELECT object_type,object_id,offset_days,is_active FROM rotation_config_targets WHERE config_id=?1 ORDER BY object_type,object_id",
    )?;
    let targets = target_statement
        .query_map([&config_id], |row| {
            Ok(RotationTarget {
                object_type: parse_object_type(&row.get::<_, String>(0)?).map_err(to_sql_conversion_error)?,
                object_id: row.get(1)?,
                offset_days: row.get(2)?,
                is_active: row.get::<_, i64>(3)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(ScheduleConfigRecord {
        config_id,
        name,
        line_id,
        line_name,
        object_type: parse_object_type(&object_type)?,
        start_date: parse_stored_date(&start)?,
        end_date: end.as_deref().map(parse_stored_date).transpose()?,
        cycle_length,
        shifts,
        cycle_days,
        targets,
        source_type,
        is_active: is_active != 0,
        created_at,
        updated_at,
    }))
}

fn to_sql_conversion_error(error: AppError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string())),
    )
}

fn parse_object_type(value: &str) -> Result<RotationObjectType, AppError> {
    match value {
        "team" => Ok(RotationObjectType::Team),
        "employee" => Ok(RotationObjectType::Employee),
        _ => Err(AppError::Configuration("数据库中的轮转对象类型无效。".into())),
    }
}

fn config_record_to_draft(record: &ScheduleConfigRecord) -> ScheduleConfigDraft {
    ScheduleConfigDraft {
        name: record.name.clone(),
        line_id: record.line_id.clone(),
        object_type: record.object_type.clone(),
        start_date: record.start_date,
        end_date: record.end_date,
        cycle_length: record.cycle_length,
        shifts: record.shifts.clone(),
        cycle_days: record.cycle_days.clone(),
        targets: record.targets.clone(),
    }
}

fn validate_configuration_with_connection(
    connection: &Connection,
    draft: &ScheduleConfigDraft,
    exclude_id: Option<&str>,
) -> Result<Vec<FieldValidationError>, AppError> {
    let mut errors = Vec::new();
    if draft.name.trim().is_empty() {
        errors.push(field_error("name", "REQUIRED", "配置名称不能为空。"));
    }
    if draft.line_id.trim().is_empty() {
        errors.push(field_error("line_id", "REQUIRED", "请选择产线。"));
    } else {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_lines WHERE line_id=?1 AND is_active=1)",
            [&draft.line_id],
            |row| row.get(0),
        )?;
        if !exists {
            errors.push(field_error("line_id", "LINE_NOT_FOUND", "所选产线不存在或已停用。"));
        }
    }
    if draft.end_date.is_some_and(|end| end < draft.start_date) {
        errors.push(field_error("end_date", "INVALID_DATE_RANGE", "结束日期不得早于生效日期。"));
    }
    if draft.cycle_length <= 0 || draft.cycle_days.len() as i64 != draft.cycle_length {
        errors.push(field_error("cycle_length", "INVALID_CYCLE_LENGTH", "周期长度必须为正数，且与周期明细行数一致。"));
    }
    if draft.shifts.is_empty() {
        errors.push(field_error("shifts", "REQUIRED", "至少定义一个工作班次。"));
    }
    let mut shift_codes = std::collections::HashSet::new();
    let mut shift_names = std::collections::HashSet::new();
    for (index, shift) in draft.shifts.iter().enumerate() {
        let code = shift.shift_code.trim();
        let name = shift.name.trim();
        if code.is_empty() {
            errors.push(field_error(&format!("shifts.{index}.shift_code"), "REQUIRED", "班次编码不能为空。"));
        } else if !shift_codes.insert(code.to_owned()) {
            errors.push(field_error(&format!("shifts.{index}.shift_code"), "DUPLICATE_SHIFT_CODE", "班次编码不得重复。"));
        }
        if name.is_empty() {
            errors.push(field_error(&format!("shifts.{index}.name"), "REQUIRED", "班次名称不能为空。"));
        } else if !shift_names.insert(name.to_owned()) {
            errors.push(field_error(&format!("shifts.{index}.name"), "DUPLICATE_SHIFT_NAME", "班次名称不得重复。"));
        }
        let start = chrono::NaiveTime::parse_from_str(shift.start_time.trim(), "%H:%M");
        let end = chrono::NaiveTime::parse_from_str(shift.end_time.trim(), "%H:%M");
        if start.is_err() {
            errors.push(field_error(&format!("shifts.{index}.start_time"), "INVALID_TIME", "开始时间须采用 HH:mm 格式。"));
        }
        if end.is_err() {
            errors.push(field_error(&format!("shifts.{index}.end_time"), "INVALID_TIME", "结束时间须采用 HH:mm 格式。"));
        }
        if let (Ok(start), Ok(end)) = (start, end) {
            if start == end {
                errors.push(field_error(&format!("shifts.{index}.end_time"), "ZERO_LENGTH_SHIFT", "班次开始时间和结束时间不得相同。"));
            }
        }
    }
    for (index, day) in draft.cycle_days.iter().enumerate() {
        if day.cycle_day != (index + 1) as i64 {
            errors.push(field_error(&format!("cycle_days.{index}.cycle_day"), "INVALID_CYCLE_ORDER", "周期日序号须从 1 开始连续排列。"));
        }
        if day.is_rest && day.shift_code.is_some() {
            errors.push(field_error(&format!("cycle_days.{index}.shift_code"), "REST_HAS_SHIFT", "休息日不得同时指定班次。"));
        } else if !day.is_rest {
            match day.shift_code.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                Some(code) if shift_codes.contains(code) => {}
                Some(_) => errors.push(field_error(&format!("cycle_days.{index}.shift_code"), "UNKNOWN_SHIFT", "请选择当前配置中已定义的班次。")),
                None => errors.push(field_error(&format!("cycle_days.{index}.shift_code"), "REQUIRED", "工作日必须选择一个班次。")),
            }
        }
    }
    if draft.targets.is_empty() {
        errors.push(field_error("targets", "REQUIRED", "至少分配一个班组或员工作为轮转对象。"));
    }
    let mut seen_targets = std::collections::HashSet::new();
    for (index, target) in draft.targets.iter().enumerate() {
        if target.object_type != draft.object_type {
            errors.push(field_error(&format!("targets.{index}.object_type"), "OBJECT_TYPE_MISMATCH", "轮转对象类型须与配置的轮班对象类型一致。"));
        }
        if target.object_id.trim().is_empty() {
            errors.push(field_error(&format!("targets.{index}.object_id"), "REQUIRED", "请选择轮转对象。"));
            continue;
        }
        if !seen_targets.insert((target.object_type.as_str(), target.object_id.trim().to_owned())) {
            errors.push(field_error(&format!("targets.{index}.object_id"), "DUPLICATE_TARGET", "同一轮转对象在此配置中只能出现一次。"));
        }
        if target.offset_days < 0 || target.offset_days >= draft.cycle_length {
            errors.push(field_error(&format!("targets.{index}.offset_days"), "OFFSET_OUT_OF_RANGE", "轮转偏移量须在 0 至周期长度减 1 之间。"));
        }
        let active = match target.object_type {
            RotationObjectType::Team => connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM rotation_teams WHERE team_id=?1 AND is_active=1)",
                [&target.object_id],
                |row| row.get::<_, i64>(0).map(|value| value != 0),
            )?,
            RotationObjectType::Employee => connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM rotation_employees WHERE employee_id=?1 AND is_archived=0)",
                [&target.object_id],
                |row| row.get::<_, i64>(0).map(|value| value != 0),
            )?,
        };
        if !active {
            errors.push(field_error(&format!("targets.{index}.object_id"), "OBJECT_NOT_ACTIVE", "轮转对象不存在或已归档。"));
        }
        let qualified: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_qualifications WHERE object_type=?1 AND object_id=?2 AND line_id=?3 AND is_active=1)",
            params![target.object_type.as_str(), target.object_id.trim(), draft.line_id.trim()],
            |row| row.get(0),
        )?;
        if !qualified {
            errors.push(field_error(&format!("targets.{index}.object_id"), "LINE_QUALIFICATION_REQUIRED", "轮转对象未登记该产线的有效岗位资格关系。"));
        }
    }
    if !draft.line_id.trim().is_empty() {
        let end_limit = draft.end_date.map(|value| value.to_string()).unwrap_or_else(|| "9999-12-31".to_owned());
        let overlap: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_configs WHERE line_id=?1 AND is_active=1 AND (?2 IS NULL OR config_id<>?2) AND start_date<=?3 AND COALESCE(end_date,'9999-12-31')>=?4)",
            params![draft.line_id.trim(), exclude_id, end_limit, draft.start_date.to_string()],
            |row| row.get(0),
        )?;
        if overlap {
            errors.push(field_error("start_date", "ACTIVE_DATE_CONFLICT", "同一产线已有有效日期重叠的启用配置。"));
        }
    }
    Ok(errors)
}

fn insert_configuration(
    transaction: &Transaction<'_>,
    id: &str,
    draft: &ScheduleConfigDraft,
    source_type: &str,
    is_active: bool,
    now: &str,
) -> Result<(), AppError> {
    transaction.execute(
        "INSERT INTO rotation_configs(config_id,name,line_id,object_type,start_date,end_date,cycle_length,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
        params![id, draft.name.trim(), draft.line_id.trim(), draft.object_type.as_str(), draft.start_date.to_string(),
                draft.end_date.map(|date| date.to_string()), draft.cycle_length, source_type, bool_i64(is_active), now],
    )?;
    replace_configuration_children(transaction, id, draft)
}

fn replace_configuration_children(
    transaction: &Transaction<'_>,
    config_id: &str,
    draft: &ScheduleConfigDraft,
) -> Result<(), AppError> {
    transaction.execute("DELETE FROM rotation_cycle_days WHERE config_id=?1", [config_id])?;
    transaction.execute("DELETE FROM rotation_config_targets WHERE config_id=?1", [config_id])?;
    transaction.execute("DELETE FROM rotation_shifts WHERE config_id=?1", [config_id])?;
    let mut shift_ids = std::collections::HashMap::new();
    for shift in &draft.shifts {
        let shift_id = new_id("rot-shift");
        transaction.execute(
            "INSERT INTO rotation_shifts(shift_id,config_id,shift_code,name,start_time,end_time,remarks,display_order) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![shift_id, config_id, shift.shift_code.trim(), shift.name.trim(), shift.start_time.trim(), shift.end_time.trim(), shift.remarks.trim(), shift.display_order],
        )?;
        shift_ids.insert(shift.shift_code.trim().to_owned(), shift_id);
    }
    for day in &draft.cycle_days {
        let shift_id = day.shift_code.as_deref().and_then(|code| shift_ids.get(code.trim())).cloned();
        transaction.execute(
            "INSERT INTO rotation_cycle_days(config_id,cycle_day,shift_id,is_rest) VALUES(?1,?2,?3,?4)",
            params![config_id, day.cycle_day, shift_id, bool_i64(day.is_rest)],
        )?;
    }
    for target in &draft.targets {
        transaction.execute(
            "INSERT INTO rotation_config_targets(config_id,object_type,object_id,offset_days,is_active) VALUES(?1,?2,?3,?4,?5)",
            params![config_id, target.object_type.as_str(), target.object_id.trim(), target.offset_days, bool_i64(target.is_active)],
        )?;
    }
    Ok(())
}

fn get_employee_with_connection(connection: &Connection, id: &str) -> Result<Option<EmployeeProfile>, AppError> {
    let record = connection
        .query_row(
            "SELECT e.employee_id,e.name,e.position_id,p.display_name,e.team_id,t.name,e.collaboration_score,e.source_type,e.is_archived,e.updated_at FROM rotation_employees e JOIN rotation_positions p ON p.position_id=e.position_id LEFT JOIN rotation_teams t ON t.team_id=e.team_id WHERE e.employee_id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<f64>>(6)?, row.get::<_, String>(7)?, row.get::<_, i64>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?;
    let Some((employee_id, name, position_id, position_name, team_id, team_name, collaboration_score, source_type, archived, updated_at)) = record else {
        return Ok(None);
    };
    let mut skill_statement = connection.prepare(
        "SELECT skill_code,skill_name,skill_score,is_active FROM rotation_employee_skills WHERE employee_id=?1 ORDER BY skill_name,skill_code",
    )?;
    let skills = skill_statement
        .query_map([&employee_id], |row| {
            Ok(EmployeeSkill {
                skill_code: row.get(0)?,
                skill_name: row.get(1)?,
                skill_score: row.get(2)?,
                is_active: row.get::<_, i64>(3)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let equipment_mappings = employee_equipment_with_connection(connection, &employee_id)?;
    let skill_values: Vec<f64> = skills
        .iter()
        .filter(|skill| skill.is_active)
        .filter_map(|skill| skill.skill_score)
        .collect();
    let skill_score = average(&skill_values);
    let composite_score = match (skill_score, collaboration_score) {
        (Some(skill), Some(collaboration)) => Some((skill + collaboration) / 2.0),
        _ => None,
    };
    let mut line_statement = connection.prepare(
        "SELECT DISTINCT line_id FROM rotation_qualifications WHERE object_type='employee' AND object_id=?1 AND is_active=1 ORDER BY line_id",
    )?;
    let line_ids = line_statement
        .query_map([&employee_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(EmployeeProfile {
        employee_id,
        name,
        position_id,
        position_name,
        team_id,
        team_name,
        line_ids,
        skills,
        equipment_mappings,
        skill_score,
        collaboration_score,
        composite_score,
        source_type,
        is_archived: archived != 0,
        updated_at,
    }))
}

fn employee_equipment_with_connection(
    connection: &Connection,
    employee_id: &str,
) -> Result<Vec<EmployeeEquipmentRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT ee.equipment_id,e.equipment_code,e.equipment_name,e.equipment_category,e.line_id,l.display_name,e.source_line_code,e.source_line_name,e.position_name,ee.ability_level,ee.source_type,e.is_active FROM rotation_employee_equipment ee JOIN rotation_equipment e ON e.equipment_id=ee.equipment_id JOIN rotation_lines l ON l.line_id=e.line_id WHERE ee.employee_id=?1 ORDER BY l.display_name,e.equipment_category,e.equipment_name",
    )?;
    let items = statement.query_map([employee_id], |row| {
        Ok(EmployeeEquipmentRecord {
            equipment_id: row.get(0)?, equipment_code: row.get(1)?, equipment_name: row.get(2)?,
            equipment_category: row.get(3)?, line_id: row.get(4)?, line_name: row.get(5)?,
            source_line_code: row.get(6)?, source_line_name: row.get(7)?, position_name: row.get(8)?,
            ability_level: row.get(9)?, source_type: row.get(10)?, is_active: row.get::<_, i64>(11)? != 0,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

fn get_team_with_connection(connection: &Connection, id: &str) -> Result<Option<TeamRecord>, AppError> {
    let mut team = connection
        .query_row(
            "SELECT t.team_id,t.name,COALESCE(tc.team_category,'未分类'),t.description,t.is_active,(SELECT COUNT(*) FROM rotation_employees e WHERE e.team_id=t.team_id AND e.is_archived=0),(SELECT COUNT(DISTINCT q.line_id) FROM rotation_qualifications q WHERE q.object_type='team' AND q.object_id=t.team_id AND q.is_active=1),t.source_type,t.updated_at FROM rotation_teams t LEFT JOIN rotation_team_catalog tc ON tc.team_id=t.team_id WHERE t.team_id=?1",
            [id],
            |row| {
                Ok(TeamRecord {
                    team_id: row.get(0)?,
                    name: row.get(1)?,
                    team_category: row.get(2)?,
                    description: row.get(3)?,
                    is_active: row.get::<_, i64>(4)? != 0,
                    member_count: row.get::<_, i64>(5)? as usize,
                    members: Vec::new(),
                    qualification_line_count: row.get::<_, i64>(6)? as usize,
                    source_type: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AppError::from)?;
    if let Some(record) = team.as_mut() {
        record.members = team_member_summaries(connection, id)?;
    }
    Ok(team)
}

fn team_member_summaries(connection: &Connection, team_id: &str) -> Result<Vec<TeamMemberSummary>, AppError> {
    let mut statement = connection.prepare(
        "SELECT e.employee_id,e.name,p.display_name FROM rotation_employees e JOIN rotation_positions p ON p.position_id=e.position_id WHERE e.team_id=?1 AND e.is_archived=0 ORDER BY e.name,e.employee_id",
    )?;
    let members = statement.query_map([team_id], |row| {
        Ok(TeamMemberSummary {
            employee_id: row.get(0)?,
            name: row.get(1)?,
            position_name: row.get(2)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(members)
}

fn validate_team_members(connection: &Connection, member_ids: &[String]) -> Result<Vec<FieldValidationError>, AppError> {
    let mut errors = Vec::new();
    let mut seen = HashSet::new();
    for (index, raw_id) in member_ids.iter().enumerate() {
        let employee_id = raw_id.trim();
        if employee_id.is_empty() {
            errors.push(field_error(&format!("member_ids[{index}]"), "REQUIRED", "班组成员编号不能为空。"));
            continue;
        }
        if !seen.insert(employee_id.to_owned()) {
            errors.push(field_error(&format!("member_ids[{index}]"), "DUPLICATE_TEAM_MEMBER", "班组成员不能重复选择。"));
            continue;
        }
        let is_eligible: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_employees WHERE employee_id=?1 AND is_archived=0)",
            [employee_id],
            |row| row.get(0),
        )?;
        if !is_eligible {
            errors.push(field_error(&format!("member_ids[{index}]"), "INVALID_TEAM_MEMBER", "班组成员必须是未归档的本机员工档案。"));
        }
    }
    Ok(errors)
}

fn replace_team_members(transaction: &Transaction<'_>, team_id: &str, member_ids: &[String], now: &str) -> Result<(), AppError> {
    transaction.execute(
        "UPDATE rotation_employees SET team_id=NULL,updated_at=?2 WHERE team_id=?1 AND is_archived=0",
        params![team_id, now],
    )?;
    for employee_id in member_ids {
        transaction.execute(
            "UPDATE rotation_employees SET team_id=?2,updated_at=?3 WHERE employee_id=?1 AND is_archived=0",
            params![employee_id.trim(), team_id, now],
        )?;
    }
    Ok(())
}

fn calendar_personnel_for_target(connection: &Connection, object_type: &RotationObjectType, object_id: &str) -> Result<Vec<CalendarPersonnel>, AppError> {
    let query = match object_type {
        RotationObjectType::Team => "SELECT e.employee_id,e.name,p.display_name FROM rotation_employees e JOIN rotation_positions p ON p.position_id=e.position_id WHERE e.team_id=?1 AND e.is_archived=0 ORDER BY e.name,e.employee_id",
        RotationObjectType::Employee => "SELECT e.employee_id,e.name,p.display_name FROM rotation_employees e JOIN rotation_positions p ON p.position_id=e.position_id WHERE e.employee_id=?1 AND e.is_archived=0",
    };
    let mut statement = connection.prepare(query)?;
    let personnel = statement.query_map([object_id], |row| {
        Ok(CalendarPersonnel {
            employee_id: row.get(0)?,
            name: row.get(1)?,
            position_name: row.get(2)?,
        })
    })?.collect::<Result<Vec<_>, _>>()?;
    Ok(personnel)
}

fn get_qualification_with_connection(connection: &Connection, id: &str) -> Result<Option<QualificationRecord>, AppError> {
    connection
        .query_row(
            "SELECT q.qualification_id,q.object_type,q.object_id,COALESCE(t.name,e.name),q.position_id,p.display_name,q.line_id,l.display_name,q.description,q.is_active,q.source_type,q.updated_at FROM rotation_qualifications q LEFT JOIN rotation_teams t ON q.object_type='team' AND t.team_id=q.object_id LEFT JOIN rotation_employees e ON q.object_type='employee' AND e.employee_id=q.object_id JOIN rotation_positions p ON p.position_id=q.position_id JOIN rotation_lines l ON l.line_id=q.line_id WHERE q.qualification_id=?1",
            [id],
            |row| {
                let object_type: String = row.get(1)?;
                Ok(QualificationRecord {
                    qualification_id: row.get(0)?,
                    object_type: parse_object_type(&object_type).map_err(to_sql_conversion_error)?,
                    object_id: row.get(2)?,
                    object_name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    position_id: row.get(4)?,
                    position_name: row.get(5)?,
                    line_id: row.get(6)?,
                    line_name: row.get(7)?,
                    description: row.get(8)?,
                    is_active: row.get::<_, i64>(9)? != 0,
                    source_type: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(AppError::from)
}

fn validate_employee_with_connection(
    connection: &Connection,
    draft: &EmployeeWrite,
    exclude_id: Option<&str>,
) -> Result<Vec<FieldValidationError>, AppError> {
    let mut errors = Vec::new();
    if draft.employee_id.trim().is_empty() {
        errors.push(field_error("employee_id", "REQUIRED", "员工编号不能为空。"));
    }
    if draft.name.trim().is_empty() {
        errors.push(field_error("name", "REQUIRED", "员工姓名不能为空。"));
    }
    let position_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM rotation_positions WHERE position_id=?1 AND is_active=1)",
        [&draft.position_id],
        |row| row.get(0),
    )?;
    if !position_exists {
        errors.push(field_error("position_id", "POSITION_NOT_FOUND", "请选择有效岗位。"));
    }
    if let Some(team_id) = draft.team_id.as_deref().filter(|value| !value.trim().is_empty()) {
        let team_exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_teams WHERE team_id=?1 AND is_active=1)",
            [team_id],
            |row| row.get(0),
        )?;
        if !team_exists {
            errors.push(field_error("team_id", "TEAM_NOT_FOUND", "所选班组不存在或已停用。"));
        }
    }
    if !score_valid(draft.collaboration_score) {
        errors.push(field_error("collaboration_score", "SCORE_OUT_OF_RANGE", "协作评分须在 0 至 100 分之间，或留空表示无可计算值。"));
    }
    let mut seen = std::collections::HashSet::new();
    for (index, skill) in draft.skills.iter().enumerate() {
        if skill.skill_code.trim().is_empty() || skill.skill_name.trim().is_empty() {
            errors.push(field_error(&format!("skills.{index}.skill_code"), "REQUIRED", "技能编码和技能名称不能为空。"));
        }
        if !seen.insert(skill.skill_code.trim().to_owned()) {
            errors.push(field_error(&format!("skills.{index}.skill_code"), "DUPLICATE_SKILL", "同一员工的技能编码不得重复。"));
        }
        if !score_valid(skill.skill_score) {
            errors.push(field_error(&format!("skills.{index}.skill_score"), "SCORE_OUT_OF_RANGE", "技能评分须在 0 至 100 分之间，或留空表示无可计算值。"));
        }
    }
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM rotation_employees WHERE employee_id=?1 AND (?2 IS NULL OR employee_id<>?2))",
        params![draft.employee_id.trim(), exclude_id],
        |row| row.get(0),
    )?;
    if exists {
        errors.push(field_error("employee_id", "DUPLICATE_EMPLOYEE_ID", "员工编号已存在。"));
    }
    Ok(errors)
}

fn replace_employee_skills(
    transaction: &Transaction<'_>,
    employee_id: &str,
    skills: &[EmployeeSkill],
    now: &str,
) -> Result<(), AppError> {
    transaction.execute("DELETE FROM rotation_employee_skills WHERE employee_id=?1", [employee_id])?;
    for skill in skills {
        transaction.execute(
            "INSERT INTO rotation_employee_skills(employee_id,skill_code,skill_name,skill_score,is_active,updated_at) VALUES(?1,?2,?3,?4,?5,?6)",
            params![employee_id, skill.skill_code.trim(), skill.skill_name.trim(), skill.skill_score, bool_i64(skill.is_active), now],
        )?;
    }
    Ok(())
}

fn validate_team(draft: &TeamWrite) -> Vec<FieldValidationError> {
    let mut errors = Vec::new();
    if draft.name.trim().is_empty() {
        errors.push(field_error("name", "REQUIRED", "班组名称不能为空。"));
    }
    errors
}

fn team_name_exists(connection: &Connection, name: &str, exclude_id: Option<&str>) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_teams WHERE name=?1 AND (?2 IS NULL OR team_id<>?2))",
            params![name.trim(), exclude_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)
}

fn validate_qualification_with_connection(
    connection: &Connection,
    draft: &QualificationWrite,
    exclude_id: Option<&str>,
) -> Result<Vec<FieldValidationError>, AppError> {
    let mut errors = Vec::new();
    if draft.object_id.trim().is_empty() {
        errors.push(field_error("object_id", "REQUIRED", "请选择班组或员工。"));
    } else {
        let target_exists: bool = match draft.object_type {
            RotationObjectType::Team => connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM rotation_teams WHERE team_id=?1 AND is_active=1)",
                [&draft.object_id],
                |row| row.get(0),
            )?,
            RotationObjectType::Employee => connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM rotation_employees WHERE employee_id=?1 AND is_archived=0)",
                [&draft.object_id],
                |row| row.get(0),
            )?,
        };
        if !target_exists {
            errors.push(field_error("object_id", "OBJECT_NOT_ACTIVE", "所选对象不存在、已停用或已归档。"));
        }
    }
    let position_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM rotation_positions WHERE position_id=?1 AND is_active=1)",
        [&draft.position_id],
        |row| row.get(0),
    )?;
    if !position_exists {
        errors.push(field_error("position_id", "POSITION_NOT_FOUND", "请选择有效岗位。"));
    }
    let line_exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM rotation_lines WHERE line_id=?1 AND is_active=1)",
        [&draft.line_id],
        |row| row.get(0),
    )?;
    if !line_exists {
        errors.push(field_error("line_id", "LINE_NOT_FOUND", "请选择有效产线。"));
    }
    let duplicate: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM rotation_qualifications WHERE object_type=?1 AND object_id=?2 AND position_id=?3 AND line_id=?4 AND (?5 IS NULL OR qualification_id<>?5))",
        params![draft.object_type.as_str(), draft.object_id.trim(), draft.position_id.trim(), draft.line_id.trim(), exclude_id],
        |row| row.get(0),
    )?;
    if duplicate {
        errors.push(field_error("object_id", "DUPLICATE_QUALIFICATION", "该对象、岗位和产线的资格关系已登记。"));
    }
    Ok(errors)
}

fn insert_qualification(
    transaction: &Transaction<'_>,
    id: &str,
    draft: &QualificationWrite,
    source_type: &str,
    now: &str,
) -> Result<(), AppError> {
    transaction.execute(
        "INSERT INTO rotation_qualifications(qualification_id,object_type,object_id,position_id,line_id,description,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![id, draft.object_type.as_str(), draft.object_id.trim(), draft.position_id.trim(), draft.line_id.trim(),
                draft.description.trim(), source_type, bool_i64(draft.is_active), now],
    )?;
    Ok(())
}

fn validate_reason_and_actor(actor_id: &str, actor_role: &str) -> Result<(), AppError> {
    if actor_id.trim().is_empty() || actor_role.trim().is_empty() {
        return Err(AppError::InvalidInput("操作人和操作角色不能为空。".into()));
    }
    Ok(())
}

fn require_reason(reason: &str) -> Result<(), AppError> {
    if reason.trim().is_empty() {
        return Err(AppError::InvalidInput("请填写本次操作原因。".into()));
    }
    Ok(())
}

fn write_audit(
    transaction: &Transaction<'_>,
    actor_id: &str,
    actor_role: &str,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    reason: &str,
    before: Option<Value>,
    after: Option<Value>,
) -> Result<(), AppError> {
    validate_reason_and_actor(actor_id, actor_role)?;
    transaction.execute(
        "INSERT INTO audit_log(id,actor_id,actor_role,action,entity_type,entity_id,reason,before_json,after_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![new_id("audit"), actor_id.trim(), actor_role.trim(), action, entity_type, entity_id, reason.trim(),
                before.map(|value| value.to_string()), after.map(|value| value.to_string()), timestamp_now()],
    )?;
    Ok(())
}

fn get_object_name(
    connection: &Connection,
    object_type: &RotationObjectType,
    object_id: &str,
) -> Result<Option<String>, AppError> {
    let sql = match object_type {
        RotationObjectType::Team => "SELECT name FROM rotation_teams WHERE team_id=?1",
        RotationObjectType::Employee => "SELECT name FROM rotation_employees WHERE employee_id=?1",
    };
    connection.query_row(sql, [object_id], |row| row.get(0)).optional().map_err(AppError::from)
}

fn parse_stored_date(value: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::Configuration("本机数据库包含无效的日期值。".into()))
}

fn average(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

fn score_valid(score: Option<f64>) -> bool {
    score.map_or(true, |value| value.is_finite() && (0.0..=100.0).contains(&value))
}

fn bool_i64(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn normalized(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|text| !text.is_empty()).map(ToOwned::to_owned)
}

fn normalized_like(value: Option<&str>) -> Option<String> {
    normalized(value).map(|text| format!("%{text}%"))
}

fn paging(page: Option<usize>, page_size: Option<usize>) -> (usize, usize, usize) {
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(20).clamp(1, 200);
    (page, page_size, page.saturating_sub(1).saturating_mul(page_size))
}

fn field_error(path: &str, code: &str, message: &str) -> FieldValidationError {
    FieldValidationError {
        path: path.to_owned(),
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

fn timestamp_now() -> String {
    chrono::Local::now().to_rfc3339()
}

fn required_array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>, AppError> {
    value.get(key).and_then(Value::as_array)
        .ok_or_else(|| AppError::Configuration(format!("演示数据目录缺少有效的 {key} 列表。")))
}

fn required_value_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AppError> {
    value.get(key).and_then(Value::as_str)
        .ok_or_else(|| AppError::Configuration(format!("演示数据记录缺少有效的 {key} 字段。")))
}

fn demo_employee_name(employee_id: &str) -> Option<&'static str> {
    let parts: Vec<&str> = employee_id.split('-').collect();
    if parts.len() < 6 || parts[0] != "DEMO" || parts[1] != "EMP" { return None; }
    let slot = parts.get(parts.len().checked_sub(2)?)?.parse::<usize>().ok()?;
    let worker = parts.last()?.parse::<usize>().ok()?;
    if !(1..=3).contains(&slot) || !(1..=2).contains(&worker) { return None; }
    let line_id = parts[2..parts.len() - 2].join("-");
    let group = match line_id.as_str() {
        "PET-01" => 0,
        "PET-02" => 1,
        "PET-03" => 2,
        "ASEPTIC-A" => 3,
        "ASEPTIC-B" => 4,
        "ASEPTIC-C" => 5,
        _ => return None,
    };
    DEMO_EMPLOYEE_NAMES.get(group * 6 + (slot - 1) * 2 + worker - 1).copied()
}

fn equipment_line_ids(source_line_code: &str) -> &'static [&'static str] {
    match source_line_code {
        "HB-PET01" => &["PET-01"],
        "HB-PET02" => &["PET-02"],
        "HB-PET03" => &["PET-03"],
        "HB-AS01" => &["ASEPTIC-A", "ASEPTIC-B", "ASEPTIC-C"],
        _ => &[],
    }
}

fn csv_column(headers: &csv::StringRecord, name: &str) -> Result<usize, AppError> {
    headers.iter().position(|header| header.trim_start_matches('\u{feff}') == name)
        .ok_or_else(|| AppError::Configuration(format!("设备参考清单缺少必要字段：{name}。")))
}

impl SchedulingRepository {
    pub fn seed_expanded_demo_catalog_once(&self, package_root: &Path) -> Result<(), AppError> {
        let catalog_path = package_root.join("data/demo/expanded/catalog_expansion.json");
        let catalog: Value = serde_json::from_slice(&std::fs::read(&catalog_path).map_err(|error| {
            AppError::Configuration(format!("无法读取人员与技能扩充目录：{error}"))
        })?).map_err(|error| AppError::Configuration(format!("人员与技能扩充目录格式无效：{error}")))?;
        let seed_version = catalog.get("seed_version").and_then(Value::as_i64)
            .ok_or_else(|| AppError::Configuration("人员与技能扩充目录缺少有效的 seed_version。".into()))?;
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let seeded: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_seed_versions WHERE seed_name='expanded-demo-catalog' AND version>=?1)",
            [seed_version], |row| row.get(0),
        )?;
        if seeded { return Ok(()); }
        let now = timestamp_now();

        for item in required_array(&catalog, "positions")? {
            let position_id = required_value_string(item, "position_id")?;
            let name = required_value_string(item, "name")?;
            let category = required_value_string(item, "category")?;
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_positions(position_id,display_name,source_type,is_active,created_at,updated_at) VALUES(?1,?2,'synthetic_demo',1,?3,?3)",
                params![position_id, name, now],
            )?;
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_position_catalog(position_id,position_category,description,source_type,created_at,updated_at) VALUES(?1,?2,'本机合成演示分类。','synthetic_demo',?3,?3)",
                params![position_id, category, now],
            )?;
        }

        for item in required_array(&catalog, "skills")? {
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_skill_catalog(skill_code,skill_name,skill_category,description,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,'synthetic_demo',1,?5,?5)",
                params![
                    required_value_string(item, "code")?,
                    required_value_string(item, "name")?,
                    required_value_string(item, "category")?,
                    required_value_string(item, "description")?,
                    now,
                ],
            )?;
        }

        // Normalize the legacy demo rows to the canonical names represented by SKILL-CORE and SKILL-SAFETY.
        transaction.execute(
            "UPDATE rotation_employee_skills SET skill_name='核心设备操作',updated_at=?1 WHERE skill_code='SKILL-CORE' AND employee_id IN (SELECT employee_id FROM rotation_employees WHERE source_type='synthetic_demo')",
            [&now],
        )?;
        transaction.execute(
            "UPDATE rotation_employee_skills SET skill_name='安全规程',updated_at=?1 WHERE skill_code='SKILL-SAFETY' AND employee_id IN (SELECT employee_id FROM rotation_employees WHERE source_type='synthetic_demo')",
            [&now],
        )?;

        for item in required_array(&catalog, "teams")? {
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_teams(team_id,name,description,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,'synthetic_demo',1,?4,?4)",
                params![
                    required_value_string(item, "team_id")?,
                    required_value_string(item, "name")?,
                    item.get("description").and_then(Value::as_str).unwrap_or_default(),
                    now,
                ],
            )?;
        }

        for item in required_array(&catalog, "team_catalog")? {
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_team_catalog(team_id,team_category,line_id,source_type,created_at,updated_at) VALUES(?1,?2,?3,'synthetic_demo',?4,?4)",
                params![
                    required_value_string(item, "team_id")?,
                    required_value_string(item, "team_category")?,
                    required_value_string(item, "line_id")?,
                    now,
                ],
            )?;
        }

        let employees = required_array(&catalog, "employees")?;
        for item in employees {
            let employee_id = required_value_string(item, "employee_id")?;
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_employees(employee_id,name,position_id,team_id,collaboration_score,source_type,is_archived,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'synthetic_demo',0,?6,?6)",
                params![
                    employee_id,
                    required_value_string(item, "name")?,
                    required_value_string(item, "position_id")?,
                    required_value_string(item, "team_id")?,
                    item.get("collaboration_score").and_then(Value::as_f64),
                    now,
                ],
            )?;
            if let Some(skills) = item.get("skills").and_then(Value::as_array) {
                for skill in skills {
                    transaction.execute(
                        "INSERT OR IGNORE INTO rotation_employee_skills(employee_id,skill_code,skill_name,skill_score,is_active,updated_at) VALUES(?1,?2,?3,?4,1,?5)",
                        params![
                            employee_id,
                            required_value_string(skill, "skill_code")?,
                            required_value_string(skill, "skill_name")?,
                            skill.get("skill_score").and_then(Value::as_f64),
                            now,
                        ],
                    )?;
                }
            }
        }

        for item in required_array(&catalog, "qualifications")? {
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_qualifications(qualification_id,object_type,object_id,position_id,line_id,description,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,'synthetic_demo',1,?7,?7)",
                params![
                    required_value_string(item, "qualification_id")?,
                    required_value_string(item, "object_type")?,
                    required_value_string(item, "object_id")?,
                    required_value_string(item, "position_id")?,
                    required_value_string(item, "line_id")?,
                    item.get("description").and_then(Value::as_str).unwrap_or_default(),
                    now,
                ],
            )?;
        }

        for item in required_array(&catalog, "config_targets")? {
            transaction.execute(
                "INSERT OR IGNORE INTO rotation_config_targets(config_id,object_type,object_id,offset_days,is_active) VALUES(?1,?2,?3,?4,1)",
                params![
                    required_value_string(item, "config_id")?,
                    required_value_string(item, "object_type")?,
                    required_value_string(item, "object_id")?,
                    item.get("offset_days").and_then(Value::as_i64).unwrap_or(0),
                ],
            )?;
        }

        for (employee_index, item) in employees.iter().enumerate() {
            let employee_id = required_value_string(item, "employee_id")?;
            let line_id = required_value_string(item, "line_id")?;
            let equipment_ids = transaction.prepare(
                "SELECT equipment_id FROM rotation_equipment WHERE line_id=?1 AND is_active=1 ORDER BY equipment_code",
            )?.query_map([line_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            if equipment_ids.is_empty() { continue; }
            let count = (2 + employee_index % 3).min(equipment_ids.len());
            let start = employee_index % equipment_ids.len();
            for offset in 0..count {
                transaction.execute(
                    "INSERT OR IGNORE INTO rotation_employee_equipment(employee_id,equipment_id,ability_level,source_type,updated_at) VALUES(?1,?2,?3,'synthetic_demo',?4)",
                    params![employee_id, equipment_ids[(start + offset) % equipment_ids.len()], ((employee_index + offset) % 5 + 1) as i64, now],
                )?;
            }
        }

        transaction.execute(
            "INSERT OR REPLACE INTO rotation_seed_versions(seed_name,version,created_at) VALUES('expanded-demo-catalog',?1,?2)",
            params![seed_version, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn seed_demo_catalog_once(&self) -> Result<(), AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let already_seeded: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_seed_versions WHERE seed_name='rotation-calendar' AND version>=1)",
            [],
            |row| row.get(0),
        )?;
        if already_seeded {
            return Ok(());
        }
        let has_existing_module_data: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_configs) OR EXISTS(SELECT 1 FROM rotation_employees) OR EXISTS(SELECT 1 FROM rotation_teams) OR EXISTS(SELECT 1 FROM rotation_lines) OR EXISTS(SELECT 1 FROM rotation_positions)",
            [],
            |row| row.get(0),
        )?;
        if has_existing_module_data {
            transaction.execute(
                "INSERT INTO rotation_seed_versions(seed_name,version,created_at) VALUES('rotation-calendar',1,?1)",
                [timestamp_now()],
            )?;
            transaction.commit()?;
            return Ok(());
        }
        let now = timestamp_now();
        let lines = [
            ("PET-01", "PET-01", "soda"),
            ("PET-02", "PET-02", "soda"),
            ("PET-03", "PET-03", "soda"),
            ("ASEPTIC-A", "无菌线-A", "aseptic"),
            ("ASEPTIC-B", "无菌线-B", "aseptic"),
            ("ASEPTIC-C", "无菌线-C", "aseptic"),
        ];
        for (line_id, display_name, line_type) in lines {
            transaction.execute(
                "INSERT INTO rotation_lines(line_id,display_name,line_type,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,'synthetic_demo',1,?4,?4)",
                params![line_id, display_name, line_type, now],
            )?;
        }
        let positions = [
            ("POS-FILL", "灌注机岗"),
            ("POS-BLOW", "吹贴机岗"),
            ("POS-ASEPTIC", "无菌操作岗"),
            ("POS-PALLET", "码垛机岗"),
            ("POS-PACK", "塑包机岗"),
        ];
        for (position_id, display_name) in positions {
            transaction.execute(
                "INSERT INTO rotation_positions(position_id,display_name,source_type,is_active,created_at,updated_at) VALUES(?1,?2,'synthetic_demo',1,?3,?3)",
                params![position_id, display_name, now],
            )?;
        }
        let effective = NaiveDate::from_ymd_opt(2026, 10, 1)
            .ok_or_else(|| AppError::Configuration("演示配置生效日期无效。".into()))?;
        for (line_id, display_name, line_type) in lines {
            let is_soda = line_type == "soda";
            let team_suffixes = if is_soda {
                ["争锋队", "冲锋队", "先锋队"]
            } else {
                ["甲班", "乙班", "丙班"]
            };
            let primary_position = if is_soda { "POS-FILL" } else { "POS-ASEPTIC" };
            let secondary_position = if is_soda { "POS-BLOW" } else { "POS-PACK" };
            let mut targets = Vec::new();
            for (slot, suffix) in team_suffixes.iter().enumerate() {
                let team_id = format!("DEMO-TEAM-{}-{}", line_id, slot + 1);
                let team_name = format!("{display_name} {suffix}");
                transaction.execute(
                    "INSERT INTO rotation_teams(team_id,name,description,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,'synthetic_demo',1,?4,?4)",
                    params![team_id, team_name, "本机初始化演示班组。", now],
                )?;
                let team_qualification = QualificationWrite {
                    qualification_id: Some(format!("DEMO-QUAL-{team_id}")),
                    object_type: RotationObjectType::Team,
                    object_id: team_id.clone(),
                    position_id: primary_position.to_owned(),
                    line_id: line_id.to_owned(),
                    description: "本机演示资格关系，不代表真实资质核验。".to_owned(),
                    is_active: true,
                };
                insert_qualification(
                    &transaction,
                    team_qualification.qualification_id.as_deref().unwrap_or(""),
                    &team_qualification,
                    "synthetic_demo",
                    &now,
                )?;
                targets.push(RotationTarget {
                    object_type: RotationObjectType::Team,
                    object_id: team_id.clone(),
                    offset_days: if is_soda { slot as i64 } else { slot as i64 * 2 },
                    is_active: true,
                });
                for worker_index in 1..=2 {
                    let employee_id = format!("DEMO-EMP-{}-{}-{}", line_id, slot + 1, worker_index);
                    let position_id = if worker_index == 1 { primary_position } else { secondary_position };
                    transaction.execute(
                        "INSERT INTO rotation_employees(employee_id,name,position_id,team_id,collaboration_score,source_type,is_archived,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'synthetic_demo',0,?6,?6)",
                        params![employee_id, demo_employee_name(&employee_id).unwrap_or("本机演示员工"),
                                position_id, team_id, 72.0 + ((slot + worker_index) * 4) as f64, now],
                    )?;
                    let skill_score = 68.0 + ((slot * 2 + worker_index) * 5) as f64;
                    let skills = [
                        EmployeeSkill {
                            skill_code: "SKILL-CORE".to_owned(),
                            skill_name: if is_soda { "设备操作" } else { "无菌作业" }.to_owned(),
                            skill_score: Some(skill_score),
                            is_active: true,
                        },
                        EmployeeSkill {
                            skill_code: "SKILL-SAFETY".to_owned(),
                            skill_name: "安全规程".to_owned(),
                            skill_score: Some((skill_score + 6.0).min(100.0)),
                            is_active: true,
                        },
                    ];
                    replace_employee_skills(&transaction, &employee_id, &skills, &now)?;
                    let employee_qualification = QualificationWrite {
                        qualification_id: Some(format!("DEMO-QUAL-{employee_id}")),
                        object_type: RotationObjectType::Employee,
                        object_id: employee_id,
                        position_id: position_id.to_owned(),
                        line_id: line_id.to_owned(),
                        description: "本机演示资格关系，不代表真实资质核验。".to_owned(),
                        is_active: true,
                    };
                    insert_qualification(
                        &transaction,
                        employee_qualification.qualification_id.as_deref().unwrap_or(""),
                        &employee_qualification,
                        "synthetic_demo",
                        &now,
                    )?;
                }
            }
            let (cycle_length, shifts, cycle_days) = if is_soda {
                (
                    3,
                    vec![
                        ShiftDefinition { shift_code: "DAY".into(), name: "白班".into(), start_time: "07:00".into(), end_time: "19:00".into(), remarks: "参考配置的白班时段。".into(), display_order: 1 },
                        ShiftDefinition { shift_code: "NIGHT".into(), name: "夜班".into(), start_time: "19:00".into(), end_time: "07:00".into(), remarks: "次日 07:00 结束。".into(), display_order: 2 },
                    ],
                    vec![
                        CycleDay { cycle_day: 1, shift_code: Some("DAY".into()), is_rest: false },
                        CycleDay { cycle_day: 2, shift_code: Some("NIGHT".into()), is_rest: false },
                        CycleDay { cycle_day: 3, shift_code: None, is_rest: true },
                    ],
                )
            } else {
                (
                    6,
                    vec![
                        ShiftDefinition { shift_code: "DAY".into(), name: "白班".into(), start_time: "07:00".into(), end_time: "19:00".into(), remarks: "本机演示白班时段。".into(), display_order: 1 },
                        ShiftDefinition { shift_code: "NIGHT".into(), name: "夜班".into(), start_time: "19:00".into(), end_time: "07:00".into(), remarks: "次日 07:00 结束。".into(), display_order: 2 },
                    ],
                    vec![
                        CycleDay { cycle_day: 1, shift_code: Some("DAY".into()), is_rest: false },
                        CycleDay { cycle_day: 2, shift_code: Some("DAY".into()), is_rest: false },
                        CycleDay { cycle_day: 3, shift_code: Some("NIGHT".into()), is_rest: false },
                        CycleDay { cycle_day: 4, shift_code: Some("NIGHT".into()), is_rest: false },
                        CycleDay { cycle_day: 5, shift_code: None, is_rest: true },
                        CycleDay { cycle_day: 6, shift_code: None, is_rest: true },
                    ],
                )
            };
            let draft = ScheduleConfigDraft {
                name: format!("{display_name}班组轮转"),
                line_id: line_id.to_owned(),
                object_type: RotationObjectType::Team,
                start_date: effective,
                end_date: None,
                cycle_length,
                shifts,
                cycle_days,
                targets,
            };
            insert_configuration(&transaction, &format!("DEMO-CONFIG-{line_id}"), &draft, "synthetic_demo", true, &now)?;
        }
        transaction.execute(
            "INSERT INTO rotation_seed_versions(seed_name,version,created_at) VALUES('rotation-calendar',1,?1)",
            [now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn seed_employee_equipment_once(&self) -> Result<(), AppError> {
        let mut connection = self.connect()?;
        let transaction = connection.transaction()?;
        let already_seeded: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM rotation_seed_versions WHERE seed_name='employee-equipment' AND version>=1)",
            [], |row| row.get(0),
        )?;
        if already_seeded { return Ok(()); }

        let now = timestamp_now();
        let mut reader = csv::ReaderBuilder::new().has_headers(true).from_reader(EQUIPMENT_REFERENCE_CSV.as_bytes());
        let headers = reader.headers().map_err(|error| AppError::Configuration(format!("无法读取设备参考清单表头：{error}")))?.clone();
        let code_col = csv_column(&headers, "设备编码")?;
        let name_col = csv_column(&headers, "设备名称")?;
        let category_col = csv_column(&headers, "设备类别")?;
        let source_line_col = csv_column(&headers, "产线编码")?;
        let source_line_name_col = csv_column(&headers, "产线名称")?;
        let position_col = csv_column(&headers, "岗位名称")?;
        for (row_index, record) in reader.records().enumerate() {
            let record = record.map_err(|error| AppError::Configuration(format!("设备参考清单第 {} 行格式错误：{error}", row_index + 2)))?;
            let source_line_code = record.get(source_line_col).unwrap_or_default().trim();
            let local_line_ids = equipment_line_ids(source_line_code);
            if local_line_ids.is_empty() { continue; }
            let equipment_code = record.get(code_col).unwrap_or_default().trim();
            let equipment_name = record.get(name_col).unwrap_or_default().trim();
            if equipment_code.is_empty() || equipment_name.is_empty() { continue; }
            let equipment_category = record.get(category_col).unwrap_or_default().trim();
            let source_line_name = record.get(source_line_name_col).unwrap_or_default().trim();
            let position_name = record.get(position_col).unwrap_or_default().trim();
            for line_id in local_line_ids {
                let line_exists: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM rotation_lines WHERE line_id=?1)", [line_id], |row| row.get(0),
                )?;
                if !line_exists { continue; }
                let equipment_id = format!("{equipment_code}@{line_id}");
                transaction.execute(
                    "INSERT OR IGNORE INTO rotation_equipment(equipment_id,equipment_code,equipment_name,equipment_category,line_id,source_line_code,source_line_name,position_name,source_type,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'local_reference',1,?9,?9)",
                    params![equipment_id, equipment_code, equipment_name, equipment_category, line_id, source_line_code, source_line_name, position_name, now],
                )?;
            }
        }

        let placeholders = transaction.prepare(
            "SELECT employee_id FROM rotation_employees WHERE source_type='synthetic_demo' AND name LIKE '演示员工%' ORDER BY employee_id",
        )?.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        for employee_id in placeholders {
            if let Some(name) = demo_employee_name(&employee_id) {
                transaction.execute(
                    "UPDATE rotation_employees SET name=?2,updated_at=?3 WHERE employee_id=?1 AND source_type='synthetic_demo' AND name LIKE '演示员工%'",
                    params![employee_id, name, now],
                )?;
            }
        }

        let demo_employees = transaction.prepare(
            "SELECT employee_id FROM rotation_employees WHERE source_type='synthetic_demo' AND employee_id LIKE 'DEMO-EMP-%' AND is_archived=0 ORDER BY employee_id",
        )?.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        for employee_id in demo_employees {
            let existing: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM rotation_employee_equipment WHERE employee_id=?1)", [&employee_id], |row| row.get(0),
            )?;
            if existing { continue; }
            let Some(employee_index) = demo_employee_index(&employee_id) else { continue; };
            let line_ids = transaction.prepare(
                "SELECT DISTINCT line_id FROM rotation_qualifications WHERE object_type='employee' AND object_id=?1 AND is_active=1 ORDER BY line_id",
            )?.query_map([&employee_id], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            for line_id in line_ids {
                let equipment_ids = transaction.prepare(
                    "SELECT equipment_id FROM rotation_equipment WHERE line_id=?1 AND is_active=1 ORDER BY equipment_code",
                )?.query_map([&line_id], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
                if equipment_ids.is_empty() { continue; }
                let count = (2 + employee_index % 3).min(equipment_ids.len());
                let start = employee_index % equipment_ids.len();
                for offset in 0..count {
                    let equipment_id = &equipment_ids[(start + offset) % equipment_ids.len()];
                    let ability_level = ((employee_index + offset) % 5 + 1) as i64;
                    transaction.execute(
                        "INSERT OR IGNORE INTO rotation_employee_equipment(employee_id,equipment_id,ability_level,source_type,updated_at) VALUES(?1,?2,?3,'synthetic_demo',?4)",
                        params![employee_id, equipment_id, ability_level, now],
                    )?;
                }
            }
        }
        transaction.execute(
            "INSERT INTO rotation_seed_versions(seed_name,version,created_at) VALUES('employee-equipment',1,?1)", [now],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

fn demo_employee_index(employee_id: &str) -> Option<usize> {
    let parts: Vec<&str> = employee_id.split('-').collect();
    let name = demo_employee_name(employee_id)?;
    let group = DEMO_EMPLOYEE_NAMES.iter().position(|candidate| *candidate == name)? / 6;
    let slot = parts.get(parts.len().checked_sub(2)?)?.parse::<usize>().ok()?;
    let worker = parts.last()?.parse::<usize>().ok()?;
    Some(group * 6 + (slot - 1) * 2 + worker - 1)
}
