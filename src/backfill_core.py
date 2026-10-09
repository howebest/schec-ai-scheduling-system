# -*- coding: utf-8 -*-
"""补位推荐核心模块（独立运行版）。

口径与已验收 SCHEC-RESCHED-V1.0 的 backfill_recommendations 一致：
对每个空缺（岗位, 日期, 班次）按技能矩阵生成候选排序，技能等级、岗位要求
等级、证书有效期、可胜任夜班、画像累计在岗时长均直接取自原始数据。
"""
import csv


def load_skill_profile(xlsx_path, code2name, pos_factory_lines):
    """从原始数据集读取技能矩阵画像字段。

    返回 (cum, cert, primary)：
    cum[(员工, 技能岗位)] 为画像累计在岗时长；
    cert[(员工, 技能岗位)] 为证书有效期；
    primary 为（员工, 技能岗位）主岗标记集合。
    """
    import pandas as pd
    xl = pd.ExcelFile(xlsx_path)
    mat = xl.parse("人员技能矩阵")
    mat.columns = [str(c).strip() for c in mat.columns]
    cum_col = next((c for c in mat.columns if ("累计" in c and "在岗" in c)), None)
    primary_col = next((c for c in mat.columns if "主岗" in c), None)
    primary_values = {"1", "1.0", "是", "Y", "y", "True", "true", "TRUE", "主岗"}
    cum, cert, primary = {}, {}, set()
    for _, r in mat.iterrows():
        e = str(r["员工工号"]).strip()
        pn = str(r["技能岗位"]).strip()
        if cum_col:
            v = pd.to_numeric(r[cum_col], errors="coerce")
            cum[(e, pn)] = float(v) if pd.notna(v) else 0.0
        else:
            cum[(e, pn)] = cum.get((e, pn), 0.0)
        from scheduling_model_builder import to_iso
        cert[(e, pn)] = to_iso(r.get("证书有效期"))
        if primary_col and str(r[primary_col]).strip() in primary_values:
            primary.add((e, pn))
    return cum, cert, primary


def recommend(qual, can_night, pos, vacancies, base_assign, base_f,
              cum, cert, month_limit=12, top_n=5):
    """为每个空缺岗位生成多技能补位候选排序。

    vacancies 为（岗位编码, 日期, 班次名称）列表；
    base_assign/base_f 为基准方案指派与非完整班，用于空闲与占用过滤。
    推荐得分 = 40*(技能等级-要求等级) + 10*有证书 + 5*窗口空闲天数
              - 0.02*画像累计在岗时长（负载均衡）。
    """
    wshift = {}
    wmonth = {}
    for (e, p, dt, sc) in base_assign:
        wshift[(e, dt)] = sc
        if sc in ("D12", "N12"):
            wmonth[(e, dt[:7])] = wmonth.get((e, dt[:7]), 0) + 1
    wfday = {(e, dt) for (e, p, dt, sc, h) in base_f}
    quals_by_pos = {}
    for (e, p) in qual:
        quals_by_pos.setdefault(p, set()).add(e)
    rows = []
    for (p, dt, shn) in sorted(vacancies):
        v = pos[p]
        req = v["req_level"]
        cands = []
        for e in sorted(quals_by_pos.get(p, set())):
            if shn == "夜班" and not can_night.get(e, False):
                continue
            if (e, dt) in wshift or (e, dt) in wfday:
                continue
            if wmonth.get((e, dt[:7]), 0) >= month_limit:
                continue
            lv = qual[(e, p)]
            c = cum.get((e, v["pos_name"]), 0.0)
            ct = cert.get((e, v["pos_name"]), "")
            wsh = sum(1 for (ee, dd) in wshift if ee == e)
            idle = 7 - wsh
            score = 40.0 * (lv - req) + (10.0 if ct else 0.0) + 5.0 * idle - 0.02 * c
            cands.append((score, e, lv, ct, c, wsh, idle, wmonth.get((e, dt[:7]), 0)))
        cands.sort(key=lambda t: (-t[0], t[1]))
        for rank, c in enumerate(cands[:top_n], 1):
            rows.append([p, v["pos_name"], v["line"], dt, shn, rank, c[1], c[2], req,
                         c[2] - req, c[3], "是" if can_night.get(c[1], False) else "否",
                         round(c[4], 1), c[5], c[6], c[7], round(c[0], 2)])
    return rows


HEADER = ["空缺岗位编码", "空缺岗位名称", "产线编码", "空缺日期", "空缺班次", "推荐排名",
          "候选员工工号", "技能等级(矩阵)", "岗位要求等级", "等级余量", "证书有效期(矩阵)",
          "可胜任夜班(矩阵)", "画像累计在岗时长(h)", "窗口内已排班次", "窗口内空闲天数",
          "当月已用12h班数", "推荐得分"]


def write_recommendations(path, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)