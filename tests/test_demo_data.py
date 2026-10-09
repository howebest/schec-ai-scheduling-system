import csv
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class DemoDataTests(unittest.TestCase):
    def run_generator(self, destination):
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "generate_demo_data.py"),
             "--output-dir", str(destination)],
            check=True, capture_output=True, text=True,
        )

    def test_generation_is_seeded_labeled_and_repeatable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first, second = root / "first", root / "second"
            self.run_generator(first)
            self.run_generator(second)
            names = ("orders.csv", "line_capacity.csv", "attendance_snapshot.csv", "manifest.json")
            for name in names:
                self.assertEqual((first / name).read_bytes(), (second / name).read_bytes())
            manifest = json.loads((first / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["source_type"], "synthetic_demo")
            self.assertEqual(manifest["seed"], 20260930)
            self.assertEqual(set(manifest["files"]), set(names[:-1]))
            for name, item in manifest["files"].items():
                actual = hashlib.sha256((first / name).read_bytes()).hexdigest()
                self.assertEqual(item["sha256"], actual)
                self.assertEqual(item["source_type"], "synthetic_demo")

    def test_csv_headers_match_the_documented_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.run_generator(output)
            expected = {
                "orders.csv": ["order_id", "line_code", "product_code", "required_units", "due_at", "priority"],
                "line_capacity.csv": ["line_code", "product_code", "units_per_hour", "efficiency_pct", "available_hours", "shift_code"],
                "attendance_snapshot.csv": ["employee_id", "schedule_date", "shift_code", "status", "source_type"],
            }
            for filename, columns in expected.items():
                with (output / filename).open(encoding="utf-8", newline="") as stream:
                    self.assertEqual(next(csv.reader(stream)), columns)


if __name__ == "__main__":
    unittest.main()
