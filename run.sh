#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN="$ROOT/bin/scheduling-service"
RUNTIME="$ROOT/data/runtime"
LOG_DIR="$ROOT/logs"
PID_FILE="$RUNTIME/scheduling-service.pid"
LOG_FILE="$LOG_DIR/scheduling-service.log"
PORT=${SCHED_PORT:-8080}
HOST=${SCHED_HOST:-127.0.0.1}
HEALTH_URL="http://$HOST:$PORT/api/v1/health"

fail() { printf '%s\n' "启动脚本：$*" >&2; exit 1; }
ensure_dirs() { mkdir -p "$RUNTIME" "$LOG_DIR"; }

pid_is_service() {
  [ -f "$PID_FILE" ] || return 1
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  case "$PID" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$PID" 2>/dev/null || return 1
  COMMAND_LINE=$(ps -p "$PID" -o command= 2>/dev/null || true)
  case "$COMMAND_LINE" in *"$BIN"*) return 0 ;; *) return 1 ;; esac
}

stop_service() {
  if ! pid_is_service; then
    rm -f "$PID_FILE"
    printf '%s\n' "服务当前未运行。"
    return 0
  fi
  PID=$(cat "$PID_FILE")
  kill -INT "$PID" 2>/dev/null || true
  attempt=0
  while kill -0 "$PID" 2>/dev/null && [ "$attempt" -lt 40 ]; do
    sleep 1
    attempt=$((attempt + 1))
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" 2>/dev/null || true
    attempt=0
    while kill -0 "$PID" 2>/dev/null && [ "$attempt" -lt 10 ]; do
      sleep 1
      attempt=$((attempt + 1))
    done
  fi
  if kill -0 "$PID" 2>/dev/null; then fail "服务未能停止，PID 文件已保留，请查看 ${LOG_FILE}。"; fi
  rm -f "$PID_FILE"
  printf '%s\n' "本机服务已停止。Rust 服务已发送停止信号并清理其管理的 Python 任务进程。"
}

start_service() {
  [ "$(uname -s)" = "Darwin" ] || fail "当前发行包面向 macOS。"
  [ "$(uname -m)" = "arm64" ] || fail "当前发行包面向 Apple Silicon arm64。"
  [ -x "$BIN" ] || fail "缺少 Rust 服务二进制。请先在兼容环境执行 ./run.sh build。"
  [ -s "$ROOT/frontend/dist/index.html" ] || fail "缺少前端构建产物。请先执行 ./run.sh build。"
  [ -f "$ROOT/src/service_adapter.py" ] || fail "缺少 Python 任务适配器。"
  PYTHON_BIN=${SCHED_PYTHON_BIN:-$(command -v python3.11 || true)}
  [ -n "$PYTHON_BIN" ] && [ -x "$PYTHON_BIN" ] || fail "找不到 CPython 3.11。请安装同版本解释器或设置 SCHED_PYTHON_BIN。"
  [ -d "$ROOT/vendor/python/macos-arm64-cp311" ] || fail "缺少包内 Python vendor 依赖。请先执行 ./run.sh build。"
  PYTHONPATH="$ROOT/vendor/python/macos-arm64-cp311" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 \
    "$PYTHON_BIN" "$ROOT/scripts/verify_python_runtime.py" >/dev/null \
    || fail "CPython 依赖版本、ABI 或导入检查失败。"

  if pid_is_service; then printf '%s\n' "服务已运行：$HEALTH_URL"; return 0; fi
  ensure_dirs
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "端口 $PORT 已被占用。请设置 SCHED_PORT 或停止占用进程。"
  fi
  cd "$ROOT"
  nohup env SCHED_PACKAGE_ROOT="$ROOT" SCHED_HOST="$HOST" SCHED_PORT="$PORT" \
    SCHED_PYTHON_BIN="$PYTHON_BIN" PYTHONNOUSERSITE=1 PYTHONDONTWRITEBYTECODE=1 \
    "$BIN" >>"$LOG_FILE" 2>&1 </dev/null &
  PID=$!
  printf '%s\n' "$PID" > "$PID_FILE.tmp"
  mv "$PID_FILE.tmp" "$PID_FILE"
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl --silent --fail "$HEALTH_URL" >/dev/null 2>&1; then
      printf '%s\n' "本机服务已启动：$HEALTH_URL"
      return 0
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      rm -f "$PID_FILE"
      fail "服务进程已退出。请查看 ${LOG_FILE}。"
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  stop_service
  fail "服务在 30 s 内未通过健康检查。请查看 ${LOG_FILE}。"
}

case "${1:-status}" in
  build)
    "$ROOT/scripts/package_macos_arm64.sh"
    ;;
  prepare)
    "$ROOT/scripts/prepare_macos_arm64.sh"
    ;;
  start)
    ensure_dirs
    start_service
    ;;
  stop)
    ensure_dirs
    stop_service
    ;;
  restart)
    ensure_dirs
    stop_service
    start_service
    ;;
  status)
    if pid_is_service && curl --silent --fail "$HEALTH_URL"; then
      printf '\n'
    else
      printf '%s\n' "服务未运行。"
      exit 1
    fi
    ;;
  logs)
    [ -f "$LOG_FILE" ] || fail "尚无服务日志文件。"
    tail -n 100 -f "$LOG_FILE"
    ;;
  *)
    fail "用法：./run.sh {prepare|build|start|stop|restart|status|logs}"
    ;;
esac
