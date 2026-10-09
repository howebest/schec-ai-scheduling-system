import type { CalendarEntry, EmployeeEquipmentRecord, EmployeeEquipmentWrite, EmployeeProfile, EmployeeWrite, EquipmentRecord, FieldValidationError, LineRecord, Page, PositionRecord, QualificationRecord, QualificationWrite, RotationFilter, ScheduleConfigDraft, ScheduleConfigRecord, TeamRecord, TeamWrite } from '../features/rotation/types';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobKind = 'info' | 'solve_demo' | 'solve_full' | 'verify_baseline' | 'reschedule' | 'kpi';

export interface DatasetRecord {
  id: string;
  version: string;
  source_type: string;
  display_name: string;
  manifest: Record<string, unknown>;
  created_at: string;
}

export interface JobRecord {
  id: string;
  kind: JobKind | string;
  dataset_id: string;
  status: JobStatus;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  solver_termination?: string | null;
  request: Record<string, unknown>;
  result?: Record<string, any> | null;
  error?: Record<string, any> | null;
}

export interface ScheduleRecord {
  id: string;
  schedule_id: string;
  dataset_id: string;
  job_id?: string | null;
  version: number;
  artifact_path: string;
  sha256: string;
  verification: Record<string, any>;
  source_type: string;
  created_at: string;
}

export interface Metric {
  metric_id: string;
  value: number | null;
  unit: string;
  group_by: string[];
  date_range?: [string, string] | null;
  sample_count: number;
  source_type: string;
  definition: string;
}

export interface ImportPreview {
  preview_id: string;
  accepted: boolean;
  accepted_rows: number;
  rejected_rows: number;
  row_count: number;
  field_errors: Array<{ field?: string; code?: string; message?: string; row?: number }>;
  columns?: string[];
  file_name?: string;
  sha256: string;
}

export interface ScheduleDetail {
  schedule: ScheduleRecord;
  content: {
    assignment_count: number;
    gap_record_count: number;
    fractional_record_count: number;
    assignments: Array<Record<string, string | number>>;
    gaps: Array<Record<string, string | number>>;
    fractional_shifts: Array<Record<string, string | number>>;
    row_limit: number;
  };
}

export interface FeedbackRecord {
  id: string;
  schedule_id?: string | null;
  employee_id: string;
  feedback_type: string;
  payload: Record<string, any>;
  source_type: string;
  created_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : `请求失败（HTTP ${response.status}）。`;
    const error = new Error(message) as Error & { fieldErrors?: FieldValidationError[]; code?: string };
    error.fieldErrors = Array.isArray(body?.field_errors) ? body.field_errors : [];
    error.code = typeof body?.code === 'string' ? body.code : undefined;
    throw error;
  }
  return body as T;
}

const queryString = (input: object) => {
  const values = input as Record<string, string | number | boolean | undefined | null>;
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
};

export const api = {
  health: () => request<{ status: string; version: string; architecture: string }>('/api/v1/health'),
  bootstrap: () => request<Record<string, any>>('/api/v1/bootstrap'),
  datasets: () => request<{ items: DatasetRecord[] }>('/api/v1/datasets'),
  jobs: (filters: Record<string, string | number | undefined> = {}) =>
    request<{ items: JobRecord[] }>(`/api/v1/jobs${queryString(filters)}`),
  job: (id: string) => request<{ job: JobRecord }>(`/api/v1/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => request<{ job: JobRecord }>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  createJob: (payload: Record<string, unknown>) =>
    request<{ job: JobRecord }>('/api/v1/jobs', { method: 'POST', body: JSON.stringify(payload) }),
  schedules: async (datasetId?: string) => {
    const result = await request<{ items: Array<{ schedule: ScheduleRecord }> }>(`/api/v1/archive${queryString({ dataset_id: datasetId, limit: 100 })}`);
    return { items: (result.items ?? []).map((item) => item.schedule) };
  },
  schedule: (id: string) => request<ScheduleDetail>(`/api/v1/schedules/${encodeURIComponent(id)}`),
  validateSchedule: (id: string, payload: Record<string, unknown>) =>
    request<{ job: JobRecord }>(`/api/v1/schedules/${encodeURIComponent(id)}/validate`, { method: 'POST', body: JSON.stringify(payload) }),
  adjustSchedule: (id: string, payload: Record<string, unknown>) =>
    request<{ job: JobRecord }>(`/api/v1/schedules/${encodeURIComponent(id)}/adjustments`, { method: 'POST', body: JSON.stringify(payload) }),
  approveSchedule: (id: string, payload: Record<string, unknown>) =>
    request<{ approval: Record<string, any> }>(`/api/v1/schedules/${encodeURIComponent(id)}/approval`, { method: 'POST', body: JSON.stringify(payload) }),
  analytics: (filters: Record<string, string | undefined> = {}) =>
    request<{ items: Metric[]; active_schedule?: ScheduleRecord | null; source_type: string; limitations: string[] }>(`/api/v1/analytics/kpis${queryString(filters)}`),
  attendance: (filters: Record<string, string | undefined> = {}) =>
    request<{ items: Array<{ employee_id: string; schedule_date: string; shift_code: string; status: string; source_type: string }>; count: number; totals: Record<string, number>; period: { start: string; end: string }; limitations: string[] }>(`/api/v1/analytics/attendance${queryString(filters)}`),
  rules: () => request<{ latest: Record<string, any>; history: Array<Record<string, any>> }>('/api/v1/rules'),
  saveRules: (payload: Record<string, unknown>) =>
    request<{ rule: Record<string, any> }>('/api/v1/rules', { method: 'POST', body: JSON.stringify(payload) }),
  archive: (filters: Record<string, string | number | undefined> = {}) =>
    request<{ items: Array<{ schedule: ScheduleRecord; job?: JobRecord; download_id: string }> }>(`/api/v1/archive${queryString(filters)}`),
  previewImport: (schemaId: string, file: File) => {
    const form = new FormData(); form.set('schema_id', schemaId); form.set('file', file);
    return request<ImportPreview>('/api/v1/datasets/import/preview', { method: 'POST', body: form });
  },
  commitImport: (payload: Record<string, unknown>) =>
    request<{ dataset: DatasetRecord }>('/api/v1/datasets/import/commit', { method: 'POST', body: JSON.stringify(payload) }),
  feedback: (filters: { employee_id?: string; schedule_id?: string; limit?: number } = {}) =>
    request<{ items: FeedbackRecord[] }>(`/api/v1/feedback${queryString(filters)}`),
  submitFeedback: (payload: Record<string, unknown>) =>
    request<{ feedback: Record<string, any> }>('/api/v1/feedback', { method: 'POST', body: JSON.stringify(payload) }),
  scheduleArtifactCsv: async (sha256: string): Promise<string> => {
    const response = await fetch(`/api/v1/files/${encodeURIComponent(sha256)}`);
    if (!response.ok) throw new Error(`读取方案文件失败（HTTP ${response.status}）。`);
    return response.text();
  },
  rotationConfigurations: (filters: RotationFilter = {}) => request<Page<ScheduleConfigRecord>>(`/api/v1/scheduling/configurations${queryString(filters)}`),
  rotationConfiguration: (id: string) => request<ScheduleConfigRecord>(`/api/v1/scheduling/configurations/${encodeURIComponent(id)}`),
  saveRotationConfiguration: (draft: ScheduleConfigDraft, reason: string, id?: string) => request<ScheduleConfigRecord>(id ? `/api/v1/scheduling/configurations/${encodeURIComponent(id)}` : '/api/v1/scheduling/configurations', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ data: draft, reason }) }),
  validateRotationConfiguration: (draft: ScheduleConfigDraft) => request<{ valid: boolean; field_errors: FieldValidationError[] }>('/api/v1/scheduling/configurations/validate', { method: 'POST', body: JSON.stringify(draft) }),
  copyRotationConfiguration: (id: string, name: string, start_date: string, end_date: string | null, reason: string) => request<ScheduleConfigRecord>(`/api/v1/scheduling/configurations/${encodeURIComponent(id)}/copy`, { method: 'POST', body: JSON.stringify({ name, start_date, end_date, reason }) }),
  activateRotationConfiguration: (id: string, reason: string) => request<ScheduleConfigRecord>(`/api/v1/scheduling/configurations/${encodeURIComponent(id)}/activate`, { method: 'POST', body: JSON.stringify({ reason }) }),
  deactivateRotationConfiguration: (id: string, reason: string) => request<ScheduleConfigRecord>(`/api/v1/scheduling/configurations/${encodeURIComponent(id)}/deactivate`, { method: 'POST', body: JSON.stringify({ reason }) }),
  rotationCalendar: async (filters: { line_id: string; start_date: string; end_date: string; config_id?: string }) => request<{ items: CalendarEntry[] }>(`/api/v1/scheduling/calendar${queryString(filters)}`),
  employees: (filters: RotationFilter = {}) => request<Page<EmployeeProfile>>(`/api/v1/scheduling/employees${queryString(filters)}`),
  employee: (id: string) => request<EmployeeProfile>(`/api/v1/scheduling/employees/${encodeURIComponent(id)}`),
  equipment: (filters: RotationFilter = {}) => request<Page<EquipmentRecord>>(`/api/v1/scheduling/equipment${queryString(filters)}`),
  employeeEquipment: (id: string) => request<{ items: EmployeeEquipmentRecord[] }>(`/api/v1/scheduling/employees/${encodeURIComponent(id)}/equipment`),
  saveEmployeeEquipment: (id: string, data: EmployeeEquipmentWrite[], reason: string) => request<{ items: EmployeeEquipmentRecord[] }>(`/api/v1/scheduling/employees/${encodeURIComponent(id)}/equipment`, { method: 'PUT', body: JSON.stringify({ data, reason }) }),
  saveEmployee: (data: EmployeeWrite, reason: string, id?: string) => request<EmployeeProfile>(id ? `/api/v1/scheduling/employees/${encodeURIComponent(id)}` : '/api/v1/scheduling/employees', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ data, reason }) }),
  teams: (filters: RotationFilter = {}) => request<Page<TeamRecord>>(`/api/v1/scheduling/teams${queryString(filters)}`),
  team: (id: string) => request<TeamRecord>(`/api/v1/scheduling/teams/${encodeURIComponent(id)}`),
  saveTeam: (data: TeamWrite, reason: string, id?: string) => request<TeamRecord>(id ? `/api/v1/scheduling/teams/${encodeURIComponent(id)}` : '/api/v1/scheduling/teams', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ data, reason }) }),
  qualifications: (filters: RotationFilter = {}) => request<Page<QualificationRecord>>(`/api/v1/scheduling/qualifications${queryString(filters)}`),
  qualification: (id: string) => request<QualificationRecord>(`/api/v1/scheduling/qualifications/${encodeURIComponent(id)}`),
  saveQualification: (data: QualificationWrite, reason: string, id?: string) => request<QualificationRecord>(id ? `/api/v1/scheduling/qualifications/${encodeURIComponent(id)}` : '/api/v1/scheduling/qualifications', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ data, reason }) }),
  rotationLines: () => request<{ items: LineRecord[] }>('/api/v1/scheduling/lines'),
  rotationPositions: () => request<{ items: PositionRecord[] }>('/api/v1/scheduling/positions'),
};
