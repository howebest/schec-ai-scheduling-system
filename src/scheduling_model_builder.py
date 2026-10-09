# -*- coding: utf-8 -*-
"""scheduling_model_builder：排班优化数学模型构建器（SCHEC-MIP-V1.0 独立运行版）。

本文件与已验收建模代码（文件永久标识 56c22815-02db-432b-b564-d704ab2daa84，
SHA-256 9caf006cb9d3b2211d077e6fdb45c479924fc44538f34a87b06a3132c0f8b9ed）同源，
为独立命令行运行做了三处工程适配，模型结构、参数、约束与目标函数完全一致：
1) 移除平台 agent_dynamic_helper 依赖（load_data 直接收路径参数）；
2) 移除平台结果登记接口（main() 不再被调用，保留为文档说明）；
3) 新增 load_data_from_csv 支持从包内参考CSV构建需求（双口径核对用）。

模型口径：12小时班计薪11小时=标准工时8小时+当日加班3小时（另1小时用餐
不计工时）；月加班上限36小时等价于每人每月12小时班不超过12班；两班间隔
与休息约束按整班排班序列判定；非完整班次按小时粒度、8小时折1人班。
"""
import datetime

import pandas as pd
import pyomo.environ as pyo

MODEL_VERSION = "SCHEC-MIP-V1.0"
INPUT_VERSION = "SCHEC-INPUT-V1.0"

PARAMS = {
    "H1_STD_HOURS": 8.0,
    "H2_DAILY_OT_CAP": 3.0,
    "H2_MEAL_UNPAID": 1.0,
    "H3_MONTH_OT_CAP": 36.0,
    "H4_MIN_INTERVAL": 11.0,
    "H5_REST_PER_7D": 1,
    "DRV_MAX_12H_SHIFTS": 12,
    "C_GRADE_HOURS": {"A": 1.0, "B": 1.2, "C": 0.8, "F": 1.5},
}
SHIFT_INFO = {
    "白班":   dict(code="D12", start=8,  dur=12.0, paid=11.0, std=8.0, ot=3.0, meal=1.0),
    "夜班":   dict(code="N12", start=20, dur=12.0, paid=11.0, std=8.0, ot=3.0, meal=1.0),
    "常白班": dict(code="D8",  start=8,  dur=8.0,  paid=8.0,  std=8.0, ot=0.0, meal=0.0),
}
CODE2SHIFT = {v["code"]: k for k, v in SHIFT_INFO.items()}
WEIGHTS = {
    "gap_key": 100.0,
    "gap_gen": 40.0,
    "co_gap_extra": 20.0,
    "ot_per_hour": 5.0,
    "balance_per_hour": 2.0,
    "util_per_shift": 1.0,
}
F_EQ_HOURS = 8.0
F_MAX_HOURS = 8.0
DATA_END = "2026-08-31"

__doc_note__ = ("原main()为平台执行入口，依赖平台结果登记接口，独立包中不使用；"
                "求解入口见 sched_solver.py。")


def to_iso(v):
    if v is None:
        return ""
    try:
        if pd.isna(v):
            return ""
    except Exception:
        pass
    if isinstance(v, (pd.Timestamp, datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def load_data(xlsx_path):
    """从原始附件构建模型输入（口径与SCHEC-INPUT-V1.0一致）。"""
    xl = pd.ExcelFile(xlsx_path)
    ledger = xl.parse("设备产线与工位台账")
    matrix = xl.parse("人员技能矩阵")
    main = xl.parse("排班训练主数据集", usecols=[
        "工厂代码", "产线编码", "日期", "班次", "生产运行状态",
        "换型标记", "换型等级", "岗位编码", "持证要求"])
    ledger.columns = [str(c).strip() for c in ledger.columns]
    matrix.columns = [str(c).strip() for c in matrix.columns]

    pos = ledger.rename(columns={
        "工厂代码": "factory", "产线编码": "line", "岗位编码": "pos",
        "岗位名称": "pos_name", "岗位类别": "pos_class",
        "岗位技能要求等级": "req_level", "白班定编": "day_staff",
        "夜班定编": "night_staff", "轮班模式": "cycle"})
    pos = pos[pos["pos"].notna()].copy()
    for c in ["pos", "line", "factory", "cycle", "pos_class", "pos_name"]:
        pos[c] = pos[c].astype(str).str.strip()
    pos["key_flag"] = pos["pos_class"].str.contains("关键").astype(int)
    pos["is_day_only"] = pos["cycle"].str.contains("常白班").astype(int)
    for c in ["req_level", "day_staff", "night_staff"]:
        pos[c] = pd.to_numeric(pos[c], errors="coerce").fillna(0).astype(int)

    cert_map = {}
    mm = main[main["持证要求"].notna()].copy()
    mm["岗位编码"] = mm["岗位编码"].astype(str).str.strip()
    mm = mm[mm["岗位编码"] != ""]
    for pc, grp in mm.groupby("岗位编码"):
        vals = grp["持证要求"].astype(str).str.strip()
        vals = vals[vals != ""]
        if len(vals):
            cert_map[pc] = str(vals.mode().iat[0]).strip()
    pos["cert_req"] = pos["pos"].map(cert_map).fillna("")

    POS = {}
    for _, r in pos.iterrows():
        POS[r["pos"]] = dict(
            factory=r["factory"], line=r["line"], pos_name=r["pos_name"],
            pos_class=r["pos_class"], key_flag=int(r["key_flag"]),
            req_level=int(r["req_level"]), day_staff=int(r["day_staff"]),
            night_staff=int(r["night_staff"]), cycle=r["cycle"],
            is_day_only=int(r["is_day_only"]), cert_req=r["cert_req"])
    pos_list = sorted(POS.keys())
    lines = sorted({v["line"] for v in POS.values()})

    for c in ["员工工号", "技能岗位", "证书有效期", "可胜任班次", "工厂代码"]:
        matrix[c] = matrix[c].astype(str).str.strip()
    matrix["证书有效期"] = matrix["证书有效期"].map(to_iso)
    name2pos = {}
    for p, v in POS.items():
        name2pos.setdefault((v["factory"], v["pos_name"]), []).append(p)

    QUAL = {}
    cert_ok = set()
    for _, r in matrix.iterrows():
        emp = r["员工工号"]
        if emp == "" or emp.lower() == "nan":
            continue
        factory = r["工厂代码"]
        level = pd.to_numeric(r["技能等级"], errors="coerce")
        if pd.isna(level):
            continue
        level = int(level)
        exp = r["证书有效期"]
        for p in name2pos.get((factory, r["技能岗位"]), []):
            v = POS[p]
            if level < v["req_level"]:
                continue
            if (emp, p) not in QUAL or level > QUAL[(emp, p)]:
                QUAL[(emp, p)] = level
            if v["cert_req"] and exp and exp >= DATA_END:
                cert_ok.add((emp, p))
    qual_final = {}
    for (e, p), lv in QUAL.items():
        if POS[p]["cert_req"] and (e, p) not in cert_ok:
            continue
        qual_final[(e, p)] = lv

    emp_list = sorted(set(matrix["员工工号"][matrix["员工工号"] != ""].unique().tolist()))
    can_night = {}
    for e, g in matrix.groupby("员工工号"):
        can_night[e] = bool(g["可胜任班次"].str.contains("夜").any())
    emp_factory = {e: str(g["工厂代码"].iloc[0]).strip()
                   for e, g in matrix.groupby("员工工号")}

    main2 = main.copy()
    for c in ["产线编码", "日期", "班次"]:
        main2[c] = main2[c].astype(str).str.strip()
    main2 = main2[main2["产线编码"].isin(set(lines))]
    main2["换型标记"] = pd.to_numeric(main2["换型标记"], errors="coerce").fillna(0)
    run_state = {}
    changeover = {}
    for (ln, dt, sh), grp in main2.groupby(["产线编码", "日期", "班次"]):
        st = grp["生产运行状态"].mode()
        st = str(st.iat[0]).strip() if len(st) else "正常生产运行"
        run_state[(ln, dt, sh)] = st
        if int(grp["换型标记"].max()) == 1:
            gv = grp["换型等级"].dropna().astype(str).str.strip()
            gv = gv[gv != ""]
            if len(gv):
                letter = str(gv.mode().iat[0]).strip().upper()[0]
                if letter in PARAMS["C_GRADE_HOURS"]:
                    changeover[(ln, dt, sh)] = letter
    dates = sorted({dt for (_, dt, _) in run_state})
    for ln in lines:
        for dt in dates:
            for sh in ["白班", "夜班"]:
                if (ln, dt, sh) not in run_state:
                    run_state[(ln, dt, sh)] = "正常生产运行"

    def line_open(ln, dt, sh):
        return run_state.get((ln, dt, sh), "正常生产运行") not in ("例行维护", "大修")

    demand = {}
    for p, v in POS.items():
        for dt in dates:
            if v["is_day_only"]:
                if v["day_staff"] > 0:
                    demand[(p, dt, "常白班")] = v["day_staff"]
            else:
                if v["day_staff"] > 0 and line_open(v["line"], dt, "白班"):
                    demand[(p, dt, "白班")] = v["day_staff"]
                if v["night_staff"] > 0 and line_open(v["line"], dt, "夜班"):
                    demand[(p, dt, "夜班")] = v["night_staff"]
    return dict(POS=POS, pos_list=pos_list, lines=lines, QUAL=qual_final,
                emp_list=emp_list, emp_factory=emp_factory, can_night=can_night,
                run_state=run_state, changeover=changeover, dates=dates,
                demand=demand)


def load_data_from_csv(xlsx_path, pos_csv, run_plan_csv):
    """按 input_04×input_07 参考CSV口径构建需求（独立核验ISS-01双口径用）。

    与 load_data 的差异仅在于：岗位定编取 input_04 列，产线班次运行状态取
    input_07 列（正常生产运行/换型开班，例行维护/大修停开班，未观测组合按
    正常生产）；技能矩阵、资格、换型、日历与 load_data 相同。
    """
    base = load_data(xlsx_path)
    pos_df = pd.read_csv(pos_csv, encoding="utf-8-sig")
    plan = pd.read_csv(run_plan_csv, encoding="utf-8-sig")
    POS = {}
    for _, r in pos_df.iterrows():
        p = str(r["岗位编码"]).strip()
        cycle = str(r["轮班模式"]).strip()
        POS[p] = dict(
            factory=str(r["工厂代码"]).strip(), line=str(r["产线编码"]).strip(),
            pos_name=str(r["岗位名称"]).strip(), pos_class=str(r["岗位类别"]).strip(),
            key_flag=int("关键" in str(r["岗位类别"])),
            req_level=int(pd.to_numeric(r["岗位技能要求等级"], errors="coerce") or 0),
            day_staff=int(pd.to_numeric(r["白班定编"], errors="coerce") or 0),
            night_staff=int(pd.to_numeric(r["夜班定编"], errors="coerce") or 0),
            cycle=cycle, is_day_only=int("常白班" in cycle),
            cert_req=str(r.get("岗位证书要求", "") if pd.notna(r.get("岗位证书要求")) else ""))
    dates = sorted(base["dates"])
    run_state = {}
    for _, r in plan.iterrows():
        run_state[(str(r["产线编码"]).strip(), str(r["日期"]).strip(),
                   str(r["班次"]).strip())] = str(r["生产运行状态"]).strip()
    def line_open(ln, dt, sh):
        return run_state.get((ln, dt, sh), "正常生产运行") not in ("例行维护", "大修")
    demand = {}
    for p, v in POS.items():
        for dt in dates:
            if v["is_day_only"]:
                if v["day_staff"] > 0:
                    demand[(p, dt, "常白班")] = v["day_staff"]
            else:
                if v["day_staff"] > 0 and line_open(v["line"], dt, "白班"):
                    demand[(p, dt, "白班")] = v["day_staff"]
                if v["night_staff"] > 0 and line_open(v["line"], dt, "夜班"):
                    demand[(p, dt, "夜班")] = v["night_staff"]
    base = dict(base)
    base["POS"] = POS
    base["pos_list"] = sorted(POS.keys())
    base["demand"] = demand
    base["run_state"] = run_state
    return base


def build_model(data, line_filter=None, date_filter=None, weights=None,
                minimum_coverage_rate=None):
    """构建排班MIP模型；支持按产线与日期过滤生成子实例。"""
    weights = WEIGHTS if weights is None else weights
    POS = data["POS"]
    QUAL = data["QUAL"]
    can_night = data["can_night"]
    changeover = data["changeover"]
    dates_sorted = sorted(data["dates"] if date_filter is None
                          else [d for d in data["dates"] if d in set(date_filter)])
    if line_filter is None:
        pos_list = data["pos_list"]
    else:
        lset = set(line_filter)
        pos_list = [p for p in data["pos_list"] if POS[p]["line"] in lset]
    pset = set(pos_list)
    demand = {k: v for k, v in data["demand"].items()
              if k[0] in pset and k[1] in set(dates_sorted)}
    qual_by_pos = {p: [] for p in pos_list}
    for (e, p) in QUAL:
        if p in qual_by_pos:
            qual_by_pos[p].append(e)
    for p in pos_list:
        qual_by_pos[p].sort()

    dem_keys = sorted(demand.keys())
    x_index = []
    for (p, dt, sh) in dem_keys:
        if demand[(p, dt, sh)] <= 0:
            continue
        sc = SHIFT_INFO[sh]["code"]
        for e in qual_by_pos[p]:
            if sh == "夜班" and not can_night.get(e, False):
                continue
            x_index.append((e, p, dt, sc))
    x_index = sorted(set(x_index))
    y_index = sorted({(e, dt, sc) for (e, p, dt, sc) in x_index})
    y_set = set(y_index)
    co_lookup = {}
    for k in dem_keys:
        p, dt, sh = k
        co_lookup[k] = (POS[p]["line"], dt, sh) in changeover
    f_index = []
    for (p, dt, sh) in dem_keys:
        if demand[(p, dt, sh)] <= 0 or POS[p]["key_flag"]:
            continue
        if not co_lookup[(p, dt, sh)]:
            continue
        sc = SHIFT_INFO[sh]["code"]
        for e in qual_by_pos[p]:
            f_index.append((e, p, dt, sc))
    f_index = sorted(set(f_index))

    m = pyo.ConcreteModel(name=MODEL_VERSION)
    m.x = pyo.Var(x_index, domain=pyo.Binary)
    m.y = pyo.Var(y_index, domain=pyo.Binary)
    m.g = pyo.Var(dem_keys, domain=pyo.NonNegativeIntegers)
    m.f = pyo.Var(f_index, domain=pyo.NonNegativeReals, bounds=(0, F_MAX_HOURS))
    m.Tmax = pyo.Var(domain=pyo.NonNegativeReals)
    m.Tmin = pyo.Var(domain=pyo.NonNegativeReals)

    xterms_by_cell = {k: [] for k in dem_keys}
    for (e, p, dt, sc) in x_index:
        xterms_by_cell[(p, dt, CODE2SHIFT[sc])].append(m.x[(e, p, dt, sc)])
    fterms_by_cell = {k: [] for k in dem_keys}
    for (e, p, dt, sc) in f_index:
        fterms_by_cell[(p, dt, CODE2SHIFT[sc])].append(m.f[(e, p, dt, sc)])

    m.cov = pyo.ConstraintList()
    for k in dem_keys:
        expr = sum(xterms_by_cell[k])
        if fterms_by_cell[k]:
            expr = expr + sum(fterms_by_cell[k]) / F_EQ_HOURS
        m.cov.add(expr + m.g[k] == demand[k])
    if minimum_coverage_rate is not None:
        total_demand = sum(demand.values())
        m.coverage_floor = pyo.Constraint(
            expr=sum(m.g[k] for k in dem_keys) <= (1.0 - minimum_coverage_rate) * total_demand)

    x_by_eds = {}
    for (e, p, dt, sc) in x_index:
        x_by_eds.setdefault((e, dt, sc), []).append(m.x[(e, p, dt, sc)])
    m.ydef = pyo.ConstraintList()
    for k in y_index:
        m.ydef.add(sum(x_by_eds.get(k, [])) == m.y[k])

    y_by_ed = {}
    for (e, dt, sc) in y_index:
        y_by_ed.setdefault((e, dt), []).append(m.y[(e, dt, sc)])
    emps_y = sorted({e for (e, dt, sc) in y_index})

    m.oneday = pyo.ConstraintList()
    for e in emps_y:
        for dt in dates_sorted:
            t = y_by_ed.get((e, dt), [])
            if len(t) > 1:
                m.oneday.add(sum(t) <= 1)

    m.h2daily = pyo.ConstraintList()
    for e in emps_y:
        for dt in dates_sorted:
            t = [m.y[(e, dt, sc)] for sc in ("D12", "N12") if (e, dt, sc) in y_set]
            if t:
                m.h2daily.add(sum(t) <= 1)

    m.h4 = pyo.ConstraintList()
    for e in emps_y:
        for i in range(len(dates_sorted) - 1):
            d0, d1 = dates_sorted[i], dates_sorted[i + 1]
            a = (e, d0, "N12")
            if a not in y_set:
                continue
            for sc2 in ("D12", "D8"):
                b = (e, d1, sc2)
                if b in y_set:
                    m.h4.add(m.y[a] + m.y[b] <= 1)

    m.h5 = pyo.ConstraintList()
    for e in emps_y:
        for i in range(len(dates_sorted) - 6):
            t = [m.y[(e, dt, sc)] for dt in dates_sorted[i:i + 7]
                 for sc in ("D12", "N12", "D8") if (e, dt, sc) in y_set]
            if t:
                m.h5.add(sum(t) <= 7 - PARAMS["H5_REST_PER_7D"])

    m.monot = pyo.ConstraintList()
    months = sorted({dt[:7] for dt in dates_sorted})
    for e in emps_y:
        for mo in months:
            t = [m.y[(e, dt, sc)] for dt in dates_sorted if dt[:7] == mo
                 for sc in ("D12", "N12") if (e, dt, sc) in y_set]
            if t:
                m.monot.add(sum(t) <= PARAMS["DRV_MAX_12H_SHIFTS"])

    f_by_ed = {}
    for (e, p, dt, sc) in f_index:
        f_by_ed.setdefault((e, dt), []).append(m.f[(e, p, dt, sc)])
    emps_f = sorted({e for (e, dt) in f_by_ed})
    m.flink = pyo.ConstraintList()
    for e in emps_f:
        for dt in dates_sorted:
            ft = f_by_ed.get((e, dt), [])
            if not ft:
                continue
            yt = y_by_ed.get((e, dt), [])
            m.flink.add(sum(ft) + F_EQ_HOURS * sum(yt) <= F_MAX_HOURS)

    hours_terms = {}
    for (e, dt, sc) in y_index:
        paid = SHIFT_INFO[CODE2SHIFT[sc]]["paid"]
        hours_terms.setdefault(e, []).append(paid * m.y[(e, dt, sc)])
    for (e, p, dt, sc) in f_index:
        hours_terms.setdefault(e, []).append(m.f[(e, p, dt, sc)])
    m.tstat = pyo.ConstraintList()
    for e, terms in hours_terms.items():
        m.tstat.add(m.Tmax >= sum(terms))
        m.tstat.add(m.Tmin <= sum(terms))

    gap_key = [m.g[k] for k in dem_keys if POS[k[0]]["key_flag"]]
    gap_gen = [m.g[k] for k in dem_keys if not POS[k[0]]["key_flag"]]
    gap_co = [m.g[k] for k in dem_keys if co_lookup[k]]
    y12 = [m.y[k] for k in y_index if k[2] in ("D12", "N12")]
    obj = (weights["gap_key"] * (sum(gap_key) if gap_key else 0.0)
           + weights["gap_gen"] * (sum(gap_gen) if gap_gen else 0.0)
           + weights["co_gap_extra"] * (sum(gap_co) if gap_co else 0.0)
           + weights["ot_per_hour"] * PARAMS["H2_DAILY_OT_CAP"] * (sum(y12) if y12 else 0.0)
           + weights["balance_per_hour"] * (m.Tmax - m.Tmin)
           - weights["util_per_shift"] * (sum(y12) if y12 else 0.0))
    m.obj = pyo.Objective(expr=obj, sense=pyo.minimize)

    meta = dict(
        dates_sorted=dates_sorted, pos_list=pos_list, dem_keys=dem_keys,
        demand=demand, qual_by_pos=qual_by_pos, x_index=x_index,
        y_index=y_index, f_index=f_index, co_lookup=co_lookup,
        months=months,
        n_var=len(x_index) + len(y_index) + len(dem_keys) + len(f_index) + 2,
        n_con=(len(m.cov) + len(m.ydef) + len(m.oneday) + len(m.h2daily)
               + len(m.h4) + len(m.h5) + len(m.monot) + len(m.flink) + len(m.tstat)))
    return m, meta
