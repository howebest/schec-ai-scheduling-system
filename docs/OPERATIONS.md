# 本机部署与运维说明

## 1. 发行目标

- macOS Apple Silicon（arm64）。
- Rust 服务默认监听 `127.0.0.1:8080`，Rust 同时提供 API 与 `frontend/dist` 静态资源。
- CPython 3.11 解释器由目标 Mac 提供；Python 第三方库安装在工程包 `vendor/python/macos-arm64-cp311/`。
- 求解任务由 Rust 以单个受控子进程调用 Python 适配器。SQLite 和静态页面均为包内本机资源，不需要单独数据库或前端开发服务器。

## 2. 构建发行包

在目标 Mac 准备 Rust stable、Node.js LTS/npm、CPython 3.11 和依赖获取能力。首次构建按顺序运行：

```sh
./run.sh prepare
./run.sh build
```

`prepare` 命令生成并下载锁定依赖、CPython 3.11 arm64 wheelhouse 与 Cargo 缓存。`build` 命令离线读取这些依赖，生成 React 静态资源、Python vendor 依赖哈希清单及 arm64 release 二进制。发行构建使用 macOS arm64 主机，避免复制 Linux 或 x86_64 原生扩展。

运行期不需要 Node、npm、Cargo、Rust 编译器或网络。运行期必须有 CPython 3.11 标准解释器；第三方模块从包内 vendor 目录加载，并启用 `PYTHONNOUSERSITE=1`。

## 3. 统一脚本

| 命令 | 用途 |
| --- | --- |
| `./run.sh prepare` | 首次构建时解析并缓存版本锁定的发行依赖 |
| `./run.sh build` | 在兼容 Mac 上构建本机发行文件 |
| `./run.sh start` | 检查平台、二进制、静态资源、Python ABI 和依赖后启动服务 |
| `./run.sh status` | 查看 PID 与健康接口状态 |
| `./run.sh stop` | 向 Rust 服务发送中断信号，等待 Rust 清理 Python 任务进程 |
| `./run.sh restart` | 停止后重新启动 |
| `./run.sh logs` | 查看服务日志 |

可在启动前设置 `SCHED_HOST`、`SCHED_PORT`、`SCHED_PYTHON_BIN`。默认仅监听本机回环地址。避免设置为外部网卡地址，除非已另行配置系统访问控制。

## 4. 运行目录与备份

- SQLite：`data/runtime/scheduling.sqlite3`。
- 任务 JSON、日志和计算产物：`out/jobs/<job_id>/`。
- 导入预览：`out/import-previews/`。
- 已提交导入：`data/imported/<dataset_id>/`。
- 服务 PID：`data/runtime/scheduling-service.pid`。
- 服务日志：`logs/scheduling-service.log`。

备份前先停止服务，再复制 SQLite、`data/imported/`、`out/jobs/` 和配置目录。不要编辑 `data/raw_dataset.xlsx`、`data/baseline_schedule_FULL62_W1.csv` 或其原始哈希记录。

## 5. 启动诊断

| 现象 | 处理 |
| --- | --- |
| 缺少 Rust release 二进制或 `frontend/dist/index.html` | 在兼容 macOS arm64 构建机执行 `./run.sh build` |
| 找不到 CPython 3.11 | 安装标准 CPython 3.11，或设置 `SCHED_PYTHON_BIN` 指向该解释器 |
| Python ABI、版本或导入检查失败 | 检查 `vendor/python/macos-arm64-cp311/SHA256SUMS` 和 `config/python-lock-macos-arm64-cp311.txt`，重新构建 vendor |
| 端口被占用 | 设置未占用的 `SCHED_PORT`，再执行 `./run.sh start` |
| 任务返回缺少求解依赖 | 检查包内 vendor 目录；求解器不使用用户级或系统级 Python site-packages |
| 健康检查超时 | 查看 `logs/scheduling-service.log`，确认端口监听、静态目录和数据库写入权限 |

停止脚本先发送 `SIGINT`，等待最多 40 s，再以 `SIGTERM` 结束 Rust 服务。服务管理的 Python 进程通过 Tokio 子进程生命周期和任务取消令牌清理。

## 6. 数据权限和个人信息

运行数据保存在本机目录。真实员工数据、证书和排班文件可能包含个人信息；仅在获批设备和受控目录中使用，并按组织的数据保留规则备份或删除。系统当前不具备账号认证、磁盘加密、远程审计服务或多用户并发隔离能力。
