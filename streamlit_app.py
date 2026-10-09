from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st


PACKAGE_ROOT = Path(__file__).resolve().parent
DEFAULT_WORKBOOK = PACKAGE_ROOT / "data" / "demo" / "streamlit_demo_dataset.xlsx"
SOLVER_SCRIPT = PACKAGE_ROOT / "src" / "sched_solver.py"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
OBJECTIVE_PROFILES = {
    "综合均衡": ("balanced", "综合考虑岗位缺口、加班与工时均衡。"),
    "覆盖优先": ("coverage_first", "提高岗位缺口的目标惩罚权重，优先满足岗位需求。"),
    "加班控制": ("cost_control", "提高加班目标惩罚权重。输出为模型目标值，不代表人民币成本。"),
    "工时公平": ("fairness_first", "提高员工工时差异的目标惩罚权重，促进工时均衡。"),
}


class SolverRunError(RuntimeError):
    pass


def _extract_result_json(output: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for offset, character in enumerate(output):
        if character != "{":
            continue
        try:
            payload, _ = decoder.raw_decode(output[offset:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and "kpi" in payload and "verification" in payload:
            return payload
    raise SolverRunError("求解程序未返回可读取的指标结果。")


def _parse_schedule_csv(contents: bytes) -> tuple[pd.DataFrame, pd.DataFrame]:
    rows = list(csv.reader(io.StringIO(contents.decode("utf-8-sig"))))
    if not rows or not rows[0] or "员工工号" not in rows[0]:
        raise SolverRunError("求解程序输出的排班文件格式不符合预期。")

    schedule_columns = rows[0]
    schedule_rows: list[list[str]] = []
    index = 1
    while index < len(rows) and rows[index] and len(rows[index]) == len(schedule_columns):
        schedule_rows.append(rows[index])
        index += 1

    gap_header: list[str] = []
    while index < len(rows):
        row = rows[index]
        index += 1
        if row and row[0].startswith("缺口记录："):
            gap_header = ["岗位编码", "岗位名称", "产线编码", "日期", "班次", "缺口人班"]
            break

    gap_rows: list[list[str]] = []
    while index < len(rows) and gap_header:
        row = rows[index]
        index += 1
        if not row:
            break
        if len(row) == len(gap_header):
            gap_rows.append(row)

    schedule = pd.DataFrame(schedule_rows, columns=schedule_columns)
    gaps = pd.DataFrame(gap_rows, columns=gap_header or [
        "岗位编码", "岗位名称", "产线编码", "日期", "班次", "缺口人班"
    ])
    if not gaps.empty:
        gaps["缺口人班"] = pd.to_numeric(gaps["缺口人班"], errors="coerce").fillna(0).astype(int)
    return schedule, gaps


def _load_employee_names(workbook_path: Path) -> dict[str, str]:
    try:
        matrix = pd.read_excel(workbook_path, sheet_name="人员技能矩阵")
    except (ValueError, OSError):
        return {}
    name_column = next((name for name in ("姓名", "员工姓名") if name in matrix.columns), None)
    if name_column is None or "员工工号" not in matrix.columns:
        return {}
    names = matrix[["员工工号", name_column]].dropna().drop_duplicates("员工工号")
    return dict(zip(names["员工工号"].astype(str), names[name_column].astype(str)))


def _run_solver(
    workbook_bytes: bytes | None,
    objective_profile: str,
    demand_multiplier: float,
    time_limit_seconds: int,
    minimum_coverage: float | None,
    scenario_name: str,
) -> dict[str, Any]:
    if not SOLVER_SCRIPT.is_file():
        raise SolverRunError("排班求解程序文件不存在，请确认部署仓库包含 src/sched_solver.py。")

    with tempfile.TemporaryDirectory(prefix="schec-streamlit-") as temporary_directory:
        work_dir = Path(temporary_directory)
        workbook_path = work_dir / "input.xlsx"
        output_path = work_dir / "schedule.csv"
        if workbook_bytes is None:
            if not DEFAULT_WORKBOOK.is_file():
                raise SolverRunError("仓库内未找到默认演示工作簿，请上传符合格式的数据文件。")
            workbook_path = DEFAULT_WORKBOOK
        else:
            workbook_path.write_bytes(workbook_bytes)

        command = [
            sys.executable,
            str(SOLVER_SCRIPT),
            "solve-demo",
            "--input", str(workbook_path),
            "--out", str(output_path),
            "--time-limit", str(time_limit_seconds),
            "--objective-profile", objective_profile,
            "--demand-multiplier", str(demand_multiplier),
            "--scenario-name", scenario_name[:80],
        ]
        if minimum_coverage is not None:
            command.extend(["--minimum-coverage-rate", str(minimum_coverage)])

        process_environment = os.environ.copy()
        process_environment["PYTHONDONTWRITEBYTECODE"] = "1"
        try:
            completed = subprocess.run(
                command,
                cwd=PACKAGE_ROOT,
                env=process_environment,
                capture_output=True,
                text=True,
                check=False,
                timeout=time_limit_seconds + 45,
            )
        except subprocess.TimeoutExpired as error:
            raise SolverRunError(
                f"求解程序超过 {time_limit_seconds + 45} s 未结束。请缩小数据范围或延长求解时限。"
            ) from error

        if completed.returncode not in (0, 4):
            detail = (completed.stderr or completed.stdout or "无可用错误详情").strip()
            raise SolverRunError("排班求解未成功完成。\n" + "\n".join(detail.splitlines()[-16:]))
        if not output_path.is_file():
            raise SolverRunError("求解程序未生成排班结果文件。")

        summary = _extract_result_json(completed.stdout)
        schedule_bytes = output_path.read_bytes()
        schedule, gaps = _parse_schedule_csv(schedule_bytes)
        employee_names = _load_employee_names(workbook_path)
        if employee_names and "员工工号" in schedule.columns:
            name_position = schedule.columns.get_loc("员工工号") + 1
            schedule.insert(
                name_position,
                "员工姓名",
                schedule["员工工号"].astype(str).map(employee_names).fillna(""),
            )
        return {
            "summary": summary,
            "schedule": schedule,
            "gaps": gaps,
            "schedule_csv": schedule_bytes,
        }


def _show_result(result: dict[str, Any]) -> None:
    summary = result["summary"]
    kpi = summary["kpi"]
    verification = summary["verification"]

    st.subheader("求解结果")
    if verification.get("all_pass"):
        st.success("独立硬约束核验通过。")
    else:
        st.error("独立硬约束核验未通过，请查看核验明细后再使用该方案。")

    coverage = kpi.get("coverage_rate")
    metric_columns = st.columns(4)
    metric_columns[0].metric("需求覆盖率", "—" if coverage is None else f"{coverage:.1%}")
    metric_columns[1].metric("排班指派", f"{kpi.get('assigned', 0):,} 人班")
    metric_columns[2].metric("岗位缺口", f"{kpi.get('gap_total', 0):,} 人班")
    metric_columns[3].metric("加班工时", f"{kpi.get('ot_hours', 0):,.1f} h")

    secondary_columns = st.columns(4)
    secondary_columns[0].metric("计薪工时", f"{kpi.get('total_paid_hours', 0):,.1f} h")
    secondary_columns[1].metric("工时最大差", f"{kpi.get('hours_range', 0):,.1f} h")
    secondary_columns[2].metric("关键岗位缺口", f"{kpi.get('key_gap', 0):,} 人班")
    secondary_columns[3].metric("求解状态", str(summary.get("termination", "未知")))

    st.caption(
        "覆盖率按已覆盖需求人班数除以总需求人班数计算。工时最大差为本次有排班员工的最高与最低计薪工时之差。"
        "当前模型未配置员工工资单价，因此不显示货币成本。"
    )

    schedule = result["schedule"]
    gaps = result["gaps"]
    if schedule.empty:
        st.info("本次求解未生成人员指派记录。")
    else:
        chart_data = schedule.groupby(["日期", "班次"]).size().unstack(fill_value=0).sort_index()
        left, right = st.columns(2)
        with left:
            st.markdown("**每日班次指派人数**")
            st.bar_chart(chart_data, height=300)
        with right:
            st.markdown("**岗位缺口分类**")
            gap_chart = pd.DataFrame(
                {"缺口人班": [int(kpi.get("key_gap", 0)), int(kpi.get("gen_gap", 0))]},
                index=["关键岗位", "一般岗位"],
            )
            st.bar_chart(gap_chart, height=300)

        st.markdown("**排班明细**")
        search = st.text_input(
            "按员工、产线或岗位名称筛选",
            key="schedule_search",
            help="输入员工姓名、员工工号、产线编码或岗位名称，筛选当前排班明细。",
        )
        visible_schedule = schedule
        if search.strip():
            mask = visible_schedule.astype(str).apply(
                lambda column: column.str.contains(search.strip(), case=False, regex=False)
            ).any(axis=1)
            visible_schedule = visible_schedule[mask]
        st.dataframe(visible_schedule, use_container_width=True, hide_index=True, height=360)

    st.markdown("**岗位需求缺口**")
    if gaps.empty:
        st.success("本次方案没有岗位需求缺口记录。")
    else:
        st.dataframe(gaps, use_container_width=True, hide_index=True, height=260)

    with st.expander("查看约束核验明细"):
        st.json(verification)
    st.download_button(
        "下载排班结果 CSV",
        data=result["schedule_csv"],
        file_name="排班方案明细.csv",
        mime="text/csv",
        help="下载求解器生成的完整 CSV 文件，包含排班明细、岗位缺口和非完整班次记录。",
    )


st.set_page_config(page_title="智能排班求解工作台", page_icon=None, layout="wide")
st.title("智能排班求解工作台")
st.caption("独立 Streamlit 页面 · Pyomo 混合整数规划 · HiGHS 求解器")

st.info(
    "本页面提供可独立部署的 7 d 排班演示求解。求解范围为数据中的 SX-PET01 产线及首 7 个日期；"
    "人员、岗位、日期和班次需求必须符合项目工作簿结构。HR、APS、MES 等外部系统未连接。"
)

with st.form("schedule_solve_form", clear_on_submit=False):
    st.subheader("求解配置")
    source_columns = st.columns([1, 2])
    with source_columns[0]:
        data_source = st.radio(
            "输入数据",
            options=["合成演示工作簿", "上传工作簿"],
            help="合成演示工作簿仅包含模拟人员和岗位数据。上传文件仅用于当前求解，不会写入仓库。",
        )
    with source_columns[1]:
        uploaded_workbook = st.file_uploader(
            "排班输入工作簿（.xlsx）",
            type=["xlsx"],
            disabled=data_source != "上传工作簿",
            help="需包含“设备产线与工位台账”“人员技能矩阵”“排班训练主数据集”三个工作表。",
        )

    setting_columns = st.columns(3)
    with setting_columns[0]:
        profile_label = st.selectbox("优化目标", list(OBJECTIVE_PROFILES.keys()), index=0)
        st.caption(OBJECTIVE_PROFILES[profile_label][1])
    with setting_columns[1]:
        demand_multiplier = st.number_input(
            "需求调整系数",
            min_value=0.50,
            max_value=1.50,
            value=1.00,
            step=0.05,
            help="仅对求解范围内的岗位需求生效。1.00 表示保持原需求，1.10 表示需求增加 10%。",
        )
    with setting_columns[2]:
        time_limit_seconds = st.number_input(
            "求解时限（s）",
            min_value=10,
            max_value=300,
            value=90,
            step=10,
            help="HiGHS 求解器的最大运行时限，范围为 10–300 s。模型构建时间另计。",
        )

    guardrail_columns = st.columns([1, 2])
    with guardrail_columns[0]:
        use_minimum_coverage = st.checkbox(
            "设置最低覆盖率约束",
            value=False,
            help="启用后，模型必须达到所设覆盖率；约束过严时可能无可行解。",
        )
    with guardrail_columns[1]:
        minimum_coverage_input = st.number_input(
            "最低覆盖率",
            min_value=0.50,
            max_value=1.00,
            value=0.90,
            step=0.01,
            disabled=not use_minimum_coverage,
            help="以总需求人班为分母计算，取值范围为 50%–100%。",
        )

    scenario_name = st.text_input(
        "方案名称",
        value="本机排班演示",
        max_chars=80,
        help="用于标记求解结果，不参与约束或目标函数计算。",
    )
    submitted = st.form_submit_button(
        "生成排班方案",
        type="primary",
        help="按当前输入数据与求解配置执行一次 7 d 排班求解。",
    )

if submitted:
    st.session_state.pop("schedule_result", None)
    uploaded_bytes: bytes | None = None
    if data_source == "上传工作簿":
        if uploaded_workbook is None:
            st.error("请先选择一个 .xlsx 工作簿。")
        elif len(uploaded_workbook.getbuffer()) > MAX_UPLOAD_BYTES:
            st.error("上传文件超过 25 MiB 限制，请压缩文件或使用合成演示工作簿。")
        else:
            uploaded_bytes = uploaded_workbook.getvalue()

    if data_source == "合成演示工作簿" or uploaded_bytes is not None:
        profile_code = OBJECTIVE_PROFILES[profile_label][0]
        try:
            with st.spinner("正在构建模型并执行求解，请稍候。"):
                result = _run_solver(
                    workbook_bytes=uploaded_bytes,
                    objective_profile=profile_code,
                    demand_multiplier=float(demand_multiplier),
                    time_limit_seconds=int(time_limit_seconds),
                    minimum_coverage=float(minimum_coverage_input) if use_minimum_coverage else None,
                    scenario_name=scenario_name.strip() or "本机排班演示",
                )
            st.session_state["schedule_result"] = result
            st.session_state.pop("schedule_search", None)
            st.success("排班方案已生成。")
        except SolverRunError as error:
            st.error(str(error))
        except Exception as error:
            st.error(f"页面执行失败：{type(error).__name__}。请检查工作簿格式与部署日志。")

if "schedule_result" in st.session_state:
    _show_result(st.session_state["schedule_result"])

with st.expander("模型与指标说明"):
    st.markdown(
        """
        - **求解算法**：混合整数规划，使用 Pyomo 建模并由 HiGHS 求解；求解器在独立 Python 子进程中运行。
        - **排班范围**：仅使用 `solve-demo` 功能，范围为 SX-PET01 产线和输入日期中的首 7 d。
        - **覆盖率**：已覆盖需求人班数 ÷ 总需求人班数；包含整数人班及非完整班次折算量。
        - **岗位缺口**：需求与实际覆盖之间的未满足人班数，按关键岗位和一般岗位分类计入模型指标。
        - **工时最大差**：至少有一条排班指派的员工中，最高计薪工时减最低计薪工时。
        - **人力成本边界**：输入文件没有统一工资单价，本页面不将模型目标值解释为货币成本。
        - **数据边界**：演示数据或上传数据的结果仅供本地分析使用，必须结合现场规则复核后再用于生产。
        """
    )
