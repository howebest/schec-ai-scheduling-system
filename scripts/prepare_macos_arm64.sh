#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FRONTEND="$ROOT/frontend"
BACKEND="$ROOT/backend"
WHEELHOUSE="$ROOT/vendor/python/wheelhouse-macos-arm64-cp311"
WHEELHOUSE_NEW="$WHEELHOUSE.tmp.$$"
WHEELHOUSE_OLD="$WHEELHOUSE.previous.$$"

fail() { printf '%s\n' "依赖准备失败：$*" >&2; exit 1; }
cleanup() { rm -rf "$WHEELHOUSE_NEW"; }
trap cleanup EXIT HUP INT TERM

[ "$(uname -s)" = "Darwin" ] || fail "依赖准备须在 macOS 上完成。"
[ "$(uname -m)" = "arm64" ] || fail "依赖准备须在 Apple Silicon arm64 设备上完成。"
command -v cargo >/dev/null 2>&1 || fail "找不到 Rust cargo。"
command -v npm >/dev/null 2>&1 || fail "找不到 npm。"
PYTHON_BIN=${SCHED_PYTHON_BIN:-$(command -v python3.11 || true)}
[ -n "$PYTHON_BIN" ] && [ -x "$PYTHON_BIN" ] || fail "找不到 CPython 3.11。请设置 SCHED_PYTHON_BIN。"
if [ -z "${SSL_CERT_FILE:-}" ] && [ ! -f /opt/homebrew/etc/openssl@3/cert.pem ] && [ -f /etc/ssl/cert.pem ]; then
  SSL_CERT_FILE=/etc/ssl/cert.pem
  export SSL_CERT_FILE
fi

# Resolve and fetch pinned dependencies once; package_macos_arm64.sh consumes
# these lock files, wheel artifacts and local caches without network access.
(if [ ! -f "$FRONTEND/package-lock.json" ]; then
  cd "$FRONTEND"
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund
fi)
(cd "$FRONTEND" && npm ci --no-audit --no-fund)
(if [ ! -f "$BACKEND/Cargo.lock" ]; then
  cd "$BACKEND"
  cargo generate-lockfile
fi)
(cd "$BACKEND" && cargo fetch --locked)
mkdir -p "$ROOT/vendor/python"
rm -rf "$WHEELHOUSE_NEW"
mkdir -p "$WHEELHOUSE_NEW"
"$PYTHON_BIN" -m pip download --disable-pip-version-check --only-binary=:all: \
  --dest "$WHEELHOUSE_NEW" --requirement "$ROOT/config/python-lock-macos-arm64-cp311.txt"
"$PYTHON_BIN" "$ROOT/scripts/hash_python_wheelhouse.py" create "$WHEELHOUSE_NEW"
if [ -d "$WHEELHOUSE" ]; then mv "$WHEELHOUSE" "$WHEELHOUSE_OLD"; fi
if mv "$WHEELHOUSE_NEW" "$WHEELHOUSE"; then
  rm -rf "$WHEELHOUSE_OLD"
else
  [ ! -d "$WHEELHOUSE_OLD" ] || mv "$WHEELHOUSE_OLD" "$WHEELHOUSE"
  fail "无法安装新的 wheelhouse。"
fi

printf '%s\n' "依赖准备完成。现在可使用 ./run.sh build 生成本机 macOS arm64 工程包。"
