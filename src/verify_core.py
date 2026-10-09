# -*- coding: utf-8 -*-
"""独立核验核心模块（求解程序包独立运行版）。

对排班方案按原业务规则复算七项硬约束与KPI分量，不使用求解器内部判定。
口径与已验收 SCHEC-SOLVE-V1.1、SCHEC-RESCHED-V1.0、SCHEC-VALID-V3.0 一致：
1) 12小时班计薪11小时=标准工时8小时+当日加班3小时（另1小时用餐不计工时）；
2) 月加班上限36小时等价于每人每月12小时班不超过12班；
3) 7天至少休1天与两班间隔不少于11小时按整班排班序列时间戳判定；
4) 覆盖等式计入非完整班次折算（非完整班小时合计除以8折为人班）。
"""
import csv
import datetime
import math

SHIFT_META = {
    "D12": dict(name="白班", start=8, dur=12.0, paid=11.0, std=8.0, ot=3.0),
    "N12": dict(name="夜班", start=20, dur=12.0, paid=11.0, std=8.0, ot=3.0),
    "D8": dict(name="常白班", start=8, dur=8.0, paid=8.0, std=8.0, ot=0.0),
}
NAME2CODE = {v["name"]: k for k, v in SHIFT_META.items()}


def parse_schedule_csv(path):
    """解析三段式排班方案CSV（指派、缺口、非完整班次）。

    返回 (assign, gaps, fvals)：
    assign 为 (员工工号, 岗位编码, 日期, 班次代码) 列表；
    gaps 为 {(岗位编码, 日期, 班次名称): 缺口人班}；
    fvals 为 (员工工号, 岗位编码, 日期, 班次代码, 小时) 列表。
    """
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
        if mode == "assign" and len(r) >= 15:
            if r[2] == "日期":
                continue
            assign.append((r[5].strip(), r[6].strip(), r[2].strip(), r[4].strip()))
        elif mode == "gap" and len(r) >= 6:
            if r[0] == "岗位编码":
                continue
            sc = r[4].strip()
            name = SHIFT_META.get(sc, {}).get("name", sc)
            gaps[(r[0].strip(), r[3].strip(), name)] = int(float(r[5]))
        elif mode == "f" and len(r) >= 5:
            if r[0] == "员工工号":
                continue
            fvals.append((r[0].strip(), r[1].strip(), r[2].strip(), r[3].strip(), float(r[4])))
    return assign, gaps, fvals


def verify_seven(assign, gaps, fvals, data, demand=None, month_limit=12):
    """按原业务规则独立复算七项硬约束。

    返回 (是否全部通过, 各项违例计数, 违例样例)。
    """
    POS = data["POS"]
    QUAL = data["QUAL"]
    CAN = data["can_night"]
    dates = data["dates"]
    if demand is None:
        demand = data["demand"]
    fails = []

    def mark(msg):
        if len(fails) < 30:
            fails.append(msg)

    valid_dates = set(dates)
    valid_people = set(data["emp_list"])
    by_emp = {}
    perday = {}
    cnt = {}
    fcov = {}
    n1 = 0
    n6 = 0

    for record in assign:
        if not isinstance(record, (tuple, list)) or len(record) != 4:
            n1 += 1
            mark("指派记录字段数量无效")
            continue
        e, p, day, sc = record
        if e not in valid_people or p not in POS or day not in valid_dates or sc not in SHIFT_META:
            n1 += 1
            mark("指派员工、岗位、日期或班次不属于输入数据:%s-%s@%s" % (e, p, day))
            continue
        if (e, p) not in QUAL:
            n1 += 1
            mark("资格:%s-%s" % (e, p))
            continue
        if sc == "N12" and not CAN.get(e, False):
            n1 += 1
            mark("夜班资格:%s" % e)
            continue
        meta = SHIFT_META[sc]
        by_emp.setdefault(e, []).append((p, day, sc, meta["dur"], False))
        perday.setdefault((e, day), []).append((sc, meta["std"], meta["ot"]))
        key = (p, day, meta["name"])
        cnt[key] = cnt.get(key, 0) + 1

    for record in fvals:
        if not isinstance(record, (tuple, list)) or len(record) != 5:
            n1 += 1
            mark("非完整班次记录字段数量无效")
            n6 += 1
            continue
        e, p, day, sc, raw_hours = record
        try:
            hours = float(raw_hours)
        except (TypeError, ValueError):
            hours = float("nan")
        if (e not in valid_people or p not in POS or day not in valid_dates
                or sc not in SHIFT_META or (e, p) not in QUAL
                or (sc == "N12" and not CAN.get(e, False))):
            n1 += 1
            mark("非完整班次员工、岗位、日期或资格无效:%s-%s@%s" % (e, p, day))
            continue
        if not math.isfinite(hours) or hours <= 0.0 or hours > 8.0:
            n6 += 1
            mark("非完整班次工时必须大于 0 h 且不超过 8 h:%s@%s" % (e, day))
            continue
        meta = SHIFT_META[sc]
        by_emp.setdefault(e, []).append((p, day, sc, hours, True))
        perday.setdefault((e, day), []).append((sc, hours, 0.0))
        key = (p, day, meta["name"])
        fcov[key] = fcov.get(key, 0.0) + hours

    n2 = sum(1 for v in perday.values() if len(v) > 1)
    if n2:
        mark("同一员工同一日期存在多条完整或非完整班次指派")
    n3 = 0
    for e, lst in by_emp.items():
        items = []
        for (p, day, sc, duration, _) in lst:
            meta = SHIFT_META[sc]
            try:
                start_day = datetime.datetime.strptime(day, "%Y-%m-%d")
            except (TypeError, ValueError):
                n1 += 1
                mark("班次日期格式无效:%s@%s" % (e, day))
                continue
            start = start_day + datetime.timedelta(hours=meta["start"])
            items.append((start, start + datetime.timedelta(hours=duration)))
        items.sort()
        for i in range(len(items) - 1):
            if (items[i + 1][0] - items[i][1]).total_seconds() / 3600.0 < 11.0 - 1e-9:
                n3 += 1
                mark("间隔<11h:%s" % e)
                break
    n4 = 0
    duty = {e: {day for (_, day, _, _, _) in lst} for e, lst in by_emp.items()}
    for e in data["emp_list"]:
        ds = duty.get(e, set())
        for i in range(len(dates) - 6):
            if sum(1 for d in dates[i:i + 7] if d in ds) > 6:
                n4 += 1
                mark("7天无休:%s@%s" % (e, dates[i]))
                break
    n5 = 0
    for e, lst in by_emp.items():
        pm = {}
        for (_, day, sc, _, fractional) in lst:
            if not fractional and sc in ("D12", "N12"):
                pm[day[:7]] = pm.get(day[:7], 0) + 1
        for mo, c in pm.items():
            if c > month_limit:
                n5 += 1
                mark("月12h班超限:%s-%s=%d" % (e, mo, c))
    for (e, day), duties in perday.items():
        ot = sum(item[2] for item in duties)
        std = sum(item[1] for item in duties)
        if ot > 3.0 + 1e-9 or std > 8.0 + 1e-9:
            n6 += 1
            mark("日工时:%s-%s" % (e, day))
    n7 = 0
    valid_gaps = {}
    for key, value in gaps.items():
        try:
            gap = float(value)
        except (TypeError, ValueError):
            gap = float("nan")
        if key not in demand or not math.isfinite(gap) or gap < 0:
            n7 += 1
            mark("缺口记录不属于需求或数量无效:%s" % (key,))
            continue
        valid_gaps[key] = gap
    valid_demand_keys = set()
    for k, raw_demand in demand.items():
        if not isinstance(k, (tuple, list)) or len(k) != 3:
            n7 += 1
            mark("需求单元字段格式无效:%s" % (k,))
            continue
        try:
            v = float(raw_demand)
        except (TypeError, ValueError):
            v = float("nan")
        if not math.isfinite(v) or v < 0:
            n7 += 1
            mark("需求数量无效:%s" % (k,))
            continue
        valid_demand_keys.add(tuple(k))
        key = tuple(k)
        cov = cnt.get(key, 0) + fcov.get(key, 0.0) / 8.0 + valid_gaps.get(key, 0)
        if abs(cov - v) > 1e-6:
            n7 += 1
            mark("覆盖:%s=%.3f/%d" % (str(k), cov, v))
    extra_cells = (set(cnt) | set(fcov) | set(gaps)) - valid_demand_keys
    for key in extra_cells:
        n7 += 1
        mark("排班结果包含需求范围外的岗位单元:%s" % (key,))
    if not valid_demand_keys:
        n7 += 1
        mark("需求集合为空，无法确认方案覆盖完整性")
    totals = dict(qual_night=n1, one_per_day=n2, interval_11h=n3, rest_7d=n4,
                  month_ot_36h=n5, daily_hours=n6, coverage_eq=n7)
    return all(v == 0 for v in totals.values()), totals, fails


def kpi_components(assign, gaps, fvals, data, demand=None):
    """复算方案KPI分量（口径与已验收基准求解一致）。"""
    POS = data["POS"]
    chg = data["changeover"]
    if demand is None:
        demand = data["demand"]
    key_gap = gen_gap = co_gap = 0
    for k, g in gaps.items():
        if g <= 0:
            continue
        if POS[k[0]]["key_flag"]:
            key_gap += g
        else:
            gen_gap += g
        if (POS[k[0]]["line"], k[1], k[2]) in chg:
            co_gap += g
    n12 = sum(1 for a in assign if a[3] in ("D12", "N12"))
    hours = {}
    for (e, p, dt, sc) in assign:
        hours[e] = hours.get(e, 0.0) + SHIFT_META[sc]["paid"]
    for (e, p, dt, sc, h) in fvals:
        hours[e] = hours.get(e, 0.0) + h
    tv = list(hours.values()) if hours else [0.0]
    f_total = sum(f[4] for f in fvals)
    covered = len(assign) + f_total / 8.0
    dem_total = sum(demand.values())
    return dict(
        assigned=len(assign), f_hours=round(f_total, 2),
        covered=round(covered, 2),
        coverage_rate=round(covered / float(dem_total), 4) if dem_total else None,
        key_gap=key_gap, gen_gap=gen_gap, co_gap=co_gap,
        gap_total=key_gap + gen_gap, shifts_12h=n12,
        ot_hours=3.0 * n12, total_paid_hours=round(sum(tv), 1),
        hours_range=round(max(tv) - min(tv), 2),
        min_hours=round(min(tv), 2), max_hours=round(max(tv), 2),
        demand_total=dem_total)


def objective_value(comp, weights, balance_range_hours=None):
    """按给定权重复算加权目标函数值。"""
    balance_range = (comp["hours_range"] if balance_range_hours is None
                     else balance_range_hours)
    return (weights["gap_key"] * comp["key_gap"]
            + weights["gap_gen"] * comp["gen_gap"]
            + weights["co_gap_extra"] * comp["co_gap"]
            + weights["ot_per_hour"] * 3.0 * comp["shifts_12h"]
            + weights["balance_per_hour"] * balance_range
            - weights["util_per_shift"] * comp["shifts_12h"])


def compare_reference(comp, objective, reference, tol=0.01):
    """将复算KPI与已验收登记值逐项比较，返回比较明细。"""
    checks = dict(
        assigned=comp["assigned"] == reference["assigned"],
        gap_total=comp["gap_total"] == reference["gap_total"],
        key_gap=comp["key_gap"] == reference["key_gap"],
        shifts_12h=comp["shifts_12h"] == reference["shifts_12h"],
        f_hours=abs(comp["f_hours"] - reference["f_hours"]) <= tol,
        ot_hours=abs(comp["ot_hours"] - reference["ot_hours"]) <= tol,
        total_paid_hours=abs(comp["total_paid_hours"] - reference["total_paid_hours"]) <= tol,
        hours_range=abs(comp["hours_range"] - reference["hours_range"]) <= tol,
        demand_total=comp["demand_total"] == reference["demand_total"],
        objective=abs(objective - reference["objective"]) <= tol)
    return dict(checks=checks, all_match=all(checks.values()))
