function validString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedDemand(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function comparableDemand(plan) {
  const analysis = plan.analysis;
  const hasDemandEvidence = analysis.assignmentCount + analysis.gapRecordCount + analysis.fractionalRecordCount > 0;
  return hasDemandEvidence ? normalizedDemand(analysis.demandShifts) : null;
}

function comparableDemandProfile(plan) {
  const expectedDemand = plan.analysis.demandShifts;
  if (!Number.isFinite(expectedDemand) || comparableDemand(plan) == null) return null;
  const rawUnits = plan.coverageUnits
    .map((unit) => ({
      line: unit.lineCode,
      position: unit.positionCode,
      date: unit.date,
      shift: unit.shift,
      demand: unit.coveredShifts + unit.gapShifts,
    }))
    .filter((unit) => unit.line && unit.position && unit.date && unit.shift && Number.isFinite(unit.demand) && unit.demand >= 0)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const profileDemand = rawUnits.reduce((sum, unit) => sum + unit.demand, 0);
  return rawUnits.length && Math.abs(profileDemand - expectedDemand) <= 1e-6
    ? rawUnits.map((unit) => ({ ...unit, demand: normalizedDemand(unit.demand) }))
    : null;
}

function shortFingerprint(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function comparisonReason(candidate, groupPlan) {
  const reasons = [];
  if (candidate.record.dataset_id !== groupPlan.record.dataset_id) reasons.push('数据集版本不同');
  if (!candidate.period.start || !candidate.period.end || !groupPlan.period.start || !groupPlan.period.end) {
    reasons.push('日期范围不完整，无法确认同一规划周期');
  } else if (candidate.period.start !== groupPlan.period.start || candidate.period.end !== groupPlan.period.end) {
    reasons.push('排班日期范围不同');
  }
  const demand = comparableDemand(candidate);
  const groupDemand = comparableDemand(groupPlan);
  if (demand == null || groupDemand == null) reasons.push('需求人班缺失，无法确认同一需求口径');
  else if (demand !== groupDemand) reasons.push('需求人班不同');
  const profile = comparableDemandProfile(candidate);
  const groupProfile = comparableDemandProfile(groupPlan);
  if (profile == null || groupProfile == null) reasons.push('产线、岗位、日期和班次需求结构不完整或人班合计不一致');
  else if (JSON.stringify(profile) !== JSON.stringify(groupProfile)) reasons.push('产线、岗位、日期或班次需求分布不同');
  if (validString(candidate.comparisonGroup) !== validString(groupPlan.comparisonGroup)) reasons.push('方案比较组标记不同');
  return reasons.join('；');
}

/** @param {Array<import('./types').AnalyzedDecisionPlan>} plans */
export function groupComparablePlans(plans) {
  const buckets = new Map();
  for (const plan of plans) {
    const periodKnown = Boolean(plan.period.start && plan.period.end);
    const demand = comparableDemand(plan);
    const demandProfile = comparableDemandProfile(plan);
    const comparisonGroup = validString(plan.comparisonGroup);
    const dimensions = {
      datasetId: plan.record.dataset_id,
      start: plan.period.start,
      end: plan.period.end,
      demand,
      demandProfile,
      comparisonGroup,
    };
    // A matching total is not enough; the line/position/day/shift demand profile must also match.
    const key = periodKnown && demand != null && demandProfile != null
      ? JSON.stringify(dimensions)
      : `${JSON.stringify(dimensions)}:${plan.record.id}`;
    if (!buckets.has(key)) buckets.set(key, { key, dimensions, plans: [] });
    buckets.get(key).plans.push(plan);
  }

  const allBuckets = [...buckets.values()];
  return allBuckets.map((bucket) => {
    const first = bucket.plans[0];
    const scenarioLabel = bucket.dimensions.comparisonGroup ?? '未标注比较组';
    const periodLabel = bucket.dimensions.start && bucket.dimensions.end
      ? `${bucket.dimensions.start} 至 ${bucket.dimensions.end}`
      : '日期范围不完整';
    const demandLabel = bucket.dimensions.demand == null
      ? '需求人班无可计算值'
      : `${bucket.dimensions.demand.toLocaleString('zh-CN')} 人班`;
    const demandProfileLabel = bucket.dimensions.demandProfile == null
      ? '需求结构无可计算值'
      : `需求结构 ${shortFingerprint(JSON.stringify(bucket.dimensions.demandProfile))}`;
    const excluded = allBuckets
      .filter((other) => other.key !== bucket.key)
      .flatMap((other) => other.plans.map((plan) => ({
        planId: plan.record.id,
        reason: comparisonReason(plan, first) || '缺少可确认的同口径依据',
      })));
    return {
      key: bucket.key,
      label: `${scenarioLabel} · ${periodLabel} · ${demandLabel} · ${demandProfileLabel}`,
      comparisonGroup: bucket.dimensions.comparisonGroup,
      planIds: bucket.plans.map((plan) => plan.record.id),
      excluded,
    };
  });
}

/** @param {import('./types').AnalyzedDecisionPlan} plan */
export function verificationEvidence(plan) {
  const verification = plan.record.verification ?? {};
  const state = typeof verification.verification_state === 'string' ? verification.verification_state : '';
  const simulated = state.includes('场景规则模拟')
    || (plan.record.source_type === 'synthetic_demo' && verification.all_pass == null);
  const counts = verification.violations && typeof verification.violations === 'object' && !Array.isArray(verification.violations)
    ? Object.values(verification.violations).filter(Number.isFinite)
    : [];
  const simulatedCount = counts.length ? counts.reduce((sum, value) => sum + Number(value), 0) : null;
  if (simulated) return { kind: 'simulation', statusLabel: '规则模拟，未独立核验', countLabel: '模拟规则违规计数（非独立核验）', count: simulatedCount };
  if (plan.analysis.compliance.status === 'passed' || plan.analysis.compliance.status === 'failed') {
    return { kind: 'independent', statusLabel: plan.analysis.compliance.status === 'passed' ? '独立核验通过' : '独立核验未通过', countLabel: '独立核验违例数', count: plan.analysis.compliance.violationCount };
  }
  return { kind: 'unverified', statusLabel: '未核验', countLabel: '核验记录计数（状态未确认）', count: plan.analysis.compliance.violationCount };
}

/** @param {import('./types').ParetoCandidate[]} candidates */
export function calculateParetoFrontier(candidates) {
  const valid = [];
  const excluded = [];
  for (const candidate of candidates) {
    const missing = [];
    if (!Number.isFinite(candidate.coverageRate)) missing.push('需求覆盖率');
    if (!Number.isFinite(candidate.estimatedLaborCost)) missing.push('工时成本代理值');
    if (missing.length) excluded.push({ id: candidate.id, reason: `${missing.join('、')}无可计算值，不参与 Pareto 比较。` });
    else valid.push(candidate);
  }
  const frontierIds = valid
    .filter((candidate) => !valid.some((other) => other.id !== candidate.id
      && other.coverageRate >= candidate.coverageRate
      && other.estimatedLaborCost <= candidate.estimatedLaborCost
      && (other.coverageRate > candidate.coverageRate || other.estimatedLaborCost < candidate.estimatedLaborCost)))
    .map((candidate) => candidate.id);
  return { frontierIds, excluded };
}

const CONSTRAINT_LABELS = {
  qual_night: '岗位资格或夜班资格',
  one_per_day: '同一员工同一日期多班指派',
  interval_11h: '相邻班次间隔不足 11 h',
  rest_7d: '连续 7 日休息要求',
  month_ot_36h: '月加班工时限制',
  daily_hours: '日工时限制',
  coverage_eq: '岗位需求覆盖账目',
};

/** @param {import('./types').AnalyzedDecisionPlan} plan */
export function buildScheduleExplanations(plan) {
  const items = [];
  const sourcePrefix = `方案 ${plan.record.schedule_id}（${plan.record.source_type}）`;
  const units = new Map(plan.coverageUnits.map((unit) => [[unit.lineCode, unit.positionCode, unit.date, unit.shift].join('\u0000'), unit]));
  for (const gap of plan.analysis.gaps) {
    const unit = units.get([gap.lineCode, gap.positionCode, gap.date, gap.shift].join('\u0000'));
    const hasUnitTotals = unit != null && Number.isFinite(unit.coveredShifts) && Number.isFinite(unit.gapShifts);
    const coverageDetail = hasUnitTotals
      ? `该排班 CSV 单元记录需求 ${ (unit.coveredShifts + unit.gapShifts).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) } 人班、已覆盖 ${unit.coveredShifts.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 人班、未覆盖 ${unit.gapShifts.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 人班。`
      : `该 CSV 缺口记录为 ${gap.gapShifts.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 人班；同单元需求总量或指派量无法从现有文件确认。`;
    items.push({
      severity: 'warning',
      title: `${gap.lineCode} · ${gap.date} · ${gap.shift} · ${gap.positionName || gap.positionCode} 存在缺口`,
      detail: `${coverageDetail}缺口记录本身不能证明员工不可用或技能不匹配；现有数据无法判定具体根因。`,
      source: `${sourcePrefix} CSV：缺口记录区（产线编码、日期、班次、岗位编码、缺口人班）${hasUnitTotals ? '；指派记录区（员工工号、岗位编码、日期、班次）' : ''}`,
      lineCode: gap.lineCode,
      date: gap.date,
      shift: gap.shift,
      positionCode: gap.positionCode,
    });
  }

  const verification = plan.record.verification ?? {};
  const verificationState = typeof verification.verification_state === 'string' ? verification.verification_state : '';
  const simulated = verificationState.includes('场景规则模拟')
    || (plan.record.source_type === 'synthetic_demo' && verification.all_pass == null);
  if (simulated) {
    const violations = verification.violations && typeof verification.violations === 'object' ? verification.violations : {};
    const numericCounts = Object.values(violations).filter(Number.isFinite);
    const simulatedCount = numericCounts.length ? numericCounts.reduce((sum, value) => sum + Number(value), 0) : null;
    items.push({
      severity: 'warning',
      title: '当前记录为场景规则模拟，未执行独立核验',
      detail: `规则模拟违规计数：${simulatedCount == null ? '无可计算值' : `${simulatedCount.toLocaleString('zh-CN')} 项`}；该计数不作为独立硬约束结论。缺少独立核验时，系统不将方案标记为合规。`,
      source: `${sourcePrefix} verification_state、all_pass、violations`,
    });
  } else if (plan.analysis.compliance.status === 'passed') {
    items.push({
      severity: 'info',
      title: '独立硬约束核验通过',
      detail: '方案登记记录的独立核验结论为通过。此结论仅覆盖核验程序实际检查的约束。',
      source: `${sourcePrefix} verification.all_pass=true`,
    });
  } else if (plan.analysis.compliance.status === 'failed') {
    const violations = verification.violations && typeof verification.violations === 'object' ? verification.violations : {};
    const samples = Array.isArray(verification.samples) ? verification.samples.filter((value) => typeof value === 'string') : [];
    const positive = Object.entries(violations).filter(([key, count]) => key in CONSTRAINT_LABELS && Number.isFinite(count) && Number(count) > 0);
    if (!positive.length) {
      items.push({
        severity: 'error',
        title: '独立硬约束核验未通过，明细无法定位',
        detail: `核验结论为未通过；违例计数：${plan.analysis.compliance.violationCount == null ? '无可计算值' : plan.analysis.compliance.violationCount}。现有核验字段没有可识别的约束计数，不能确定具体问题。`,
        source: `${sourcePrefix} verification.all_pass、verification.violations`,
      });
    } else {
      for (const [key, count] of positive) {
        const label = CONSTRAINT_LABELS[key];
        const related = samples.filter((sample) => key === 'qual_night' ? /资格|夜班资格/.test(sample)
          : key === 'one_per_day' ? /同一员工同一日期/.test(sample)
            : key === 'interval_11h' ? /间隔<11h/.test(sample)
              : key === 'rest_7d' ? /7天无休/.test(sample)
                : key === 'month_ot_36h' ? /月12h班超限/.test(sample)
                  : key === 'daily_hours' ? /日工时/.test(sample)
                    : /覆盖|需求/.test(sample)).slice(0, 3);
        items.push({
          severity: 'error',
          title: `${label}核验未通过`,
          detail: `独立核验记录 ${Number(count).toLocaleString('zh-CN')} 项违规。${related.length ? `已返回样例：${related.join('；')}` : '核验结果未提供该约束的具体样例。'}`,
          source: `${sourcePrefix} verification.violations.${key}${related.length ? '、verification.samples' : ''}`,
        });
      }
    }
  } else {
    items.push({
      severity: 'warning',
      title: '当前方案未核验',
      detail: `独立核验违规计数：${plan.analysis.compliance.violationCount == null ? '无可计算值' : `${plan.analysis.compliance.violationCount} 项`}。未核验不等于通过，也不等于未通过。`,
      source: `${sourcePrefix} verification.all_pass 缺失或为 null`,
    });
  }

  const verificationViolations = verification.violations && typeof verification.violations === 'object' ? verification.violations : {};
  const hasQualificationEvidence = Number.isFinite(verificationViolations.qual_night)
    || (Array.isArray(verification.samples) && verification.samples.some((value) => typeof value === 'string' && /资格|夜班资格/.test(value)));
  if (!simulated && !hasQualificationEvidence) {
    items.push({
      severity: 'info',
      title: '技能和资格关系证据不足',
      detail: '排班 CSV 未包含员工技能矩阵或有效证书关系，核验记录也没有对应岗位资格字段或样例。现有数据无法判定未排班人员是否具备岗位资格，也不能据此归因缺口。',
      source: `${sourcePrefix} CSV 字段；当前方案未提供可关联到员工与岗位的独立核验样例`,
    });
  }

  if (!items.length) {
    items.push({ severity: 'info', title: '现有数据无法判定原因', detail: '当前方案未提供可定位的缺口或核验依据。', source: `${sourcePrefix} CSV 与核验记录` });
  }
  return items;
}
