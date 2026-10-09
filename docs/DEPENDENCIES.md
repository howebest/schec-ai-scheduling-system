# 依赖和兼容性说明

## 1. 工程化包发行目标

发行构建目标为 macOS Apple Silicon arm64：

| 组件 | 版本/方式 | 运行期位置 |
| --- | --- | --- |
| Rust | stable，具体版本随 Cargo 构建环境记录 | `bin/scheduling-service` |
| HTTP | Axum/Tokio，依赖版本固定在 `backend/Cargo.toml` 与 `backend/Cargo.lock` | Rust 二进制内 |
| 前端 | React 19、Ant Design 5、Vite 7、ECharts 6，版本锁定在 `frontend/package.json` 和 `frontend/package-lock.json` | `frontend/dist/` 静态文件 |
| Python 解释器 | 标准 CPython 3.11，ABI 为 cp311 | 由目标 Mac 提供，可用 `SCHED_PYTHON_BIN` 指定 |
| 排班 MIP | Pyomo 6.10.1、highspy 1.15.1 | `vendor/python/macos-arm64-cp311/` |
| 数据处理 | NumPy 2.2.6、pandas 2.2.3、openpyxl 3.1.5、et-xmlfile 2.0.0、ply 3.11 | 同上 |

发行构建须在 Mac arm64 与 CPython 3.11 上生成，避免打入 Linux 或 x86_64 原生扩展。依赖准备阶段为 wheelhouse 生成 SHA-256 清单，离线发行构建先核验清单；`scripts/verify_python_vendor.py` 在构建时检查解释器、包版本和原生扩展导入，并为 vendor 目录生成 `SHA256SUMS`。运行脚本将第三方模块路径限定到包内 vendor 并设置 `PYTHONNOUSERSITE=1`。

## 2. 发行构建依赖

首次构建需要 Rust stable、Node.js/npm、CPython 3.11 和依赖获取能力。先运行 `./run.sh prepare` 生成 Cargo/npm 锁文件、获取 Rust crate 缓存及 CPython arm64 wheelhouse；再运行 `./run.sh build` 离线构建静态产物、Rust 二进制和 Python vendor 安装目录。完成发行构建后，运行无需 Node/npm、Rust 编译器、外部数据库服务或网络。

## 3. 求解算法和限制

- 排班 MIP 使用 Pyomo `ConcreteModel` / `ConstraintList` 与 HiGHS Appsi 接口。
- 不使用 GPU 和商业求解器，不需要商业许可证。
- 不导入 OR-Tools。既有依赖说明记录了同一进程加载 highspy 与 OR-Tools 时的原生库符号冲突；如需跨求解器比较，应分进程执行。
- 补位候选排序为现有规则评分，不是训练后的概率模型。
- 当前工程文件未发现可由后端直接加载的已训练机器学习模型。

## 4. 既有验证记录与新发行目标

原始 SCHEC 求解源码的既有运行记录针对 Linux x86_64 CPython 3.11；该记录不能证明新的 macOS arm64 Rust 服务、React 静态资源或 Python 原生 vendor 已经构建。本机发行包须按 `docs/ACCEPTANCE.md` 在目标设备重新执行验收。

## 5. 许可证

发行前需在随包 notice 文件中复核并附带 React、Ant Design、Ant Design Icons、ECharts、Python 包、HiGHS 及其传递依赖的许可证文本和 notices。原始数据与方案文件按项目数据授权使用，不随开源依赖许可证分发。

## 6. Streamlit Community Cloud 独立页面

仓库根目录的 `streamlit_app.py` 可作为 Streamlit Community Cloud 的独立入口。Cloud 运行环境为 Linux，应通过根目录 `requirements.txt` 按 PyPI 发行包安装依赖；不得复用 `config/python-lock-macos-arm64-cp311.txt` 中的 macOS arm64 wheel 文件。应用高级设置使用 CPython 3.11，与当前项目锁定的 Python 包版本保持一致。

页面通过子进程调用 `src/sched_solver.py solve-demo`。求解依赖为 Pyomo 6.10.1 和 HiGHS `highspy` 1.15.1；页面依赖 Streamlit 1.65.0、NumPy 2.2.6、pandas 2.2.3 与 openpyxl 3.1.5。Streamlit 子进程隔离 HiGHS 原生库，避免将其加载到页面主进程。
