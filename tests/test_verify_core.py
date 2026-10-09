import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from verify_core import kpi_components, objective_value, verify_seven


class VerifyCoreTests(unittest.TestCase):
    def data(self, demand):
        return {
            "POS": {"P1": {"key_flag": 0, "line": "L1", "factory": "F1"}},
            "QUAL": {("E1", "P1")},
            "can_night": {"E1": True},
            "dates": ["2026-07-01"],
            "emp_list": ["E1"],
            "demand": demand,
            "changeover": {},
        }

    def test_empty_demand_is_not_publishable_and_kpi_ratio_is_null(self):
        data = self.data({})
        passed, violations, samples = verify_seven([], {}, [], data)
        self.assertFalse(passed)
        self.assertGreater(violations["coverage_eq"], 0)
        self.assertTrue(samples)
        self.assertIsNone(kpi_components([], {}, [], data)["coverage_rate"])

    def test_assignment_outside_demand_is_rejected(self):
        demand = {("P1", "2026-07-01", "夜班"): 0}
        passed, violations, _ = verify_seven(
            [("E1", "P1", "2026-07-01", "D8")], {}, [], self.data(demand))
        self.assertFalse(passed)
        self.assertGreater(violations["coverage_eq"], 0)

    def test_fractional_assignment_checks_employee_and_hour_limit(self):
        demand = {("P1", "2026-07-01", "白班"): 10}
        passed, violations, _ = verify_seven(
            [], {}, [
                ("UNKNOWN", "P1", "2026-07-01", "D12", 80.0),
                ("E1", "P1", "2026-07-01", "D12", 80.0),
            ], self.data(demand))
        self.assertFalse(passed)
        self.assertGreater(violations["qual_night"], 0)
        self.assertGreater(violations["daily_hours"], 0)

    def test_objective_recalculation_uses_model_employee_scope(self):
        components = {
            "key_gap": 0,
            "gen_gap": 0,
            "co_gap": 0,
            "shifts_12h": 98,
            "hours_range": 33,
        }
        weights = {
            "gap_key": 100,
            "gap_gen": 40,
            "co_gap_extra": 20,
            "ot_per_hour": 5,
            "balance_per_hour": 2,
            "util_per_shift": 1,
        }
        self.assertEqual(objective_value(components, weights, balance_range_hours=44), 1460)


if __name__ == "__main__":
    unittest.main()
