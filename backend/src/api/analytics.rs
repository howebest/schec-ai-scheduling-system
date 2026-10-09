use std::collections::HashMap;
use std::path::Path;

use axum::extract::{Query, State};
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::JobRepository;
use crate::error::AppError;
use crate::models::{AnalyticsResponse, ScheduleRecord};
use crate::AppState;

#[derive(Deserialize, Default)]
pub struct AnalyticsQuery {
    dataset_id: Option<String>,
    schedule_id: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
}

#[derive(Deserialize)]
struct OrderRow {
    line_code: String,
    product_code: String,
    required_units: f64,
}

#[derive(Deserialize)]
struct CapacityRow {
    line_code: String,
    product_code: String,
    units_per_hour: f64,
    efficiency_pct: f64,
    available_hours: f64,
}

#[derive(Deserialize)]
struct AttendanceRow {
    employee_id: String,
    schedule_date: String,
    shift_code: String,
    status: String,
    source_type: String,
}

#[derive(Deserialize, Default)]
pub struct AttendanceQuery {
    date: Option<String>,
    shift_code: Option<String>,
    status: Option<String>,
}

pub async fn attendance(
    State(state): State<AppState>,
    Query(query): Query<AttendanceQuery>,
) -> Result<Json<Value>, AppError> {
    if query.date.as_deref().is_some_and(|value| !valid_iso_date(value)) {
        return Err(AppError::InvalidInput("date 必须为有效的 YYYY-MM-DD 日期。".into()));
    }
    let path = state.config.package_root.join("data/demo/attendance_snapshot.csv");
    let file = std::fs::File::open(path)?;
    let records: Vec<AttendanceRow> = csv::Reader::from_reader(file)
        .deserialize().collect::<Result<_, _>>()
        .map_err(|_| AppError::InvalidInput("本机合成考勤快照 CSV 存在格式错误。".into()))?;
    let filtered: Vec<_> = records.into_iter().filter(|row| {
        query.date.as_deref().is_none_or(|value| row.schedule_date == value)
            && query.shift_code.as_deref().is_none_or(|value| row.shift_code == value)
            && query.status.as_deref().is_none_or(|value| row.status == value)
    }).collect();
    let present = filtered.iter().filter(|row| row.status == "present").count();
    let absent = filtered.iter().filter(|row| row.status == "absent").count();
    let leave = filtered.iter().filter(|row| row.status == "leave").count();
    let items: Vec<_> = filtered.iter().map(|row| json!({
        "employee_id":row.employee_id,"schedule_date":row.schedule_date,
        "shift_code":row.shift_code,"status":row.status,"source_type":row.source_type
    })).collect();
    Ok(Json(json!({
        "items":items,"count":items.len(),
        "totals":{"present":present,"absent":absent,"leave":leave},
        "source_type":"synthetic_demo",
        "period":{"start":"2026-10-01","end":"2026-10-14"},
        "limitations":["这些记录由固定随机种子生成，不代表真实考勤或现场到岗。","未接入 HR、考勤、MES 或设备系统。"]
    })))
}

pub async fn kpis(
    State(state): State<AppState>,
    Query(query): Query<AnalyticsQuery>,
) -> Result<Json<Value>, AppError> {
    let date_range = match (query.date_from.clone(), query.date_to.clone()) {
        (None, None) => None,
        (Some(start), Some(end)) if valid_iso_date(&start) && valid_iso_date(&end) && start <= end => Some([start, end]),
        _ => return Err(AppError::InvalidInput("date_from 与 date_to 必须同时提供有效的 YYYY-MM-DD 日期，且起始日期不得晚于结束日期。".into())),
    };
    let schedule = match query.schedule_id.as_deref() {
        Some(id) => state.db.get_schedule(id)?,
        None => state.db.list_schedules(query.dataset_id.as_deref(), 1)?.into_iter().next(),
    };
    let mut items = Vec::new();
    let mut source_type = query.dataset_id.as_deref().unwrap_or("accepted_baseline").to_owned();
    if let Some(schedule) = schedule.as_ref() {
        source_type = schedule.source_type.clone();
        append_schedule_metrics(&state.db, schedule, &state.config.package_root, date_range.as_ref(), &mut items)?;
    } else {
        items.extend(empty_solver_metrics(source_type.as_str(), query.date_from.clone(), query.date_to.clone()));
    }
    if query.dataset_id.as_deref() == Some("synthetic-demo-20260930-v1") {
        append_synthetic_capacity_metrics(&state.config.package_root, &mut items)?;
    }
    Ok(Json(json!({
        "items":items,
        "active_schedule":schedule,
        "date_range":date_range,
        "source_type":source_type,
        "limitations":[
            "现场产量、实际到岗和真实交期未接入；合成订单与产能结果仅用于分析演示。",
            "分布统计仅包含方案文件中至少有一条整班指派的员工。"
        ]
    })))
}

fn append_schedule_metrics(
    repository: &JobRepository,
    schedule: &ScheduleRecord,
    root: &Path,
    date_range: Option<&[String; 2]>,
    items: &mut Vec<AnalyticsResponse>,
) -> Result<(), AppError> {
    let path = resolve_relative(root, &schedule.artifact_path)?;
    if let Some(range) = date_range {
        append_range_metrics(schedule, &path, range, items)?;
        return Ok(());
    }
    let job_result = schedule.job_id.as_deref()
        .and_then(|id| repository.get(id).ok().flatten())
        .and_then(|job| job.result)
        .and_then(|result| result.get("summary").cloned())
        .unwrap_or(Value::Null);
    let registered_baseline = json!({
        "assigned":9693,"coverage_rate":0.8528,"gap_total":1753,
        "key_gap":990,"gen_gap":763,"ot_hours":25731,
        "total_paid_hours":107003,"hours_range":136
    });
    let kpi = if job_result.get("kpi").is_some() {
        job_result.get("kpi").unwrap_or(&Value::Null)
    } else if job_result.get("kpi_after").is_some() {
        job_result.get("kpi_after").unwrap_or(&Value::Null)
    } else if schedule.schedule_id == "baseline-full62-w1"
        && schedule.version == 1 && schedule.source_type == "accepted_baseline" {
        &registered_baseline
    } else {
        &Value::Null
    };
    let baseline_note = if schedule.schedule_id == "baseline-full62-w1"
        && schedule.version == 1 && schedule.source_type == "accepted_baseline"
        && job_result.get("kpi").is_none() && job_result.get("kpi_after").is_none() {
        "已验收基准登记值；不是本机重新计算结果。"
    } else {
        "当前任务方案的复算值。"
    };
    let definition = |label: &str| format!("{label} {baseline_note}");
    push(items, "assigned_shifts", kpi.get("assigned").and_then(Value::as_f64),
         "人班", &definition("整班指派数量。"), schedule.source_type.as_str(), 1);
    push(items, "coverage_rate", kpi.get("coverage_rate").and_then(Value::as_f64).map(|v| v * 100.0),
         "%", &definition("覆盖人班除以当前任务需求人班；不代表实际到岗或产量。"), schedule.source_type.as_str(), 1);
    push(items, "uncovered_shifts", kpi.get("gap_total").and_then(Value::as_f64),
         "人班", &definition("模型记录的未覆盖需求人班数量。"), schedule.source_type.as_str(), 1);
    push(items, "key_position_gap", kpi.get("key_gap").and_then(Value::as_f64),
         "人班", &definition("关键岗位未覆盖需求人班数量。"), schedule.source_type.as_str(), 1);
    push(items, "general_position_gap", kpi.get("gen_gap").and_then(Value::as_f64),
         "人班", &definition("一般岗位未覆盖需求人班数量。"), schedule.source_type.as_str(), 1);
    push(items, "overtime_hours", kpi.get("ot_hours").and_then(Value::as_f64),
         "h", &definition("整班指派形成的加班小时数，按每个 12 h 班次 3 h 计算。"), schedule.source_type.as_str(), 1);
    push(items, "paid_hours", kpi.get("total_paid_hours").and_then(Value::as_f64),
         "h", &definition("整班与非完整班次的计薪工时合计。"), schedule.source_type.as_str(), 1);
    push(items, "hours_range", kpi.get("hours_range").and_then(Value::as_f64),
         "h", &definition("员工计薪工时最大值与最小值之差。"), schedule.source_type.as_str(), 1);
    if let Some(bound) = job_result.get("bound").and_then(Value::as_f64) {
        push(items, "solver_bound", Some(bound), "目标函数单位", "求解器给出的目标函数下界；不得单独解释为业务 KPI。", schedule.source_type.as_str(), 1);
    }
    if let Some(objective) = job_result.get("objective_recomputed").and_then(Value::as_f64) {
        push(items, "objective_value", Some(objective), "加权目标单位", "按当前目标权重从方案 KPI 分量复算的加权目标值。", schedule.source_type.as_str(), 1);
    }

    let distribution = read_employee_hours(&path, None)?;
    if distribution.is_empty() {
        items.extend(distribution_null_metrics(schedule.source_type.as_str()));
    } else {
        let mut values: Vec<f64> = distribution.values().copied().collect();
        values.sort_by(f64::total_cmp);
        let total: f64 = values.iter().sum();
        let n = values.len();
        let percentile = |p: f64| -> f64 {
            let index = ((n.saturating_sub(1)) as f64 * p).round() as usize;
            values[index]
        };
        let gini = if total <= 0.0 {
            None
        } else {
            let weighted: f64 = values.iter().enumerate()
                .map(|(index, value)| (2.0 * (index + 1) as f64 - n as f64 - 1.0) * value)
                .sum();
            Some(weighted / (n as f64 * total))
        };
        push(items, "employee_hours_q25", Some(percentile(0.25)), "h", "有指派员工计薪工时的第 25 百分位数。", schedule.source_type.as_str(), n as u64);
        push(items, "employee_hours_median", Some(percentile(0.50)), "h", "有指派员工计薪工时的中位数。", schedule.source_type.as_str(), n as u64);
        push(items, "employee_hours_q75", Some(percentile(0.75)), "h", "有指派员工计薪工时的第 75 百分位数。", schedule.source_type.as_str(), n as u64);
        push(items, "employee_hours_gini", gini, "无量纲", "员工计薪工时基尼系数；样本限于存在整班指派的员工。", schedule.source_type.as_str(), n as u64);
        push(items, "employees_with_assignments", Some(n as f64), "人", "至少有一条整班指派的员工数量。", schedule.source_type.as_str(), n as u64);
    }
    Ok(())
}

fn read_employee_hours(path: &Path, date_range: Option<&[String; 2]>) -> Result<HashMap<String, f64>, AppError> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_path(path)
        .map_err(|_| AppError::InvalidInput("排班产物 CSV 无法读取。".into()))?;
    let mut result = HashMap::new();
    for row in reader.records() {
        let row = row.map_err(|_| AppError::InvalidInput("排班产物 CSV 存在格式错误。".into()))?;
        if row.get(2) == Some("日期") || row.get(0).is_some_and(|value| value.starts_with("缺口记录") || value.starts_with("非完整班次记录")) {
            continue;
        }
        if row.len() < 15 {
            continue;
        }
        let employee = row.get(5).unwrap_or_default().trim();
        if employee.is_empty() {
            continue;
        }
        if let Some([start, end]) = date_range {
            let date = row.get(2).unwrap_or_default();
            if date < start.as_str() || date > end.as_str() {
                continue;
            }
        }
        let paid = row.get(10).unwrap_or_default().parse::<f64>().unwrap_or(0.0);
        *result.entry(employee.to_owned()).or_insert(0.0) += paid;
    }
    Ok(result)
}

#[derive(Default)]
struct RangeTotals {
    assignments: f64,
    overtime_hours: f64,
    paid_hours: f64,
    fractional_hours: f64,
    gaps: f64,
}

fn append_range_metrics(
    schedule: &ScheduleRecord,
    path: &Path,
    range: &[String; 2],
    items: &mut Vec<AnalyticsResponse>,
) -> Result<(), AppError> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).flexible(true).from_path(path)
        .map_err(|_| AppError::InvalidInput("排班产物 CSV 无法读取。".into()))?;
    let mut section = 0_u8;
    let mut totals = RangeTotals::default();
    for result in reader.records() {
        let row = result.map_err(|_| AppError::InvalidInput("排班产物 CSV 存在格式错误。".into()))?;
        let first = row.get(0).unwrap_or_default();
        if first.starts_with("缺口记录") {
            section = 1;
            continue;
        }
        if first.starts_with("非完整班次记录") {
            section = 2;
            continue;
        }
        if first == "工厂代码" || first == "岗位编码" || first == "员工工号" {
            continue;
        }
        let date_index = match section {
            0 => 2,
            1 => 3,
            _ => 2,
        };
        let date = row.get(date_index).unwrap_or_default();
        if date < range[0].as_str() || date > range[1].as_str() {
            continue;
        }
        match section {
            0 if row.len() >= 15 => {
                totals.assignments += 1.0;
                totals.paid_hours += parse_number(row.get(10));
                totals.overtime_hours += parse_number(row.get(12));
            }
            1 if row.len() >= 6 => totals.gaps += parse_number(row.get(5)),
            2 if row.len() >= 5 => totals.fractional_hours += parse_number(row.get(4)),
            _ => {}
        }
    }
    totals.paid_hours += totals.fractional_hours;
    let fractional_shifts = totals.fractional_hours / 8.0;
    let covered = totals.assignments + fractional_shifts;
    let demand = covered + totals.gaps;
    let coverage = (demand > 0.0).then_some(covered / demand * 100.0);
    let range_slice = Some(range.clone());
    let has_data = totals.assignments + totals.gaps + totals.fractional_hours > 0.0;
    push_range(items, "assigned_shifts", has_data.then_some(totals.assignments),
        "人班", "指定日期范围内的整班指派数量。", schedule.source_type.as_str(), totals.assignments as u64, &range_slice);
    push_range(items, "coverage_rate", coverage, "%", "指定日期范围内，整班与非完整班次折算人班除以需求人班。", schedule.source_type.as_str(), demand as u64, &range_slice);
    push_range(items, "uncovered_shifts", has_data.then_some(totals.gaps), "人班", "指定日期范围内的岗位缺口人班数量。", schedule.source_type.as_str(), demand as u64, &range_slice);
    push_range(items, "key_position_gap", None, "人班", "该文件未记录按日期拆分的关键岗缺口类别，因此本范围指标无可计算值。", schedule.source_type.as_str(), 0, &range_slice);
    push_range(items, "general_position_gap", None, "人班", "该文件未记录按日期拆分的一般岗缺口类别，因此本范围指标无可计算值。", schedule.source_type.as_str(), 0, &range_slice);
    push_range(items, "overtime_hours", has_data.then_some(totals.overtime_hours), "h", "指定日期范围内按 12 h 班次计算的加班小时数。", schedule.source_type.as_str(), totals.assignments as u64, &range_slice);
    push_range(items, "paid_hours", has_data.then_some(totals.paid_hours), "h", "指定日期范围内整班及非完整班次的计薪工时。", schedule.source_type.as_str(), totals.assignments as u64, &range_slice);
    let distribution = read_employee_hours(path, Some(range))?;
    if distribution.is_empty() {
        items.extend(distribution_null_metrics(schedule.source_type.as_str()).into_iter().map(|mut metric| {
            metric.date_range = Some(range.clone());
            metric
        }));
    } else {
        let mut values: Vec<f64> = distribution.values().copied().collect();
        values.sort_by(f64::total_cmp);
        let count = values.len();
        let percentile = |p: f64| values[((count.saturating_sub(1)) as f64 * p).round() as usize];
        let total: f64 = values.iter().sum();
        let hours_range = values.last().copied().unwrap_or(0.0) - values.first().copied().unwrap_or(0.0);
        let weighted: f64 = values.iter().enumerate()
            .map(|(index, value)| (2.0 * (index + 1) as f64 - count as f64 - 1.0) * value)
            .sum();
        let gini = (total > 0.0).then_some(weighted / (count as f64 * total));
        push_range(items, "employee_hours_q25", Some(percentile(0.25)), "h", "指定日期范围内员工计薪工时第 25 百分位数。", schedule.source_type.as_str(), count as u64, &range_slice);
        push_range(items, "employee_hours_median", Some(percentile(0.50)), "h", "指定日期范围内员工计薪工时中位数。", schedule.source_type.as_str(), count as u64, &range_slice);
        push_range(items, "employee_hours_q75", Some(percentile(0.75)), "h", "指定日期范围内员工计薪工时第 75 百分位数。", schedule.source_type.as_str(), count as u64, &range_slice);
        push_range(items, "employee_hours_gini", gini, "无量纲", "指定日期范围内员工计薪工时基尼系数。", schedule.source_type.as_str(), count as u64, &range_slice);
        push_range(items, "hours_range", Some(hours_range), "h", "指定日期范围内员工计薪工时最大值与最小值之差。", schedule.source_type.as_str(), count as u64, &range_slice);
    }
    Ok(())
}

fn parse_number(value: Option<&str>) -> f64 {
    value.and_then(|text| text.parse::<f64>().ok()).unwrap_or(0.0)
}

fn valid_iso_date(value: &str) -> bool {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn push_range(items: &mut Vec<AnalyticsResponse>, metric_id: &str, value: Option<f64>,
              unit: &str, definition: &str, source_type: &str, sample_count: u64,
              date_range: &Option<[String; 2]>) {
    push(items, metric_id, value, unit, definition, source_type, sample_count);
    if let Some(metric) = items.last_mut() {
        metric.date_range = date_range.clone();
    }
}

fn append_synthetic_capacity_metrics(root: &Path, items: &mut Vec<AnalyticsResponse>) -> Result<(), AppError> {
    let orders_path = root.join("data/demo/orders.csv");
    let capacity_path = root.join("data/demo/line_capacity.csv");
    let orders_file = std::fs::File::open(orders_path).map_err(AppError::Io)?;
    let capacity_file = std::fs::File::open(capacity_path).map_err(AppError::Io)?;
    let orders: Vec<OrderRow> = csv::Reader::from_reader(orders_file).deserialize().collect::<Result<_, _>>()
        .map_err(|_| AppError::InvalidInput("合成订单 CSV 存在格式错误。".into()))?;
    let capacities: Vec<CapacityRow> = csv::Reader::from_reader(capacity_file).deserialize().collect::<Result<_, _>>()
        .map_err(|_| AppError::InvalidInput("合成产能 CSV 存在格式错误。".into()))?;
    let mut demand_by_pair = HashMap::new();
    for order in &orders {
        *demand_by_pair.entry((order.line_code.clone(), order.product_code.clone())).or_insert(0.0) += order.required_units;
    }
    let demand: f64 = demand_by_pair.values().sum();
    let mut capacity_by_pair = HashMap::new();
    for row in capacities {
        capacity_by_pair.insert((row.line_code, row.product_code),
            row.units_per_hour * row.efficiency_pct / 100.0 * row.available_hours);
    }
    let available_capacity: f64 = demand_by_pair.keys()
        .map(|pair| capacity_by_pair.get(pair).copied().unwrap_or(0.0))
        .sum();
    let utilization = (available_capacity > 0.0).then_some(demand / available_capacity * 100.0);
    push(items, "synthetic_order_units", Some(demand), "unit", "合成订单需求量合计。", "synthetic_demo", orders.len() as u64);
    push(items, "synthetic_available_capacity_units", (available_capacity > 0.0).then_some(available_capacity), "unit", "按合成线速、效率与 14 d 规划周期可用小时数估算的产量。", "synthetic_demo", orders.len() as u64);
    push(items, "synthetic_capacity_utilization", utilization, "%", "14 d 合成规划周期内，订单需求量除以估算可用产量；仅为敏感性分析，不进入当前 MIP 求解。", "synthetic_demo", orders.len() as u64);
    Ok(())
}

fn empty_solver_metrics(source: &str, date_from: Option<String>, date_to: Option<String>) -> Vec<AnalyticsResponse> {
    let range = match (date_from, date_to) {
        (Some(start), Some(end)) => Some([start, end]),
        _ => None,
    };
    ["coverage_rate", "uncovered_shifts", "overtime_hours", "paid_hours"].into_iter()
        .map(|metric_id| AnalyticsResponse {
            metric_id: metric_id.into(), value: None,
            unit: match metric_id {
                "coverage_rate" => "%",
                "uncovered_shifts" => "人班",
                _ => "h",
            }.into(),
            group_by: vec![], date_range: range.clone(), sample_count: 0,
            source_type: source.into(), definition: "没有可用方案数据，当前指标无可计算值。".into(),
        }).collect()
}

fn distribution_null_metrics(source: &str) -> Vec<AnalyticsResponse> {
    ["employee_hours_q25", "employee_hours_median", "employee_hours_q75", "employee_hours_gini"]
        .into_iter().map(|metric_id| AnalyticsResponse {
            metric_id: metric_id.into(), value: None,
            unit: if metric_id.ends_with("gini") { "无量纲" } else { "h" }.into(),
            group_by: vec!["employee_id".into()], date_range: None, sample_count: 0,
            source_type: source.into(), definition: "没有可用员工工时样本，无可计算值。".into(),
        }).collect()
}

fn push(items: &mut Vec<AnalyticsResponse>, metric_id: &str, value: Option<f64>, unit: &str,
        definition: &str, source_type: &str, sample_count: u64) {
    items.push(AnalyticsResponse {
        metric_id: metric_id.into(), value, unit: unit.into(), group_by: vec![],
        date_range: None, sample_count, source_type: source_type.into(), definition: definition.into(),
    });
}

fn resolve_relative(root: &Path, relative: &str) -> Result<std::path::PathBuf, AppError> {
    let root = root.canonicalize()?;
    let path = root.join(relative).canonicalize()
        .map_err(|_| AppError::InvalidInput("方案文件不存在。".into()))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(AppError::InvalidInput("方案文件路径无效。".into()));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_denominator_is_null_not_infinity() {
        let metrics = empty_solver_metrics("accepted_baseline", None, None);
        assert!(metrics.iter().all(|metric| metric.value.is_none()));
    }

    #[test]
    fn gini_distribution_has_known_zero_for_equal_hours() {
        let values = [5.0, 5.0, 5.0];
        let n = values.len() as f64;
        let total = values.iter().sum::<f64>();
        let numerator = values.iter().enumerate()
            .map(|(index, value)| (2.0 * (index + 1) as f64 - n - 1.0) * value).sum::<f64>();
        assert_eq!(numerator / (n * total), 0.0);
    }
}
