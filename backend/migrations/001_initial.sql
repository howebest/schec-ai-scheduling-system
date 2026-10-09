PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    source_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    manifest_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules_versions (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    values_json TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(version)
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
    request_json TEXT NOT NULL,
    result_json TEXT,
    solver_termination TEXT,
    error_json TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY(dataset_id) REFERENCES datasets(id)
);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);

CREATE TABLE IF NOT EXISTS schedule_versions (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    job_id TEXT,
    version INTEGER NOT NULL,
    artifact_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    verification_json TEXT NOT NULL,
    source_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(schedule_id, version),
    FOREIGN KEY(dataset_id) REFERENCES datasets(id),
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    schedule_version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','reviewed','locked','simulated_published','rejected')),
    actor_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(schedule_id) REFERENCES schedule_versions(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    schedule_id TEXT,
    employee_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'simulated_feedback',
    created_at TEXT NOT NULL,
    FOREIGN KEY(schedule_id) REFERENCES schedule_versions(id)
);

INSERT OR IGNORE INTO datasets(id, version, source_type, display_name, manifest_json, created_at)
VALUES ('accepted-baseline-v1', 'accepted-baseline-v1', 'accepted_baseline', '已验收基准数据', '{}', '2026-09-30T00:00:00+08:00');
INSERT OR IGNORE INTO datasets(id, version, source_type, display_name, manifest_json, created_at)
VALUES ('synthetic-demo-20260930-v1', 'synthetic-demo-20260930-v1', 'synthetic_demo', '合成演示数据', '{}', '2026-09-30T00:00:00+08:00');
