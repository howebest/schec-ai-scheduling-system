CREATE TABLE IF NOT EXISTS rotation_position_catalog (
    position_id TEXT PRIMARY KEY REFERENCES rotation_positions(position_id) ON DELETE CASCADE,
    position_category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation_team_catalog (
    team_id TEXT PRIMARY KEY REFERENCES rotation_teams(team_id) ON DELETE CASCADE,
    team_category TEXT NOT NULL,
    line_id TEXT NOT NULL REFERENCES rotation_lines(line_id),
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rotation_skill_catalog (
    skill_code TEXT PRIMARY KEY,
    skill_name TEXT NOT NULL UNIQUE,
    skill_category TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'synthetic_demo',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO datasets(id, version, source_type, display_name, manifest_json, created_at)
VALUES (
    'synthetic-demo-expanded-20261008-v1',
    'synthetic-demo-expanded-20261008-v1',
    'synthetic_demo',
    '合成演示数据（人员与多方案扩充）',
    '{}',
    '2026-10-08T00:00:00+08:00'
);
