import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import service_adapter


class ServiceAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = Path(self.temp.name)
        (self.work / "data").mkdir()
        (self.work / "data" / "input.xlsx").write_bytes(b"fixture")

    def tearDown(self):
        self.temp.cleanup()

    def valid_info_request(self):
        return {
            "schema_version": 1,
            "job_id": "job-test-001",
            "task": "info",
            "dataset_version": "dataset-demo-v1",
            "input_files": {"input": "data/input.xlsx"},
            "parameters": {},
        }

    def test_valid_request_returns_stable_response_schema(self):
        dispatched = {
            "return_code": 0,
            "stdout": '{"termination":"optimal","incumbent":12.5,"bound":12.5,"employees":5}',
            "stderr": "",
        }
        with patch.object(service_adapter, "dispatch_task", return_value=dispatched):
            response = service_adapter.execute(self.valid_info_request(), self.work)
        self.assertEqual(response["schema"], service_adapter.RESPONSE_SCHEMA)
        self.assertEqual(response["job_id"], "job-test-001")
        self.assertEqual(response["status"], "succeeded")
        self.assertEqual(response["summary"]["employees"], 5)
        self.assertEqual(response["summary"]["termination"], "optimal")
        self.assertEqual(response["summary"]["incumbent"], 12.5)
        self.assertEqual(response["summary"]["bound"], 12.5)
        self.assertEqual(
            set(response),
            {"schema", "job_id", "status", "exit_code", "summary", "verification",
             "timings", "artifacts", "error"},
        )

    def test_missing_task_field_returns_diagnostic_without_dispatch(self):
        request = self.valid_info_request()
        del request["task"]
        with patch.object(service_adapter, "dispatch_task") as dispatch:
            response = service_adapter.execute(request, self.work)
        dispatch.assert_not_called()
        self.assertEqual(response["status"], "failed")
        self.assertEqual(response["error"]["code"], "INVALID_REQUEST")

    def test_invalid_reschedule_event_type_is_rejected(self):
        request = self.valid_info_request()
        request.update(
            task="reschedule",
            input_files={"input": "data/input.xlsx", "baseline": "data/input.xlsx"},
            event={"type": "unknown", "line": "L1", "date": "2026-09-30"},
        )
        with patch.object(service_adapter, "dispatch_task") as dispatch:
            response = service_adapter.execute(request, self.work)
        dispatch.assert_not_called()
        self.assertEqual(response["status"], "failed")
        self.assertEqual(response["error"]["code"], "INVALID_EVENT")

    def test_path_traversal_is_rejected_without_artifact_directory(self):
        request = self.valid_info_request()
        request["input_files"]["input"] = "../../outside.xlsx"
        with patch.object(service_adapter, "dispatch_task") as dispatch:
            response = service_adapter.execute(request, self.work)
        dispatch.assert_not_called()
        self.assertEqual(response["status"], "failed")
        self.assertEqual(response["error"]["code"], "PATH_OUTSIDE_PACKAGE")
        self.assertFalse((self.work / "out" / "jobs" / "job-test-001").exists())

    def test_validate_schedule_reports_hard_constraints_without_reference_kpi(self):
        fake_builder = types.SimpleNamespace(
            load_data=lambda path: {"demand": {("P1", "2026-09-30", "白班"): 1}}
        )
        fake_verifier = types.ModuleType("verify_core")
        fake_verifier.parse_schedule_csv = lambda path: ([("E1", "P1", "2026-09-30", "D12")], {}, [])
        fake_verifier.verify_seven = lambda assign, gaps, fvals, data, demand: (
            False, {"qual_night": 1, "one_per_day": 0}, ["资格:E1-P1"])
        with patch.dict(sys.modules, {"scheduling_model_builder": fake_builder, "verify_core": fake_verifier}):
            result = service_adapter.validate_schedule(
                self.work / "schedule.csv", self.work / "data" / "input.xlsx", "solver", self.work)
        self.assertFalse(result["all_pass"])
        self.assertEqual(result["violations"]["qual_night"], 1)
        self.assertNotIn("reference_match", result)
        self.assertIn("不比较 KPI 基准登记值", result["note"])

    def test_import_preview_reports_missing_csv_fields(self):
        (self.work / "data" / "orders.csv").write_text(
            "order_id,line_code,required_units\nO1,L1,100\n", encoding="utf-8")
        request = {
            "schema_version": 1,
            "job_id": "preview-test-001",
            "task": "preview_import",
            "dataset_version": "preview",
            "input_files": {"upload": "data/orders.csv"},
            "parameters": {"schema_id": "orders"},
        }
        response = service_adapter.execute(request, self.work)
        self.assertEqual(response["status"], "succeeded")
        self.assertFalse(response["summary"]["accepted"])
        fields = {item["field"] for item in response["summary"]["field_errors"]}
        self.assertIn("product_code", fields)
        self.assertIn("due_at", fields)
        self.assertIn("priority", fields)

    def test_import_preview_rejects_nan_capacity_values(self):
        path = self.work / "data" / "capacity.csv"
        path.write_text(
            "line_code,product_code,units_per_hour,efficiency_pct,available_hours,shift_code\n"
            "L1,P1,NaN,NaN,NaN,D12\n", encoding="utf-8")
        result = service_adapter.preview_import(path, "line_capacity")
        self.assertFalse(result["accepted"])
        self.assertEqual(result["rejected_rows"], 1)

    def test_import_preview_rejects_invalid_line_run_date(self):
        path = self.work / "data" / "line_run_plan.csv"
        path.write_text(
            "产线编码,日期,班次,生产运行状态\n"
            "L1,not-a-date,白班,正常生产运行\n", encoding="utf-8")
        result = service_adapter.preview_import(path, "line_run_plan")
        self.assertFalse(result["accepted"])
        self.assertIn("日期", {item["field"] for item in result["field_errors"]})

    def test_import_preview_requires_calendar_date_format(self):
        path = self.work / "data" / "line_run_plan_compact_date.csv"
        path.write_text(
            "产线编码,日期,班次,生产运行状态\n"
            "L1,20260701,白班,正常生产运行\n", encoding="utf-8")
        result = service_adapter.preview_import(path, "line_run_plan")
        self.assertFalse(result["accepted"])
        self.assertIn("日期", {item["field"] for item in result["field_errors"]})

    def test_demand_override_requires_finite_data_cells(self):
        path = self.work / "data" / "effective_demand.json"
        path.write_text(
            '{"effective_demand":[{"position_code":"P1","date":"2026-07-01",'
            '"shift":"白班","demand":NaN}]}', encoding="utf-8")
        with self.assertRaises(service_adapter.RequestError) as error:
            service_adapter._load_demand_override(path, {
                "POS": {"P1": {}}, "dates": ["2026-07-01"],
            })
        self.assertEqual(error.exception.code, "INVALID_DEMAND_OVERRIDE")

    def test_event_preflight_rejects_unknown_line_before_task_creation(self):
        fake_builder = types.SimpleNamespace(load_data=lambda path: {
            "dates": ["2026-07-01"], "lines": {"L1"}, "emp_list": {"E1"},
        })
        event = {"type": "insert", "line": "MISSING", "date": "2026-07-01", "shift": "白班"}
        with patch.dict(sys.modules, {"scheduling_model_builder": fake_builder}):
            with self.assertRaises(service_adapter.RequestError) as error:
                service_adapter.preflight_event(event, self.work / "data" / "input.xlsx")
        self.assertEqual(error.exception.code, "INVALID_EVENT")
        self.assertFalse((self.work / "out" / "jobs").exists())

    def test_schedule_adjustment_requires_structured_operation(self):
        request = self.valid_info_request()
        request.update(
            task="adjust_schedule",
            input_files={"input": "data/input.xlsx", "schedule": "data/input.xlsx"},
            parameters={"adjustment": {"type": "assign", "employee_id": "E1"}},
        )
        with patch.object(service_adapter, "dispatch_task") as dispatch:
            response = service_adapter.execute(request, self.work)
        dispatch.assert_not_called()
        self.assertEqual(response["status"], "failed")
        self.assertEqual(response["error"]["code"], "INVALID_ADJUSTMENT")

    def test_validation_response_exposes_hard_constraint_summary(self):
        request = self.valid_info_request()
        request.update(
            task="validate_schedule",
            input_files={"input": "data/input.xlsx", "schedule": "data/input.xlsx"},
            parameters={},
        )
        with patch.object(service_adapter, "dispatch_task", return_value={
            "return_code": 4,
            "stdout": '{"all_pass":false,"violations":{"qual_night":1}}',
            "stderr": "",
        }):
            response = service_adapter.execute(request, self.work)
        self.assertEqual(response["verification"]["all_pass"], False)


if __name__ == "__main__":
    unittest.main()
