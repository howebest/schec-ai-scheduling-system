# AI 智能排班本机工程化包

本工程保留已验收的 SCHEC 排班求解源码、基准数据与独立核验实现，并增加 Rust 单端口服务、React + Ant Design 本机工作台、SQLite 任务与版本目录、统一启动脚本及发行构建流程。

## 当前交付边界

本工程已在 macOS arm64 完成依赖准备、锁定离线发行构建和本机启动验收。本机发行目录包含 `bin/scheduling-service`、`frontend/dist/`、Cargo/npm 锁文件、arm64 CPython 3.11 wheelhouse 与 `vendor/python/macos-arm64-cp311/`。统一脚本可启动、检查状态、停止服务并查看日志。

GitHub 源码仓库不提交生成的 wheelhouse 和已安装的 vendor 运行库。首次克隆后执行 `./run.sh prepare`，脚本会按 `config/python-lock-macos-arm64-cp311.txt` 下载固定版本依赖；随后执行 `./run.sh build` 生成 Rust 服务、前端静态资源及 Python vendor 目录。依赖准备完成后，构建和运行均可在本机离线完成。

包内没有已训练完成、可由后端直接加载的机器学习模型。可调用算法是 Pyomo + HiGHS 混合整数规划求解、独立硬约束校验和规则化补位排序。模型管理页登记阶段版本、求解目标、KPI 双口径和两份离线 HTML 交付报告。真实 HR、APS、MES、考勤、订单协同和消息服务不在本机运行范围内。

## 首次构建和运行

在 Mac Apple Silicon 上准备 Rust stable、Node.js LTS、CPython 3.11 和依赖获取能力。首次构建先准备并锁定依赖，再进行离线发行构建：

```sh
./run.sh prepare
./run.sh build
./run.sh start
```

打开 `http://127.0.0.1:8080`。后续可运行：

```sh
./run.sh status
./run.sh logs
./run.sh stop
```

依赖准备过程生成前端与 Rust 锁文件并下载目标平台的 Python wheels；发行构建只使用锁文件、本地缓存和 wheelhouse。构建产出前端静态资源、Rust 服务二进制、CPython 3.11 vendor 依赖及文件哈希。运行阶段无需 Node、npm、Cargo 或外网，但需要标准 CPython 3.11 解释器。

## 工程目录

| 目录 | 说明 |
| --- | --- |
| `backend/` | Rust Axum 服务、SQLite 迁移、REST API 和受控 Python 子进程 |
| `frontend/` | React、TypeScript、Ant Design 和 ECharts 工作台 |
| `src/` | 已验收排班模型、事件重排、KPI 和独立核验源码 |
| `data/` | 原始样本、已验收基准和明确标记的合成演示数据 |
| `examples/events/` | 五类异常场景样例 |
| `scripts/` | 合成数据、依赖准备、发行构建和 Python vendor 校验脚本 |
| `docs/` | 用户、运维、API、数据治理、验收与培训说明 |

## 核心页面

- 运行总览、排班任务与方案版本复核。
- 插单、增产、换产、设备故障及员工突发离岗场景。
- 人员技能样例、按员工编号的排班预览、合成考勤看板。
- 岗位覆盖、缺口、加班、工时分布、基尼系数及产能敏感性；新增排班数据分析提供方案明细的日期、工厂、产线、班次和岗位筛选、趋势与覆盖率热力图、员工工时分布统计、异常筛查和维度明细；排班管理分析继续提供单方案评价与多方案比较。
- 数据字段预览、规则版本、模型版本链与阶段报告目录、调度档案、模拟反馈与连接器状态。

模型管理页内置 `SCHEC-KPI-V1.0.1` 与 `SCHEC-DELIVERY-V1.0` 两份离线 HTML 报告，可在页面预览或下载。报告所用数据是规则驱动仿真样本，不代表实际工厂绩效。

## 扩充演示数据

扩充版数据新增 96 名合成演示员工，使人员目录达到 132 人；班组达到 42 个，岗位字典包含 8 类，技能字典包含 12 项，并新增 12 套 14 d 排班方案。方案覆盖成本、覆盖率、公平性、技能匹配、夜班保障、缺勤应急、换型、多技能补位和旺季增产等场景。系统启动时按版本号幂等导入，原 `FULL62-W1` 基准不变。

启动后，在顶栏数据版本中选择“合成演示数据（人员与多方案扩充）”，即可查看方案管理和排班管理分析数据。扩充方案中的满意度、合规规则检查和人工成本均为合成模拟口径，未执行独立核验。字段分类、关联键、方案指标定义和完整数据文件见[本机扩充演示数据目录](docs/demo-data-catalog.md)。

## 文档与检查

- [用户手册](docs/USER_GUIDE.md)
- [运维说明](docs/OPERATIONS.md)
- [API 说明](docs/API.md)
- [数据治理与指标口径](docs/DATA_GOVERNANCE.md)
- [培训步骤](docs/TRAINING_GUIDE.md)
- [验收记录](docs/ACCEPTANCE.md)
- [依赖说明](docs/DEPENDENCIES.md)

Python 适配器与演示数据生成器检查：

```sh
python3.11 -m unittest discover -s tests -v
```

前端展示逻辑和排班分析计算检查：

```sh
npm test --prefix frontend
```
