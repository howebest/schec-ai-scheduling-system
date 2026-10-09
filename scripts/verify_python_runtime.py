#!/usr/bin/env python3
"""Verify that a process can import the isolated package Python dependencies."""
from __future__ import annotations

import importlib.metadata
import hashlib
import json
import platform
import sys
from pathlib import Path

EXPECTED = {"pyomo": "6.10.1", "highspy": "1.15.1", "pandas": "2.2.3", "openpyxl": "3.1.5"}
ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor/python/macos-arm64-cp311"


def verify_vendor_hashes() -> tuple[bool, str]:
    manifest = VENDOR / "SHA256SUMS"
    if not manifest.is_file():
        return False, "缺少 Python vendor SHA256SUMS 清单。"
    expected: dict[str, str] = {}
    for line_number, line in enumerate(manifest.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            digest, relative = line.split("  ", 1)
        except ValueError:
            return False, f"Python vendor 哈希清单第 {line_number} 行格式无效。"
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or relative in expected:
            return False, f"Python vendor 哈希清单第 {line_number} 行路径无效。"
        expected[relative] = digest
    actual_files = {path.relative_to(VENDOR).as_posix() for path in VENDOR.rglob("*")
                    if path.is_file() and path.name != "SHA256SUMS"}
    if not expected or actual_files != set(expected):
        return False, "Python vendor 文件集合与 SHA256SUMS 不一致。"
    for relative, expected_digest in expected.items():
        path = (VENDOR / relative).resolve()
        if not path.is_relative_to(VENDOR.resolve()) or not path.is_file():
            return False, f"Python vendor 文件路径无效：{relative}"
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != expected_digest:
            return False, f"Python vendor 文件哈希不匹配：{relative}"
    return True, ""


def main() -> int:
    if sys.version_info[:2] != (3, 11) or platform.python_implementation() != "CPython":
        print("需要 CPython 3.11。", file=sys.stderr)
        return 2
    hashes_ok, hash_error = verify_vendor_hashes()
    if not hashes_ok:
        print(hash_error, file=sys.stderr)
        return 2
    missing, wrong = [], []
    for name, expected in EXPECTED.items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            missing.append(name)
            continue
        if actual != expected:
            wrong.append(f"{name}={actual}（要求 {expected}）")
    if missing or wrong:
        print(json.dumps({"missing": missing, "version_mismatches": wrong}, ensure_ascii=False), file=sys.stderr)
        return 2
    import highspy  # noqa: F401
    import openpyxl  # noqa: F401
    import pandas  # noqa: F401
    import pyomo.environ  # noqa: F401
    print(json.dumps({"python": sys.version.split()[0], "architecture": platform.machine(), "status": "ok"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
