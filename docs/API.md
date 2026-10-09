# 本机 API 说明

服务默认根地址为 `http://127.0.0.1:8080`，接口前缀为 `/api/v1`。成功响应为 JSON；错误响应包含 `code`、`message` 和 `details`。未匹配的 API 路径返回 JSON 404，不返回前端页面。

## 1. 状态与目录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 服务版本、平台和健康状态 |
| GET | `/bootstrap` | 应用角色、来源类型、模型与连接器声明 |
| GET | `/datasets` | 数据集版本列表 |

## 2. 导入

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/datasets/import/preview` | multipart 字段 `schema_id` 与 `file`；返回行数、字段错误、列和 SHA-256 |
| POST | `/datasets/import/commit` | JSON：`preview_id`、`display_name`、`actor_id`、`actor_role`、`reason`；仅接受通过检查的预览 |

当前模板：`raw_dataset`、`orders`、`line_capacity`、`attendance_snapshot`、`position_requirements`、`line_run_plan`、`baseline_schedule`、`event_json`。只有结构符合要求的 `raw_dataset` XLSX 可作为排班求解输入。

## 3. 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/jobs?status=&dataset_id=&limit=` | 查询任务 |
| POST | `/jobs` | 创建异步任务 |
| GET | `/jobs/{id}` | 读取任务详情 |
| POST | `/jobs/{id}/cancel` | 取消排队或运行任务 |

创建请求示例：

```json
{
  "kind": "solve_demo",
  "dataset_id": "accepted-baseline-v1",
  "actor_id": "本机计划员",
  "actor_role": "计划员",
  "reason": "验证 7 天演示周期方案",
  "parameters": { "time_limit_seconds": 300 }
}
```

`kind` 支持 `info`、`solve_demo`、`solve_full`、`verify_baseline`、`reschedule`、`kpi`、`validate_schedule`、`adjust_schedule`。重排任务还需提供 `event`，类型为 `insert`、`rampup`、`changeover`、`equipment_fail` 或 `absence`。文件路径由服务根据数据集和方案 ID 解析，不接受客户端任意绝对路径。

## 4. 方案、核验和审批

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/schedules/{id}` | 读取方案元信息和最多 1,000 条指派/缺口预览 |
| POST | `/schedules/{id}/adjustments` | 提交人工调整，要求 `expected_version`、操作人、角色和原因 |
| POST | `/schedules/{id}/validate` | 独立核验，`demand_profile` 为 `solver` 或 `reference` |
| POST | `/schedules/{id}/approval` | 状态动作 `review`、`lock`、`simulated_publish` 或 `reject` |
| GET | `/archive` | 筛选方案档案及任务 |
| GET | `/files/{sha256}` | 校验哈希后下载登记的文件 |

人工修改与审批必须传入当前方案版本号。锁定和模拟发布要求独立硬约束核验通过。模拟发布只在本机记录状态，不向外部系统发送数据。

## 5. 指标、考勤与规则

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/analytics/kpis?dataset_id=&schedule_id=&date_from=&date_to=` | KPI、分位数、基尼系数、来源和定义 |
| GET | `/analytics/attendance?date=&shift_code=&status=` | 固定 14 d 的合成考勤快照及状态汇总 |
| GET | `/rules` | 最新规则版本及历史 |
| POST | `/rules` | 版本化保存规则 JSON，要求期望版本、操作人、角色和原因 |
| GET | `/feedback?employee_id=&schedule_id=&limit=` | 本机反馈列表，可按员工编号或具体方案版本筛选 |
| POST | `/feedback` | 本机模拟反馈提交；payload 可选包含 1 至 5 的整数 `satisfaction_score` |

分析指标用 `value: null` 表示当前无可计算值。每项包含单位、来源、样本数、日期范围和定义。合成考勤、订单和产能不会被标记为现场实绩。

排班管理分析通过方案文件 SHA-256 调用 `GET /files/{sha256}` 读取完整 CSV，并使用 `/feedback?schedule_id={schedule_version_id}` 读取该方案版本的模拟评分。反馈评分只作为本机员工反馈样本统计，不代表真实调查结果。

## 6. 本机排班配置、轮转日历与人员目录

以下接口维护独立于 MIP 求解输入的本机 SQLite 配置。创建、更新、复制、启用或停用等写操作均要求操作原因；本机演示默认操作人为“本机计划员”，角色为“计划员”。列表响应包含 `items`、`total`、`page` 和 `page_size`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/scheduling/configurations` | 按名称、产线、启用状态筛选配置；POST 创建配置，正文为 `{ "data": <配置草稿>, "reason": "..." }` |
| GET/PUT | `/scheduling/configurations/{id}` | 读取或更新完整配置；PUT 使用相同 `data` 与 `reason` 包装 |
| POST | `/scheduling/configurations/validate` | 校验配置草稿，正文直接传配置对象；返回 `valid` 与 `field_errors` |
| POST | `/scheduling/configurations/{id}/copy` | 复制停用副本，正文包含 `name`、`start_date`、`end_date` 和 `reason` |
| POST | `/scheduling/configurations/{id}/activate` | 完整校验后启用；正文包含 `reason` |
| POST | `/scheduling/configurations/{id}/deactivate` | 停用配置但保留记录；正文包含 `reason` |
| GET | `/scheduling/calendar?line_id=&start_date=&end_date=&config_id=` | 按产线即时生成日历；日期为 `YYYY-MM-DD`，日期范围上限 62 个自然日 |
| GET/POST | `/scheduling/employees` | 分页/筛选员工档案；创建请求正文为 `{ "data": <员工档案>, "reason": "..." }` |
| GET/PUT | `/scheduling/employees/{id}` | 读取或更新员工档案；档案归档通过 `is_archived` 字段完成 |
| GET/POST | `/scheduling/teams` | 查询或创建班组；创建与更新需填写操作原因 |
| GET/PUT | `/scheduling/teams/{id}` | 读取或更新班组；停用通过 `is_active=false` 完成 |
| GET/POST | `/scheduling/qualifications` | 查询或创建员工/班组的岗位产线资格关系 |
| GET/PUT | `/scheduling/qualifications/{id}` | 读取或更新资格关系；停用通过 `is_active=false` 完成 |
| GET | `/scheduling/lines` | 查询本机产线字典 |
| GET | `/scheduling/positions` | 查询本机岗位字典 |

配置草稿主要字段：`name`、`line_id`、`object_type`（`team` 或 `employee`）、`start_date`、可空的 `end_date`、`cycle_length`、`shifts`、`cycle_days` 和 `targets`。班次时间采用 24 小时制 `HH:mm`。每个周期日必须设置一个已定义班次或设置 `is_rest=true`；周期日序号从 1 连续排列。每个轮转对象的 `offset_days` 为 0 至周期长度减 1 的整数，且对象必须有效并存在适用产线的启用资格关系。日历周期序号按“查询日与生效日的自然日差 + 对象偏移量”对周期长度取余，再加 1 读取周期明细。若结束时间早于开始时间，结束日期按次日计算；开始与结束时刻相同会被拒绝。

结构化字段校验错误沿用以下格式，`path` 与配置 JSON 字段路径对应：

```json
{
  "code": "VALIDATION_FAILED",
  "message": "请修正标记的字段后重试。",
  "details": [],
  "field_errors": [
    { "path": "cycle_days.1.shift_code", "code": "REQUIRED", "message": "工作日必须选择一个班次。" }
  ]
}
```

员工技能评分和协作评分均为 0–100 分，可为空。技能评分为有效且已评分技能的算术平均值；综合评分为技能均分与协作评分的算术平均值，任一项缺失时返回 `null`，界面显示“无可计算值”。本机演示产线、岗位、员工、班组及资格关系使用 `synthetic_demo` 来源标识；用户新增记录使用 `local_config` 来源标识。这些接口不表示 HR、APS 或 MES 已连接，也不把轮转配置转换为 MIP 输入。

## 7. 版本和错误

方案或规则版本过期时返回 HTTP 409 `VERSION_CONFLICT`。输入 schema 无效时返回 HTTP 400 `INVALID_INPUT`。路径不属于工程包、文件哈希不匹配或数据不符合 schema 时不会生成可用数据/方案版本。任务响应另保存 HiGHS termination、incumbent、bound、验证结论、产物哈希和日志下载引用。
