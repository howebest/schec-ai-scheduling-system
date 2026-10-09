#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate reproducible, explicitly synthetic dashboard and analysis data."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path


SEED = 20260930
GENERATOR_VERSION = "1.0.0"
DATASET_VERSION = "synthetic-demo-20260930-v1"
SOURCE_TYPE = "synthetic_demo"
ORDERS_COLUMNS = ["order_id", "line_code", "product_code", "required_units", "due_at", "priority"]
CAPACITY_COLUMNS = ["line_code", "product_code", "units_per_hour", "efficiency_pct", "available_hours", "shift_code"]
ATTENDANCE_COLUMNS = ["employee_id", "schedule_date", "shift_code", "status", "source_type"]
LINES = ["SX-PET01", "SX-QC", "SX-CAN01", "HB-PET01"]
PRODUCTS = ["PET-500", "QC-330", "CAN-330", "PET-1500"]
SHIFTS = ["D12", "N12", "D8"]


def _write_csv(path: Path, columns: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _rows(seed: int) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    rng = random.Random(seed)
    orders = []
    first_day = date(2026, 10, 1)
    for index in range(48):
        line = LINES[index % len(LINES)]
        product = PRODUCTS[(index + index // len(LINES)) % len(PRODUCTS)]
        due = first_day + timedelta(days=index % 14)
        due_at = datetime.combine(due, time(16), tzinfo=timezone(timedelta(hours=8)))
        orders.append({
            "order_id": f"DEMO-ORD-{index + 1:04d}",
            "line_code": line,
            "product_code": product,
            "required_units": rng.randrange(12000, 56001, 1000),
            "due_at": due_at.isoformat(),
            "priority": 1 + index % 3,
        })

    capacities = []
    for line_index, line in enumerate(LINES):
        for product_index, product in enumerate(PRODUCTS):
            capacities.append({
                "line_code": line,
                "product_code": product,
                "units_per_hour": 1450 + 180 * line_index + 65 * product_index,
                "efficiency_pct": 78 + rng.randrange(0, 16),
                "available_hours": 168 if (line_index + product_index) % 3 else 336,
                "shift_code": "D12+N12" if (line_index + product_index) % 2 else "D12",
            })

    attendance = []
    for day_offset in range(14):
        schedule_date = (first_day + timedelta(days=day_offset)).isoformat()
        for employee_index in range(40):
            shift = SHIFTS[(employee_index + day_offset) % len(SHIFTS)]
            draw = rng.random()
            status = "present" if draw < 0.94 else ("absent" if draw < 0.98 else "leave")
            attendance.append({
                "employee_id": f"EMP-DEMO-{employee_index + 1:04d}",
                "schedule_date": schedule_date,
                "shift_code": shift,
                "status": status,
                "source_type": SOURCE_TYPE,
            })
    return orders, capacities, attendance


def generate_demo_data(output_dir: Path, seed: int = SEED) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    orders, capacities, attendance = _rows(seed)
    table_specs = {
        "orders.csv": (ORDERS_COLUMNS, orders, "订单交期与需求量分析；不进入当前 MIP 求解模型"),
        "line_capacity.csv": (CAPACITY_COLUMNS, capacities, "产线速度与效率敏感性分析；不进入当前 MIP 求解模型"),
        "attendance_snapshot.csv": (ATTENDANCE_COLUMNS, attendance, "本机模拟现场快照；不代表真实考勤"),
    }
    manifest_files = {}
    for filename, (columns, rows, usage) in table_specs.items():
        path = output_dir / filename
        _write_csv(path, columns, rows)
        manifest_files[filename] = {
            "source_type": SOURCE_TYPE,
            "sha256": _sha256(path),
            "row_count": len(rows),
            "columns": columns,
            "usage": usage,
        }
    manifest = {
        "schema_version": 1,
        "dataset_version": DATASET_VERSION,
        "source_type": SOURCE_TYPE,
        "generator": "scripts/generate_demo_data.py",
        "generator_version": GENERATOR_VERSION,
        "seed": seed,
        "generated_at": "2026-09-30T00:00:00+08:00",
        "units": {"time": "h", "quantity": "unit", "efficiency": "%"},
        "planning_period_days": 14,
        "files": manifest_files,
        "limitations": [
            "这些记录为固定随机种子生成的合成演示数据。",
            "订单、线速、效率和产能字段用于看板与敏感性分析，不参与现有排班 MIP 决策。",
            "员工编号为演示编号，不对应真实员工。",
        ],
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成可重复的本机合成演示数据")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "demo")
    args = parser.parse_args(argv)
    manifest = generate_demo_data(args.output_dir)
    print(json.dumps({"dataset_version": manifest["dataset_version"],
                      "source_type": manifest["source_type"],
                      "output_dir": str(args.output_dir.resolve()),
                      "files": list(manifest["files"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
