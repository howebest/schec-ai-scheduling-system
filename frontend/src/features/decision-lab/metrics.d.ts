import type { AnalyzedDecisionPlan, ComparisonGroup, ExplanationItem, ParetoCandidate, ParetoResult } from './types';

export function groupComparablePlans(plans: AnalyzedDecisionPlan[]): ComparisonGroup[];
export function calculateParetoFrontier(candidates: ParetoCandidate[]): ParetoResult;
export function verificationEvidence(plan: AnalyzedDecisionPlan): {
  kind: 'simulation' | 'independent' | 'unverified';
  statusLabel: string;
  countLabel: string;
  count: number | null;
};
export function buildScheduleExplanations(plan: AnalyzedDecisionPlan): ExplanationItem[];
