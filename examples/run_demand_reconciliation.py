# -*- coding: utf-8 -*-
"""双需求口径核对示例脚本（ISS-01）。

比较两种需求构建口径的人班合计与单元数：
- 求解口径 load_data：主数据集观测（生产运行状态众数）判定开停班；
- 参考口径 load_data_from_csv：input_04 定编 × input_07 运行计划。
用法：
  python3 examples/run_demand_reconciliation.py --input data/raw_dataset.xlsx --pos data/reference/input_04_position_requirements.csv --plan data/reference/input_07_line_run_plan.csv
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(HERE), "src")
if SRC not in sys.path:
    sys.path.insert(0, SRC)

import scheduling_model_builder as builder


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--pos", required=True)
    ap.add_argument("--plan", required=True)
    args = ap.parse_args()
    d1 = builder.load_data(args.input)
    d2 = builder.load_data_from_csv(args.input, args.pos, args.plan)
    k1 = set(d1["demand"].keys())
    k2 = set(d2["demand"].keys())
    only2 = sorted(k2 - k1)
    only1 = sorted(k1 - k2)
    diff_units = []
    for k in sorted(k1 & k2):
        if d1["demand"][k] != d2["demand"][k]:
            diff_units.append([k[0], k[1], k[2], d1["demand"][k], d2["demand"][k]])
    out = dict(
        solver_view=dict(person_shifts=sum(d1["demand"].values()), cells=len(k1)),
        reference_view=dict(person_shifts=sum(d2["demand"].values()), cells=len(k2)),
        person_shift_gap=sum(d2["demand"].values()) - sum(d1["demand"].values()),
        cells_only_in_reference=len(only2), cells_only_in_solver=len(only1),
        units_only_in_reference=[list(k) for k in only2][:50],
        value_diff_units=diff_units[:50], value_diff_count=len(diff_units))
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())