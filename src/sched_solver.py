# -*- coding: utf-8 -*-
"""中粮可口可乐AI智慧排班 求解程序包统一命令行入口（SCHEC-PKG-V1.0）。

用法示例（在解压根目录下）：
  python3 src/sched_solver.py info --input data/raw_dataset.xlsx
  python3 src/sched_solver.py solve-demo --input data/raw_dataset.xlsx --out out/demo_schedule.csv
  python3 src/sched_solver.py solve-full --input data/raw_dataset.xlsx --out out/full62_schedule.csv
  python3 src/sched_solver.py verify-baseline --input data/raw_dataset.xlsx --baseline data/baseline_schedule_FULL62_W1.csv
  python3 src/sched_solver.py reschedule --input data/raw_dataset.xlsx --baseline data/baseline_schedule_FULL62_W1.csv --event examples/events/S5-ABSENCE.json --out-dir out/S5
  python3 src/sched_solver.py kpi --baseline out/full62_schedule.csv --out-dir out/kpi

全部输入输出路径均由参数指定，不依赖宿主绝对路径。求解器为HiGHS
（pyomo.contrib.appsi接口），本程序不导入ortools（见 docs/DEPENDENCIES.md）。
"""
import argparse
import csv
import datetime
import importlib.util
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import scheduling_model_builder as builder  # noqa: E402
import pyomo.environ as pyo  # noqa: E402
from pyomo.contrib.appsi.solvers import Highs as AppsiHighs  # noqa: E402
from verify_core import (SHIFT_META, parse_schedule_csv, verify_seven,  # noqa: E402
                         kpi_components, objective_value, compare_reference)

PKG_VERSION = "SCHEC-PKG-V1.0"
# 已验收基准方案 FULL62-W1 登记值（正式Python结果 2471c0cc-317d-46cb-82e8-734f3ce0c3d9，
# 独立核验 30a5f9b1-55e9-4617-a338-6c4837bdb1ff 复算一致）
FULL62_W1_REFERENCE = dict(
    assigned=9693, f_hours=3728.0, gap_total=1753, key_gap=990, gen_gap=763,
    co_gap=0, shifts_12h=8577, ot_hours=25731.0, total_paid_hours=107003.0,
    hours_range=136.0, demand_total=11912, objective=249870.0)
WEIGHTS_W1 = dict(builder.WEIGHTS)
OBJECTIVE_PROFILES = {
    "balanced": dict(WEIGHTS_W1),
    "coverage_first": {**WEIGHTS_W1, "gap_key": 500.0, "gap_gen": 250.0,
                       "co_gap_extra": 80.0, "ot_per_hour": 2.0, "balance_per_hour": 0.5},
    "cost_control": {**WEIGHTS_W1, "gap_key": 70.0, "gap_gen": 18.0,
                     "co_gap_extra": 10.0, "ot_per_hour": 32.0, "util_per_shift": 0.0},
    "fairness_first": {**WEIGHTS_W1, "gap_key": 180.0, "gap_gen": 70.0,
                       "co_gap_extra": 35.0, "balance_per_hour": 60.0},
}

# 独立核验ISS-01双口径：按input_04×input_07重建需求为11948人班/11830单元
ISS01_REBUILT_DEMAND = dict(person_shifts=11948, cells=11830, coverage_rate=0.8503)


def sha256_file(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_schedule_csv(path, assign, gaps, fvals, data, scenario):
    """按基准方案同构的三段式格式输出排班方案明细。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    POS = data["POS"]
    chg = data["changeover"]
    assign = sorted(assign, key=lambda a: (a[2], a[3], a[1], a[0]))
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["工厂代码", "产线编码", "日期", "班次", "班次代码", "员工工号", "岗位编码",
                    "岗位名称", "是否关键岗", "技能等级", "计薪工时(h)", "标准工时(h)",
                    "当日加班工时(h)", "该班次换型等级", "实验编号"])
        for (e, p, dt, sc) in assign:
            v = POS[p]
            meta = SHIFT_META[sc]
            cg = chg.get((v["line"], dt, SHIFT_META[sc]["name"]), "")
            w.writerow([v["factory"], v["line"], dt, SHIFT_META[sc]["name"], sc, e, p,
                        v["pos_name"], v["key_flag"], data["QUAL"].get((e, p), ""),
                        meta["paid"], meta["std"], meta["ot"], cg, scenario])
        w.writerow([])
        w.writerow(["缺口记录：岗位编码,岗位名称,产线编码,日期,班次,缺口人班"])
        for k in sorted(gaps.keys()):
            if gaps[k] > 0:
                v = POS[k[0]]
                w.writerow([k[0], v["pos_name"], v["line"], k[1],
                            SHIFT_META[k[2]]["name"] if k[2] in SHIFT_META else k[2], gaps[k]])
        w.writerow([])
        w.writerow(["非完整班次记录：员工工号,岗位编码,日期,班次代码,小时"])
        for (e, p, dt, sc, h) in sorted(fvals, key=lambda t: (t[2], t[3], t[1], t[0])):
            w.writerow([e, p, dt, sc, round(h, 3)])


def extract(m, meta):
    assign = [k for k in meta["x_index"]
              if (pyo.value(m.x[k], exception=False) or 0) > 0.5]
    gaps = {k: int(round(pyo.value(m.g[k], exception=False) or 0))
            for k in meta["dem_keys"]}
    fvals = [(k[0], k[1], k[2], k[3], float(pyo.value(m.f[k], exception=False) or 0))
             for k in meta["f_index"]
             if (pyo.value(m.f[k], exception=False) or 0) > 1e-6]
    return assign, gaps, fvals


def solve_model(m, time_limit):
    opt = AppsiHighs()
    opt.config.load_solution = True
    opt.config.time_limit = time_limit
    t0 = time.perf_counter()
    res = opt.solve(m)
    wall = time.perf_counter() - t0
    return dict(termination=str(res.termination_condition),
                incumbent=(None if res.best_feasible_objective is None
                           else float(res.best_feasible_objective)),
                bound=(None if res.best_objective_bound is None
                       else float(res.best_objective_bound)),
                wall_s=wall)


def cmd_info(args):
    t0 = time.perf_counter()
    data = builder.load_data(args.input)
    print(json.dumps(dict(
        package_version=PKG_VERSION, model_version=builder.MODEL_VERSION,
        input_version=builder.INPUT_VERSION, input_sha256=sha256_file(args.input),
        employees=len(data["emp_list"]), positions=len(data["pos_list"]),
        lines=len(data["lines"]), dates=[data["dates"][0], data["dates"][-1]],
        qualified_pairs=len(data["QUAL"]),
        night_capable=sum(1 for v in data["can_night"].values() if v),
        demand_cells=len(data["demand"]),
        demand_person_shifts=sum(data["demand"].values()),
        load_seconds=round(time.perf_counter() - t0, 2)), ensure_ascii=False, indent=2))
    return 0


def run_solve(data, out_csv, scenario, line_filter=None, date_filter=None,
              time_limit=600, objective_profile="balanced", demand_multiplier=1.0,
              minimum_coverage_rate=None):
    weights = OBJECTIVE_PROFILES[objective_profile]
    if demand_multiplier != 1.0:
        data = dict(data)
        selected_dates = set(date_filter if date_filter is not None else data["dates"])
        selected_lines = set(line_filter if line_filter is not None else data["lines"])
        data["demand"] = {
            key: (int(math.ceil(value * demand_multiplier))
                  if key[1] in selected_dates and data["POS"][key[0]]["line"] in selected_lines
                  else value)
            for key, value in data["demand"].items()
        }
    t1 = time.perf_counter()
    m, meta = builder.build_model(
        data, line_filter=line_filter, date_filter=date_filter, weights=weights,
        minimum_coverage_rate=minimum_coverage_rate)
    build_s = time.perf_counter() - t1
    sol = solve_model(m, time_limit)
    if sol["incumbent"] is None:
        print("求解未取得可行解：终止状态 %s" % sol["termination"])
        return 3
    assign, gaps, fvals = extract(m, meta)
    write_schedule_csv(out_csv, assign, gaps, fvals, data, scenario)
    ok, totals, fails = verify_seven(assign, gaps, fvals, data, meta["demand"])
    comp = kpi_components(assign, gaps, fvals, data, meta["demand"])
    coverage_guardrail = None if minimum_coverage_rate is None else dict(
        minimum_rate=minimum_coverage_rate,
        actual_rate=comp["coverage_rate"],
        passed=comp["coverage_rate"] + 1e-9 >= minimum_coverage_rate)
    model_balance_range = float(pyo.value(m.Tmax - m.Tmin))
    obj = objective_value(comp, weights, balance_range_hours=model_balance_range)
    objective_breakdown = dict(
        key_gap_penalty=weights["gap_key"] * comp["key_gap"],
        general_gap_penalty=weights["gap_gen"] * comp["gen_gap"],
        changeover_gap_extra_penalty=weights["co_gap_extra"] * comp["co_gap"],
        overtime_penalty=weights["ot_per_hour"] * 3.0 * comp["shifts_12h"],
        balance_penalty=weights["balance_per_hour"] * model_balance_range,
        utilization_reward=-weights["util_per_shift"] * comp["shifts_12h"],
    )
    print(json.dumps(dict(
        scenario=scenario, objective_profile=objective_profile,
        demand_multiplier=demand_multiplier, termination=sol["termination"],
        coverage_guardrail=coverage_guardrail,
        incumbent=round(sol["incumbent"], 4), bound=sol["bound"],
        objective_recomputed=round(obj, 4), build_seconds=round(build_s, 2),
        objective_breakdown=objective_breakdown,
        objective_scope=dict(
            balance_population="优化模型中的排班候选员工，包含本次未排班员工",
            balance_range_hours=round(model_balance_range, 2),
            kpi_hours_range_population="本次至少有一条排班指派的员工",
            kpi_hours_range_hours=comp["hours_range"],
        ),
        solve_seconds=round(sol["wall_s"], 2), vars=meta["n_var"], cons=meta["n_con"],
        verification=dict(all_pass=ok, violations=totals, samples=fails[:10]),
        kpi=comp, output=out_csv, output_sha256=sha256_file(out_csv)),
        ensure_ascii=False, indent=2))
    return 0 if ok else 4


def cmd_solve_demo(args):
    data = builder.load_data(args.input)
    dates = data["dates"][:7]
    return run_solve(data, args.out, args.scenario_name, line_filter=["SX-PET01"],
                     date_filter=dates, time_limit=args.time_limit,
                     objective_profile=args.objective_profile,
                     demand_multiplier=args.demand_multiplier,
                     minimum_coverage_rate=args.minimum_coverage_rate)


def cmd_solve_full(args):
    data = builder.load_data(args.input)
    return run_solve(data, args.out, "PKG-FULL62", time_limit=args.time_limit)


def cmd_verify_baseline(args):
    data = builder.load_data(args.input)
    assign, gaps, fvals = parse_schedule_csv(args.baseline)
    ok, totals, fails = verify_seven(assign, gaps, fvals, data)
    comp = kpi_components(assign, gaps, fvals, data)
    obj = objective_value(comp, WEIGHTS_W1)
    ref = FULL62_W1_REFERENCE
    cmpres = compare_reference(comp, obj, ref)
    print(json.dumps(dict(
        mode="verify-baseline", baseline=args.baseline,
        baseline_sha256=sha256_file(args.baseline),
        verification=dict(all_pass=ok, violations=totals, samples=fails[:10]),
        kpi=comp, objective=round(obj, 4),
        reference_match=cmpres,
        iss01_dual_demand_reference=ISS01_REBUILT_DEMAND),
        ensure_ascii=False, indent=2))
    if not ok:
        return 4
    if not cmpres["all_match"]:
        print("与已验收基准登记值存在不一致项：%s" % json.dumps(cmpres["checks"], ensure_ascii=False))
        return 5
    return 0


def load_event(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_event_modifier(event, data):
    """按事件类型构造需求变更与场景参数（与SCHEC-RESCHED-V1.0口径一致）。"""
    POS = data["POS"]
    etype = event["type"]
    res = dict()
    if etype == "absence":
        res["absent_emp"] = event["employee"]
        res["date"] = event["date"]
        res["scn_type"] = event.get("scn_type", "员工突发离岗")
    elif etype == "insert":
        ln, dt, sh = event["line"], event["date"], event["shift"]

        def dm(dem, _ln=ln, _dt=dt, _sh=sh):
            touched = set()
            for p, v in POS.items():
                if v["line"] != _ln or v["is_day_only"]:
                    continue
                staff = v["day_staff"] if _sh == "白班" else v["night_staff"]
                if staff > 0:
                    k = (p, _dt, _sh)
                    dem[k] = dem.get(k, 0) + staff
                    touched.add(k)
            return touched
        res["demand_modifier"] = dm
        res["date"] = dt
        res["scn_type"] = event.get("scn_type", "插单")
    elif etype == "rampup":
        ln, dt, add = event["line"], event["date"], int(event.get("add_per_position", 1))

        def dm(dem, _ln=ln, _dt=dt, _add=add):
            touched = set()
            for p, v in POS.items():
                if v["line"] != _ln or v["is_day_only"]:
                    continue
                for shn, sk in (("白班", "day_staff"), ("夜班", "night_staff")):
                    if v[sk] > 0:
                        k = (p, _dt, shn)
                        if k in dem:
                            dem[k] += _add
                            touched.add(k)
            return touched
        res["demand_modifier"] = dm
        res["date"] = dt
        res["scn_type"] = event.get("scn_type", "增产")
    elif etype == "changeover":
        key = (event["line"], event["date"], event["shift"])
        res["changeover_add"] = key
        res["date"] = event["date"]
        res["scn_type"] = event.get("scn_type", "换产")
    elif etype == "equipment_fail":
        ln = event["line"]
        dts = list(event["dates"])

        def dm(dem, _ln=ln, _dts=dts):
            touched = set()
            for p, v in POS.items():
                if v["line"] != _ln or v["is_day_only"]:
                    continue
                for dt in _dts:
                    for shn in ("白班", "夜班"):
                        k = (p, dt, shn)
                        if k in dem:
                            del dem[k]
                            touched.add(k)
            return touched
        res["demand_modifier"] = dm
        res["date"] = dts[0]
        res["scn_type"] = event.get("scn_type", "设备故障")
    else:
        raise ValueError("未知事件类型：%s" % etype)
    res["event_id"] = event.get("event_id", "EVT")
    return res


def scope_data_to_baseline(data, base_assign, base_gaps, base_f,
                           has_demand_override=False):
    """将增量重排输入限制到基线 CSV 实际表示的需求与日期范围。

    基线方案可能来自 solve-demo，仅覆盖部分产线和日期。若仍使用完整输入
    数据集建模，基线未表示的需求单元会被错误地固定为空排班，导致模型不可行。
    CSV 的指派、缺口和非完整班记录可还原每个已覆盖需求单元的有效需求。
    """
    coverage = {}

    def add(key, value):
        coverage[key] = coverage.get(key, 0.0) + float(value)

    for employee, position, day, shift_code in base_assign:
        add((position, day, SHIFT_META[shift_code]["name"]), 1.0)
    for key, gap in base_gaps.items():
        add(key, gap)
    for _employee, position, day, shift_code, hours in base_f:
        add((position, day, SHIFT_META[shift_code]["name"]), float(hours) / 8.0)

    coverage = {key: value for key, value in coverage.items() if value > 1e-9}
    if not coverage:
        raise ValueError("基线排班文件未包含可用于增量重排的需求记录。")

    input_dates = list(data["dates"])
    input_date_set = set(input_dates)
    invalid = [key for key in coverage if key[1] not in input_date_set or key[0] not in data["POS"]]
    if invalid:
        raise ValueError("基线排班日期或岗位超出所选数据集范围：%s" % (invalid[0],))

    if has_demand_override:
        for key, baseline_value in coverage.items():
            effective_value = data["demand"].get(key)
            if effective_value is None or abs(float(effective_value) - baseline_value) > 1e-3:
                raise ValueError("基线方案与保存的有效需求不一致：%s；请重新生成或选择匹配的基线方案。" % (key,))

    first_day = min(key[1] for key in coverage)
    last_day = max(key[1] for key in coverage)
    data["dates"] = [day for day in input_dates if first_day <= day <= last_day]
    data["demand"] = coverage
    return dict(start_date=first_day, end_date=last_day,
                position_count=len({key[0] for key in coverage}),
                demand_cell_count=len(coverage))


def cmd_reschedule(args):
    import reschedule_core
    import backfill_core
    import kpi_core
    import mock_adapters
    data = builder.load_data(args.input)
    if args.demand_override:
        try:
            with open(args.demand_override, "r", encoding="utf-8") as stream:
                override = json.load(stream)["effective_demand"]
            effective = {}
            valid_shifts = {meta["name"] for meta in SHIFT_META.values()}
            for row in override:
                key = (row["position_code"], row["date"], row["shift"])
                value = float(row["demand"])
                if key[0] not in data["POS"] or key[1] not in data["dates"] or key[2] not in valid_shifts:
                    raise ValueError("需求单元超出当前数据集范围")
                if key in effective or not (0 <= value < float("inf")):
                    raise ValueError("需求数量无效或需求单元重复")
                effective[key] = value
            if not effective:
                raise ValueError("有效需求列表为空")
            data["demand"] = effective
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError("排班版本有效需求文件无效：%s" % exc) from exc
    base_assign, base_gaps, base_f = parse_schedule_csv(args.baseline)
    baseline_scope = scope_data_to_baseline(
        data, base_assign, base_gaps, base_f,
        has_demand_override=bool(args.demand_override))
    event = load_event(args.event)
    modifier = build_event_modifier(event, data)
    extra_unlock = None
    fac_arg = None
    if modifier.get("absent_emp"):
        wname = modifier["absent_emp"]
        wdates = [d for d in data["dates"]
                  if data["dates"].index(modifier["date"])
                  <= data["dates"].index(d)
                  < data["dates"].index(modifier["date"]) + args.window_days]
        wset = set(wdates)
        extra_unlock = {(a[1], a[2], SHIFT_META[a[3]]["name"]) for a in base_assign
                        if a[0] == wname and a[2] in wset}
        fac_arg = data["emp_factory"].get(wname)
    t_total0 = time.perf_counter()
    res = reschedule_core.run_scenario(
        data, base_assign, base_gaps, base_f, builder, modifier,
        factory=fac_arg,
        window_days=args.window_days, time_limit=args.time_limit,
        extra_unlock=extra_unlock)
    merged_assign, merged_gaps, merged_f = res["merged"]
    ok, totals, fails = verify_seven(merged_assign, merged_gaps, merged_f,
                                     data, res["demand"])
    comp_before = kpi_components(base_assign, base_gaps, base_f, data)
    comp_after = kpi_components(merged_assign, merged_gaps, merged_f,
                                data, res["demand"])
    outdir = args.out_dir
    os.makedirs(outdir, exist_ok=True)
    write_schedule_csv(os.path.join(outdir, "rescheduled_schedule.csv"),
                       merged_assign, merged_gaps, merged_f, data,
                       "%s-RS" % modifier["event_id"])
    with open(os.path.join(outdir, "scenario_result.json"), "w", encoding="utf-8") as f:
        json.dump(dict(
            event_id=modifier["event_id"], scn_type=res["scn_type"],
            event=event, baseline_scope=baseline_scope, window=res["window"],
            unlocked_cells=res["unlocked_cells"],
            vars=res["vars"], cons=res["cons"], fixes=res["fixes"],
            boundary=res["boundary"], termination=res["termination"],
            incumbent=res["incumbent"], bound=res["bound"],
            t_setup=res["t_setup"], t_build=res["t_build"], t_fix=res["t_fix"],
            t_solve=res["t_solve"], t_extract=res["t_extract"],
            response_s=res["response_s"], meet60=res["meet60"],
            n_removed=len(res["removed"]), n_added=len(res["added"]),
            n_affected=len(res["affected"]), n_gap_change=len(res["gap_changes"]),
            kpi_before=comp_before, kpi_after=comp_after,
            verification=dict(all_pass=ok, violations=totals, samples=fails[:10]),
            effective_demand=[{"position_code":key[0], "date":key[1], "shift":key[2], "demand":value}
                              for key, value in sorted(res["demand"].items())],
            demand_total_after=comp_after["demand_total"]), f,
            ensure_ascii=False, indent=2)
    with open(os.path.join(outdir, "reschedule_changes_detail.csv"), "w",
              encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["记录类型", "员工工号", "岗位编码", "岗位名称", "产线编码", "工厂代码",
                    "日期", "班次", "班次代码", "原值", "新值", "说明"])
        POS = data["POS"]
        for (e, p, dt, sc) in res["removed"]:
            v = POS[p]
            w.writerow(["取消指派", e, p, v["pos_name"], v["line"], v["factory"],
                        dt, SHIFT_META[sc]["name"], sc, "指派", "无", "重排后取消该指派"])
        for (e, p, dt, sc) in res["added"]:
            v = POS[p]
            w.writerow(["新增指派", e, p, v["pos_name"], v["line"], v["factory"],
                        dt, SHIFT_META[sc]["name"], sc, "无", "指派", "重排后新增该指派"])
        for (k, b, n) in res["gap_changes"]:
            v = POS[k[0]]
            w.writerow(["缺口变化", "", k[0], v["pos_name"], v["line"], v["factory"],
                        k[1], k[2], "", str(b), str(n),
                        "该单元缺口人班由%d变为%d" % (b, n)])
    # 场景级非完整班次明细（独立核验ISS建议）
    wname_set = set()
    dates = data["dates"]
    i0 = dates.index(modifier["date"])
    wname_set = set(dates[i0:i0 + args.window_days])
    with open(os.path.join(outdir, "fractional_shift_detail.csv"), "w",
              encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["员工工号", "岗位编码", "日期", "班次代码", "小时", "是否事件窗口内"])
        for (e, p, dt, sc, h) in sorted(merged_f, key=lambda t: (t[2], t[1], t[0])):
            w.writerow([e, p, dt, sc, round(h, 3), "是" if dt in wname_set else "否"])
    # 补位推荐（离岗场景）
    if modifier.get("absent_emp"):
        cum, cert, _ = backfill_core.load_skill_profile(
            args.input, None, None)
        vac = {(a[1], a[2], SHIFT_META[a[3]]["name"]) for a in base_assign
               if a[0] == modifier["absent_emp"] and a[2] in wname_set}
        rows = backfill_core.recommend(data["QUAL"], data["can_night"], data["POS"],
                                       sorted(vac), base_assign, base_f, cum, cert,
                                       top_n=5)
        backfill_core.write_recommendations(
            os.path.join(outdir, "backfill_recommendations.csv"), rows)
    # 调度归档与外部系统模拟适配层
    changes_payload = []
    for (e, p, dt, sc) in res["removed"]:
        v = POS[p]
        changes_payload.append(dict(employee_id=e, position_code=p, schedule_date=dt,
                                    shift_code=sc, action_type="CANCEL",
                                    position_name=v["pos_name"]))
    for (e, p, dt, sc) in res["added"]:
        v = POS[p]
        changes_payload.append(dict(employee_id=e, position_code=p, schedule_date=dt,
                                    shift_code=sc, action_type="ASSIGN",
                                    position_name=v["pos_name"]))
    meta_info = dict(algorithm_version="SCHEC-RESCHED-PKG-V1.0",
                     model_version=builder.MODEL_VERSION,
                     input_version=builder.INPUT_VERSION,
                     baseline_version="FULL62-W1",
                     response_time_s=res["response_s"],
                     objective_before=comp_before, objective_after=comp_after,
                     remark="模拟适配层生成，未连接真实外部系统")
    archive = kpi_core.DispatchArchive(os.path.join(outdir, "dispatch_archive.csv"))
    archive.record_event(modifier["event_id"], event["type"],
                         datetime.datetime.now().replace(microsecond=0).isoformat(),
                         [(c["action_type"], c["employee_id"], c["position_code"],
                           c.get("position_name", ""), "", "", c["schedule_date"],
                           SHIFT_META.get(c["shift_code"], {}).get("name", ""),
                           c["shift_code"], "", "", "", "") for c in changes_payload],
                         meta_info)
    mock_adapters.emit_all(os.path.join(outdir, "external_messages"),
                           dict(event_id=modifier["event_id"], event_type=event["type"],
                                trigger_time=datetime.datetime.now().replace(
                                    microsecond=0).isoformat()),
                           changes_payload, meta_info)
    kpi_core.schedule_kpi_report(os.path.join(outdir, "rescheduled_schedule.csv"),
                                 os.path.join(outdir, "kpi_report.md"),
                                 scenario="%s-RS" % modifier["event_id"])
    print(json.dumps(dict(
        mode="reschedule", event_id=modifier["event_id"],
        baseline_scope=baseline_scope, window=res["window"],
        termination=res["termination"], incumbent=res["incumbent"],
        response_s=res["response_s"], meet60=res["meet60"],
        e2e_seconds=round(time.perf_counter() - t_total0, 2),
        n_removed=len(res["removed"]), n_added=len(res["added"]),
        n_affected=len(res["affected"]), kpi_before=comp_before,
        kpi_after=comp_after, verification=dict(all_pass=ok, violations=totals),
        out_dir=outdir), ensure_ascii=False, indent=2))
    if res["incumbent"] is None:
        return 5
    if not ok:
        return 4
    if not res["meet60"]:
        return 6
    return 0


def cmd_kpi(args):
    import kpi_core
    os.makedirs(args.out_dir, exist_ok=True)
    kpi_core.to_place_rows(args.baseline,
                           os.path.join(args.out_dir, "kpi_place_rows.csv"))
    kpi_core.schedule_kpi_report(args.baseline,
                                 os.path.join(args.out_dir, "kpi_report.md"))
    print(json.dumps(dict(mode="kpi", baseline=args.baseline,
                          out_dir=args.out_dir), ensure_ascii=False))
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="sched_solver",
                                description="中粮可口可乐AI智慧排班求解程序包")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("info", help="加载输入并输出数据概况")
    sp.add_argument("--input", required=True, help="原始数据集xlsx路径")
    sp.set_defaults(func=cmd_info)

    sp = sub.add_parser("solve-demo", help="演示实例求解（SX-PET01线7天）")
    sp.add_argument("--input", required=True)
    sp.add_argument("--out", required=True, help="输出排班方案CSV路径")
    sp.add_argument("--time-limit", type=float, default=300.0)
    sp.add_argument("--objective-profile", choices=sorted(OBJECTIVE_PROFILES), default="balanced")
    sp.add_argument("--demand-multiplier", type=float, default=1.0)
    sp.add_argument("--scenario-name", default="PKG-DEMO")
    sp.add_argument("--minimum-coverage-rate", type=float)
    sp.set_defaults(func=cmd_solve_demo)

    sp = sub.add_parser("solve-full", help="62天整周期排班求解")
    sp.add_argument("--input", required=True)
    sp.add_argument("--out", required=True)
    sp.add_argument("--time-limit", type=float, default=600.0)
    sp.set_defaults(func=cmd_solve_full)

    sp = sub.add_parser("verify-baseline", help="独立核验排班方案（七项硬约束+KPI与登记值比对）")
    sp.add_argument("--input", required=True)
    sp.add_argument("--baseline", required=True)
    sp.set_defaults(func=cmd_verify_baseline)

    sp = sub.add_parser("reschedule", help="执行异常场景锁定式增量重排")
    sp.add_argument("--input", required=True)
    sp.add_argument("--baseline", required=True)
    sp.add_argument("--demand-override", help="继承上一排班版本保存的有效需求 JSON 文件")
    sp.add_argument("--event", required=True, help="场景事件JSON路径")
    sp.add_argument("--out-dir", required=True)
    sp.add_argument("--window-days", type=int, default=7)
    sp.add_argument("--time-limit", type=float, default=45.0)
    sp.set_defaults(func=cmd_reschedule)

    sp = sub.add_parser("kpi", help="输出KPI统计与产线处数适配输出")
    sp.add_argument("--baseline", required=True)
    sp.add_argument("--out-dir", required=True)
    sp.set_defaults(func=cmd_kpi)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
