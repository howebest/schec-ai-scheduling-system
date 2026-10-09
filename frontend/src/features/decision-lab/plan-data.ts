import { api, type JobRecord, type ScheduleRecord } from '../../api/client';
import { analyzeScheduleCsv } from '../schedule-analysis/metrics.js';
import type { AnalyzedDecisionPlan } from './types';

type ScheduleWithJob = ScheduleRecord & { job?: JobRecord | null };

export interface ScenarioOptions {
  lines: string[];
  dates: string[];
  employees: string[];
  lineDateShifts: Array<{ line: string; date: string; shift: string }>;
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === '') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('基线方案 CSV 包含未闭合的引号。');
  if (field !== '' || row.length) { row.push(field); if (row.some((value) => value !== '')) rows.push(row); }
  return rows;
}

export async function loadScenarioOptions(record: ScheduleRecord): Promise<ScenarioOptions> {
  const rows = parseCsvRows(await api.scheduleArtifactCsv(record.sha256));
  const header = rows[0] ?? [];
  const column = (name: string, fallback: number) => {
    const index = header.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const lineIndex = column('产线编码', 1);
  const dateIndex = column('日期', 2);
  const shiftIndex = column('班次', 3);
  const employeeIndex = column('员工工号', 5);
  const lines = new Set<string>();
  const dates = new Set<string>();
  const employees = new Set<string>();
  const pairs = new Map<string, { line: string; date: string; shift: string }>();
  let section: 'assignments' | 'gaps' | 'fractional' = 'assignments';
  for (const item of rows.slice(1)) {
    if (item[0]?.startsWith('缺口记录')) { section = 'gaps'; continue; }
    if (item[0]?.startsWith('非完整班次记录')) { section = 'fractional'; continue; }
    if (section === 'gaps') continue;
    if (section === 'fractional') {
      if (item[0] === '员工工号') continue;
      const employee = item[0]?.trim();
      if (employee) employees.add(employee);
      continue;
    }
    const line = item[lineIndex]?.trim();
    const date = item[dateIndex]?.trim();
    const shift = item[shiftIndex]?.trim();
    const employee = item[employeeIndex]?.trim();
    if (!line || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !shift) continue;
    lines.add(line);
    dates.add(date);
    if (employee) employees.add(employee);
    pairs.set(`${line}\u0000${date}\u0000${shift}`, { line, date, shift });
  }
  return {
    lines: [...lines].sort(),
    dates: [...dates].sort(),
    employees: [...employees].sort(),
    lineDateShifts: [...pairs.values()].sort((left, right) => left.line.localeCompare(right.line) || left.date.localeCompare(right.date) || left.shift.localeCompare(right.shift)),
  };
}

function extractAssignmentKeys(csvText: string) {
  const rows = parseCsvRows(csvText);
  const header = rows[0] ?? [];
  const column = (name: string, fallback: number) => {
    const index = header.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const dateIndex = column('日期', 2);
  const shiftIndex = column('班次代码', 4);
  const employeeIndex = column('员工工号', 5);
  const positionIndex = column('岗位编码', 6);
  const keys: string[] = [];
  let section: 'assignments' | 'gaps' | 'fractional' = 'assignments';
  for (const row of rows.slice(1)) {
    if (row[0]?.startsWith('缺口记录')) { section = 'gaps'; continue; }
    if (row[0]?.startsWith('非完整班次记录')) { section = 'fractional'; continue; }
    if (section === 'assignments') {
      if (row[employeeIndex] && row[positionIndex] && row[dateIndex] && row[shiftIndex]) {
        keys.push(JSON.stringify(['full', row[employeeIndex], row[positionIndex], row[dateIndex], row[shiftIndex]]));
      }
    } else if (section === 'fractional' && row[0] !== '员工工号' && row.length >= 5) {
      const employee = row[0]?.trim();
      const position = row[1]?.trim();
      const date = row[2]?.trim();
      const shift = row[3]?.trim();
      const hours = Number(row[4]);
      if (employee && position && date && shift && Number.isFinite(hours)) {
        keys.push(JSON.stringify(['fractional', employee, position, date, shift, hours]));
      }
    }
  }
  return keys;
}

function extractCoverageUnits(csvText: string) {
  const rows = parseCsvRows(csvText);
  const header = rows[0] ?? [];
  const column = (name: string, fallback: number) => {
    const index = header.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const lineIndex = column('产线编码', 1);
  const dateIndex = column('日期', 2);
  const shiftIndex = column('班次', 3);
  const shiftCodeIndex = column('班次代码', 4);
  const positionIndex = column('岗位编码', 6);
  const positionLines = new Map<string, Set<string>>();
  const addPositionLine = (positionCode: string, lineCode: string) => {
    if (!positionLines.has(positionCode)) positionLines.set(positionCode, new Set());
    positionLines.get(positionCode)!.add(lineCode);
  };
  const shiftNames = new Map<string, string>();
  const units = new Map<string, { lineCode: string; positionCode: string; date: string; shift: string; coveredShifts: number; gapShifts: number }>();
  const unitFor = (lineCode: string, positionCode: string, date: string, shift: string) => {
    const key = [lineCode, positionCode, date, shift].join('\u0000');
    if (!units.has(key)) units.set(key, { lineCode, positionCode, date, shift, coveredShifts: 0, gapShifts: 0 });
    return units.get(key)!;
  };
  let section: 'assignments' | 'gaps' | 'fractional' = 'assignments';
  for (const row of rows.slice(1)) {
    if (row[0]?.startsWith('缺口记录')) { section = 'gaps'; continue; }
    if (row[0]?.startsWith('非完整班次记录')) { section = 'fractional'; continue; }
    if (section === 'assignments') {
      if (row[dateIndex] === '日期' || row.length < 15) continue;
      const line = row[lineIndex]?.trim();
      const date = row[dateIndex]?.trim();
      const shift = row[shiftIndex]?.trim();
      const shiftCode = row[shiftCodeIndex]?.trim();
      const position = row[positionIndex]?.trim();
      if (!line || !date || !shift || !position) continue;
      addPositionLine(position, line);
      if (shiftCode) shiftNames.set(shiftCode, shift);
      unitFor(line, position, date, shift).coveredShifts += 1;
    } else if (section === 'gaps') {
      if (row[0] === '岗位编码' || row.length < 6) continue;
      const position = row[0]?.trim();
      const line = row[2]?.trim();
      const date = row[3]?.trim();
      const shift = row[4]?.trim();
      const gap = Number(row[5]);
      if (position && line && date && shift && Number.isFinite(gap)) {
        addPositionLine(position, line);
        unitFor(line, position, date, shift).gapShifts += gap;
      }
    } else {
      if (row[0] === '员工工号' || row.length < 5) continue;
      const position = row[1]?.trim();
      const date = row[2]?.trim();
      const shiftCode = row[3]?.trim();
      const hours = Number(row[4]);
      const candidateLines = positionLines.get(position ?? '');
      const line = candidateLines?.size === 1 ? [...candidateLines][0] : undefined;
      const shift = shiftNames.get(shiftCode ?? '') ?? ({ D8: '常白班', D12: '白班', N12: '夜班' } as Record<string, string>)[shiftCode ?? ''];
      if (line && position && date && shift && Number.isFinite(hours) && hours > 0) unitFor(line, position, date, shift).coveredShifts += hours / 8;
    }
  }
  return [...units.values()].sort((left, right) => right.gapShifts - left.gapShifts || left.date.localeCompare(right.date) || left.lineCode.localeCompare(right.lineCode));
}

function scenarioName(record: ScheduleWithJob): string {
  const requestName = record.job?.request?.parameters;
  const parameterName = requestName && typeof requestName === 'object'
    ? (requestName as Record<string, unknown>).scenario_name
    : null;
  const verificationName = record.verification?.scenario_name;
  if (typeof parameterName === 'string' && parameterName.trim()) return parameterName.trim();
  if (typeof verificationName === 'string' && verificationName.trim()) return verificationName.trim();
  return `排班方案 ${record.schedule_id.slice(0, 8)}`;
}

export async function loadAnalyzedDecisionPlan(record: ScheduleWithJob): Promise<AnalyzedDecisionPlan> {
  try {
    const [csvText, feedback] = await Promise.all([
      api.scheduleArtifactCsv(record.sha256),
      api.feedback({ schedule_id: record.id, limit: 500 }),
    ]);
    const analysis = analyzeScheduleCsv(csvText, {
      verification: record.verification,
      satisfactionScores: feedback.items.map((item) => item.payload?.satisfaction_score),
    });
    const dates = analysis.daily.map((item) => item.date).filter(Boolean).sort();
    return {
      record,
      analysis,
      scenarioName: scenarioName(record),
      comparisonGroup: typeof record.verification?.comparison_group === 'string'
        ? record.verification.comparison_group
        : null,
      period: { start: dates[0] ?? null, end: dates.at(-1) ?? null },
      assignmentKeys: extractAssignmentKeys(csvText),
      coverageUnits: extractCoverageUnits(csvText),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知读取错误';
    throw new Error(`读取方案 ${record.schedule_id}（版本 ${record.version}）失败：${detail}`);
  }
}
