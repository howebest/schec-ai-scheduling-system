const HOURS_PER_SHIFT = 8;
const DAILY_OVERTIME_LIMIT = 3;
const MONTHLY_OVERTIME_LIMIT = 36;

function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

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
  if (quoted) throw new Error('排班方案 CSV 包含未闭合的引号。');
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function numberAt(row, index, fieldName) {
  const raw = String(row[index] ?? '').trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) throw new Error(`排班方案 CSV 的${fieldName}字段不是有效数值。`);
  return value;
}

function uniqueMapping(rows, key, value) {
  const values = new Map();
  for (const row of rows) {
    const keyValue = row[key];
    if (!keyValue) continue;
    if (!values.has(keyValue)) values.set(keyValue, new Set());
    if (row[value]) values.get(keyValue).add(row[value]);
  }
  return new Map([...values].map(([name, entries]) => [name, entries.size === 1 ? [...entries][0] : null]));
}

export function parseScheduleData(csvText) {
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
      assignments.push({
        factoryCode: row[0] ?? '', lineCode: row[1] ?? '', date: row[2] ?? '', shift: row[3] ?? '', shiftCode: row[4] ?? '',
        employeeId: row[5] ?? '', positionCode: row[6] ?? '', positionName: row[7] ?? '',
        paidHours: numberAt(row, 10, '计薪工时'), standardHours: numberAt(row, 11, '标准工时'),
        overtimeHours: numberAt(row, 12, '当日加班工时'),
      });
    } else if (section === 'gaps') {
      if (first === '岗位编码' || row.length < 6) continue;
      gaps.push({
        positionCode: row[0] ?? '', positionName: row[1] ?? '', lineCode: row[2] ?? '', date: row[3] ?? '',
        shift: row[4] ?? '', gapShifts: numberAt(row, 5, '缺口人班'),
      });
    } else {
      if (first === '员工工号' || row.length < 5) continue;
      fractional.push({
        employeeId: row[0] ?? '', positionCode: row[1] ?? '', date: row[2] ?? '', shift: row[3] ?? '',
        hours: numberAt(row, 4, '非完整班次工时'),
      });
    }
  }
  const factoryByLine = uniqueMapping(assignments, 'lineCode', 'factoryCode');
  const lineByPosition = uniqueMapping([...assignments, ...gaps], 'positionCode', 'lineCode');
  const shiftByCode = uniqueMapping(assignments, 'shiftCode', 'shift');
  for (const row of gaps) row.factoryCode = factoryByLine.get(row.lineCode) ?? '';
  for (const row of fractional) {
    row.lineCode = lineByPosition.get(row.positionCode) ?? '';
    row.factoryCode = factoryByLine.get(row.lineCode) ?? '';
    row.shiftCode = row.shift;
    row.shift = shiftByCode.get(row.shiftCode) ?? row.shiftCode;
  }
  return { assignments, gaps, fractional, factoryByLine, lineByPosition };
}

export function scheduleFilterOptions(data) {
  const records = [...(data?.assignments ?? []), ...(data?.gaps ?? []), ...(data?.fractional ?? [])];
  const values = (field) => [...new Set(records.map((row) => row[field]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
  return {
    factories: values('factoryCode'),
    lines: values('lineCode'),
    shifts: values('shift'),
    positions: [...new Set(records.map((row) => row.positionCode).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    dates: [...new Set(records.map((row) => row.date).filter(Boolean))].sort(),
  };
}

function matches(row, filters) {
  return (!filters.dateFrom || row.date >= filters.dateFrom)
    && (!filters.dateTo || row.date <= filters.dateTo)
    && (!filters.factoryCode || row.factoryCode === filters.factoryCode)
    && (!filters.lineCode || row.lineCode === filters.lineCode)
    && (!filters.shift || row.shift === filters.shift)
    && (!filters.positionCode || row.positionCode === filters.positionCode);
}

function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function groupFor(map, key, label) {
  if (!map.has(key)) map.set(key, { key, label: label || key, coveredShifts: 0, gapShifts: 0, paidHours: 0, overtimeHours: 0, employees: new Set() });
  return map.get(key);
}

function finishGroups(map) {
  return [...map.values()].map((item) => {
    const demandShifts = item.coveredShifts + item.gapShifts;
    return {
      key: item.key, label: item.label, coveredShifts: item.coveredShifts, demandShifts,
      gapShifts: item.gapShifts, coverageRate: demandShifts > 0 ? item.coveredShifts / demandShifts * 100 : null,
      paidHours: item.paidHours, overtimeHours: item.overtimeHours, employeeCount: item.employees.size,
    };
  }).sort((a, b) => b.gapShifts - a.gapShifts || (a.coverageRate ?? 101) - (b.coverageRate ?? 101) || a.label.localeCompare(b.label, 'zh-CN'));
}

function pearson(left, right) {
  if (left.length < 3 || left.length !== right.length) return null;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  const numerator = left.reduce((sum, value, index) => sum + (value - meanLeft) * (right[index] - meanRight), 0);
  const leftSquare = left.reduce((sum, value) => sum + (value - meanLeft) ** 2, 0);
  const rightSquare = right.reduce((sum, value) => sum + (value - meanRight) ** 2, 0);
  const denominator = Math.sqrt(leftSquare * rightSquare);
  return denominator > 0 ? numerator / denominator : null;
}

export function analyzeScheduleData(data, filters = {}) {
  const assignments = (data?.assignments ?? []).filter((row) => matches(row, filters));
  const gaps = (data?.gaps ?? []).filter((row) => matches(row, filters));
  const fractional = (data?.fractional ?? []).filter((row) => matches(row, filters));
  const lineGroups = new Map();
  const shiftGroups = new Map();
  const positionGroups = new Map();
  const daily = new Map();
  const employeeHours = new Map();
  const dailyOvertime = new Map();
  const monthlyOvertime = new Map();
  const lineDateCells = new Map();
  const getDay = (date) => {
    if (!daily.has(date)) daily.set(date, { date, coveredShifts: 0, gapShifts: 0, paidHours: 0, overtimeHours: 0 });
    return daily.get(date);
  };
  const getLineDate = (lineCode, date) => {
    const key = `${lineCode}\u0000${date}`;
    if (!lineDateCells.has(key)) lineDateCells.set(key, { lineCode, date, coveredShifts: 0, gapShifts: 0 });
    return lineDateCells.get(key);
  };
  const addCovered = (row, shifts, hours, overtimeHours) => {
    for (const [map, key, label] of [[lineGroups, row.lineCode, row.lineCode], [shiftGroups, row.shift, row.shift], [positionGroups, row.positionCode || '未记录岗位', row.positionName || row.positionCode || '未记录岗位']]) {
      const group = groupFor(map, key || '未记录', label || '未记录');
      group.coveredShifts += shifts;
      group.paidHours += hours;
      group.overtimeHours += overtimeHours;
      if (row.employeeId) group.employees.add(row.employeeId);
    }
    const day = getDay(row.date);
    day.coveredShifts += shifts;
    day.paidHours += hours;
    day.overtimeHours += overtimeHours;
    if (row.employeeId) employeeHours.set(row.employeeId, (employeeHours.get(row.employeeId) ?? 0) + hours);
    if (row.lineCode) getLineDate(row.lineCode, row.date).coveredShifts += shifts;
  };
  for (const row of assignments) {
    addCovered(row, 1, row.paidHours, row.overtimeHours);
    const dailyKey = `${row.employeeId}\u0000${row.date}`;
    dailyOvertime.set(dailyKey, (dailyOvertime.get(dailyKey) ?? 0) + row.overtimeHours);
    const monthlyKey = `${row.employeeId}\u0000${row.date.slice(0, 7)}`;
    monthlyOvertime.set(monthlyKey, (monthlyOvertime.get(monthlyKey) ?? 0) + row.overtimeHours);
  }
  for (const row of fractional) addCovered(row, row.hours / HOURS_PER_SHIFT, row.hours, 0);
  for (const row of gaps) {
    for (const [map, key, label] of [[lineGroups, row.lineCode, row.lineCode], [shiftGroups, row.shift, row.shift], [positionGroups, row.positionCode || '未记录岗位', row.positionName || row.positionCode || '未记录岗位']]) {
      groupFor(map, key || '未记录', label || '未记录').gapShifts += row.gapShifts;
    }
    getDay(row.date).gapShifts += row.gapShifts;
    if (row.lineCode) getLineDate(row.lineCode, row.date).gapShifts += row.gapShifts;
  }

  const paidHours = assignments.reduce((sum, row) => sum + row.paidHours, 0) + fractional.reduce((sum, row) => sum + row.hours, 0);
  const standardHours = assignments.reduce((sum, row) => sum + row.standardHours, 0) + fractional.reduce((sum, row) => sum + row.hours, 0);
  const overtimeHours = assignments.reduce((sum, row) => sum + row.overtimeHours, 0);
  const coveredShifts = assignments.length + fractional.reduce((sum, row) => sum + row.hours / HOURS_PER_SHIFT, 0);
  const gapShifts = gaps.reduce((sum, row) => sum + row.gapShifts, 0);
  const demandShifts = coveredShifts + gapShifts;
  const dates = [...daily.keys()].sort();
  const lines = finishGroups(lineGroups);
  const shifts = finishGroups(shiftGroups);
  const positions = finishGroups(positionGroups);
  const orderedHours = [...employeeHours].map(([employeeId, hours]) => ({ employeeId, hours })).sort((a, b) => a.hours - b.hours);
  const values = orderedHours.map((item) => item.hours);
  const p25 = quantile(values, 0.25);
  const median = quantile(values, 0.5);
  const p75 = quantile(values, 0.75);
  const iqr = p25 == null || p75 == null ? null : p75 - p25;
  const giniNumerator = values.reduce((sum, value, index) => sum + (2 * (index + 1) - values.length - 1) * value, 0);
  const totalHours = values.reduce((sum, value) => sum + value, 0);
  const gini = values.length && totalHours > 0 ? giniNumerator / (values.length * totalHours) : null;
  const upperFence = p75 == null || iqr == null ? null : p75 + 1.5 * iqr;
  const lowerFence = p25 == null || iqr == null ? null : Math.max(0, p25 - 1.5 * iqr);
  const outlierEmployees = upperFence == null ? [] : orderedHours.filter((item) => item.hours > upperFence || item.hours < lowerFence);
  const dailyRows = dates.map((date) => {
    const item = daily.get(date);
    const demand = item.coveredShifts + item.gapShifts;
    return { ...item, demandShifts: demand, coverageRate: demand > 0 ? item.coveredShifts / demand * 100 : null };
  });
  const heatmap = lines.flatMap((line) => dailyRows.map((day) => {
    const cell = lineDateCells.get(`${line.key}\u0000${day.date}`) ?? { coveredShifts: 0, gapShifts: 0 };
    const demand = cell.coveredShifts + cell.gapShifts;
    return { lineCode: line.key, date: day.date, coverageRate: demand > 0 ? cell.coveredShifts / demand * 100 : null, gapShifts: cell.gapShifts, demandShifts: demand };
  }));
  const dailyOverLimitCount = [...dailyOvertime.values()].filter((value) => value > DAILY_OVERTIME_LIMIT).length;
  const monthlyOverLimitCount = [...monthlyOvertime.values()].filter((value) => value > MONTHLY_OVERTIME_LIMIT).length;
  const correlationDemandGap = pearson(dailyRows.map((row) => row.demandShifts), dailyRows.map((row) => row.gapShifts));
  return {
    summary: {
      assignmentCount: assignments.length, gapRecordCount: gaps.length, fractionalRecordCount: fractional.length,
      employeeCount: employeeHours.size, dateCount: dates.length, lineCount: lines.length,
      coveredShifts, demandShifts, gapShifts, coverageRate: demandShifts > 0 ? coveredShifts / demandShifts * 100 : null,
      paidHours, standardHours, overtimeHours, standardHourRatio: paidHours > 0 ? standardHours / paidHours * 100 : null,
    },
    distribution: { employeeCount: values.length, p25, median, p75, iqr, gini, rangeHours: values.length ? values.at(-1) - values[0] : null, upperFence, lowerFence, histogram: histogram(values), outlierEmployees: outlierEmployees.slice(0, 20) },
    daily: dailyRows,
    heatmap,
    byLine: lines,
    byShift: shifts,
    byPosition: positions,
    gapDetails: gaps.sort((a, b) => b.gapShifts - a.gapShifts || a.date.localeCompare(b.date)).slice(0, 100),
    diagnostics: { dailyOverLimitCount, monthlyOverLimitCount, outlierCount: outlierEmployees.length, correlationDemandGap, filteredRecordCount: assignments.length + gaps.length + fractional.length },
  };
}

function histogram(values) {
  if (!values.length) return [];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return [{ label: `${low.toFixed(1)} h`, start: low, end: high, count: values.length }];
  const binCount = Math.min(10, Math.max(4, Math.ceil(Math.log2(values.length) + 1)));
  const width = high === low ? 1 : (high - low) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const start = low + width * index;
    const end = index === binCount - 1 ? high : low + width * (index + 1);
    return { label: `${start.toFixed(0)}–${end.toFixed(0)} h`, start, end, count: 0 };
  });
  for (const value of values) bins[Math.min(binCount - 1, Math.floor((value - low) / width))].count += 1;
  return bins;
}
