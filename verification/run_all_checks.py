# -*- coding: utf-8 -*-
"""一键自检程序：按README命令顺序实际运行全部核验命令。

用法（在解压根目录下）：
  python3 verification/run_all_checks.py --input data/raw_dataset.xlsx --baseline data/baseline_schedule_FULL62_W1.csv --out-dir out/selfcheck

依次执行：info、solve-demo、verify-baseline、reschedule S5、kpi、verify_outputs；
任一命令退出码非0即整体失败（退出码1），全部通过输出汇总JSON并退出0。
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PKG_ROOT = os.path.dirname(HERE)
PY = sys.executable


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--event", default=os.path.join(PKG_ROOT, "examples", "events", "S5-ABSENCE.json"))
    args = ap.parse_args()
    out = args.out_dir
    os.makedirs(out, exist_ok=True)
    cmds = [
        ("info", ["src/sched_solver.py", "info", "--input", args.input]),
        ("solve-demo", ["src/sched_solver.py", "solve-demo", "--input", args.input,
                        "--out", os.path.join(out, "demo_schedule.csv")]),
        ("verify-baseline", ["src/sched_solver.py", "verify-baseline", "--input", args.input,
                             "--baseline", args.baseline]),
        ("reschedule-S5", ["src/sched_solver.py", "reschedule", "--input", args.input,
                           "--baseline", args.baseline, "--event", args.event,
                           "--out-dir", os.path.join(out, "S5")]),
        ("kpi", ["src/sched_solver.py", "kpi", "--baseline", args.baseline,
                 "--out-dir", os.path.join(out, "kpi")]),
        ("verify-outputs", ["verification/verify_outputs.py", "--run-dir", out,
                            "--expect-demo", os.path.join(out, "demo_schedule.csv"),
                            "--expect-scenario", os.path.join(out, "S5")]),
    ]
    results = []
    for name, c in cmds:
        p = subprocess.run([PY] + c, cwd=PKG_ROOT, capture_output=True, text=True)
        results.append(dict(name=name, cmd="python3 " + " ".join(c),
                            returncode=p.returncode,
                            stdout_head=p.stdout[:800], stderr_head=p.stderr[:300]))
        print("[%s] 退出码=%d" % (name, p.returncode), flush=True)
        if p.returncode != 0:
            print(p.stdout[-1500:])
            print(p.stderr[:800])
            break
    summary = dict(all_passed=all(r["returncode"] == 0 for r in results)
                   and len(results) == len(cmds), results=results)
    spath = os.path.join(out, "selfcheck_summary.json")
    with open(spath, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(json.dumps(dict(all_passed=summary["all_passed"],
                          commands=[r["name"] for r in results],
                          summary_file=spath), ensure_ascii=False))
    return 0 if summary["all_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())