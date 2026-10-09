import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeScheduleCsv, comparisonRadar } from './metrics.js';

const scheduleCsv = [
  '工厂代码,产线编码,日期,班次,班次代码,员工工号,岗位编码,岗位名称,是否关键岗,技能等级,计薪工时(h),标准工时(h),当日加班工时(h),该班次换型等级,实验编号',
  'F1,"LINE, 1",2026-01-01,夜班,N12,E1,P1,关键岗位,是,3,10,8,2,0,case-1',
  'F1,"LINE, 1",2026-01-02,白班,D12,E2,P2,一般岗位,否,2,8,8,0,0,case-1',
  '"缺口记录：岗位编码,岗位名称,产线编码,日期,班次,缺口人班"',
  '岗位编码,岗位名称,产线编码,日期,班次,缺口人班',
  'P3,岗位3,"LINE, 1",2026-01-01,夜班,1.5',
  '"非完整班次记录：员工工号,岗位编码,日期,班次代码,小时"',
  '员工工号,岗位编码,日期,班次代码,小时',
  'E1,P1,2026-01-01,N12,4',
].join('\r\n');

test('分析完整排班 CSV，计算覆盖、工时公平性、日趋势、缺口热力数据和满意度', () => {
  const result = analyzeScheduleCsv(scheduleCsv, {
    verification: { all_pass: false, hard_violations: 2 },
    satisfactionScores: [5, 3],
  });

  assert.equal(result.assignmentCount, 2);
  assert.equal(result.gapRecordCount, 1);
  assert.equal(result.fractionalRecordCount, 1);
  assert.equal(result.coveredShifts, 2.5);
  assert.equal(result.demandShifts, 4);
  assert.equal(result.coverageRate, 62.5);
  assert.equal(result.paidHours, 22);
  assert.equal(result.overtimeHours, 2);
  assert.equal(result.fairness.employeeCount, 2);
  assert.equal(result.fairness.rangeHours, 6);
  assert.equal(result.fairness.gini, 6 / 44);
  assert.deepEqual(result.compliance, { status: 'failed', violationCount: 2 });
  assert.deepEqual(result.satisfaction, { average: 4, responseCount: 2 });
  assert.equal(result.daily[0].coverageRate, 50);
  assert.equal(result.daily[1].coverageRate, 100);
  assert.deepEqual(result.heatmap[0], { lineCode: 'LINE, 1', date: '2026-01-01', gapShifts: 1.5 });
  assert.ok(result.anomalies.some((item) => item.code === 'coverage_gap'));
  assert.ok(result.anomalies.some((item) => item.code === 'verification_failed'));
});

test('空方案与无满意度样本显示无可计算值，不以零替代缺失值', () => {
  const result = analyzeScheduleCsv(
    '工厂代码,产线编码,日期,班次,班次代码,员工工号,岗位编码,岗位名称,是否关键岗,技能等级,计薪工时(h),标准工时(h),当日加班工时(h),该班次换型等级,实验编号',
    { verification: null, satisfactionScores: [] },
  );

  assert.equal(result.coverageRate, null);
  assert.equal(result.paidHours, null);
  assert.equal(result.overtimeHours, null);
  assert.equal(result.fairness.gini, null);
  assert.equal(result.compliance.status, 'unverified');
  assert.deepEqual(result.satisfaction, { average: null, responseCount: 0 });
  assert.deepEqual(result.daily, []);
  assert.deepEqual(result.heatmap, []);
});

test('核验没有提供违例计数时保留缺失值，不把 null 当作零项违例', () => {
  const result = analyzeScheduleCsv(
    '工厂代码,产线编码,日期,班次,班次代码,员工工号,岗位编码,岗位名称,是否关键岗,技能等级,计薪工时(h),标准工时(h),当日加班工时(h),该班次换型等级,实验编号',
    { verification: { all_pass: false, violation_count: null } },
  );

  assert.deepEqual(result.compliance, { status: 'failed', violationCount: null });
});

test('多方案雷达分数按指标方向归一化，并保留缺失指标', () => {
  const result = comparisonRadar([
    { id: 'A', coverageRate: 80, paidHours: 100, fairnessGini: 0.2, compliance: 'passed', satisfactionAverage: 5 },
    { id: 'B', coverageRate: 100, paidHours: 90, fairnessGini: 0.1, compliance: 'failed', satisfactionAverage: null },
  ]);

  assert.deepEqual(result.indicators.map((item) => item.key), [
    'coverageRate', 'paidHours', 'fairnessGini', 'compliance',
  ]);
  assert.deepEqual(result.series[0].values, [0, 0, 0, 100]);
  assert.deepEqual(result.series[1].values, [100, 100, 100, 0]);
});

test('在项目 FULL62-W1 方案文件上复算出登记覆盖、工时和周期规模', () => {
  const csv = readFileSync(new URL('../../../../data/baseline_schedule_FULL62_W1.csv', import.meta.url), 'utf8');
  const result = analyzeScheduleCsv(csv, { verification: { all_pass: true } });

  assert.equal(result.assignmentCount, 9693);
  assert.equal(result.gapShifts, 1753);
  assert.ok(Math.abs(result.coverageRate - 85.28374748) < 0.000001);
  assert.equal(result.paidHours, 107003);
  assert.equal(result.overtimeHours, 25731);
  assert.equal(result.fairness.employeeCount, 392);
  assert.equal(result.daily.length, 62);
});
