#!/usr/bin/env python3
"""Create or verify a stable SHA-256 manifest for the prepared wheelhouse."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in {"create", "verify"}:
        print("用法：hash_python_wheelhouse.py {create|verify} <wheelhouse>", file=sys.stderr)
        return 2
    root = Path(sys.argv[2]).resolve()
    manifest = root / "SHA256SUMS"
    if not root.is_dir():
        print("wheelhouse 目录不存在。", file=sys.stderr)
        return 2
    if sys.argv[1] == "create":
        files = sorted(path for path in root.rglob("*") if path.is_file() and path != manifest)
        if not files:
            print("wheelhouse 为空。", file=sys.stderr)
            return 2
        body = "".join(f"{digest(path)}  {path.relative_to(root).as_posix()}\n" for path in files)
        manifest.write_text(body, encoding="utf-8")
        return 0
    expected = {}
    try:
        for line in manifest.read_text(encoding="utf-8").splitlines():
            value, relative = line.split("  ", 1)
            expected[relative] = value
    except (OSError, ValueError):
        print("wheelhouse SHA256SUMS 格式无效。", file=sys.stderr)
        return 2
    actual_files = {path.relative_to(root).as_posix(): path
                    for path in root.rglob("*") if path.is_file() and path != manifest}
    if set(actual_files) != set(expected):
        print("wheelhouse 文件清单与 SHA256SUMS 不一致。", file=sys.stderr)
        return 1
    for relative, path in actual_files.items():
        if digest(path) != expected[relative]:
            print(f"wheelhouse 文件校验失败：{relative}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
