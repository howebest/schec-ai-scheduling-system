CREATE TABLE IF NOT EXISTS rotation_lines (
    line_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    line_type TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation_positions (
    position_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation_teams (
    team_id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation_employees (
    employee_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position_id TEXT NOT NULL REFERENCES rotation_positions(position_id),
    team_id TEXT REFERENCES rotation_teams(team_id),
    collaboration_score REAL CHECK (collaboration_score IS NULL OR (collaboration_score >= 0 AND collaboration_score <= 100)),
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rotation_employees_team_idx ON rotation_employees(team_id, is_archived);
CREATE INDEX IF NOT EXISTS rotation_employees_position_idx ON rotation_employees(position_id, is_archived);

CREATE TABLE IF NOT EXISTS rotation_employee_skills (
    employee_id TEXT NOT NULL REFERENCES rotation_employees(employee_id) ON DELETE CASCADE,
    skill_code TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    skill_score REAL CHECK (skill_score IS NULL OR (skill_score >= 0 AND skill_score <= 100)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (employee_id, skill_code)
);

CREATE TABLE IF NOT EXISTS rotation_qualifications (
    qualification_id TEXT PRIMARY KEY,
    object_type TEXT NOT NULL CHECK (object_type IN ('team', 'employee')),
    object_id TEXT NOT NULL,
    position_id TEXT NOT NULL REFERENCES rotation_positions(position_id),
    line_id TEXT NOT NULL REFERENCES rotation_lines(line_id),
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (object_type, object_id, position_id, line_id)
);
CREATE INDEX IF NOT EXISTS rotation_qualifications_line_idx ON rotation_qualifications(line_id, position_id, is_active);
CREATE INDEX IF NOT EXISTS rotation_qualifications_object_idx ON rotation_qualifications(object_type, object_id, is_active);

CREATE TABLE IF NOT EXISTS rotation_configs (
    config_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    line_id TEXT NOT NULL REFERENCES rotation_lines(line_id),
    object_type TEXT NOT NULL CHECK (object_type IN ('team', 'employee')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    cycle_length INTEGER NOT NULL CHECK (cycle_length > 0),
    source_type TEXT NOT NULL DEFAULT 'local_config',
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS rotation_configs_line_active_idx ON rotation_configs(line_id, is_active, start_date, end_date);
CREATE INDEX IF NOT EXISTS rotation_configs_name_idx ON rotation_configs(name);

CREATE TABLE IF NOT EXISTS rotation_shifts (
    shift_id TEXT PRIMARY KEY,
    config_id TEXT NOT NULL REFERENCES rotation_configs(config_id) ON DELETE CASCADE,
    shift_code TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    remarks TEXT NOT NULL DEFAULT '',
    display_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (config_id, shift_code),
    UNIQUE (config_id, name)
);
CREATE INDEX IF NOT EXISTS rotation_shifts_config_idx ON rotation_shifts(config_id, display_order);

CREATE TABLE IF NOT EXISTS rotation_cycle_days (
    config_id TEXT NOT NULL REFERENCES rotation_configs(config_id) ON DELETE CASCADE,
    cycle_day INTEGER NOT NULL CHECK (cycle_day > 0),
    shift_id TEXT REFERENCES rotation_shifts(shift_id) ON DELETE RESTRICT,
    is_rest INTEGER NOT NULL CHECK (is_rest IN (0, 1)),
    PRIMARY KEY (config_id, cycle_day),
    CHECK ((is_rest = 1 AND shift_id IS NULL) OR (is_rest = 0 AND shift_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS rotation_config_targets (
    config_id TEXT NOT NULL REFERENCES rotation_configs(config_id) ON DELETE CASCADE,
    object_type TEXT NOT NULL CHECK (object_type IN ('team', 'employee')),
    object_id TEXT NOT NULL,
    offset_days INTEGER NOT NULL CHECK (offset_days >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    PRIMARY KEY (config_id, object_type, object_id)
);
CREATE INDEX IF NOT EXISTS rotation_config_targets_object_idx ON rotation_config_targets(object_type, object_id, is_active);

CREATE TABLE IF NOT EXISTS rotation_seed_versions (
    seed_name TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
