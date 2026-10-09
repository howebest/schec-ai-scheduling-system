# -*- coding: utf-8 -*-
"""reschedule_core：锁定式增量重排核心模块（独立运行版）。

方法与已验收 SCHEC-RESCHED-V1.0 一致：以基准方案为初始解，仅解锁事件影响
单元与同厂窗口内基准缺口单元，其余人员-岗位-日期-班次变量与缺口变量固定为
基准值；边界处理含窗口前后夜班-早班禁排、月12小时班上限按窗口外同月已用
紧缩、任意连续7天休息约束按窗口前后各6天前缀/后缀衔接。
"""
import datetime
import time

import pyomo.environ as pyo
from pyomo.contrib.appsi.solvers import Highs as AppsiHighs

from verify_core import SHIFT_META, NAME2CODE


def parse_baseline(path):
    from verify_core import parse_schedule_csv
    return parse_schedule_csv(path)


def run_scenario(data, base_assign, base_gaps, base_f, builder, event,
                 factory=None, window_days=7, time_limit=45.0, extra_unlock=None):
    """执行一个异常场景的锁定式增量重排。

    event 需含 demand_modifier(可选)、changeover_add(可选)、absent_emp(可选)。
    返回结果字典，含响应时间分项、求解状态、窗口解、合并全期解与变更明细。
    """
    t0 = time.perf_counter()
    dates = data["dates"]
    date_idx = {d: i for i, d in enumerate(dates)}
    POS = data["POS"]
    event_date = event.get("date", dates[0])
    i0 = date_idx[event_date]
    window = dates[i0:i0 + window_days]
    wset = set(window)
    base_set = set(base_assign)
    base_f_map = {(e, p, dt, sc): h for (e, p, dt, sc, h) in base_f}
    base_emp_shift = {}
    for (e, p, dt, sc) in base_assign:
        base_emp_shift[(e, dt)] = sc

    dem2 = dict(data["demand"])
    chg2 = dict(data["changeover"])
    touched = set()
    if event.get("demand_modifier"):
        touched |= event["demand_modifier"](dem2)
    if event.get("changeover_add"):
        chg2[event["changeover_add"]] = "B"
        touched |= {(p, event["changeover_add"][1], event["changeover_add"][2])
                    for p in POS
                    if POS[p]["line"] == event["changeover_add"][0]
                    and dem2.get((p, event["changeover_add"][1], event["changeover_add"][2]), 0) > 0}
    fac = factory if factory is not None else event.get("factory")
    unlocked = {k for k in dem2
                if k[1] in wset and POS[k[0]]["factory"] == fac
                and base_gaps.get(k, 0) > 0}
    unlocked |= {k for k in touched if k[1] in wset}
    if extra_unlock:
        unlocked |= {k for k in extra_unlock if k[1] in wset}
    t_setup = time.perf_counter() - t0

    t1 = time.perf_counter()
    d2 = dict(data)
    d2["demand"] = dem2
    d2["changeover"] = chg2
    m, meta = builder.build_model(d2, date_filter=wset)
    t_build = time.perf_counter() - t1

    t2 = time.perf_counter()


    def cell_key(pos, dt, sc):
        """meta键班次代码为builder班次名称（白班/夜班/常白班），与SHIFT_META代码映射。"""
        return (pos, dt, SHIFT_META[sc]["name"])


    x_by_cell = {}
    for (e, p, dt, sc) in meta["x_index"]:
        x_by_cell.setdefault(cell_key(p, dt, sc), []).append((e, sc))
    f_by_cell = {}
    for (e, p, dt, sc) in meta["f_index"]:
        f_by_cell.setdefault(cell_key(p, dt, sc), []).append((e, sc))
    nfix = 0
    for k in meta["dem_keys"]:
        if k in unlocked:
            continue
        for (e, sc) in x_by_cell.get(k, []):
            m.x[(e, k[0], k[1], sc)].fix(1 if (e, k[0], k[1], sc) in base_set else 0)
            nfix += 1
        m.g[k].fix(base_gaps.get(k, 0))
        nfix += 1
        for (e, sc) in f_by_cell.get(k, []):
            m.f[(e, k[0], k[1], sc)].fix(base_f_map.get((e, k[0], k[1], sc), 0.0))
            nfix += 1
    absent = event.get("absent_emp")
    if absent:
        for (e, p, dt, sc) in meta["x_index"]:
            if e == absent:
                m.x[(e, p, dt, sc)].fix(0)
                nfix += 1
        for (e, p, dt, sc) in meta["f_index"]:
            if e == absent:
                m.f[(e, p, dt, sc)].fix(0.0)
                nfix += 1
    idx0 = date_idx[window[0]]
    idx_end = date_idx[window[-1]]
    y_set = set(meta["y_index"])
    emps_y = sorted({e for (e, dt, sc) in meta["y_index"]})
    month_limit = builder.PARAMS["DRV_MAX_12H_SHIFTS"]
    nb = 0
    if idx0 > 0:
        prev = dates[idx0 - 1]
        first = window[0]
        for (e, d), sc in base_emp_shift.items():
            if d == prev and sc == "N12":
                for sc2 in ("D12", "D8"):
                    if (e, first, sc2) in y_set:
                        m.y[(e, first, sc2)].fix(0)
                        nb += 1
    if idx_end < len(dates) - 1:
        nxt = dates[idx_end + 1]
        last = window[-1]
        for (e, d), sc in base_emp_shift.items():
            if d == nxt and sc in ("D12", "D8"):
                if (e, last, "N12") in y_set:
                    m.y[(e, last, "N12")].fix(0)
                    nb += 1
    used_out = {}
    for (e, p, dt, sc) in base_assign:
        if sc in ("D12", "N12") and dt not in wset:
            used_out[(e, dt[:7])] = used_out.get((e, dt[:7]), 0) + 1
    m.monot2 = pyo.ConstraintList()
    for mo in sorted({d[:7] for d in window}):
        for e in emps_y:
            u = used_out.get((e, mo), 0)
            if u <= 0:
                continue
            tt = [m.y[(e, dt, sc)] for dt in window if dt[:7] == mo
                  for sc in ("D12", "N12") if (e, dt, sc) in y_set]
            if tt:
                m.monot2.add(sum(tt) <= month_limit - u)
                nb += 1
    m.restlink = pyo.ConstraintList()
    for t in range(1, 7):
        old_days = dates[max(0, idx0 - t):idx0]
        new_days = window[:7 - t]
        if new_days:
            for e in emps_y:
                cnt_old = sum(1 for d in old_days if base_emp_shift.get((e, d)))
                if cnt_old <= 0:
                    continue
                tt = [m.y[(e, d, sc)] for d in new_days
                      for sc in ("D12", "N12", "D8") if (e, d, sc) in y_set]
                if tt:
                    m.restlink.add(sum(tt) <= 6 - cnt_old)
                    nb += 1
        post_days = dates[idx_end + 1:idx_end + 1 + t]
        tail_days = window[-(7 - t):] if (7 - t) > 0 else []
        if post_days and tail_days:
            for e in emps_y:
                cnt_post = sum(1 for d in post_days if base_emp_shift.get((e, d)))
                if cnt_post <= 0:
                    continue
                tt = [m.y[(e, d, sc)] for d in tail_days
                      for sc in ("D12", "N12", "D8") if (e, d, sc) in y_set]
                if tt:
                    m.restlink.add(sum(tt) <= 6 - cnt_post)
                    nb += 1
    t_fix = time.perf_counter() - t2

    opt = AppsiHighs()
    opt.config.load_solution = False
    opt.config.time_limit = time_limit
    ts0 = time.perf_counter()
    res = opt.solve(m)
    t_solve = time.perf_counter() - ts0
    term = str(res.termination_condition)
    incumbent = (None if res.best_feasible_objective is None
                 else float(res.best_feasible_objective))
    bound = (None if res.best_objective_bound is None
             else float(res.best_objective_bound))

    t3 = time.perf_counter()
    if incumbent is None:
        # Keep the baseline intact when no feasible incumbent exists. The
        # caller marks the task failed and must not publish this unchanged plan.
        assign_w = [a for a in base_assign if a[2] in wset]
        gaps_w = {k: base_gaps.get(k, 0) for k in meta["dem_keys"]}
        f_w = [r for r in base_f if r[2] in wset]
    else:
        # Reuse the exact incumbent returned by the first solve; a second solve
        # can time out differently and produce variables inconsistent with the
        # termination, incumbent and bound recorded above.
        res.solution_loader.load_vars()
        assign_w = [k for k in meta["x_index"]
                    if (pyo.value(m.x[k], exception=False) or 0) > 0.5]
        gaps_w = {k: int(round(pyo.value(m.g[k], exception=False) or 0))
                  for k in meta["dem_keys"]}
        f_w = [(k[0], k[1], k[2], k[3], float(pyo.value(m.f[k], exception=False) or 0))
               for k in meta["f_index"]
               if (pyo.value(m.f[k], exception=False) or 0) > 1e-6]
    t_extract = time.perf_counter() - t3

    merged_assign = [a for a in base_assign if a[2] not in wset] + assign_w
    merged_gaps = {k: v for k, v in base_gaps.items() if k[1] not in wset}
    for k, v in gaps_w.items():
        merged_gaps[k] = v
    merged_f = [r for r in base_f if r[2] not in wset] + f_w
    base_w = {a for a in base_assign if a[2] in wset}
    new_w = set(assign_w)
    removed = sorted(base_w - new_w)
    added = sorted(new_w - base_w)
    affected = sorted({a[0] for a in removed} | {a[0] for a in added})
    gap_changes = [(k, base_gaps.get(k, 0), gaps_w.get(k, 0))
                   for k in meta["dem_keys"]
                   if base_gaps.get(k, 0) != gaps_w.get(k, 0)]
    resp = t_setup + t_build + t_fix + t_solve + t_extract
    return dict(
        event_id=event.get("event_id", ""), scn_type=event.get("scn_type", ""),
        window="%s~%s" % (window[0], window[-1]),
        unlocked_cells=len(unlocked), vars=meta["n_var"], cons=meta["n_con"],
        fixes=nfix, boundary=nb, termination=term, incumbent=incumbent,
        bound=bound, t_setup=round(t_setup, 3), t_build=round(t_build, 2),
        t_fix=round(t_fix, 2), t_solve=round(t_solve, 2),
        t_extract=round(t_extract, 3), response_s=round(resp, 2), meet60=bool(resp < 60.0),
        assign_w=assign_w, gaps_w=gaps_w, f_w=f_w,
        merged=(merged_assign, merged_gaps, merged_f),
        removed=removed, added=added, affected=affected, gap_changes=gap_changes,
        demand=dem2, changeover=chg2)
