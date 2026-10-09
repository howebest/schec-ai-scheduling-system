# 外部系统对接接口契约与适配设计说明（SCHEC-PKG-V1.0）

## 1 范围声明
本程序包交付外部系统对接的接口契约与模拟适配层。本环境没有外部系统访问
权限，也没有任何真实凭证；程序包不访问网络、不连接真实企业微信/短信/考勤/
MES/OCC/手环系统，所有推送与回传均为模拟适配（SIMULATED标注），用于
对接联调前的报文格式验证与流程闭环演示。不声称已与真实系统联调。

## 2 对接系统与用途
| 系统 | 对接用途 | 方向 | 接口标识 |
| --- | --- | --- | --- |
| 企业微信（WECOM） | 排班结果与调度指令推送、锁定与临时调整通知员工 | 出站推送+状态回执 | IF-WECOM-PUSH-1.0 |
| 短信（SMS） | 无企业微信终端时的调度指令兜底通知 | 出站推送+状态回执 | IF-SMS-PUSH-1.0 |
| 考勤系统（凌云塔，ATTENDANCE） | 排班结果锁定/临时调整同步为考勤计划 | 出站写入 | IF-ATTENDANCE-PUSH-1.0 |
| MES执行系统 | 排班执行人员与产线工位绑定、到岗执行 | 出站写入+执行事件 | IF-MES-PUSH-1.0 |
| OCC系统 | 调度方案与执行状态事件上报、人力可视化数据源 | 出站上报 | IF-OCC-PUSH-1.0 |
| 手环（BRACELET） | 调度指令下发至个人终端、执行状态回传 | 出站推送+状态回执 | IF-BRACELET-PUSH-1.0 |

## 3 统一推送报文契约
```
{
  "interface_id": "IF-<SYSTEM>-PUSH-1.0",
  "message_id": "<SYSTEM>-<event_id>-<UTC时间戳>",
  "event_id": "事件编号（同一事件多条记录共享）",
  "event_type": "INSERT_ORDER|RAMPUP|CHANGEOVER|EQUIP_FAIL|ABSENCE|MANUAL|PLAN",
  "trigger_time": "ISO 8601",
  "algorithm_version": "SCHEC-RESCHED-PKG-V1.0",
  "model_version": "SCHEC-MIP-V1.0",
  "generated_at": "ISO 8601",
  "body": [
    {"employee_id": "", "position_code": "", "schedule_date": "YYYY-MM-DD",
     "shift_code": "D12|N12|D8", "action": "ASSIGN|CANCEL|REPLACE|LOCK"}
  ]
}
```
系统差异化字段：WECOM/SMS/BRACELET 增加 channels 与 push_status；
ATTENDANCE 增加 operation=UPSERT_ATTENDANCE_PLAN；MES 增加
operation=BIND_POSITION_STAFF；OCC 增加 operation=REPORT_DISPATCH_EVENT。

## 4 回执与执行状态模型
- 推送状态：`SIMULATED_SENT`（模拟已发送；真实对接后由通道回执覆盖为SENT/FAILED）；
- 执行状态：`PENDING -> ACCEPTED | REJECTED | TIMEOUT`；
- 回传字段：event_id、system、execution_status、executor_id、feedback_time（ISO 8601）、remark；
- 实现位置：`src/mock_adapters.py` 的 `record_feedback`（追加写入）与
  `pull_feedback`（按事件查询）。真实对接时以相同契约替换传输层，业务字段不变。

## 5 模拟适配层行为
`mock_adapters.emit_all(out_dir, event, changes, meta)` 对全部6个系统生成：
- `<system>_push.json`：契约报文；
- `<system>_receipt.json`：推送回执（SIMULATED_SENT + PENDING）。
文件保存在重排输出目录 `external_messages/` 下，可逐字段核对契约格式。
`reschedule` 命令在每次重排后自动调用，并将人员变更同步写入
`dispatch_archive.csv`（调度记录全量归档，append-only，字段口径与
SCHEC-RESCHED-V1.0 设计一致：dispatch_id、event_id、event_type、
trigger_time、工厂/产线/岗位、日期班次、员工、action_type、
prior_employee_id、技能等级、证书有效期、算法/模型/输入/基准版本、
response_time_s、objective_before/after、push_channel、push_status、
execution_status、executor_id、feedback_time、remark）。

## 6 真实对接实施要求（部署阶段）
1. 传输与安全：企业微信/短信通道需在部署环境配置应用凭证与网关；考勤、MES、
   OCC按中粮可口可乐实际接口规范（凌云塔排班/考勤系统、MES执行系统、HR人事
   系统）补充鉴权与网络策略；手环通道按厂商API接入。凭证不得写入本包。
2. 幂等与重试：以message_id幂等；推送失败按通道策略重试；执行状态回传按
   PENDING超时阈值（建议15分钟，可配置）转TIMEOUT。
3. 审计：dispatch_archive.csv为全量归档底账，任何时点可重建历史；真实对接后
   迁移到数据库表并保持append-only与逐笔更新日志（profile_update_log）。
4. 人员画像闭环：执行状态ACCEPTED的调度记录按（员工,技能岗位）累计计薪工时，
   累计达到阈值（默认200小时，可配置）生成技能等级提升建议，经人工确认后
   更新技能等级并重算资格集合，形成"推荐-执行-画像更新-再推荐"闭环。

## 7 适用限制
本契约与模拟适配层未与真实系统联调；报文字段与状态模型为交付设计，实际
字段映射需在联调阶段与各系统厂商确认。输入为规则驱动仿真样本，输出结论
不构成实际工厂绩效证据。