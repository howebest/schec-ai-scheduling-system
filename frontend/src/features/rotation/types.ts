export interface Page<T> { items: T[]; total: number; page: number; page_size: number }
export type RotationObjectType = 'team' | 'employee';
export interface ShiftDefinition { shift_code: string; name: string; start_time: string; end_time: string; remarks: string; display_order: number }
export interface CycleDay { cycle_day: number; shift_code: string | null; is_rest: boolean }
export interface RotationTarget { object_type: RotationObjectType; object_id: string; offset_days: number; is_active: boolean }
export interface ScheduleConfigDraft { name: string; line_id: string; object_type: RotationObjectType; start_date: string; end_date: string | null; cycle_length: number; shifts: ShiftDefinition[]; cycle_days: CycleDay[]; targets: RotationTarget[] }
export interface ScheduleConfigRecord extends ScheduleConfigDraft { config_id: string; line_name: string; source_type: string; is_active: boolean; created_at: string; updated_at: string }
export interface EmployeeSkill { skill_code: string; skill_name: string; skill_score: number | null; is_active: boolean }
export interface EquipmentRecord { equipment_id: string; equipment_code: string; equipment_name: string; equipment_category: string; line_id: string; line_name: string; source_line_code: string; source_line_name: string; position_name: string; source_type: string; is_active: boolean }
export interface EmployeeEquipmentRecord extends EquipmentRecord { ability_level: number }
export interface EmployeeEquipmentWrite { equipment_id: string; ability_level: number }
export interface EmployeeProfile { employee_id: string; name: string; position_id: string; position_name: string; team_id: string | null; team_name: string | null; line_ids: string[]; skills: EmployeeSkill[]; equipment_mappings: EmployeeEquipmentRecord[]; skill_score: number | null; collaboration_score: number | null; composite_score: number | null; source_type: string; is_archived: boolean; updated_at: string }
export interface EmployeeWrite { employee_id: string; name: string; position_id: string; team_id: string | null; skills: EmployeeSkill[]; collaboration_score: number | null; is_archived: boolean }
export interface TeamMemberSummary { employee_id: string; name: string; position_name: string }
export interface TeamRecord { team_id: string; name: string; team_category: string; description: string; is_active: boolean; member_count: number; members: TeamMemberSummary[]; qualification_line_count: number; source_type: string; updated_at: string }
export interface TeamWrite { team_id: string | null; name: string; description: string; is_active: boolean; member_ids: string[] }
export interface QualificationRecord { qualification_id: string; object_type: RotationObjectType; object_id: string; object_name: string; position_id: string; position_name: string; line_id: string; line_name: string; description: string; is_active: boolean; source_type: string; updated_at: string }
export interface QualificationWrite { qualification_id: string | null; object_type: RotationObjectType; object_id: string; position_id: string; line_id: string; description: string; is_active: boolean }
export interface LineRecord { line_id: string; display_name: string; line_type: string; source_type: string; is_active: boolean }
export interface PositionRecord { position_id: string; display_name: string; source_type: string; is_active: boolean }
export interface CalendarPersonnel { employee_id: string; name: string; position_name: string }
export interface CalendarEntry { date: string; end_date: string; config_id: string; config_name: string; object_type: RotationObjectType; object_id: string; object_name: string; personnel: CalendarPersonnel[]; line_id: string; line_name: string; status: string; shift_code: string | null; shift_name: string | null; start_time: string | null; end_time: string | null; crosses_midnight: boolean; source_type: string }
export interface FieldValidationError { path: string; code: string; message: string }
export interface RotationFilter { name?: string; query?: string; line_id?: string; position_id?: string; team_id?: string; equipment_id?: string; category?: string; is_active?: boolean; is_archived?: boolean; object_type?: RotationObjectType; page?: number; page_size?: number }
