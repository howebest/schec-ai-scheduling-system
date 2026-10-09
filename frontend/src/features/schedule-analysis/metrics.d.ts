export interface DailyScheduleMetric {
  date: string;
  assignedShifts: number;
  fractionalHours: number;
  gapShifts: number;
  overtimeHours: number;
  paidHours: number;
  coveredShifts: number;
  demandShifts: number;
  coverageRate: number | null;
}

export interface ScheduleGap {
  positionCode: string;
  positionName: string;
  lineCode: string;
  date: string;
  shift: string;
  gapShifts: number;
}

export interface ScheduleAnalysis {
  assignmentCount: number;
  gapRecordCount: number;
  fractionalRecordCount: number;
  coveredShifts: number;
  demandShifts: number;
  gapShifts: number;
  coverageRate: number | null;
  paidHours: number | null;
  standardHours: number | null;
  overtimeHours: number | null;
  standardHourRatio: number | null;
  overtimeShare: number | null;
  laborHourUtilizationRate: number | null;
  estimatedLaborCost: number | null;
  simulatedHourlyRate: number;
  simulatedOvertimeMultiplier: number;
  costPerCoveredShift: number | null;
  laborEfficiency: number | null;
  coverageBalance: { cellCount: number; meanRate: number | null; standardDeviation: number | null; coefficientVariation: number | null; score: number | null };
  fairness: { gini: number | null; rangeHours: number | null; employeeCount: number };
  compliance: { status: 'passed' | 'failed' | 'unverified'; violationCount: number | null; passedChecks: number | null; totalChecks: number | null; rate: number | null };
  satisfaction: { average: number | null; responseCount: number; favorableRate: number | null };
  daily: DailyScheduleMetric[];
  heatmap: Array<{ lineCode: string; date: string; gapShifts: number }>;
  gaps: ScheduleGap[];
  anomalies: Array<{ code: string; severity: 'warning' | 'error'; message: string }>;
}

export interface RadarPlan {
  id: string;
  name?: string;
  coverageRate?: number | null;
  paidHours?: number | null;
  estimatedLaborCost?: number | null;
  costPerCoveredShift?: number | null;
  laborEfficiency?: number | null;
  overtimeShare?: number | null;
  coverageBalance?: { score: number | null };
  complianceRate?: number | null;
  fairnessGini?: number | null;
  fairness?: { gini: number | null };
  compliance?: 'passed' | 'failed' | 'unverified' | { status: 'passed' | 'failed' | 'unverified' };
  satisfactionAverage?: number | null;
  satisfaction?: { average: number | null };
}

export function analyzeScheduleCsv(
  csvText: string,
  options?: { verification?: Record<string, unknown> | null; satisfactionScores?: unknown[] },
): ScheduleAnalysis;

export function comparisonRadar(plans: RadarPlan[]): {
  indicators: Array<{ key: string; name: string; max: 100 }>;
  series: Array<{ name: string; values: Array<number | null> }>;
};
