import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Descriptions, Empty, Row, Select, Space, Spin, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import type { EChartsOption } from 'echarts';
import { ReloadOutlined } from '@ant-design/icons';
import { api, type ScheduleRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import ChartPanel from '../../components/ChartPanel';
import AdvancedChartPanel from './AdvancedChartPanel';
import DataSourceTag from '../../components/DataSourceTag';
import FieldHelp from '../../components/FieldHelp';
import { formatDate } from '../../lib/display.js';
import { analyzeScheduleCsv, comparisonRadar } from './metrics.js';
import type { ScheduleAnalysis, ScheduleGap } from './metrics.js';

interface AnalyzedPlan {
  record: AnalyzedScheduleRecord;
  metrics: ScheduleAnalysis;
}
interface AnalyzedScheduleRecord extends ScheduleRecord { job?: Record<string, any> | null }

const comparisonMetrics = [
  { key: 'coverageRate', label: '人力覆盖率', unit: '%', direction: '越高越好' },
  { key: 'estimatedLaborCost', label: '模拟人力成本', unit: '元', direction: '越低越好' },
  { key: 'costPerCoveredShift', label: '单位覆盖成本', unit: '元/人班', direction: '越低越好' },
  { key: 'laborEfficiency', label: '工时人班效率', unit: '人班/100 h', direction: '越高越好' },
  { key: 'gapShifts', label: '未覆盖需求', unit: '人班', direction: '越低越好' },
  { key: 'overtimeHours', label: '加班工时', unit: 'h', direction: '越低越好' },
  { key: 'overtimeShare', label: '加班工时占比', unit: '%', direction: '越低越好' },
  { key: 'laborHourUtilizationRate', label: '排班工时利用率', unit: '%', direction: '结合覆盖率和加班量判断' },
  { key: 'complianceRate', label: '合规规则通过率', unit: '%', direction: '越高越好' },
  { key: 'coverageBalance', label: '覆盖均衡度', unit: '分', direction: '越高越好' },
  { key: 'standardHourRatio', label: '标准工时占比', unit: '%', direction: '越高越好' },
  { key: 'gini', label: '工时基尼系数', unit: '', direction: '越低越好' },
  { key: 'satisfaction', label: '员工满意度', unit: '分', direction: '越高越好' },
] as const;

function planLabel(record: AnalyzedScheduleRecord, job?: Record<string, any> | null) {
  const scenarioName = job?.request?.parameters?.scenario_name ?? record.verification?.scenario_name;
  const zeroAssignment = job?.status === 'succeeded' && job?.result?.summary?.kpi?.assigned === 0;
  return `${typeof scenarioName === 'string' && scenarioName.trim() ? scenarioName : `排班方案 ${record.schedule_id.slice(0, 8)}`}${zeroAssignment ? ' · 零排班预警' : ''} · V${record.version}`;
}

function complianceTag(status: ScheduleAnalysis['compliance']['status']) {
  if (status === 'passed') return <Tag color="green">通过</Tag>;
  if (status === 'failed') return <Tag color="red">未通过</Tag>;
  return <Tag>未核验</Tag>;
}

function comparisonGroupLabel(value: unknown) {
  if (value === 'baseline-demand') return '基准需求组';
  if (value === 'peak-demand') return '旺季需求组';
  return typeof value === 'string' && value ? value : '未标注';
}

function MetricTitle({ label, purpose, source, unit, impact, limitation }: {
  label: string;
  purpose: string;
  source: string;
  unit: string;
  impact: string;
  limitation: string;
}) {
  return <Space size={4}><Typography.Text>{label}</Typography.Text><FieldHelp definition={{ title: label, purpose, sourceOrDefault: source, unit, impact, limitation }} /></Space>;
}

async function loadAnalyzedPlan(record: AnalyzedScheduleRecord): Promise<AnalyzedPlan> {
  const [csvText, feedback] = await Promise.all([
    api.scheduleArtifactCsv(record.sha256),
    api.feedback({ schedule_id: record.id, limit: 500 }),
  ]);
  const metrics = analyzeScheduleCsv(csvText, {
    verification: record.verification,
    satisfactionScores: feedback.items.map((item) => item.payload?.satisfaction_score),
  });
  return { record, metrics };
}

export default function ScheduleAnalysisPage({ datasetId, refresh }: PageProps) {
  const [records, setRecords] = useState<AnalyzedScheduleRecord[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [singleId, setSingleId] = useState<string>();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [tab, setTab] = useState('single');
  const [singlePlan, setSinglePlan] = useState<AnalyzedPlan | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState('');
  const [comparisonPlans, setComparisonPlans] = useState<AnalyzedPlan[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const [comparisonMetric, setComparisonMetric] = useState<(typeof comparisonMetrics)[number]['key']>('coverageRate');

  useEffect(() => {
    let active = true;
    setRecordsLoading(true);
    setRecordError('');
    api.archive({ dataset_id: datasetId, limit: 100 })
      .then((result) => {
        if (!active) return;
        const available = (result.items ?? []).map((item) => ({ ...item.schedule, job: item.job }))
          .filter((item) => item.dataset_id === datasetId);
        setRecords(available);
        setSingleId((current) => available.some((item) => item.id === current) ? current : available[0]?.id);
        setCompareIds((current) => {
          const retained = current.filter((id) => available.some((item) => item.id === id));
          return retained.length >= 2 ? retained.slice(0, 5) : available.slice(0, 5).map((item) => item.id);
        });
      })
      .catch((error: Error) => { if (active) { setRecords([]); setRecordError(error.message || '无法读取方案档案。'); } })
      .finally(() => { if (active) setRecordsLoading(false); });
    return () => { active = false; };
  }, [datasetId, refresh, reloadKey]);

  useEffect(() => {
    let active = true;
    const record = records.find((item) => item.id === singleId);
    if (!record) { setSinglePlan(null); setSingleError(''); setSingleLoading(false); return () => { active = false; }; }
    setSingleLoading(true);
    setSingleError('');
    loadAnalyzedPlan(record)
      .then((plan) => { if (active) setSinglePlan(plan); })
      .catch((error: Error) => { if (active) { setSinglePlan(null); setSingleError(error.message || '无法读取所选方案的分析数据。'); } })
      .finally(() => { if (active) setSingleLoading(false); });
    return () => { active = false; };
  }, [records, singleId]);

  const selectedComparisonRecords = useMemo(
    () => compareIds.map((id) => records.find((item) => item.id === id)).filter((item): item is ScheduleRecord => item !== undefined),
    [compareIds, records],
  );

  useEffect(() => {
    let active = true;
    if (selectedComparisonRecords.length < 2) {
      setComparisonPlans([]);
      setComparisonError('');
      setComparisonLoading(false);
      return () => { active = false; };
    }
    setComparisonLoading(true);
    setComparisonError('');
    Promise.all(selectedComparisonRecords.map(loadAnalyzedPlan))
      .then((plans) => { if (active) setComparisonPlans(plans); })
      .catch((error: Error) => { if (active) { setComparisonPlans([]); setComparisonError(error.message || '无法读取所选方案的对比数据。'); } })
      .finally(() => { if (active) setComparisonLoading(false); });
    return () => { active = false; };
  }, [selectedComparisonRecords]);

  const metrics = singlePlan?.metrics;
  const dailyOption: EChartsOption = useMemo(() => ({
    color: ['#245b8f', '#d18a3b'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { bottom: 0, data: ['人力覆盖率', '加班工时'] },
    grid: { left: 66, right: 62, top: 28, bottom: 52 },
    xAxis: { type: 'category', data: metrics?.daily.map((item) => item.date) ?? [], axisTick: { show: false } },
    yAxis: [
      { type: 'value', name: '覆盖率（%）', min: 0, max: 100, splitLine: { lineStyle: { color: '#eef1f4' } } },
      { type: 'value', name: '加班工时（h）', min: 0, splitLine: { show: false } },
    ],
    series: [
      { name: '人力覆盖率', type: 'line', data: metrics?.daily.map((item) => item.coverageRate) ?? [], connectNulls: false, symbolSize: 5 },
      { name: '加班工时', type: 'line', yAxisIndex: 1, data: metrics?.daily.map((item) => item.overtimeHours) ?? [], connectNulls: false, symbolSize: 5 },
    ],
  }), [metrics]);

  const heatmapOption: EChartsOption = useMemo(() => {
    const dates = [...new Set(metrics?.heatmap.map((item) => item.date) ?? [])].sort();
    const lines = [...new Set(metrics?.heatmap.map((item) => item.lineCode) ?? [])].sort();
    const values = metrics?.heatmap.map((item) => item.gapShifts) ?? [];
    return {
      tooltip: { position: 'top', formatter: (params: any) => {
        const [dateIndex, lineIndex, gap] = params.value as [number, number, number];
        return `${lines[lineIndex]} · ${dates[dateIndex]}<br/>未覆盖需求：${gap} 人班`;
      } },
      grid: { left: 110, right: 24, top: 12, bottom: 62 },
      xAxis: { type: 'category', data: dates, splitArea: { show: true }, axisLabel: { rotate: 45 } },
      yAxis: { type: 'category', data: lines, splitArea: { show: true } },
      visualMap: {
        min: 0,
        max: Math.max(1, ...values),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        text: ['缺口较多', '无缺口'],
        inRange: { color: ['#eef3f7', '#c9d9e8', '#7299ba', '#b84a4a'] },
      },
      series: [{ type: 'heatmap', data: metrics?.heatmap.map((item) => [dates.indexOf(item.date), lines.indexOf(item.lineCode), item.gapShifts]) ?? [], label: { show: false }, emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,.18)' } } }],
    };
  }, [metrics]);

  const comparisonRows = useMemo(() => comparisonPlans.map(({ record, metrics: value }) => ({
    id: record.id,
    plan: planLabel(record, record.job),
    scenarioFamily: record.verification?.scenario_family ?? '未分类',
    comparisonGroup: comparisonGroupLabel(record.verification?.comparison_group),
    strategy: record.verification?.strategy ?? '未标注',
    demandShifts: value.demandShifts,
    gapShifts: value.gapShifts,
    coverageRate: value.coverageRate,
    paidHours: value.paidHours,
    estimatedLaborCost: value.estimatedLaborCost,
    costPerCoveredShift: value.costPerCoveredShift,
    laborEfficiency: value.laborEfficiency,
    overtimeHours: value.overtimeHours,
    overtimeShare: value.overtimeShare,
    laborHourUtilizationRate: value.laborHourUtilizationRate,
    standardHourRatio: value.standardHourRatio,
    complianceRate: value.compliance.rate,
    coverageBalance: value.coverageBalance.score,
    gini: value.fairness.gini,
    fairnessRange: value.fairness.rangeHours,
    compliance: value.compliance,
    satisfaction: value.satisfaction,
  })), [comparisonPlans]);
  const radarData = useMemo(() => comparisonRadar(comparisonPlans.map(({ record, metrics: value }) => ({
    id: record.id,
    name: planLabel(record, record.job),
    coverageRate: value.coverageRate,
    estimatedLaborCost: value.estimatedLaborCost,
    costPerCoveredShift: value.costPerCoveredShift,
    laborEfficiency: value.laborEfficiency,
    overtimeShare: value.overtimeShare,
    coverageBalance: value.coverageBalance,
    complianceRate: value.compliance.rate,
    fairness: value.fairness,
    compliance: value.compliance,
    satisfaction: value.satisfaction,
  }))), [comparisonPlans]);

  const comparisonBarOption: EChartsOption = useMemo(() => {
    const setting = comparisonMetrics.find((item) => item.key === comparisonMetric) ?? comparisonMetrics[0];
    const valueFor = (plan: (typeof comparisonRows)[number]) => {
      if (setting.key === 'gini') return plan.gini;
      if (setting.key === 'satisfaction') return plan.satisfaction.average;
      if (setting.key === 'coverageRate') return plan.coverageRate;
      if (setting.key === 'estimatedLaborCost') return plan.estimatedLaborCost;
      if (setting.key === 'costPerCoveredShift') return plan.costPerCoveredShift;
      if (setting.key === 'laborEfficiency') return plan.laborEfficiency;
      if (setting.key === 'gapShifts') return plan.gapShifts;
      if (setting.key === 'overtimeShare') return plan.overtimeShare;
      if (setting.key === 'complianceRate') return plan.complianceRate;
      if (setting.key === 'coverageBalance') return plan.coverageBalance;
      if (setting.key === 'standardHourRatio') return plan.standardHourRatio;
      if (setting.key === 'laborHourUtilizationRate') return plan.laborHourUtilizationRate;
      return plan.overtimeHours;
    };
    return {
      color: ['#537a9e'],
      tooltip: { trigger: 'axis', valueFormatter: (value) => value == null ? '无可计算值' : `${value}${setting.unit ? ` ${setting.unit}` : ''}` },
      grid: { left: 72, right: 22, top: 22, bottom: 64 },
      xAxis: { type: 'category', data: comparisonRows.map((row) => row.plan), axisLabel: { interval: 0, rotate: 20 } },
      yAxis: { type: 'value', name: setting.unit || '无量纲', splitLine: { lineStyle: { color: '#eef1f4' } } },
      series: [{ name: setting.label, type: 'bar', barMaxWidth: 44, data: comparisonRows.map(valueFor), itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    };
  }, [comparisonMetric, comparisonRows]);

  const radarOption: EChartsOption = useMemo(() => ({
    color: ['#245b8f', '#d18a3b', '#6b9274', '#8d78a8', '#a86d65'],
    tooltip: {},
    legend: { bottom: 0, type: 'scroll' },
    radar: { indicator: radarData.indicators, radius: '62%', axisName: { color: '#536273' }, splitLine: { lineStyle: { color: '#e5e9ee' } }, splitArea: { areaStyle: { color: ['#fff', '#fafbfd'] } } },
    series: [{ type: 'radar', data: radarData.series.map((item) => ({ name: item.name, value: item.values, symbolSize: 4 })) }],
  }), [radarData]);

  const gapColumns: TableColumnsType<ScheduleGap> = [
    { title: '产线', dataIndex: 'lineCode', key: 'lineCode', width: 140 },
    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
    { title: '班次', dataIndex: 'shift', key: 'shift', width: 100 },
    { title: '岗位', dataIndex: 'positionName', key: 'positionName' },
    { title: '岗位编码', dataIndex: 'positionCode', key: 'positionCode', width: 120 },
    { title: '缺口', dataIndex: 'gapShifts', key: 'gapShifts', align: 'right', render: (value: number) => `${value.toLocaleString('zh-CN')} 人班` },
  ];

  const comparisonColumns: TableColumnsType<(typeof comparisonRows)[number]> = [
    { title: '方案', dataIndex: 'plan', key: 'plan', fixed: 'left', width: 230 },
    { title: '业务场景', dataIndex: 'scenarioFamily', key: 'scenarioFamily', width: 120 },
    { title: '对比组', dataIndex: 'comparisonGroup', key: 'comparisonGroup', width: 140 },
    { title: '方案策略', dataIndex: 'strategy', key: 'strategy', width: 190, ellipsis: true },
    { title: '需求人班', dataIndex: 'demandShifts', key: 'demandShifts', align: 'right', render: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) },
    { title: '人力覆盖率', dataIndex: 'coverageRate', key: 'coverageRate', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(2)}%` },
    { title: '未覆盖人班', dataIndex: 'gapShifts', key: 'gapShifts', align: 'right', render: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) },
    { title: '模拟人力成本', dataIndex: 'estimatedLaborCost', key: 'estimatedLaborCost', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}` },
    { title: '单位覆盖成本', dataIndex: 'costPerCoveredShift', key: 'costPerCoveredShift', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` },
    { title: '工时人班效率', dataIndex: 'laborEfficiency', key: 'laborEfficiency', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(2)} 人班/100 h` },
    { title: '标准工时占比', dataIndex: 'standardHourRatio', key: 'standardHourRatio', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(2)}%` },
    { title: '排班工时利用率', dataIndex: 'laborHourUtilizationRate', key: 'laborHourUtilizationRate', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(2)}%` },
    { title: '加班工时', dataIndex: 'overtimeHours', key: 'overtimeHours', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toLocaleString('zh-CN')} h` },
    { title: '加班占比', dataIndex: 'overtimeShare', key: 'overtimeShare', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(2)}%` },
    { title: '合规规则通过率', dataIndex: 'complianceRate', key: 'complianceRate', align: 'right', render: (value: number | null) => value == null ? '仅提供核验结论' : `${value.toFixed(2)}%` },
    { title: '覆盖均衡度', dataIndex: 'coverageBalance', key: 'coverageBalance', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(1)} 分` },
    { title: '工时基尼系数', dataIndex: 'gini', key: 'gini', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : value.toFixed(4) },
    { title: '工时极差', dataIndex: 'fairnessRange', key: 'fairnessRange', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toLocaleString('zh-CN')} h` },
    { title: '约束核验', dataIndex: 'compliance', key: 'compliance', render: (value: ScheduleAnalysis['compliance']) => <Space>{complianceTag(value.status)}{value.violationCount == null ? null : <Typography.Text type="secondary">{value.violationCount} 项违例</Typography.Text>}</Space> },
    { title: '满意度', dataIndex: 'satisfaction', key: 'satisfaction', align: 'right', render: (value: ScheduleAnalysis['satisfaction']) => value.average == null ? '无可计算值' : `${value.average.toFixed(2)} 分（${value.responseCount} 份）` },
    { title: '满意度正向率', dataIndex: ['satisfaction', 'favorableRate'], key: 'favorableRate', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(1)}%` },
  ];

  const recordOptions = records.map((record) => ({ value: record.id, label: `${planLabel(record, record.job)} · ${formatDate(record.created_at)}` }));
  const singleRecord = records.find((record) => record.id === singleId);
  const hasScenarioRuleSimulation = singleRecord?.source_type === 'synthetic_demo'
    && typeof singleRecord.verification?.verification_state === 'string'
    && singleRecord.verification.verification_state.includes('场景规则模拟');
  const selectedComparisonMetric = comparisonMetrics.find((item) => item.key === comparisonMetric) ?? comparisonMetrics[0];

  return <>
    <PageHeader title="排班管理分析" description="查看岗位覆盖、模拟人工成本、加班风险、约束通过率、覆盖均衡度、员工工时公平性及模拟满意度，并比较单次排班与多套业务方案。" extra={<Button icon={<ReloadOutlined />} onClick={() => { setReloadKey((value) => value + 1); refresh(); }}>刷新数据</Button>} />
    <Alert
      className="section-card"
      type="info"
      showIcon
      message="指标来源与解释边界"
      description="排班工时利用率＝计薪工时÷（有排班员工数×方案记录天数×8 h）；分母使用模型口径的 8 h/人·日，不含未排班候选员工及个体可用工时差异，需结合覆盖率和加班量判断。标准工时占比＝标准工时÷计薪工时；覆盖均衡度按产线、日期、班次覆盖率变异系数换算为 0–100 分；合规规则通过率按七项检查结果计算。对已有独立核验记录的方案，该指标反映核验结果；对扩充合成方案，该指标反映规则模拟检查结果，方案仍标记为未独立核验。估算人工成本使用演示费率 ¥35/h、加班倍率 1.5，属于模拟口径，不代表实际工资。满意度来自关联方案的本机模拟评分；无样本时显示无可计算值。"
    />
    {datasetId === 'synthetic-demo-expanded-20261008-v1' && <Alert
      className="section-card"
      type="warning"
      showIcon
      message="扩充演示方案口径"
      description="当前数据版本包含 12 套 2026-10-01 至 2026-10-14 的合成排班方案，覆盖常规需求、成本控制、缺勤应急、夜班保障、技能匹配和旺季增产等场景。满意度、合规规则统计及人工成本均为本机模拟值；方案未执行独立硬约束核验。旺季方案采用不同需求量，已在对比组字段中标识。"
    />}
    {recordError && <Alert className="section-card" type="error" showIcon message="方案列表读取失败" description={recordError} />}
    <Tabs
      activeKey={tab}
      onChange={setTab}
      className="section-card"
      items={[
        { key: 'single', label: '单次排班分析' },
        { key: 'compare', label: '多方案对比' },
      ]}
    />

    {tab === 'single' && <>
      <Card className="section-card filter-card" size="small">
        <Space wrap>
          <Typography.Text strong>分析方案</Typography.Text>
          <FieldHelp definition={{ title: '分析方案', purpose: '选择当前数据版本中一个已登记方案进行全周期分析。', sourceOrDefault: '默认选择最新登记方案。', impact: '变更后重新读取完整方案文件、独立核验记录和关联满意度评分。', limitation: '只分析本机登记的方案版本；未登记文件不可选。' }} />
          <Select value={singleId} onChange={setSingleId} options={recordOptions} loading={recordsLoading} placeholder="当前数据版本没有已登记方案" style={{ minWidth: 360 }} showSearch optionFilterProp="label" />
          {singleRecord && <DataSourceTag sourceType={singleRecord.source_type} />}
        </Space>
      </Card>
      {singleLoading && <div className="initial-loading"><Spin /><span>正在读取方案并计算指标</span></div>}
      {singleError && <Alert className="section-card" type="error" showIcon message="方案分析失败" description={singleError} />}
      {!singleLoading && !singleError && !singlePlan && <Card className="section-card"><Empty description={recordsLoading ? '正在读取方案列表' : '当前数据版本没有可分析的排班方案'} /></Card>}
      {!singleLoading && !singleError && metrics && singleRecord && <>
        {singleRecord.verification?.verification_state && <Alert className="section-card" type="warning" showIcon message="方案核验状态说明" description={singleRecord.verification.verification_state} />}
        <Row gutter={[16, 16]} className="section-card">
          <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title={<MetricTitle label="人力覆盖率" purpose="查看已覆盖需求占全部需求的比例。" source="由当前方案 CSV 中的整班、非完整班次和缺口记录复算。" unit="%" impact="用于识别人员容量不足的日期和产线。" limitation="不代表实际到岗或产量；需求分母为方案文件记录的人班。" />} value={metrics.coverageRate == null ? '—' : metrics.coverageRate} precision={metrics.coverageRate == null ? undefined : 2} suffix={metrics.coverageRate == null ? undefined : '%'} /></Card></Col>
          <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title={<MetricTitle label="未覆盖需求" purpose="统计方案文件记录的岗位缺口人班。" source="读取缺口记录区的缺口人班字段。" unit="人班" impact="数值越高，未满足的岗位需求越多。" limitation="岗位分类信息不在缺口记录中，本页不按关键岗位类别推算缺口。" />} value={metrics.gapShifts} suffix="人班" /></Card></Col>
          <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title={<MetricTitle label="模拟人工成本" purpose="估算排班方案的人力成本，用于方案间相对比较。" source={`标准工时按 ¥${metrics.simulatedHourlyRate}/h，加班工时按 ${metrics.simulatedOvertimeMultiplier} 倍计价。`} unit="元" impact="综合反映排班工时与加班结构。" limitation="演示费率不是企业工资标准，未包含津贴、社保及其他费用。" />} value={metrics.estimatedLaborCost == null ? '—' : metrics.estimatedLaborCost} precision={metrics.estimatedLaborCost == null ? undefined : 0} prefix={metrics.estimatedLaborCost == null ? undefined : '¥'} /></Card></Col>
          <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title={<MetricTitle label="加班工时" purpose="汇总排班方案中各整班指派记录的加班工时。" source="读取方案 CSV 当日加班工时字段。" unit="h" impact="用于识别加班较高的方案和时间段。" limitation="方案时长不代表考勤实绩；异常按单日 3 h、单月 36 h 规则识别。" />} value={metrics.overtimeHours == null ? '—' : metrics.overtimeHours} precision={metrics.overtimeHours == null ? undefined : 1} suffix={metrics.overtimeHours == null ? undefined : 'h'} /></Card></Col>
          <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title={<MetricTitle label="标准工时占比" purpose="查看标准工时在计薪工时中的占比。" source="标准工时总量除以计薪工时总量。" unit="%" impact="占比偏低时应检查加班结构及非完整班次工时。" limitation="此指标不等同于设备产能利用率或员工实际出勤率。" />} value={metrics.standardHourRatio == null ? '—' : metrics.standardHourRatio} precision={metrics.standardHourRatio == null ? undefined : 2} suffix={metrics.standardHourRatio == null ? undefined : '%'} /></Card></Col>
          <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title={<MetricTitle label="排班工时利用率" purpose="估算有排班员工在方案周期内的排班工时相对容量占用。" source="计薪工时总量÷（有排班员工数×方案记录天数×8 h/人·日）。" unit="%" impact="用于比较方案周期中的工时容量占用，应同时查看岗位覆盖、缺口和加班指标。" limitation="分母为统一的演示口径；不含未排班候选员工、休假及个人可用工时差异，超过 100% 表示计薪工时高于此理论分母。" />} value={metrics.laborHourUtilizationRate == null ? '—' : metrics.laborHourUtilizationRate} precision={metrics.laborHourUtilizationRate == null ? undefined : 2} suffix={metrics.laborHourUtilizationRate == null ? undefined : '%'} /></Card></Col>
        </Row>
        <Row gutter={[16, 16]} className="section-card">
          <Col xs={24} xl={14}>
            <Card title="工时公平性与合规性">
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="有排班员工">{metrics.fairness.employeeCount.toLocaleString('zh-CN')} 人</Descriptions.Item>
                <Descriptions.Item label="员工工时基尼系数">{metrics.fairness.gini == null ? '无可计算值' : metrics.fairness.gini.toFixed(4)}</Descriptions.Item>
                <Descriptions.Item label="员工工时极差">{metrics.fairness.rangeHours == null ? '无可计算值' : `${metrics.fairness.rangeHours.toLocaleString('zh-CN')} h`}</Descriptions.Item>
                <Descriptions.Item label="独立硬约束核验">{complianceTag(metrics.compliance.status)}</Descriptions.Item>
                <Descriptions.Item label={hasScenarioRuleSimulation ? '场景规则模拟通过率' : '独立硬约束项通过率'}>{metrics.compliance.rate == null ? '仅提供核验结论' : `${metrics.compliance.rate.toFixed(2)}%（${metrics.compliance.passedChecks ?? 7}/${metrics.compliance.totalChecks ?? 7} 项）`}</Descriptions.Item>
                <Descriptions.Item label="记录违例数">{metrics.compliance.violationCount == null ? '报告未提供计数' : `${metrics.compliance.violationCount} 项`}</Descriptions.Item>
                <Descriptions.Item label="覆盖均衡度">{metrics.coverageBalance.score == null ? '无可计算值' : `${metrics.coverageBalance.score.toFixed(1)} 分`}</Descriptions.Item>
                <Descriptions.Item label="覆盖率变异系数">{metrics.coverageBalance.coefficientVariation == null ? '无可计算值' : `${(metrics.coverageBalance.coefficientVariation * 100).toFixed(1)}%`}</Descriptions.Item>
                <Descriptions.Item label="员工满意度">{metrics.satisfaction.average == null ? '无可计算值' : `${metrics.satisfaction.average.toFixed(2)} 分`}</Descriptions.Item>
                <Descriptions.Item label="满意度正向率">{metrics.satisfaction.favorableRate == null ? '无可计算值' : `${metrics.satisfaction.favorableRate.toFixed(1)}%（评分不低于 4 分）`}</Descriptions.Item>
                <Descriptions.Item label="有效评分样本">{metrics.satisfaction.responseCount.toLocaleString('zh-CN')} 份</Descriptions.Item>
                <Descriptions.Item label="整班指派">{metrics.assignmentCount.toLocaleString('zh-CN')} 人班</Descriptions.Item>
                <Descriptions.Item label="非完整班次">{metrics.fractionalRecordCount.toLocaleString('zh-CN')} 条</Descriptions.Item>
              </Descriptions>
              <Typography.Paragraph type="secondary" className="small-note top-space">基尼系数根据有排班员工计薪工时计算，越低表示员工工时分布越均匀。覆盖均衡度按已登记的产线、日期和班次需求单元计算；满意度只反映本机模拟反馈样本。</Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card title="异常与瓶颈识别">
              {metrics.anomalies.length ? <Space direction="vertical" className="full-width">
                {metrics.anomalies.map((item) => <Alert key={item.code} type={item.severity} showIcon message={item.message} />)}
              </Space> : <Alert type="success" showIcon message="未发现已定义规则下的覆盖缺口或加班超限" description="独立核验状态仍需按上方记录单独确认。" />}
              <Typography.Paragraph type="secondary" className="small-note top-space">当前识别规则：岗位需求缺口、方案登记的七项核验或场景模拟检查、单日加班超过 3 h、员工单月加班超过 36 h、产线日期班次覆盖率差异超过 10%。页面不推断 CSV 中没有记录的人员可用工时或实际到岗情况。</Typography.Paragraph>
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 16]} className="section-card">
          <Col xs={24}>{metrics.daily.length ? <ChartPanel title="每日人力覆盖与加班趋势" option={dailyOption} height={320} /> : <Card title="每日人力覆盖与加班趋势" className="chart-card"><Empty description="当前方案没有按日可计算记录" /></Card>}</Col>
          <Col xs={24}>{metrics.heatmap.length ? <AdvancedChartPanel title="产线与日期缺口热力图" option={heatmapOption} height={Math.min(580, Math.max(280, new Set(metrics.heatmap.map((item) => item.lineCode)).size * 28 + 120))} /> : <Card title="产线与日期缺口热力图" className="chart-card"><Empty description="当前方案没有缺口热力数据" /></Card>}</Col>
        </Row>
        <Card title={`岗位空缺明细（${metrics.gapRecordCount} 条）`} className="section-card">
          <Table rowKey={(_row, index) => String(index)} size="small" dataSource={metrics.gaps} columns={gapColumns} pagination={{ pageSize: 8 }} scroll={{ x: 780 }} locale={{ emptyText: '当前方案没有岗位空缺记录' }} />
        </Card>
      </>}
    </>}

    {tab === 'compare' && <>
      <Card className="section-card filter-card" size="small">
        <Space wrap>
          <Typography.Text strong>对比方案</Typography.Text>
          <FieldHelp definition={{ title: '对比方案', purpose: '并列分析同一数据版本下的 2 至 5 个已登记方案。', sourceOrDefault: '默认选择最近登记的五套方案。', impact: '所选方案将逐一读取完整 CSV、核验状态和关联反馈评分。', limitation: '最多 5 个；当前选择的数据版本决定方案范围。' }} />
          <Select mode="multiple" maxCount={5} value={compareIds} onChange={setCompareIds} options={recordOptions} loading={recordsLoading} placeholder="至少选择两套方案" style={{ minWidth: 500 }} showSearch optionFilterProp="label" />
        </Space>
      </Card>
      {comparisonError && <Alert className="section-card" type="error" showIcon message="方案对比失败" description={comparisonError} />}
      {comparisonLoading && <div className="initial-loading"><Spin /><span>正在读取方案并计算对比指标</span></div>}
      {!comparisonLoading && !comparisonError && comparisonRows.length < 2 && <Card className="section-card"><Empty description={records.length < 2 ? '当前数据版本至少需要两套已登记方案才能进行对比' : '请选择两套或以上方案'} /></Card>}
      {!comparisonLoading && !comparisonError && comparisonRows.length >= 2 && <>
        <Alert className="section-card" type="warning" showIcon message="模拟成本、评分及方案边界" description="本机演示费率 ¥35/h 和加班倍率 1.5 用于形成可比较的成本估算，不代表企业工资政策。演示评分仅用于展示满意度分析。不同需求倍率的方案必须结合场景需求量阅读；雷达图只显示所选方案的相对归一化结果。" />
        <Card title="多方案关键指标" className="section-card">
          <Table rowKey="id" size="middle" dataSource={comparisonRows} columns={comparisonColumns} pagination={false} scroll={{ x: 1740 }} />
        </Card>
        <Row gutter={[16, 16]} className="section-card">
          <Col xs={24} xl={14}>
            <Card title="单指标方案对比" className="chart-card" extra={<Space><Typography.Text>对比指标</Typography.Text><FieldHelp definition={{ title: '对比指标', purpose: '选择柱状图显示的方案评价指标。', sourceOrDefault: '默认显示人力覆盖率。', impact: '改变横向对比柱状图的数据字段和单位。', limitation: '各指标量纲不同，逐项选择，不混用同一数值轴。' }} /><Select value={comparisonMetric} onChange={setComparisonMetric} options={comparisonMetrics.map((item) => ({ value: item.key, label: item.label }))} style={{ minWidth: 210 }} /></Space>}>
              <ChartPanel title={selectedComparisonMetric.label} option={comparisonBarOption} height={330} />
              <Typography.Paragraph type="secondary" className="small-note">比较方向：{selectedComparisonMetric.direction}。柱状图保留指标原始单位；未提供的数据不以零值替代。</Typography.Paragraph>
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            {radarData.indicators.length ? <AdvancedChartPanel title="方案相对评价雷达图" option={radarOption} height={400} /> : <Card title="方案相对评价雷达图" className="chart-card"><Empty description="所选方案没有共同可计算的评价指标" /></Card>}
            <Typography.Paragraph type="secondary" className="small-note">雷达分数按所选方案的最小值与最大值映射到 0–100 分；相同值映射为 100 分。缺失维度不绘制，不能据此替代硬约束核验或绝对业务评价。</Typography.Paragraph>
          </Col>
        </Row>
      </>}
    </>}
  </>;
}
