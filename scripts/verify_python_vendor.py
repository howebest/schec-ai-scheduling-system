#!/usr/bin/env python3
"""Validate the package-local CPython vendor set and write stable file hashes."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENDOR = Path(os.environ.get("SCHED_PYTHON_VENDOR_DIR", ROOT / "vendor/python/macos-arm64-cp311"))
EXPECTED = {
    "numpy": "2.2.6",
    "pandas": "2.2.3",
    "openpyxl": "3.1.5",
    "et-xmlfile": "2.0.0",
    "ply": "3.11",
    "pyomo": "6.10.1",
    "highspy": "1.15.1",
}


def main() -> int:
    if sys.version_info[:2] != (3, 11) or platform.python_implementation() != "CPython":
        print("需要 CPython 3.11。", file=sys.stderr)
        return 2
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        print("需要 macOS arm64 构建环境。", file=sys.stderr)
        return 2
    if not VENDOR.is_dir():
        print(f"缺少 Python vendor 目录：{VENDOR}", file=sys.stderr)
        return 2
    missing = []
    wrong = []
    for package, version in EXPECTED.items():
        try:
            actual = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            missing.append(package)
            continue
        if actual != version:
            wrong.append(f"{package}: 预期 {version}，实际 {actual}")
    if missing or wrong:
        print(json.dumps({"missing": missing, "version_mismatches": wrong}, ensure_ascii=False), file=sys.stderr)
        return 2
    # Importing these modules verifies native extensions and the solver binding.
    import highspy  # noqa: F401
    import numpy  # noqa: F401
    import openpyxl  # noqa: F401
    import pandas  # noqa: F401
    import pyomo.environ  # noqa: F401

    paths = sorted(path for path in VENDOR.rglob("*") if path.is_file() and path.name != "SHA256SUMS")
    rows = []
    for path in paths:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        rows.append(f"{digest}  {path.relative_to(VENDOR).as_posix()}")
    (VENDOR / "SHA256SUMS").write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(json.dumps({"python": sys.version.split()[0], "architecture": platform.machine(),
                      "packages": EXPECTED, "hashed_files": len(rows)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
