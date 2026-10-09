# -*- coding: utf-8 -*-
"""外部系统适配层（企业微信/短信/考勤/MES/OCC/手环）模拟适配器。

本环境没有外部系统访问权限，也没有真实凭证。本模块实现统一的
接口契约与模拟适配层：按契约格式生成出站消息与回执文件，用于
对接联调前的格式验证与流程闭环演示。不访问任何网络地址，不出网。

契约定义与字段说明见 docs/EXTERNAL_INTERFACE_CONTRACT.md。
状态模型（与调度归档设计一致）：
推送 push_status: SIMULATED_SENT（模拟已发送）
执行 execution_status: PENDING -> ACCEPTED / REJECTED / TIMEOUT
"""
import csv
import datetime as dt
import json
import os

SYSTEMS = ["WECOM", "SMS", "ATTENDANCE", "MES", "OCC", "BRACELET"]


def _write_json(path, payload):
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def build_push_payload(system, event, changes, meta):
    """按外部系统契约构造推送报文（模拟适配层）。"""
    base = dict(
        interface_id="IF-%s-PUSH-1.0" % system,
        message_id="%s-%s-%s" % (system, event.get("event_id", "EVT"),
                                 dt.datetime.now().strftime("%Y%m%d%H%M%S")),
        event_id=event.get("event_id", ""),
        event_type=event.get("event_type", ""),
        trigger_time=event.get("trigger_time", ""),
        algorithm_version=meta.get("algorithm_version", ""),
        model_version=meta.get("model_version", ""),
        generated_at=dt.datetime.now().replace(microsecond=0).isoformat(),
        body=[dict(employee_id=c.get("employee_id", ""),
                   position_code=c.get("position_code", ""),
                   schedule_date=c.get("schedule_date", ""),
                   shift_code=c.get("shift_code", ""),
                   action=c.get("action_type", "")) for c in changes])
    if system in ("WECOM", "SMS", "BRACELET"):
        base["channels"] = [system]
        base["push_status"] = "SIMULATED_SENT"
        base["note"] = "模拟适配：未连接真实通道，仅生成契约报文与回执文件"
    elif system == "ATTENDANCE":
        base["purpose"] = "排班锁定与临时调整同步至考勤系统"
        base["operation"] = "UPSERT_ATTENDANCE_PLAN"
    elif system == "MES":
        base["purpose"] = "排班执行人员与产线岗位绑定同步"
        base["operation"] = "BIND_POSITION_STAFF"
    elif system == "OCC":
        base["purpose"] = "调度方案与执行状态事件上报"
        base["operation"] = "REPORT_DISPATCH_EVENT"
    else:
        raise ValueError("未知系统标识：%s" % system)
    return base


def emit_all(out_dir, event, changes, meta):
    """为全部系统生成模拟报文与推送回执文件，返回文件清单。"""
    os.makedirs(out_dir, exist_ok=True)
    made = []
    for system in SYSTEMS:
        payload = build_push_payload(system, event, changes, meta)
        p = os.path.join(out_dir, "%s_push.json" % system.lower())
        _write_json(p, payload)
        made.append(p)
        receipt = dict(interface_id=payload["interface_id"],
                       message_id=payload["message_id"],
                       push_status="SIMULATED_SENT",
                       execution_status="PENDING",
                       received_at=dt.datetime.now().replace(microsecond=0).isoformat())
        rp = os.path.join(out_dir, "%s_receipt.json" % system.lower())
        _write_json(rp, receipt)
        made.append(rp)
    return made


def record_feedback(feedback_csv, event_id, system, execution_status,
                    executor_id="", remark=""):
    """追加执行状态回传记录（模拟回执，覆盖闭环状态）。"""
    header = ["event_id", "system", "execution_status", "executor_id",
              "feedback_time", "remark"]
    newfile = not os.path.exists(feedback_csv)
    os.makedirs(os.path.dirname(os.path.abspath(feedback_csv)) or ".", exist_ok=True)
    with open(feedback_csv, "a", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        if newfile:
            w.writerow(header)
        w.writerow([event_id, system, execution_status, executor_id,
                    dt.datetime.now().replace(microsecond=0).isoformat(), remark])


def pull_feedback(feedback_csv, event_id=None):
    """读取执行状态回传记录（模拟拉取）。"""
    if not os.path.exists(feedback_csv):
        return []
    out = []
    with open(feedback_csv, "r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if event_id is None or row.get("event_id") == event_id:
                out.append(row)
    return out