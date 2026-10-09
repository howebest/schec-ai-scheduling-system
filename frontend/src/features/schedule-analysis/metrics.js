const HOURS_PER_SHIFT = 8;
const DAILY_OVERTIME_LIMIT = 3;
const MONTHLY_OVERTIME_LIMIT = 36;
const VERIFIED_CONSTRAINTS = ['qual_night', 'one_per_day', 'interval_11h', 'rest_7d', 'month_ot_36h', 'daily_hours', 'coverage_eq'];
const SIMULATED_BASE_HOURLY_RATE = 35;
const SIMULATED_OVERTIME_MULTIPLIER = 1.5;

function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('排班方案 CSV 包含未闭合的引号。');
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function numericCell(row, index, label) {
  const raw = String(row[index] ?? '').trim();
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) {
    throw new Error(`排班方案 CSV 的${label}字段不是有效数值。`);
  }
  return value;
}

function isKeyPosition(value) {
  return ['1', 'true', 'yes', 'y', '是', '关键'].includes(String(value ?? '').trim().toLowerCase());
}

function countViolations(verification) {
  if (!verification || typeof verification !== 'object') return null;
  for (const key of ['violation_count', 'hard_violation_count', 'hard_violations', 'violations_count']) {
    const value = verification[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.length;
  }
  if (Array.isArray(verification.violations)) return verification.violations.length;
  if (verification.violations && typeof verification.violations === 'object') {
    const counts = Object.values(verification.violations).filter(Number.isFinite);
    return counts.length ? counts.reduce((sum, value) => sum + value, 0) : null;
  }
  return null;
}

function complianceMetrics(verification) {
  const violations = verification?.violations;
  const values = violations && typeof violations === 'object' && !Array.isArray(violations) ? violations : null;
  const assessed = values ? VERIFIED_CONSTRAINTS.filter((key) => Number.isFinite(values[key])) : [];
  const passed = assessed.filter((key) => values[key] === 0).length;
  const status = verification?.all_pass === true ? 'passed' : verification?.all_pass === false ? 'failed' : 'unverified';
  return {
    status,
    violationCount: countViolations(verification),
    passedChecks: assessed.length ? passed : null,
    totalChecks: assessed.length || null,
    rate: assessed.length ? passed / assessed.length * 100 : status === 'passed' ? 100 : null,
  };
}

/**
 * @param {string} csvText
 * @param {{ verification?: Record<string, unknown> | null, satisfactionScores?: unknown[] }} options
 */
export function analyzeScheduleCsv(csvText, options = {}) {
  const assignments = [];
  const gaps = [];
  const fractional = [];
  let section = 'assignments';

  for (const row of parseCsv(csvText)) {
    const first = row[0] ?? '';
    if (first.startsWith('缺口记录')) { section = 'gaps'; continue; }
    if (first.startsWith('非完整班次记录')) { section = 'fractional'; continue; }

    if (section === 'assignments') {
      if (row[2] === '日期' || row.length < 15) continue;
      const overtimeHours = numericCell(row, 12, '当日加班工时');
      assignments.push({
        factoryCode: row[0] ?? '',
        lineCode: row[1] ?? '',
        date: row[2] ?? '',
        shift: row[3] ?? '',
        positionCode: row[6] ?? '',
        employeeId: row[5] ?? '',
        keyPosition: isKeyPosition(row[8]),
        paidHours: numericCell(row, 10, '计薪工时'),
        standardHours: numericCell(row, 11, '标准工时'),
        overtimeHours,
      });
    } else if (section === 'gaps') {
      if (first === '岗位编码' || row.length < 6) continue;
      gaps.push({
        positionCode: row[0] ?? '',
        positionName: row[1] ?? '',
        lineCode: row[2] ?? '',
        date: row[3] ?? '',
        shift: row[4] ?? '',
        gapShifts: numericCell(row, 5, '缺口人班'),
      });
    } else {
      if (first === '员工工号' || row.length < 5) continue;
      fractional.push({
        employeeId: row[0] ?? '',
        positionCode: row[1] ?? '',
        date: row[2] ?? '',
        shiftCode: row[3] ?? '',
        hours: numericCell(row, 4, '非完整班次工时'),
      });
    }
  }

  const employeeHours = new Map();
  const daily = new Map();
  const dailyOvertime = new Map();
  const monthlyOvertime = new Map();
  const heatmapGaps = new Map();
  const lines = new Set();
  const dates = new Set();
  let overtimeHours = 0;
  let paidHours = 0;
  let standardHours = 0;

  const dailyFor = (date) => {
    if (!daily.has(date)) daily.set(date, { date, assignedShifts: 0, fractionalHours: 0, gapShifts: 0, overtimeHours: 0, paidHours: 0, standardHours: 0 });
    return daily.get(date);
  };

  for (const assignment of assignments) {
    const { date, lineCode, employeeId } = assignment;
    lines.add(lineCode);
    dates.add(date);
    const day = dailyFor(date);
    day.assignedShifts += 1;
    day.overtimeHours += assignment.overtimeHours;
    day.paidHours += assignment.paidHours;
    day.standardHours += assignment.standardHours;
    overtimeHours += assignment.overtimeHours;
    paidHours += assignment.paidHours;
    standardHours += assignment.standardHours;
    if (employeeId) employeeHours.set(employeeId, (employeeHours.get(employeeId) ?? 0) + assignment.paidHours);
    const dayOvertimeKey = `${employeeId}\u0000${date}`;
    dailyOvertime.set(dayOvertimeKey, (dailyOvertime.get(dayOvertimeKey) ?? 0) + assignment.overtimeHours);
    const month = date.slice(0, 7);
    const monthOvertimeKey = `${employeeId}\u0000${month}`;
    monthlyOvertime.set(monthOvertimeKey, (monthlyOvertime.get(monthOvertimeKey) ?? 0) + assignment.overtimeHours);
  }

  for (const entry of fractional) {
    dates.add(entry.date);
    const day = dailyFor(entry.date);
    day.fractionalHours += entry.hours;
    day.paidHours += entry.hours;
    day.standardHours += entry.hours;
    paidHours += entry.hours;
    standardHours += entry.hours;
    if (entry.employeeId) employeeHours.set(entry.employeeId, (employeeHours.get(entry.employeeId) ?? 0) + entry.hours);
  }

  for (const gap of gaps) {
    lines.add(gap.lineCode);
    dates.add(gap.date);
    dailyFor(gap.date).gapShifts += gap.gapShifts;
    const key = `${gap.lineCode}\u0000${gap.date}`;
    heatmapGaps.set(key, (heatmapGaps.get(key) ?? 0) + gap.gapShifts);
  }

  const coveredShifts = assignments.length + fractional.reduce((sum, entry) => sum + entry.hours / HOURS_PER_SHIFT, 0);
  const gapShifts = gaps.reduce((sum, entry) => sum + entry.gapShifts, 0);
  const demandShifts = coveredShifts + gapShifts;
  const coverageRate = demandShifts > 0 ? coveredShifts / demandShifts * 100 : null;
  const hours = [...employeeHours.values()].sort((left, right) => left - right);
  const modeledCapacityHours = hours.length * dates.size * HOURS_PER_SHIFT;
  const laborHourUtilizationRate = modeledCapacityHours > 0 ? paidHours / modeledCapacityHours * 100 : null;
  const totalEmployeeHours = hours.reduce((sum, value) => sum + value, 0);
  const giniNumerator = hours.reduce((sum, value, index) => sum + (2 * (index + 1) - hours.length - 1) * value, 0);
  const gini = hours.length && totalEmployeeHours > 0 ? giniNumerator / (hours.length * totalEmployeeHours) : null;
  const fairness = {
    gini,
    rangeHours: hours.length ? hours.at(-1) - hours[0] : null,
    employeeCount: hours.length,
  };
  const verification = options.verification;
  const compliance = complianceMetrics(verification);
  const scores = (options.satisfactionScores ?? []).map(Number).filter((score) => Number.isInteger(score) && score >= 1 && score <= 5);
  const satisfaction = {
    average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    responseCount: scores.length,
    favorableRate: scores.length ? scores.filter((score) => score >= 4).length / scores.length * 100 : null,
  };
  const costBaseHours = Math.max(0, paidHours - overtimeHours);
  const estimatedLaborCost = paidHours > 0
    ? costBaseHours * SIMULATED_BASE_HOURLY_RATE
      + overtimeHours * SIMULATED_BASE_HOURLY_RATE * SIMULATED_OVERTIME_MULTIPLIER
    : null;
  const costPerCoveredShift = estimatedLaborCost != null && coveredShifts > 0
    ? estimatedLaborCost / coveredShifts : null;
  const cellCoverage = new Map();
  const positionLines = new Map();
  for (const assignment of assignments) positionLines.set(assignment.positionCode, assignment.lineCode);
  for (const gap of gaps) positionLines.set(gap.positionCode, gap.lineCode);
  const cellFor = (lineCode, date, shift) => {
    const key = `${lineCode}\u0000${date}\u0000${shift}`;
    if (!cellCoverage.has(key)) cellCoverage.set(key, { assigned: 0, gap: 0 });
    return cellCoverage.get(key);
  };
  for (const assignment of assignments) cellFor(assignment.lineCode, assignment.date, assignment.shift).assigned += 1;
  for (const gap of gaps) cellFor(gap.lineCode, gap.date, gap.shift).gap += gap.gapShifts;
  for (const entry of fractional) {
    const lineCode = positionLines.get(entry.positionCode);
    if (lineCode) cellFor(lineCode, entry.date, entry.shiftCode).assigned += entry.hours / HOURS_PER_SHIFT;
  }
  const cellRates = [...cellCoverage.values()].map((cell) => {
    const demand = cell.assigned + cell.gap;
    return demand > 0 ? cell.assigned / demand * 100 : null;
  }).filter(Number.isFinite);
  const cellMean = cellRates.length ? cellRates.reduce((sum, value) => sum + value, 0) / cellRates.length : null;
  const cellStdDev = cellMean == null ? null : Math.sqrt(cellRates.reduce((sum, value) => sum + (value - cellMean) ** 2, 0) / cellRates.length);
  const coverageBalance = {
    cellCount: cellRates.length,
    meanRate: cellMean,
    standardDeviation: cellStdDev,
    coefficientVariation: cellMean > 0 ? cellStdDev / cellMean : null,
    score: cellMean == null ? null : Math.max(0, 100 - (cellMean > 0 ? cellStdDev / cellMean * 100 : 100)),
  };
  const hasScheduleRecords = assignments.length + gaps.length + fractional.length > 0;

  const dailyRows = [...daily.values()].sort((left, right) => left.date.localeCompare(right.date)).map((entry) => {
    const covered = entry.assignedShifts + entry.fractionalHours / HOURS_PER_SHIFT;
    const demand = covered + entry.gapShifts;
    return {
      ...entry,
      coveredShifts: covered,
      demandShifts: demand,
      coverageRate: demand > 0 ? covered / demand * 100 : null,
    };
  });
  const heatmap = [...dates].sort().flatMap((date) => [...lines].sort().map((lineCode) => ({
    lineCode,
    date,
    gapShifts: heatmapGaps.get(`${lineCode}\u0000${date}`) ?? 0,
  })));
  const anomalies = [];
  if (demandShifts > 0 && coveredShifts === 0) anomalies.push({ code: 'no_assignments', severity: 'error', message: `该方案没有安排任何员工，${demandShifts.toLocaleString('zh-CN')} 人班需求全部未覆盖，不具备直接执行条件。` });
  if (gapShifts > 0) anomalies.push({ code: 'coverage_gap', severity: 'warning', message: `存在 ${gapShifts.toLocaleString('zh-CN')} 人班岗位缺口。` });
  if (compliance.status === 'failed') anomalies.push({ code: 'verification_failed', severity: 'error', message: `独立核验未通过${compliance.violationCount == null ? '。' : `，记录 ${compliance.violationCount} 项违例。`}优先复核独立核验列出的约束项。` });
  const dailyOverLimit = [...dailyOvertime.entries()].filter(([, value]) => value > DAILY_OVERTIME_LIMIT);
  if (dailyOverLimit.length) anomalies.push({ code: 'daily_overtime_above_limit', severity: 'error', message: `${dailyOverLimit.length} 个员工日的加班工时超过 ${DAILY_OVERTIME_LIMIT} h。` });
  const monthlyOverLimit = [...monthlyOvertime.entries()].filter(([, value]) => value > MONTHLY_OVERTIME_LIMIT);
  if (monthlyOverLimit.length) anomalies.push({ code: 'monthly_overtime_above_limit', severity: 'error', message: `${monthlyOverLimit.length} 个员工月的加班工时超过 ${MONTHLY_OVERTIME_LIMIT} h。` });
  if (coverageBalance.coefficientVariation != null && coverageBalance.coefficientVariation > 0.1) anomalies.push({ code: 'coverage_imbalance', severity: 'warning', message: `岗位班次覆盖率变异系数为 ${(coverageBalance.coefficientVariation * 100).toFixed(1)}%，建议优先检查覆盖率较低的日期与班次。` });

  return {
    assignmentCount: assignments.length,
    gapRecordCount: gaps.length,
    fractionalRecordCount: fractional.length,
    coveredShifts,
    demandShifts,
    gapShifts,
    coverageRate,
    paidHours: hasScheduleRecords ? paidHours : null,
    standardHours: hasScheduleRecords ? standardHours : null,
    overtimeHours: hasScheduleRecords ? overtimeHours : null,
    standardHourRatio: paidHours > 0 ? standardHours / paidHours * 100 : null,
    overtimeShare: paidHours > 0 ? overtimeHours / paidHours * 100 : null,
    laborHourUtilizationRate,
    estimatedLaborCost: hasScheduleRecords ? estimatedLaborCost : null,
    simulatedHourlyRate: SIMULATED_BASE_HOURLY_RATE,
    simulatedOvertimeMultiplier: SIMULATED_OVERTIME_MULTIPLIER,
    costPerCoveredShift,
    laborEfficiency: paidHours > 0 ? coveredShifts / paidHours * 100 : null,
    coverageBalance,
    fairness,
    compliance,
    satisfaction,
    daily: dailyRows,
    heatmap,
    gaps: gaps.sort((left, right) => right.gapShifts - left.gapShifts),
    anomalies,
  };
}

const RADAR_METRICS = [
  { key: 'coverageRate', name: '人力覆盖率', direction: 'higher' },
  { key: 'estimatedLaborCost', name: '模拟人力成本', direction: 'lower' },
  { key: 'costPerCoveredShift', name: '单位覆盖成本', direction: 'lower' },
  { key: 'laborEfficiency', name: '工时人班效率', direction: 'higher' },
  { key: 'overtimeShare', name: '加班工时占比', direction: 'lower' },
  { key: 'coverageBalance', name: '覆盖均衡度', direction: 'higher' },
  { key: 'fairnessGini', name: '工时公平性', direction: 'lower' },
  { key: 'compliance', name: '独立核验', direction: 'higher' },
  { key: 'satisfactionAverage', name: '员工满意度', direction: 'higher' },
];

function radarValue(plan, key) {
  if (key === 'fairnessGini') return plan.fairnessGini ?? plan.fairness?.gini ?? null;
  if (key === 'compliance') {
    if (Number.isFinite(plan.complianceRate)) return plan.complianceRate;
    if (plan.compliance === 'passed' || plan.compliance?.status === 'passed') return 1;
    if (plan.compliance === 'failed' || plan.compliance?.status === 'failed') return 0;
    return null;
  }
  if (key === 'coverageBalance') return plan.coverageBalance?.score ?? null;
  if (key === 'satisfactionAverage') return plan.satisfactionAverage ?? plan.satisfaction?.average ?? null;
  return plan[key] ?? null;
}

/** @param {Array<Record<string, any>>} plans */
export function comparisonRadar(plans) {
  const indicators = [];
  const valuesByMetric = new Map();
  for (const metric of RADAR_METRICS) {
    const values = plans.map((plan) => radarValue(plan, metric.key));
    if (!values.length || !values.every((value) => Number.isFinite(value))) continue;
    valuesByMetric.set(metric.key, values);
    indicators.push({ key: metric.key, name: metric.name, max: 100 });
  }

  const series = plans.map((plan, planIndex) => ({
    name: plan.name ?? plan.id,
    values: indicators.map((indicator) => {
      const metric = RADAR_METRICS.find((item) => item.key === indicator.key);
      const values = valuesByMetric.get(indicator.key) ?? [];
      const value = values[planIndex];
      if (!Number.isFinite(value)) return null;
      const available = values.filter(Number.isFinite);
      const minimum = Math.min(...available);
      const maximum = Math.max(...available);
      if (minimum === maximum) return 100;
      const score = (value - minimum) / (maximum - minimum) * 100;
      return metric?.direction === 'lower' ? 100 - score : score;
    }),
  }));
  return { indicators, series };
}
