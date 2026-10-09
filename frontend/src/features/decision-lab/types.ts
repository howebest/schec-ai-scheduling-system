import type { JobRecord, ScheduleRecord } from '../../api/client';
import type { ScheduleAnalysis } from '../schedule-analysis/metrics.js';

export type ScenarioEvent =
  | { type: 'absence'; event_id: string; employee: string; date: string }
  | { type: 'equipment_fail'; event_id: string; line: string; dates: string[] }
  | { type: 'rampup'; event_id: string; line: string; date: string; add_per_position: number }
  | { type: 'insert' | 'changeover'; event_id: string; line: string; date: string; shift: string };

export interface AnalyzedDecisionPlan {
  record: ScheduleRecord & { job?: JobRecord | null };
  analysis: ScheduleAnalysis;
  scenarioName: string;
  comparisonGroup: string | null;
  period: { start: string | null; end: string | null };
  assignmentKeys: string[];
  coverageUnits: ScheduleCoverageUnit[];
}

export interface ScheduleCoverageUnit {
  lineCode: string;
  positionCode: string;
  date: string;
  shift: string;
  coveredShifts: number;
  gapShifts: number;
}

export interface ExplanationItem {
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  source: string;
  lineCode?: string;
  date?: string;
  shift?: string;
  positionCode?: string;
}

export interface ScenarioDiff {
  addedAssignments: Array<{ employeeId: string; positionCode: string; date: string; shiftCode: string; recordType: '整班指派' | '非完整班次'; hours: number | null }>;
  removedAssignments: Array<{ employeeId: string; positionCode: string; date: string; shiftCode: string; recordType: '整班指派' | '非完整班次'; hours: number | null }>;
  changedGaps: Array<{ lineCode: string; positionCode: string; date: string; shift: string; before: number; after: number; delta: number }>;
  kpiDeltas: Array<{ key: string; label: string; unit: string; before: number | null; after: number | null; delta: number | null }>;
}

export interface ComparisonGroup {
  key: string;
  label: string;
  comparisonGroup: string | null;
  planIds: string[];
  excluded: Array<{ planId: string; reason: string }>;
}

export interface ParetoCandidate {
  id: string;
  coverageRate: number | null;
  estimatedLaborCost: number | null;
  gini: number | null;
}

export interface ParetoResult {
  frontierIds: string[];
  excluded: Array<{ id: string; reason: string }>;
}

export interface ScenarioSubmission {
  datasetId: string;
  baselineScheduleId: string;
  actorId: string;
  actorRole: string;
  reason: string;
  scenarioName: string;
  event: ScenarioEvent;
}
