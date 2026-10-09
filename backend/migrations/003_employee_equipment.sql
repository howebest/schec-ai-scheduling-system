CREATE TABLE IF NOT EXISTS rotation_equipment (
    equipment_id TEXT PRIMARY KEY,
    equipment_code TEXT NOT NULL,
    equipment_name TEXT NOT NULL,
    equipment_category TEXT NOT NULL,
    line_id TEXT NOT NULL REFERENCES rotation_lines(line_id) ON DELETE RESTRICT,
    source_line_code TEXT NOT NULL,
    source_line_name TEXT NOT NULL,
    position_name TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'local_reference',
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (equipment_code, line_id)
);
CREATE INDEX IF NOT EXISTS rotation_equipment_line_idx ON rotation_equipment(line_id, is_active, equipment_category);
CREATE INDEX IF NOT EXISTS rotation_equipment_name_idx ON rotation_equipment(equipment_name, equipment_code);

CREATE TABLE IF NOT EXISTS rotation_employee_equipment (
    employee_id TEXT NOT NULL REFERENCES rotation_employees(employee_id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL REFERENCES rotation_equipment(equipment_id) ON DELETE RESTRICT,
    ability_level INTEGER NOT NULL CHECK (ability_level BETWEEN 1 AND 5),
    source_type TEXT NOT NULL DEFAULT 'local_config',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (employee_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS rotation_employee_equipment_device_idx ON rotation_employee_equipment(equipment_id, employee_id);
