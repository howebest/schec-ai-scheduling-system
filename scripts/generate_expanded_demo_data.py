#!/usr/bin/env python3
"""Build a deterministic, linked synthetic data pack for local scheduling comparisons."""

from __future__ import annotations

import csv
import hashlib
import json
import math
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "demo" / "expanded"
DATASET_ID = "synthetic-demo-expanded-20261008-v1"
START = date(2026, 10, 1)
HORIZON_DAYS = 14
SOURCE_TYPE = "synthetic_demo"
SEED = 20261008

LINES = [
    {"line_id": "PET-01", "name": "PET-01", "line_type": "soda", "factory_code": "HB", "factory_name": "河北厂"},
    {"line_id": "PET-02", "name": "PET-02", "line_type": "soda", "factory_code": "HB", "factory_name": "河北厂"},
    {"line_id": "PET-03", "name": "PET-03", "line_type": "soda", "factory_code": "HB", "factory_name": "河北厂"},
    {"line_id": "ASEPTIC-A", "name": "无菌线-A", "line_type": "aseptic", "factory_code": "SX", "factory_name": "陕西厂"},
    {"line_id": "ASEPTIC-B", "name": "无菌线-B", "line_type": "aseptic", "factory_code": "SX", "factory_name": "陕西厂"},
    {"line_id": "ASEPTIC-C", "name": "无菌线-C", "line_type": "aseptic", "factory_code": "SX", "factory_name": "陕西厂"},
]

INITIAL_NAMES = [
    "王晨曦", "李明轩", "张语桐", "刘昱辰", "陈思远", "杨可欣", "赵一鸣", "黄梓涵", "周雨桐", "吴嘉言", "徐子墨", "孙清妍",
    "胡宇航", "朱若琳", "高逸凡", "林婉清", "何承泽", "郭欣妍", "马嘉树", "罗心怡", "梁景行", "宋知夏", "郑博文", "谢安琪",
    "韩沐阳", "唐依诺", "冯睿哲", "于佳宁", "董子谦", "萧雨晴", "程嘉树", "曹语彤", "袁景澄", "邓书瑶", "许皓然", "沈清禾",
]
SURNAMES = ["王", "李", "张", "刘", "陈", "杨", "赵", "黄", "周", "吴", "徐", "孙"]
GIVEN_NAMES = ["志强", "建华", "明远", "燕玲", "晓峰", "佳怡", "浩然", "雨欣"]

POSITIONS = [
    {"position_id": "POS-FILL", "name": "灌注机岗", "category": "生产操作"},
    {"position_id": "POS-BLOW", "name": "吹贴机岗", "category": "生产操作"},
    {"position_id": "POS-ASEPTIC", "name": "无菌操作岗", "category": "生产操作"},
    {"position_id": "POS-PALLET", "name": "码垛机岗", "category": "包装操作"},
    {"position_id": "POS-PACK", "name": "塑包机岗", "category": "包装操作"},
    {"position_id": "POS-QUALITY", "name": "质量抽检岗", "category": "质量管理"},
    {"position_id": "POS-CHANGEOVER", "name": "换型操作岗", "category": "生产支持"},
    {"position_id": "POS-LOGISTICS", "name": "物料配送岗", "category": "生产支持"},
]
SKILLS = [
    {"code": "SKILL-CORE", "name": "核心设备操作", "category": "设备操作", "description": "按员工主岗位记录核心设备操作能力评分。"},
    {"code": "SKILL-SAFETY", "name": "安全规程", "category": "安全与合规", "description": "按统一评分口径记录安全规程执行能力。"},
    {"code": "SKILL-QUALITY", "name": "质量抽检", "category": "质量管理", "description": "记录抽样、外观和质量异常处置能力。"},
    {"code": "SKILL-CHANGEOVER", "name": "产品换型", "category": "生产支持", "description": "记录换型准备、操作和复位能力。"},
    {"code": "SKILL-CIP", "name": "清洗消毒", "category": "食品安全", "description": "记录清洗消毒作业能力；不代表证书核验。"},
    {"code": "SKILL-MAINTENANCE", "name": "设备点检", "category": "设备维护", "description": "记录日常点检和异常上报能力。"},
    {"code": "SKILL-5S", "name": "现场整理", "category": "现场管理", "description": "记录现场整理、清洁和交接能力。"},
    {"code": "SKILL-HANDOVER", "name": "班次交接", "category": "协同管理", "description": "记录班前、班后信息交接能力。"},
    {"code": "SKILL-PACKAGING", "name": "包装作业", "category": "包装操作", "description": "记录包装设备与包装物料作业能力。"},
    {"code": "SKILL-AUTOMATION", "name": "自动化设备操作", "category": "设备操作", "description": "记录自动化设备人机操作能力。"},
    {"code": "SKILL-MATERIAL", "name": "物料配送", "category": "生产支持", "description": "记录生产物料配送与批次核对能力。"},
    {"code": "SKILL-EMERGENCY", "name": "异常应急处置", "category": "安全与合规", "description": "记录异常识别、报告和初步处置能力。"},
]

SCENARIOS = [
    {"code": "SC01", "name": "均衡基准", "family": "常规生产", "strategy": "覆盖与工时均衡", "comparison_group": "baseline-demand", "coverage": 0.96, "distribution": "balanced", "overtime": "low", "satisfaction": 4.0, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "作为其他方案的共同需求基准。"},
    {"code": "SC02", "name": "成本优先", "family": "成本控制", "strategy": "降低排班人班", "comparison_group": "baseline-demand", "coverage": 0.82, "distribution": "concentrated", "overtime": "none", "satisfaction": 3.2, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "减少已覆盖人班以降低模拟人工成本，同时保留较多需求缺口。"},
    {"code": "SC03", "name": "覆盖优先", "family": "产能保障", "strategy": "最大化需求覆盖", "comparison_group": "baseline-demand", "coverage": 1.0, "distribution": "balanced", "overtime": "moderate", "satisfaction": 3.8, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "优先覆盖全部基准需求，允许产生较高工时投入。"},
    {"code": "SC04", "name": "公平优先", "family": "员工公平", "strategy": "均衡员工工作量", "comparison_group": "baseline-demand", "coverage": 0.95, "distribution": "fair", "overtime": "none", "satisfaction": 4.6, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "优先降低员工工时差异，覆盖水平略低于全覆盖方案。"},
    {"code": "SC05", "name": "技能优先", "family": "技能匹配", "strategy": "优先安排技能得分较高人员", "comparison_group": "baseline-demand", "coverage": 0.94, "distribution": "skill", "overtime": "low", "satisfaction": 4.1, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "突出岗位技能匹配，观察成本、覆盖和人员公平性的变化。"},
    {"code": "SC06", "name": "低加班", "family": "工时风险", "strategy": "控制加班投入", "comparison_group": "baseline-demand", "coverage": 0.91, "distribution": "fair", "overtime": "none", "satisfaction": 4.3, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "不安排加班，使用需求缺口反映可用工时不足。"},
    {"code": "SC07", "name": "夜班保障", "family": "班次保障", "strategy": "夜班资格优先", "comparison_group": "baseline-demand", "coverage": 0.98, "distribution": "night-qualified", "overtime": "high", "satisfaction": 3.7, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "优先使用夜班资格人员，高工时压力作为风险对照。"},
    {"code": "SC08", "name": "突发缺勤", "family": "异常应急", "strategy": "可用人员减少", "comparison_group": "baseline-demand", "coverage": 0.84, "distribution": "concentrated", "overtime": "high", "satisfaction": 2.9, "event": "每条线减少 3 名可用员工", "absence_per_line": 3, "demand_multiplier": 1.0, "notes": "每条线固定排除 3 名员工，展示缺勤对覆盖、加班和满意度的影响。"},
    {"code": "SC09", "name": "换型应急", "family": "生产切换", "strategy": "换型技能优先", "comparison_group": "baseline-demand", "coverage": 0.90, "distribution": "changeover", "overtime": "moderate", "satisfaction": 3.6, "event": "换型作业增多", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "优先安排掌握产品换型技能的员工，保留部分普通岗位缺口。"},
    {"code": "SC10", "name": "多技能补位", "family": "跨岗协同", "strategy": "多技能人员补位", "comparison_group": "baseline-demand", "coverage": 0.97, "distribution": "multiskill", "overtime": "low", "satisfaction": 4.4, "event": "稳定需求", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "使用具备多岗位资格的员工补充关键和支持岗位。"},
    {"code": "SC11", "name": "旺季增产", "family": "需求变化", "strategy": "需求增加 15%", "comparison_group": "peak-demand", "coverage": 0.91, "distribution": "balanced", "overtime": "high", "satisfaction": 3.5, "event": "基准需求增加 15%", "absence_per_line": 0, "demand_multiplier": 1.15, "notes": "与基准需求方案的绝对指标不可直接等量比较；按覆盖率、单位覆盖成本和风险进行分析。"},
    {"code": "SC12", "name": "备用产能", "family": "产能韧性", "strategy": "保留人员储备并控制缺口", "comparison_group": "baseline-demand", "coverage": 0.93, "distribution": "multiskill", "overtime": "moderate", "satisfaction": 4.0, "event": "可用人员储备", "absence_per_line": 0, "demand_multiplier": 1.0, "notes": "比较保留机动人员和加班投入对覆盖与成本的影响。"},
]

SHIFTS = [("DAY", "白班"), ("NIGHT", "夜班")]
KEY_POSITIONS = {"POS-FILL", "POS-ASEPTIC", "POS-QUALITY"}


def write_csv(path: Path, columns: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def stable_int(*parts: object) -> int:
    digest = hashlib.sha256("|".join(map(str, parts)).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def skill_score(person_index: int, skill_code: str) -> float:
    return float(58 + stable_int(SEED, person_index, skill_code) % 43)


def build_catalog() -> tuple[dict[str, object], list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    positions_by_id = {item["position_id"]: item for item in POSITIONS}
    line_by_id = {item["line_id"]: item for item in LINES}
    added_positions = POSITIONS[5:]
    added_teams: list[dict[str, object]] = []
    added_employees: list[dict[str, object]] = []
    all_employees: list[dict[str, object]] = []
    all_teams: list[dict[str, object]] = []
    all_employee_skills: list[dict[str, object]] = []
    added_qualifications: list[dict[str, object]] = []

    line_positions: dict[str, list[str]] = {}
    for line in LINES:
        if line["line_type"] == "soda":
            primary = "POS-FILL"
            secondary = "POS-BLOW"
            roles = [primary, secondary, "POS-QUALITY", "POS-CHANGEOVER"]
            old_roles = [primary, secondary]
        else:
            primary = "POS-ASEPTIC"
            secondary = "POS-PACK"
            roles = [primary, secondary, "POS-QUALITY", "POS-LOGISTICS"]
            old_roles = [primary, secondary]
        line_positions[line["line_id"]] = roles
        for slot in range(1, 4):
            team_id = f"DEMO-TEAM-{line['line_id']}-{slot}"
            team_name = f"{line['name']} {'甲班' if slot == 1 else '乙班' if slot == 2 else '丙班'}"
            all_teams.append({"team_id": team_id, "name": team_name, "team_category": "轮转生产班组", "line_id": line["line_id"], "factory_code": line["factory_code"], "primary_position_id": primary, "source_type": SOURCE_TYPE})
            for worker in range(1, 3):
                global_index = LINES.index(line) * 6 + (slot - 1) * 2 + worker - 1
                emp_id = f"DEMO-EMP-{line['line_id']}-{slot}-{worker}"
                role = old_roles[worker - 1]
                old_name = INITIAL_NAMES[global_index]
                skills = [
                    {"skill_code": "SKILL-CORE", "skill_name": "核心设备操作", "skill_score": 68.0 + ((slot * 2 + worker) * 5)},
                    {"skill_code": "SKILL-SAFETY", "skill_name": "安全规程", "skill_score": min(100.0, 74.0 + ((slot * 2 + worker) * 5))},
                ]
                person = {"employee_id": emp_id, "name": old_name, "team_id": team_id, "position_id": role, "line_id": line["line_id"], "factory_code": line["factory_code"], "factory_name": line["factory_name"], "collaboration_score": float(72 + ((slot + worker) * 4)), "seniority_years": 4 + global_index % 10, "night_eligible": True, "source_type": SOURCE_TYPE, "skills": skills}
                all_employees.append(person)
                all_employee_skills.extend({"employee_id": emp_id, **item, "source_type": SOURCE_TYPE} for item in skills)

        suffixes = ["增援班组", "技能协同班组", "夜班保障班组", "机动替班班组"]
        for team_slot, suffix in enumerate(suffixes, start=1):
            team_id = f"DEMO-TEAM-{line['line_id']}-X{team_slot:02d}"
            team = {"team_id": team_id, "name": f"{line['name']} {suffix}", "team_category": suffix, "line_id": line["line_id"], "factory_code": line["factory_code"], "primary_position_id": primary, "description": "本机合成扩充班组；成员、技能和资格均由固定规则生成。", "source_type": SOURCE_TYPE}
            added_teams.append(team)
            all_teams.append(team)
            for member_slot, role in enumerate(roles, start=1):
                index = LINES.index(line) * 16 + (team_slot - 1) * 4 + member_slot - 1
                employee_id = f"DEMO-XEMP-{line['line_id']}-X{team_slot:02d}-{member_slot:02d}"
                name = SURNAMES[index // len(GIVEN_NAMES)] + GIVEN_NAMES[index % len(GIVEN_NAMES)]
                role_skill = {
                    "POS-FILL": "SKILL-CORE", "POS-BLOW": "SKILL-CORE", "POS-ASEPTIC": "SKILL-CIP",
                    "POS-PACK": "SKILL-PACKAGING", "POS-QUALITY": "SKILL-QUALITY", "POS-CHANGEOVER": "SKILL-CHANGEOVER",
                    "POS-LOGISTICS": "SKILL-MATERIAL", "POS-PALLET": "SKILL-AUTOMATION",
                }[role]
                skill_codes = ["SKILL-CORE", "SKILL-SAFETY", role_skill]
                if member_slot % 2 == 0:
                    skill_codes.append("SKILL-HANDOVER")
                if (team_slot + member_slot) % 2 == 0:
                    skill_codes.append("SKILL-5S")
                if team_slot in (2, 4) or member_slot == 3:
                    skill_codes.append("SKILL-MAINTENANCE")
                if line["line_type"] == "aseptic" and member_slot in (1, 3):
                    skill_codes.append("SKILL-CIP")
                if role != "POS-QUALITY" and team_slot == 2:
                    skill_codes.append("SKILL-QUALITY")
                if team_slot == 3 and member_slot in (2, 4):
                    skill_codes.append("SKILL-AUTOMATION")
                if team_slot == 4 and member_slot in (1, 3):
                    skill_codes.append("SKILL-EMERGENCY")
                # Keep each employee's code set unique and use the same catalog name in every row.
                skill_codes = list(dict.fromkeys(skill_codes))
                skills = []
                for code in skill_codes:
                    catalog = next(item for item in SKILLS if item["code"] == code)
                    skills.append({"skill_code": code, "skill_name": catalog["name"], "skill_score": skill_score(index, code)})
                cross_positions = [role]
                if "SKILL-CHANGEOVER" in skill_codes:
                    cross_positions.append("POS-CHANGEOVER")
                if "SKILL-QUALITY" in skill_codes and role != "POS-QUALITY":
                    cross_positions.append("POS-QUALITY")
                person = {
                    "employee_id": employee_id, "name": name, "team_id": team_id, "position_id": role,
                    "line_id": line["line_id"], "factory_code": line["factory_code"], "factory_name": line["factory_name"],
                    "collaboration_score": float(58 + stable_int(index, "collaboration") % 43),
                    "seniority_years": 1 + stable_int(index, "seniority") % 15,
                    "night_eligible": (index + team_slot) % 5 != 0,
                    "source_type": SOURCE_TYPE,
                    "skills": skills,
                    "qualification_position_ids": list(dict.fromkeys(cross_positions)),
                }
                added_employees.append(person)
                all_employees.append(person)
                all_employee_skills.extend({"employee_id": employee_id, **item, "source_type": SOURCE_TYPE} for item in skills)
                for position_id in person["qualification_position_ids"]:
                    added_qualifications.append({
                        "qualification_id": f"DEMO-QUAL-{employee_id}-{position_id}",
                        "object_type": "employee", "object_id": employee_id, "position_id": position_id,
                        "line_id": line["line_id"], "description": "由合成演示技能关系生成；不代表外部证书核验。",
                    })
            added_qualifications.append({
                "qualification_id": f"DEMO-QUAL-{team_id}", "object_type": "team", "object_id": team_id,
                "position_id": primary, "line_id": line["line_id"], "description": "本机合成演示班组岗位资格关系。",
            })

    catalog = {
        "schema_version": 1,
        "dataset_id": DATASET_ID,
        "seed_version": 4,
        "source_type": SOURCE_TYPE,
        "positions": POSITIONS,
        "skills": SKILLS,
        "team_catalog": all_teams,
        "teams": added_teams,
        "employees": added_employees,
        "qualifications": added_qualifications,
        "config_targets": [
            {"config_id": f"DEMO-CONFIG-{team['line_id']}", "object_type": "team", "object_id": team["team_id"], "offset_days": 3 + index % 4}
            for line in LINES
            for index, team in enumerate([team for team in added_teams if team["line_id"] == line["line_id"]])
        ],
    }
    # Expand the flat employee qualification export to include existing seed records too.
    for person in all_employees[:36]:
        role_catalog = POSITIONS[[item["position_id"] for item in POSITIONS].index(person["position_id"])]
        line = line_by_id[person["line_id"]]
        added_qualifications.extend([])
        person["position_name"] = role_catalog["name"]
        person["line_name"] = line["name"]
        person["employment_status"] = "在岗"
    for person in all_employees[36:]:
        person["position_name"] = positions_by_id[person["position_id"]]["name"]
        person["line_name"] = line_by_id[person["line_id"]]["name"]
        person["employment_status"] = "在岗"
    for team in all_teams:
        team["line_name"] = line_by_id[team["line_id"]]["name"]
    return catalog, all_employees, all_teams, all_employee_skills


def plan_demands(plan: dict[str, object]) -> list[dict[str, object]]:
    demand: list[dict[str, object]] = []
    for day_index in range(HORIZON_DAYS):
        work_date = (START + timedelta(days=day_index)).isoformat()
        for line in LINES:
            positions = ["POS-FILL", "POS-BLOW", "POS-PACK", "POS-QUALITY"] if line["line_type"] == "soda" else ["POS-ASEPTIC", "POS-PACK", "POS-QUALITY", "POS-LOGISTICS"]
            for shift_code, shift_name in SHIFTS:
                for position_id in positions:
                    demand.append({"date": work_date, "day_index": day_index, "line": line, "shift_code": shift_code, "shift_name": shift_name, "position_id": position_id, "key": position_id in KEY_POSITIONS})
    target = round(len(demand) * float(plan["demand_multiplier"]))
    extra = target - len(demand)
    for extra_index in range(extra):
        base = demand[stable_int(plan["code"], "peak", extra_index) % len(demand)]
        demand.append({**base, "key": base["key"], "extra_demand": True})
    return demand


def employee_can_work(person: dict[str, object], day_index: int, shift_code: str, plan: dict[str, object], worked_by_day: dict[str, set[str]], assignments_by_employee: dict[str, list[dict[str, object]]]) -> bool:
    if person["employee_id"] in worked_by_day.setdefault(str(day_index), set()):
        return False
    if plan["absence_per_line"] and person.get("absence_group"):
        if int(person["absence_group"]) <= int(plan["absence_per_line"]):
            return False
    if shift_code == "NIGHT" and plan["distribution"] == "night-qualified" and not person["night_eligible"]:
        return False
    if shift_code == "NIGHT" and not person["night_eligible"] and plan["distribution"] in ("balanced", "fair", "skill", "multiskill"):
        return False
    history = assignments_by_employee[person["employee_id"]]
    if plan["distribution"] != "concentrated" and plan["overtime"] != "high":
        if history and history[-1]["shift_code"] == "NIGHT" and shift_code == "DAY" and history[-1]["day_index"] == day_index - 1:
            return False
        recent = {item["day_index"] for item in history if day_index - 6 <= item["day_index"] < day_index}
        if len(recent) >= 6:
            return False
    return True


def assignment_overtime(plan: dict[str, object], assignment_index: int, shift_code: str, employee_load: int) -> float:
    profile = plan["overtime"]
    if profile == "none":
        return 0.0
    if profile == "low":
        return 1.0 if stable_int(plan["code"], assignment_index) % 7 == 0 else 0.0
    if profile == "moderate":
        return 1.5 if stable_int(plan["code"], assignment_index) % 3 == 0 else 0.0
    if profile == "high":
        if plan["code"] in ("SC08",) and employee_load < 12:
            return 4.0
        return 3.0 if shift_code == "NIGHT" or stable_int(plan["code"], assignment_index) % 2 == 0 else 2.0
    return 0.0


def build_schedule(plan: dict[str, object], employees: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
    people_by_line: dict[str, list[dict[str, object]]] = defaultdict(list)
    by_id = {}
    for person in employees:
        people_by_line[str(person["line_id"])].append(person)
        by_id[str(person["employee_id"])] = person
    for line_id, people in people_by_line.items():
        for person in people:
            team_suffix = person["team_id"].rsplit("X", 1)[-1] if "-X" in str(person["team_id"]) else "0"
            person["absence_group"] = int(team_suffix) if str(team_suffix).isdigit() else 0
    demands = plan_demands(plan)
    target_assignments = round(len(demands) * float(plan["coverage"]))

    def demand_priority(item: dict[str, object]) -> tuple[int, int, int]:
        if plan["code"] in ("SC02", "SC06"):
            return (0 if item["key"] else 1, stable_int(plan["code"], item["date"], item["line"]["line_id"], item["shift_code"], item["position_id"]), 0)
        if plan["code"] == "SC09":
            return (0 if item["position_id"] == "POS-CHANGEOVER" else 1, stable_int(plan["code"], item["date"], item["line"]["line_id"], item["shift_code"], item["position_id"]), 0)
        return (0, stable_int(plan["code"], item["date"], item["line"]["line_id"], item["shift_code"], item["position_id"], item.get("extra_demand", False)), 0)

    selected = sorted(demands, key=demand_priority)[:target_assignments]
    selected.sort(key=lambda item: (item["date"], 0 if item["shift_code"] == "DAY" else 1, item["line"]["line_id"], item["position_id"], stable_int(plan["code"], item["date"], item["line"]["line_id"], item["shift_code"], item["position_id"])))
    worked_by_day: dict[str, set[str]] = defaultdict(set)
    assignments_by_employee: dict[str, list[dict[str, object]]] = defaultdict(list)
    assignment_rows: list[dict[str, object]] = []
    assigned_keys: Counter[tuple[str, str, str, str]] = Counter()
    for assignment_index, demand_item in enumerate(selected):
        line_id = str(demand_item["line"]["line_id"])
        candidates = people_by_line[line_id]
        role = str(demand_item["position_id"])
        shift = str(demand_item["shift_code"])

        def candidate_priority(person: dict[str, object]) -> tuple[float, int, str]:
            if not employee_can_work(person, int((date.fromisoformat(str(demand_item["date"])) - START).days), shift, plan, worked_by_day, assignments_by_employee):
                return (1e9, stable_int(person["employee_id"], assignment_index), str(person["employee_id"]))
            score = {item["skill_code"]: float(item["skill_score"]) for item in person["skills"]}.get("SKILL-CORE", 50.0)
            role_fit = 1 if role in person.get("qualification_position_ids", [person["position_id"]]) else 0
            load = len(assignments_by_employee[person["employee_id"]])
            if plan["distribution"] == "fair":
                rank = load * 1_000 - score * 0.1
            elif plan["distribution"] == "skill":
                rank = -score * 10 - role_fit * 500 + load
            elif plan["distribution"] == "night-qualified":
                rank = -role_fit * 500 + (0 if person["night_eligible"] else 1_000) + load
            elif plan["distribution"] == "changeover":
                skills = {item["skill_code"] for item in person["skills"]}
                rank = (0 if "SKILL-CHANGEOVER" in skills else 1_000) - score + load
            elif plan["distribution"] == "multiskill":
                rank = -len(person["skills"]) * 100 - role_fit * 100 + load
            elif plan["distribution"] == "concentrated":
                rank = -load * 1_000 + stable_int(plan["code"], person["employee_id"] ) % 500
            else:
                rank = load * 8 + stable_int(plan["code"], person["employee_id"], assignment_index) % 7
            if shift == "NIGHT" and not person["night_eligible"] and plan["overtime"] == "high":
                rank -= 500
            return (rank, stable_int(plan["code"], person["employee_id"], assignment_index), str(person["employee_id"]))

        eligible = sorted(candidates, key=candidate_priority)
        chosen = next((person for person in eligible if candidate_priority(person)[0] < 1e8), None)
        if chosen is None:
            # Demand without an available person is emitted as an explicit gap below.
            continue
        day_index = (date.fromisoformat(str(demand_item["date"])) - START).days
        employee_id = str(chosen["employee_id"])
        worked_by_day[str(day_index)].add(employee_id)
        overtime = assignment_overtime(plan, assignment_index, shift, len(assignments_by_employee[employee_id]))
        assignments_by_employee[employee_id].append({"day_index": day_index, "date": demand_item["date"], "shift_code": shift, "overtime": overtime})
        line = demand_item["line"]
        position = next(item for item in POSITIONS if item["position_id"] == role)
        assignment_rows.append({
            "工厂代码": line["factory_code"], "产线编码": line_id, "日期": demand_item["date"], "班次": demand_item["shift_name"], "班次代码": shift,
            "员工工号": employee_id, "岗位编码": role, "岗位名称": position["name"], "是否关键岗": "是" if role in KEY_POSITIONS else "否",
            "技能等级": 1 + int(stable_int(chosen["employee_id"], role) % 5), "计薪工时(h)": 8 + overtime,
            "标准工时(h)": 8, "当日加班工时(h)": overtime, "该班次换型等级": "高" if plan["code"] == "SC09" and demand_item["date"].endswith(("04", "08", "12")) else "常规",
            "实验编号": plan["code"],
        })
        assigned_keys[(line_id, str(demand_item["date"]), shift, role)] += 1

    demand_by_key: Counter[tuple[str, str, str, str]] = Counter()
    demand_metadata: dict[tuple[str, str, str, str], tuple[dict[str, object], dict[str, object]]] = {}
    for item in demands:
        key = (str(item["line"]["line_id"]), str(item["date"]), str(item["shift_code"]), str(item["position_id"]))
        demand_by_key[key] += 1
        demand_metadata[key] = (item["line"], item)
    gaps = []
    for key, demand_count in sorted(demand_by_key.items()):
        missing = demand_count - assigned_keys[key]
        if missing <= 0:
            continue
        line_id, work_date, shift_code, position_id = key
        line, item = demand_metadata[key]
        position = next(value for value in POSITIONS if value["position_id"] == position_id)
        gaps.append({
            "岗位编码": position_id, "岗位名称": position["name"], "产线编码": line_id, "日期": work_date,
            "班次": "白班" if shift_code == "DAY" else "夜班", "缺口人班": missing,
        })

    workdays: dict[str, set[int]] = defaultdict(set)
    monthly_overtime: dict[tuple[str, str], float] = defaultdict(float)
    daily_overtime: dict[tuple[str, str], float] = defaultdict(float)
    night_qualification_violations = 0
    for row in assignment_rows:
        employee_id = str(row["员工工号"])
        day_index = (date.fromisoformat(str(row["日期"])) - START).days
        workdays[employee_id].add(day_index)
        monthly_overtime[(employee_id, str(row["日期"])[:7])] += float(row["当日加班工时(h)"])
        daily_overtime[(employee_id, str(row["日期"]))] += float(row["当日加班工时(h)"])
        person = by_id[employee_id]
        if row["班次代码"] == "NIGHT" and not person["night_eligible"]:
            night_qualification_violations += 1

    rest_violations = 0
    for days in workdays.values():
        for start_day in range(max(0, HORIZON_DAYS - 6)):
            if all(day in days for day in range(start_day, start_day + 7)):
                rest_violations += 1
    monthly_violations = sum(value > 36 for value in monthly_overtime.values())
    daily_violations = sum(value > 3 for value in daily_overtime.values())
    transitions: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for row in assignment_rows:
        transitions[str(row["员工工号"])].append(((date.fromisoformat(str(row["日期"])) - START).days, str(row["班次代码"])))
    interval_violations = sum(
        1 for entries in transitions.values()
        for (day_a, shift_a), (day_b, shift_b) in zip(sorted(entries), sorted(entries)[1:])
        if day_b == day_a + 1 and shift_a == "NIGHT" and shift_b == "DAY"
    )
    violations = {
        "qual_night": night_qualification_violations,
        "one_per_day": 0,
        "interval_11h": interval_violations,
        "rest_7d": rest_violations,
        "month_ot_36h": monthly_violations,
        "daily_hours": daily_violations,
        "coverage_eq": 0,
    }
    total_violations = sum(violations.values())
    all_pass = None  # Data are scenario simulations and have not gone through independent validation.
    feedback_employees = sorted({str(row["员工工号"]) for row in assignment_rows}, key=lambda value: stable_int(plan["code"], value))[:30]
    feedback = [
        {"employee_id": employee_id, "satisfaction_score": int(max(1, min(5, round(float(plan["satisfaction"]) + ((stable_int(plan["code"], employee_id, "score") % 3) - 1) * 0.45))))}
        for employee_id in feedback_employees
    ]
    return assignment_rows, gaps, {
        "violations": violations,
        "violation_count": total_violations,
        "all_pass": all_pass,
        "verification_state": "场景规则模拟评估；未执行独立核验",
        "feedback_samples": feedback,
        "workdays": workdays,
        "monthly_overtime": monthly_overtime,
        "daily_overtime": daily_overtime,
    }


def gini(values: list[float]) -> float | None:
    values = sorted(values)
    if not values or sum(values) == 0:
        return None
    n = len(values)
    return sum((2 * index - n - 1) * value for index, value in enumerate(values, start=1)) / (n * sum(values))


def plan_metrics(assignments: list[dict[str, object]], gaps: list[dict[str, object]], feedback: list[dict[str, object]]) -> dict[str, object]:
    paid_hours = sum(float(row["计薪工时(h)"]) for row in assignments)
    standard_hours = sum(float(row["标准工时(h)"]) for row in assignments)
    overtime_hours = sum(float(row["当日加班工时(h)"]) for row in assignments)
    covered = float(len(assignments))
    gap_count = sum(float(row["缺口人班"]) for row in gaps)
    demand = covered + gap_count
    hours_by_employee: dict[str, float] = defaultdict(float)
    dates = {str(row["日期"]) for row in assignments} | {str(row["日期"]) for row in gaps}
    for row in assignments:
        hours_by_employee[str(row["员工工号"])] += float(row["计薪工时(h)"])
    # The client metric uses the employees receiving assignments and calendar dates present in the artifact.
    capacity = len(hours_by_employee) * len(dates) * 8
    cost = max(0.0, paid_hours - overtime_hours) * 35 + overtime_hours * 35 * 1.5
    cell_rates: dict[tuple[str, str, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for row in assignments:
        cell_rates[(str(row["产线编码"]), str(row["日期"]), str(row["班次"]))][0] += 1
    for row in gaps:
        cell_rates[(str(row["产线编码"]), str(row["日期"]), str(row["班次"]))][1] += float(row["缺口人班"])
    rates = [assigned / (assigned + missing) * 100 for assigned, missing in cell_rates.values() if assigned + missing > 0]
    mean = sum(rates) / len(rates) if rates else None
    stddev = math.sqrt(sum((value - mean) ** 2 for value in rates) / len(rates)) if rates and mean is not None else None
    score = max(0.0, 100 - stddev / mean * 100) if mean else None
    scores = [int(item["satisfaction_score"]) for item in feedback]
    return {
        "demand_person_shifts": round(demand, 2), "covered_person_shifts": round(covered, 2), "gap_person_shifts": round(gap_count, 2),
        "coverage_rate_pct": round(covered / demand * 100, 2) if demand else None,
        "paid_hours_h": round(paid_hours, 2), "standard_hours_h": round(standard_hours, 2), "overtime_hours_h": round(overtime_hours, 2),
        "overtime_share_pct": round(overtime_hours / paid_hours * 100, 2) if paid_hours else None,
        "simulated_labor_cost_cny": round(cost, 2), "cost_per_covered_shift_cny": round(cost / covered, 2) if covered else None,
        "labor_efficiency_shifts_per_100h": round(covered / paid_hours * 100, 3) if paid_hours else None,
        "labor_hour_utilization_pct": round(paid_hours / capacity * 100, 2) if capacity else None,
        "coverage_balance_score": round(score, 2) if score is not None else None,
        "hours_gini": round(gini(list(hours_by_employee.values())) or 0, 4) if hours_by_employee else None,
        "hours_range_h": round(max(hours_by_employee.values()) - min(hours_by_employee.values()), 2) if hours_by_employee else None,
        "satisfaction_average_1_to_5": round(sum(scores) / len(scores), 2) if scores else None,
        "satisfaction_response_count": len(scores),
    }


def emit() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog, employees, teams, all_skills = build_catalog()
    (OUT / "catalog_expansion.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    line_by_id = {item["line_id"]: item for item in LINES}
    write_csv(OUT / "employees.csv", ["employee_id", "name", "factory_code", "factory_name", "line_id", "line_name", "team_id", "position_id", "position_name", "employment_status", "seniority_years", "collaboration_score", "night_eligible", "source_type"], employees)
    write_csv(OUT / "teams.csv", ["team_id", "name", "team_category", "factory_code", "line_id", "line_name", "primary_position_id", "description", "source_type"], teams)
    write_csv(OUT / "line_catalog.csv", ["line_id", "line_name", "factory_code", "factory_name", "line_type", "source_type"], [{"line_id": item["line_id"], "line_name": item["name"], "factory_code": item["factory_code"], "factory_name": item["factory_name"], "line_type": item["line_type"], "source_type": SOURCE_TYPE} for item in LINES])
    write_csv(OUT / "position_catalog.csv", ["position_id", "position_name", "position_category"], [{"position_id": item["position_id"], "position_name": item["name"], "position_category": item["category"]} for item in POSITIONS])
    write_csv(OUT / "shift_catalog.csv", ["shift_code", "shift_name", "start_time", "end_time", "source_type"], [{"shift_code": "DAY", "shift_name": "白班", "start_time": "07:00", "end_time": "19:00", "source_type": SOURCE_TYPE}, {"shift_code": "NIGHT", "shift_name": "夜班", "start_time": "19:00", "end_time": "07:00", "source_type": SOURCE_TYPE}])
    write_csv(OUT / "skill_catalog.csv", ["skill_code", "skill_name", "skill_category", "description"], [{"skill_code": item["code"], "skill_name": item["name"], "skill_category": item["category"], "description": item["description"]} for item in SKILLS])
    write_csv(OUT / "employee_skills.csv", ["employee_id", "skill_code", "skill_name", "skill_score", "source_type"], all_skills)

    plan_manifest = {"schema_version": 1, "dataset_id": DATASET_ID, "source_type": SOURCE_TYPE, "generator": "scripts/generate_expanded_demo_data.py", "generator_version": "1.0.0", "seed": SEED, "period": {"start_date": START.isoformat(), "end_date": (START + timedelta(days=HORIZON_DAYS - 1)).isoformat(), "days": HORIZON_DAYS}, "comparison_dimensions": ["scenario_family", "scenario_code", "comparison_group", "factory_code", "line_id", "team_id", "position_id", "skill_code", "shift_code", "coverage_rate_pct", "simulated_labor_cost_cny", "overtime_hours_h", "coverage_balance_score", "hours_gini", "compliance_rate_pct", "satisfaction_average_1_to_5"], "metric_definitions": {"coverage_rate_pct": "已覆盖人班 ÷ 需求人班 × 100%；未覆盖需求以缺口记录表示。", "simulated_labor_cost_cny": "非加班工时 × 35 元/h + 加班工时 × 52.5 元/h；仅为统一费率代理。", "compliance_rate_pct": "七项场景规则检查中未记录违例的检查项数 ÷ 有效检查项数 × 100%；未执行独立核验。", "satisfaction_average_1_to_5": "每套方案关联的本机模拟评分算术平均值；不是真实问卷结果。", "hours_gini": "按方案内参与排班员工计薪工时计算的基尼系数；越低表示工时分布越均衡。"}, "plans": []}
    comparison_rows: list[dict[str, object]] = []
    for plan in SCENARIOS:
        assignments, gaps, generated = build_schedule(plan, employees)
        scenario_dir = OUT / "schedules"
        scenario_dir.mkdir(parents=True, exist_ok=True)
        relative_file = f"data/demo/expanded/schedules/{plan['code']}.csv"
        path = ROOT / relative_file
        columns = ["工厂代码", "产线编码", "日期", "班次", "班次代码", "员工工号", "岗位编码", "岗位名称", "是否关键岗", "技能等级", "计薪工时(h)", "标准工时(h)", "当日加班工时(h)", "该班次换型等级", "实验编号"]
        with path.open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(assignments)
            writer.writerow({"工厂代码": f"缺口记录（{len(gaps)} 条）"})
            writer.writerow({"工厂代码": "岗位编码", "产线编码": "岗位名称", "日期": "产线编码", "班次": "日期", "班次代码": "班次", "员工工号": "缺口人班"})
            for gap in gaps:
                writer.writerow({"工厂代码": gap["岗位编码"], "产线编码": gap["岗位名称"], "日期": gap["产线编码"], "班次": gap["日期"], "班次代码": gap["班次"], "员工工号": gap["缺口人班"]})
            writer.writerow({"工厂代码": "非完整班次记录（0 条）"})
            writer.writerow({"工厂代码": "员工工号", "产线编码": "岗位编码", "日期": "日期", "班次": "班次编码", "班次代码": "非完整班次工时"})
        file_bytes = path.read_bytes()
        scores = generated["feedback_samples"]
        metrics = plan_metrics(assignments, gaps, scores)
        violations = generated["violations"]
        checks = list(violations.values())
        compliance_rate = sum(value == 0 for value in checks) / len(checks) * 100
        metrics["compliance_rate_pct"] = round(compliance_rate, 2)
        metrics["rule_violation_count"] = generated["violation_count"]
        record = {
            "scenario_code": plan["code"], "schedule_id": f"DEMO-{plan['code']}", "scenario_name": plan["name"], "scenario_family": plan["family"],
            "strategy": plan["strategy"], "comparison_group": plan["comparison_group"], "demand_profile": plan["event"], "priority": plan["strategy"],
            "period": plan_manifest["period"], "artifact_path": relative_file, "sha256": hashlib.sha256(file_bytes).hexdigest(),
            "source_type": SOURCE_TYPE, "notes": plan["notes"], "comparison_dimensions": plan_manifest["comparison_dimensions"],
            "metrics": metrics, "all_pass": None, "verification_state": generated["verification_state"], "violations": violations,
            "feedback_samples": scores,
        }
        plan_manifest["plans"].append(record)
        comparison_rows.append({
            "scenario_code": plan["code"], "schedule_id": record["schedule_id"], "scenario_name": plan["name"], "scenario_family": plan["family"],
            "comparison_group": plan["comparison_group"], "demand_profile": plan["event"], "coverage_target_pct": plan["coverage"] * 100,
            **metrics, "source_type": SOURCE_TYPE, "independent_validation": "未执行",
        })
    (OUT / "scenario_manifest.json").write_text(json.dumps(plan_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_csv(OUT / "scenario_comparison_summary.csv", list(comparison_rows[0].keys()), comparison_rows)
    write_csv(OUT / "scenario_catalog.csv", ["scenario_code", "schedule_id", "scenario_name", "scenario_family", "strategy", "comparison_group", "demand_profile", "source_type", "notes"], [{"scenario_code": item["scenario_code"], "schedule_id": item["schedule_id"], "scenario_name": item["scenario_name"], "scenario_family": item["scenario_family"], "strategy": item["strategy"], "comparison_group": item["comparison_group"], "demand_profile": item["demand_profile"], "source_type": item["source_type"], "notes": item["notes"]} for item in plan_manifest["plans"]])

    catalog_summary = {
        "schema_version": 1, "dataset_id": DATASET_ID, "dataset_version": "synthetic-demo-expanded-20261008-v1",
        "display_name": "合成演示数据（人员与多方案扩充）", "source_type": SOURCE_TYPE,
        "provenance": "由固定种子和规则生成的本机合成数据；不含真实员工个人信息，不代表生产绩效。",
        "seed": SEED, "planning_period_days": HORIZON_DAYS, "planning_period": {"start_date": START.isoformat(), "end_date": (START + timedelta(days=HORIZON_DAYS - 1)).isoformat()},
        "counts": {"lines": len(LINES), "employees": len(employees), "new_employees": len(catalog["employees"]), "teams": len(teams), "new_teams": len(catalog["teams"]), "positions": len(POSITIONS), "skills": len(SKILLS), "employee_skill_relations": len(all_skills), "scenarios": len(SCENARIOS), "schedule_artifacts": len(SCENARIOS)},
        "classification": {"factory_code": {"HB": "河北厂", "SX": "陕西厂"}, "line_type": {"soda": "含气饮料线", "aseptic": "无菌饮料线"}, "source_type": {"synthetic_demo": "合成演示数据"}, "position_categories": sorted({item["category"] for item in POSITIONS}), "skill_categories": sorted({item["category"] for item in SKILLS}), "comparison_groups": ["baseline-demand", "peak-demand"]},
        "relation_keys": {"employees": "employee_id", "teams": "team_id", "positions": "position_id", "skills": "skill_code", "lines": "line_id", "qualifications": "object_type + object_id + position_id + line_id", "schedule_versions": "schedule_id + version", "schedule_employee_link": "schedule assignment employee_id = employee_id"},
        "files": {}, "limitations": ["所有新增记录均为合成本机演示数据。", "员工满意度为本机模拟评分，不代表真实员工反馈。", "模拟人工成本统一采用 35 元/h 基准费率和 1.5 倍加班倍率，不代表实际工资。", "合规率来自生成脚本的场景规则模拟检查；所有方案均未执行独立硬约束核验。", "旺季增产场景的需求量与基准场景不同，应优先比较覆盖率、单位覆盖成本和风险指标。", "新增比较方案不进入现有 MIP 求解器输入。"]
    }
    for path in sorted(OUT.glob("*")):
        if path.is_file() and path.name not in {"dataset_manifest.json"}:
            content = path.read_bytes()
            if path.suffix == ".csv":
                with path.open("r", encoding="utf-8-sig", newline="") as stream:
                    row_count = max(0, sum(1 for _ in csv.reader(stream)) - 1)
            else:
                row_count = None
            catalog_summary["files"][path.name] = {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(content).hexdigest(), "row_count": row_count}
    (OUT / "dataset_manifest.json").write_text(json.dumps(catalog_summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    emit()
