# -*- coding: utf-8 -*-
"""输出核验程序：对运行输出做约定检查（SCHEC-PKG-V1.0）。

用法：
  python3 verification/verify_outputs.py --run-dir out --expect-demo out/demo_schedule.csv --expect-scenario out/S5

检查项：
1) 演示方案与场景重排方案文件存在且可解析（三段式格式）；
2) 演示方案七项硬约束独立核验全部通过（需求范围按演示实例自身的
   线别与日期范围过滤，与 solve-demo 的 line_filter/date_filter 口径一致）；
3) 场景 scenario_result.json 响应时间小于60秒、全期核验通过；
4) 场景输出文件齐全（重排方案、变更明细、场景级非完整班明细、
   调度归档、外部系统模拟报文与回执、KPI简报）；
5) 外部系统模拟报文含全部6个系统且标注SIMULATED；
6) 输出JSON汇总（供最终包核验报告引用）。
"""
import argparse
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG_ROOT = os.path.dirname(HERE)
SRC = os.path.join(PKG_ROOT, "src")
for p in (SRC, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

REQUIRED_SCENARIO_FILES = [
    "rescheduled_schedule.csv", "scenario_result.json",
    "reschedule_changes_detail.csv", "fractional_shift_detail.csv",
    "dispatch_archive.csv", "kpi_report.md"]
EXTERNAL_SYSTEMS = ["wecom", "sms", "attendance", "mes", "occ", "bracelet"]


def check(cond, name, detail=""):
    return dict(name=name, passed=bool(cond), detail=detail)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--expect-demo", required=True)
    ap.add_argument("--expect-scenario", required=True)
    ap.add_argument("--input", default=os.path.join(PKG_ROOT, "data", "raw_dataset.xlsx"))
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    results = []
    # 1) 演示方案核验（需求范围按演示实例线别与日期过滤，与solve-demo口径一致）
    if os.path.isfile(args.expect_demo):
        import scheduling_model_builder as builder
        from verify_core import parse_schedule_csv, verify_seven
        data = builder.load_data(args.input)
        assign, gaps, fvals = parse_schedule_csv(args.expect_demo)
        # 由演示方案文件自身推导线别与日期范围（指派段与缺口段的并集），
        # 仅对这些需求单元复算覆盖等式，避免按全期数据产生虚假违例
        demo_lines = {data["POS"][p]["line"] for (_e, p, _dt, _sc) in assign}
        demo_lines |= {data["POS"][k[0]]["line"] for k in gaps}
        demo_dates = {dt for (_e, _p, dt, _sc) in assign} | {k[1] for k in gaps}
        demo_demand = {k: v for k, v in data["demand"].items()
                       if data["POS"][k[0]]["line"] in demo_lines
                       and k[1] in demo_dates}
        ok, totals, fails = verify_seven(assign, gaps, fvals, data, demo_demand)
        results.append(check(bool(ok and demo_demand), "demo_seven_constraints",
                             "演示需求单元=%d 线别=%s 日期范围=%s~%s 违例计数=%s 样例=%s"
                             % (len(demo_demand), sorted(demo_lines),
                                min(demo_dates) if demo_dates else "-",
                                max(demo_dates) if demo_dates else "-",
                                totals, fails[:5])))
        results.append(check(len(assign) > 0, "demo_has_assignments",
                             "指派数=%d" % len(assign)))
    else:
        results.append(check(False, "demo_file_exists", args.expect_demo))

    # 2) 场景输出核验
    sdir = args.expect_scenario
    missing = [f for f in REQUIRED_SCENARIO_FILES
               if not os.path.isfile(os.path.join(sdir, f))]
    results.append(check(not missing, "scenario_files_complete",
                         "缺失=%s" % missing if missing else "全部存在"))
    sr = os.path.join(sdir, "scenario_result.json")
    if os.path.isfile(sr):
        with open(sr, "r", encoding="utf-8") as f:
            rj = json.load(f)
        results.append(check(rj.get("meet60") is True, "scenario_response_under_60s",
                             "response_s=%s" % rj.get("response_s")))
        v = rj.get("verification", {})
        results.append(check(v.get("all_pass") is True, "scenario_verification_pass",
                             "违例=%s" % v.get("violations")))
        term_str = str(rj.get("termination") or "")
        results.append(check(("optimal" in term_str.lower()) or ("feasible" in term_str.lower()),
                             "scenario_solver_status", term_str))
        # 变更明细行数与场景统计一致
        with open(os.path.join(sdir, "reschedule_changes_detail.csv"),
                  "r", encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        n_cancel = sum(1 for r in rows[1:] if r and r[0] == "取消指派")
        n_add = sum(1 for r in rows[1:] if r and r[0] == "新增指派")
        results.append(check(
            n_cancel == rj.get("n_removed") and n_add == rj.get("n_added"),
            "scenario_change_rows_match",
            "取消%d/%d 新增%d/%d" % (n_cancel, rj.get("n_removed"),
                                      n_add, rj.get("n_added"))))
    else:
        results.append(check(False, "scenario_result_json", sr))

    # 3) 外部系统模拟报文
    msg_dir = os.path.join(sdir, "external_messages")
    missing_msg = []
    simulated_ok = True
    for s in EXTERNAL_SYSTEMS:
        pj = os.path.join(msg_dir, "%s_push.json" % s)
        rj_file = os.path.join(msg_dir, "%s_receipt.json" % s)
        if not (os.path.isfile(pj) and os.path.isfile(rj_file)):
            missing_msg.append(s)
            continue
        with open(pj, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if s in ("wecom", "sms", "bracelet"):
            simulated_ok = simulated_ok and payload.get("push_status") == "SIMULATED_SENT"
    results.append(check(not missing_msg, "external_messages_complete",
                         "缺失=%s" % missing_msg if missing_msg else "6系统报文与回执齐全"))
    results.append(check(simulated_ok, "external_messages_simulated",
                         "推送状态均为SIMULATED_SENT"))

    summary = dict(all_passed=all(r["passed"] for r in results),
                   checks=results,
                   run_dir=args.run_dir, demo=args.expect_demo,
                   scenario=args.expect_scenario)
    out = args.out or os.path.join(args.run_dir, "verify_outputs_result.json")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["all_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())