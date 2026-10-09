# -*- coding: utf-8 -*-
"""kpi_core：排班KPI统计与产出处接口适配层。

将基线方案与重排方案的KPI输出映射到内部系统要求的统一处数格式，
并对调度执行记录做全量归档（append-only），供历史查询与追溯使用。
外部处数口径说明见 docs/EXTERNAL_INTERFACE_CONTRACT.md；本模块为
命令行包内的实现层，不访问任何外部网络地址。
"""
import csv
import datetime as dt
import json
import os


def to_place_rows(schedule_csv, out_csv):
    """将排班方案明细转换为处数KPI统一输出（处编号=岗位编码）。"""
    assign, gaps, fvals = _parse(schedule_csv)
    rows = [["处ID", "日期", "班次代码", "员工工号", "类型", "计薪工时(h)", "标准工时(h)", "加班工时(h)"]]
    paid = {"D12": 11.0, "N12": 11.0, "D8": 8.0}
    std = {"D12": 8.0, "N12": 8.0, "D8": 8.0}
    ot = {"D12": 3.0, "N12": 3.0, "D8": 0.0}
    for (e, p, d, sc) in assign:
        rows.append([p, d, sc, e, "整班", paid[sc], std[sc], ot[sc]])
    for (e, p, d, sc, h) in fvals:
        rows.append([p, d, sc, e, "非完整班", h, h, 0.0])
    _write(out_csv, rows)


def _parse(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    assign, gaps, fvals = [], {}, []
    mode = "assign"
    for r in rows:
        if not r or all(c == "" for c in r):
            continue
        c0 = (r[0] or "").strip()
        if c0.startswith("缺口记录"):
            mode = "gap"
            continue
        if c0.startswith("非完整班次记录"):
            mode = "f"
            continue
        if mode == "assign" and len(r) >= 15 and r[2] != "日期":
            assign.append((r[5].strip(), r[6].strip(), r[2].strip(), r[4].strip()))
        elif mode == "gap" and len(r) >= 6 and r[0] != "岗位编码":
            gaps[(r[0].strip(), r[3].strip(), r[4].strip())] = int(float(r[5]))
        elif mode == "f" and len(r) >= 5 and r[0] != "员工工号":
            fvals.append((r[0].strip(), r[1].strip(), r[2].strip(), r[3].strip(), float(r[4])))
    return assign, gaps, fvals


def _write(path, rows):
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        csv.writer(f).writerows(rows)


class DispatchArchive:
    """调度记录全量归档（append-only），字段口径与 SCHEC-RESCHED-V1.0 设计一致。"""

    HEADER = ["dispatch_id", "event_id", "event_type", "trigger_time", "factory_code",
              "line_code", "position_code", "position_name", "schedule_date", "shift_name",
              "shift_code", "employee_id", "action_type", "prior_employee_id", "skill_level",
              "required_level", "cert_valid_until", "algorithm_version", "model_version",
              "input_version", "baseline_version", "response_time_s", "objective_before",
              "objective_after", "push_channel", "push_status", "push_time", "execution_status",
              "executor_id", "feedback_time", "remark"]

    def __init__(self, csv_path):
        self.path = csv_path
        if not os.path.exists(csv_path):
            self._append_rows([self.HEADER])

    def record_event(self, event_id, event_type, trigger_time, changes, meta):
        """将一次重排事件的全部人员变更逐条归档。

        changes 为 (action, employee, position_code, position_name, factory, line,
        date, shift_name, shift_code, prior_employee, skill_level, required_level,
        cert_valid_until) 元组列表；meta 含版本与响应时间信息。
        """
        now = trigger_time
        rows = []
        for i, c in enumerate(changes, 1):
            rows.append(["DSP%s%04d" % (event_id, i), event_id, event_type, trigger_time,
                         c[4], c[5], c[2], c[3], c[6], c[7], c[8], c[1], c[0], c[9],
                         c[10], c[11], c[12], meta["algorithm_version"], meta["model_version"],
                         meta["input_version"], meta["baseline_version"], meta["response_time_s"],
                         json.dumps(meta.get("objective_before", {}), ensure_ascii=False),
                         json.dumps(meta.get("objective_after", {}), ensure_ascii=False),
                         meta.get("push_channel", "SYSTEM"), "SIMULATED_SENT", now,
                         "PENDING", "", "", meta.get("remark", "")])
        self._append_rows(rows)

    def _append_rows(self, rows):
        os.makedirs(os.path.dirname(os.path.abspath(self.path)) or ".", exist_ok=True)
        with open(self.path, "a", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerows(rows)

    def query(self, **filters):
        """按字段过滤查询历史归档记录（等值匹配）。"""
        out = []
        with open(self.path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if all(row.get(k) == v for k, v in filters.items()):
                    out.append(row)
        return out


def schedule_kpi_report(schedule_csv, out_md, scenario="FULL62-W1"):
    """生成方案KPI简报（Markdown），供系统留档与人工复核。"""
    assign, gaps, fvals = _parse(schedule_csv)
    n12 = sum(1 for a in assign if a[3] in ("D12", "N12"))
    hours = {}
    paid = {"D12": 11.0, "N12": 11.0, "D8": 8.0}
    for (e, p, d, sc) in assign:
        hours[e] = hours.get(e, 0.0) + paid[sc]
    for (e, p, d, sc, h) in fvals:
        hours[e] = hours.get(e, 0.0) + h
    tv = list(hours.values()) if hours else [0.0]
    gap = sum(gaps.values())
    f_total = sum(x[4] for x in fvals)
    lines = [
        "# 排班方案KPI简报（%s）" % scenario, "",
        "- 整班指派：%d人班" % len(assign),
        "- 非完整班：%d条，合计%.1f小时（折%.2f人班）" % (len(fvals), f_total, f_total / 8.0),
        "- 缺口合计：%d人班" % gap,
        "- 12小时班上岗：%d人班，加班工时：%.1f小时" % (n12, 3.0 * n12),
        "- 计薪总工时：%.1f小时；单人极差：%.1f小时" % (sum(tv), max(tv) - min(tv)),
        "- 生成时间：%s" % dt.datetime.now().replace(microsecond=0).isoformat(),
    ]
    os.makedirs(os.path.dirname(os.path.abspath(out_md)) or ".", exist_ok=True)
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")