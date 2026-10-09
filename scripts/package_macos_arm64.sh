#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
PYTHON_VENDOR="$ROOT/vendor/python/macos-arm64-cp311"
PYTHON_VENDOR_NEW="$PYTHON_VENDOR.tmp.$$"
PYTHON_VENDOR_OLD="$PYTHON_VENDOR.previous.$$"
PYTHON_WHEELHOUSE="$ROOT/vendor/python/wheelhouse-macos-arm64-cp311"

fail() { printf '%s\n' "打包失败：$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "发行构建须在 macOS 上完成。"
[ "$(uname -m)" = "arm64" ] || fail "发行构建须在 Apple Silicon arm64 设备上完成。"
command -v cargo >/dev/null 2>&1 || fail "找不到 Rust cargo。请准备 Rust stable 工具链后重试。"
command -v npm >/dev/null 2>&1 || fail "找不到 npm。请准备 Node.js LTS 后重试。"
PYTHON_BIN=${SCHED_PYTHON_BIN:-$(command -v python3.11 || true)}
[ -n "$PYTHON_BIN" ] && [ -x "$PYTHON_BIN" ] || fail "找不到 CPython 3.11。请设置 SCHED_PYTHON_BIN。"

[ -f "$FRONTEND/package-lock.json" ] || fail "缺少前端锁定文件。请先运行 ./run.sh prepare。"
[ -f "$BACKEND/Cargo.lock" ] || fail "缺少 Rust 锁定文件。请先运行 ./run.sh prepare。"
[ -d "$PYTHON_WHEELHOUSE" ] || fail "缺少 CPython 3.11 arm64 wheelhouse。请先运行 ./run.sh prepare。"
"$PYTHON_BIN" "$ROOT/scripts/hash_python_wheelhouse.py" verify "$PYTHON_WHEELHOUSE" \
  || fail "CPython wheelhouse 文件完整性检查失败，请重新运行 ./run.sh prepare。"
(cd "$FRONTEND" && npm ci --offline --no-audit --no-fund && npm run build)

mkdir -p "$ROOT/vendor/python"
rm -rf "$PYTHON_VENDOR_NEW"
mkdir -p "$PYTHON_VENDOR_NEW"
"$PYTHON_BIN" -m pip install --disable-pip-version-check --no-index --find-links "$PYTHON_WHEELHOUSE" \
  --only-binary=:all: --target "$PYTHON_VENDOR_NEW" \
  --requirement "$ROOT/config/python-lock-macos-arm64-cp311.txt"
SCHED_PYTHON_VENDOR_DIR="$PYTHON_VENDOR_NEW" PYTHONPATH="$PYTHON_VENDOR_NEW" PYTHONNOUSERSITE=1 \
  "$PYTHON_BIN" "$ROOT/scripts/verify_python_vendor.py"
if [ -d "$PYTHON_VENDOR" ]; then mv "$PYTHON_VENDOR" "$PYTHON_VENDOR_OLD"; fi
if mv "$PYTHON_VENDOR_NEW" "$PYTHON_VENDOR"; then
  rm -rf "$PYTHON_VENDOR_OLD"
else
  [ ! -d "$PYTHON_VENDOR_OLD" ] || mv "$PYTHON_VENDOR_OLD" "$PYTHON_VENDOR"
  fail "无法安装新的 Python vendor 目录。"
fi

(cd "$BACKEND" && cargo build --release --locked --offline)
mkdir -p "$ROOT/bin"
cp "$BACKEND/target/release/scheduling-service" "$ROOT/bin/scheduling-service"
chmod 755 "$ROOT/bin/scheduling-service"

file "$ROOT/bin/scheduling-service" | grep -q 'arm64' || fail "Rust 可执行文件未识别为 macOS arm64。"
[ -s "$FRONTEND/dist/index.html" ] || fail "缺少前端静态入口文件。"
printf '%s\n' "发行构建完成。使用 ./run.sh start 启动，使用 ./run.sh stop 停止。"
