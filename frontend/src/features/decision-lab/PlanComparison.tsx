import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Card, Collapse, Descriptions, Empty, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { EChartsOption } from 'echarts';
import ChartPanel from '../../components/ChartPanel';
import DataSourceTag from '../../components/DataSourceTag';
import FieldHelp from '../../components/FieldHelp';
import { formatMetric, sourceLabel } from '../../lib/display.js';
import { helpText } from '../../help/metadata';
import { buildScheduleExplanations, calculateParetoFrontier, verificationEvidence } from './metrics.js';
import type { AnalyzedDecisionPlan, ComparisonGroup, ParetoCandidate } from './types';

function complianceTag(plan: AnalyzedDecisionPlan) {
  const evidence = verificationEvidence(plan);
  if (evidence.kind === 'simulation') return <Tag color="gold">规则模拟，未独立核验</Tag>;
  const status = plan.analysis.compliance.status;
  if (status === 'passed') return <Tag color="green">通过</Tag>;
  if (status === 'failed') return <Tag color="red">未通过</Tag>;
  return <Tag>未核验</Tag>;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function planOptionName(plan: AnalyzedDecisionPlan) {
  return `${plan.scenarioName} · V${plan.record.version}`;
}

function hasScheduleData(plan: AnalyzedDecisionPlan) {
  return plan.analysis.assignmentCount + plan.analysis.gapRecordCount + plan.analysis.fractionalRecordCount > 0;
}

export default function PlanComparison({ groups, plans, loading, onSelectPlan, selectedPlanId }: {
  groups: ComparisonGroup[];
  plans: AnalyzedDecisionPlan[];
  loading: boolean;
  onSelectPlan: (id: string) => void;
  selectedPlanId?: string;
}) {
  const [groupKey, setGroupKey] = useState<string>();
  useEffect(() => {
    setGroupKey((current) => groups.some((group) => group.key === current) ? current : groups[0]?.key);
  }, [groups]);

  const selectedGroup = groups.find((group) => group.key === groupKey);
  const visiblePlans = useMemo(() => plans.filter((plan) => selectedGroup?.planIds.includes(plan.record.id)), [plans, selectedGroup]);
  const points = useMemo(() => visiblePlans.filter((plan) => Number.isFinite(plan.analysis.coverageRate) && Number.isFinite(plan.analysis.estimatedLaborCost)), [visiblePlans]);
  const selectedPlan = visiblePlans.find((plan) => plan.record.id === selectedPlanId) ?? visiblePlans[0];
  const explanations = useMemo(() => selectedPlan ? buildScheduleExplanations(selectedPlan) : [], [selectedPlan]);
  const gapExplanations = explanations.filter((item) => Boolean(item.lineCode));
  const verificationExplanations = explanations.filter((item) => !item.lineCode);
  const candidates = useMemo<ParetoCandidate[]>(() => visiblePlans.map((plan) => ({
    id: plan.record.id,
    coverageRate: plan.analysis.coverageRate,
    estimatedLaborCost: plan.analysis.estimatedLaborCost,
    gini: plan.analysis.fairness.gini,
  })), [visiblePlans]);
  const pareto = useMemo(() => calculateParetoFrontier(candidates), [candidates]);
  const frontierIds = useMemo(() => new Set(pareto.frontierIds), [pareto.frontierIds]);
  const paretoExcludedIds = useMemo(() => new Set(pareto.excluded.map((item) => item.id)), [pareto.excluded]);

  const choosePlan = useCallback((id: string) => { if (id) onSelectPlan(id); }, [onSelectPlan]);
  useEffect(() => { if (selectedPlan) onSelectPlan(selectedPlan.record.id); }, [selectedPlan?.record.id, onSelectPlan]);

  const scatterOption: EChartsOption = useMemo(() => {
    const toPoint = (plan: AnalyzedDecisionPlan) => ({
      name: planOptionName(plan),
      value: [plan.analysis.estimatedLaborCost, plan.analysis.coverageRate, plan.analysis.fairness.gini, plan.record.id],
      itemStyle: { color: frontierIds.has(plan.record.id) ? '#245b8f' : '#9aa8b5' },
    });
    return {
      color: ['#245b8f', '#9aa8b5'],
      tooltip: {
        trigger: 'item',
        formatter: (input: any) => {
          const point = input?.data?.value as unknown[] | undefined;
          const plan = visiblePlans.find((item) => item.record.id === point?.[3]);
          if (!plan) return '';
          const cost = formatMetric(plan.analysis.estimatedLaborCost, '元');
          const coverage = formatMetric(plan.analysis.coverageRate, '%');
          const gini = plan.analysis.fairness.gini == null ? '无可计算值' : plan.analysis.fairness.gini.toFixed(4);
          const verification = verificationEvidence(plan).statusLabel;
          return `<strong>${escapeHtml(planOptionName(plan))}</strong><br/>需求覆盖率：${escapeHtml(coverage)}<br/>工时成本代理值：${escapeHtml(cost)}<br/>员工工时基尼系数：${escapeHtml(gini)}<br/>数据来源：${escapeHtml(sourceLabel(plan.record.source_type))}<br/>核验状态：${escapeHtml(verification)}<br/>Pareto 状态：${frontierIds.has(plan.record.id) ? '非支配方案' : '存在更优取舍方案'}`;
        },
      },
      legend: { bottom: 0, data: ['Pareto 非支配方案', '其他可比较方案'] },
      grid: { left: 78, right: 28, top: 26, bottom: 58 },
      xAxis: { type: 'value', name: '工时成本代理值（元）', nameLocation: 'middle', nameGap: 38, axisLabel: { formatter: (value: number) => value.toLocaleString('zh-CN') }, splitLine: { lineStyle: { color: '#edf0f3' } } },
      yAxis: { type: 'value', name: '需求覆盖率（%）', min: 0, max: 100, splitLine: { lineStyle: { color: '#edf0f3' } } },
      series: [
        {
          name: 'Pareto 非支配方案',
          type: 'scatter',
          data: points.filter((plan) => frontierIds.has(plan.record.id)).map(toPoint),
          symbolSize: (value: unknown[]) => Number.isFinite(value[2]) ? Math.max(10, Math.min(28, 10 + Number(value[2]) * 40)) : 12,
          emphasis: { focus: 'self', scale: 1.2 },
        },
        {
          name: '其他可比较方案',
          type: 'scatter',
          data: points.filter((plan) => !frontierIds.has(plan.record.id)).map(toPoint),
          symbolSize: (value: unknown[]) => Number.isFinite(value[2]) ? Math.max(10, Math.min(28, 10 + Number(value[2]) * 40)) : 12,
          emphasis: { focus: 'self', scale: 1.2 },
        },
      ],
    };
  }, [frontierIds, points, visiblePlans]);

  const columns: ColumnsType<AnalyzedDecisionPlan> = [
    { title: '方案', key: 'name', fixed: 'left', width: 190, render: (_value, plan) => <Typography.Text strong>{planOptionName(plan)}</Typography.Text> },
    { title: '数据来源', dataIndex: ['record', 'source_type'], key: 'source', width: 120, render: (value: string) => <DataSourceTag sourceType={value} /> },
    { title: '需求人班', key: 'demand', width: 130, align: 'right', render: (_value, plan) => hasScheduleData(plan) ? formatMetric(plan.analysis.demandShifts, '人班') : '无可计算值' },
    { title: '需求覆盖率', key: 'coverage', width: 120, align: 'right', render: (_value, plan) => formatMetric(plan.analysis.coverageRate, '%') },
    { title: '工时成本代理值', key: 'cost', width: 145, align: 'right', render: (_value, plan) => formatMetric(plan.analysis.estimatedLaborCost, '元') },
    { title: '员工工时基尼系数', key: 'gini', width: 145, align: 'right', render: (_value, plan) => formatMetric(plan.analysis.fairness.gini) },
    { title: '加班工时', key: 'overtime', width: 110, align: 'right', render: (_value, plan) => formatMetric(plan.analysis.overtimeHours, 'h') },
    { title: '核验状态', key: 'compliance', width: 155, render: (_value, plan) => complianceTag(plan) },
    { title: '满意度', key: 'satisfaction', width: 120, align: 'right', render: (_value, plan) => plan.analysis.satisfaction.average == null ? '无可计算值' : `${plan.analysis.satisfaction.average.toFixed(2)} 分（${plan.analysis.satisfaction.responseCount} 份）` },
    { title: '前沿状态', key: 'pareto', width: 115, render: (_value, plan) => frontierIds.has(plan.record.id) ? <Tag color="blue">非支配方案</Tag> : paretoExcludedIds.has(plan.record.id) ? <Tag>未参与计算</Tag> : <Tag>存在取舍差异</Tag> },
  ];

  const onChartClick = useCallback((event: any) => {
    const id = event?.data?.value?.[3];
    if (typeof id === 'string') choosePlan(id);
  }, [choosePlan]);

  if (loading) return <Card className="section-card"><div className="initial-loading"><Spin /><span>正在读取方案 CSV 并计算指标</span></div></Card>;
  if (!plans.length) return <Card className="section-card"><Empty description="当前数据版本没有可读取的已登记排班方案" /></Card>;
  if (!groups.length || !selectedGroup) return <Card className="section-card"><Empty description="现有方案缺少可确认的比较数据" /></Card>;

  return <>
    <Card className="section-card filter-card" size="small">
      <Space wrap>
        <Typography.Text strong>方案比较组</Typography.Text>
        <FieldHelp definition={helpText.decisionLabGroup} />
        <Select value={selectedGroup.key} onChange={setGroupKey} options={groups.map((group) => ({ value: group.key, label: group.label }))} style={{ minWidth: 380, maxWidth: 'min(780px, 80vw)' }} showSearch optionFilterProp="label" />
        <Typography.Text type="secondary">当前组 {visiblePlans.length} 套方案</Typography.Text>
      </Space>
    </Card>
    {!selectedGroup.comparisonGroup && <Alert className="section-card" type="warning" showIcon message="业务比较组未标注" description="当前组的方案未提供 comparison_group 元数据，系统仅按数据集、排班日期范围和需求人班进行分组。" />}
    {visiblePlans.length < 2 && <Alert className="section-card" type="info" showIcon message="当前组只有一套方案" description="Pareto 前沿需要至少两套可比较方案；可在数据集内选择其他同周期、同需求口径的已登记版本。" />}
    {visiblePlans.length > 0 && <>
      <Card title={<Space>成本与覆盖率取舍<FieldHelp definition={helpText.decisionLabPareto} /></Space>} className="section-card">
        {pareto.excluded.length > 0 && <Alert className="section-card" type="warning" showIcon message="部分方案不参与 Pareto 计算" description={pareto.excluded.map((item) => `${plans.find((plan) => plan.record.id === item.id)?.scenarioName ?? item.id}：${item.reason}`).join(' ')} />}
        {points.length > 0 ? <ChartPanel title="方案 Pareto 对比" option={scatterOption} height={360} onChartClick={onChartClick} /> : <Empty description="当前比较组没有同时具备覆盖率和工时成本代理值的方案" />}
        <Typography.Paragraph type="secondary" className="small-note top-space">横轴为工时成本代理值，纵轴为需求覆盖率；圆点大小随员工工时基尼系数增大而增大，基尼系数缺失时使用统一点大小。蓝色方案在两项主指标上不存在同时更优的同组方案；该结论不代表唯一最优方案。</Typography.Paragraph>
      </Card>
      <Card title="同组方案关键指标" className="section-card">
        <Table rowKey={(plan) => plan.record.id} size="small" dataSource={visiblePlans} columns={columns} pagination={{ pageSize: 8 }} scroll={{ x: 1390 }} rowSelection={{ type: 'radio', selectedRowKeys: selectedPlan ? [selectedPlan.record.id] : [], onChange: (keys) => choosePlan(String(keys[0] ?? '')) }} onRow={(plan) => ({ onClick: () => choosePlan(plan.record.id) })} locale={{ emptyText: '当前比较组没有方案' }} />
      </Card>
      {selectedPlan && <Card title="所选方案数据口径" className="section-card">
        <Space wrap className="section-card"><DataSourceTag sourceType={selectedPlan.record.source_type} />{complianceTag(selectedPlan)}<Typography.Text type="secondary">版本 {selectedPlan.record.version} · 方案编号 {selectedPlan.record.schedule_id}</Typography.Text></Space>
        <Descriptions bordered size="small" column={{ xs: 1, md: 2, xl: 3 }}>
          <Descriptions.Item label="规划周期">{selectedPlan.period.start && selectedPlan.period.end ? `${selectedPlan.period.start} 至 ${selectedPlan.period.end}` : '无可计算值'}</Descriptions.Item>
          <Descriptions.Item label="需求人班">{hasScheduleData(selectedPlan) ? formatMetric(selectedPlan.analysis.demandShifts, '人班') : '无可计算值'}</Descriptions.Item>
          <Descriptions.Item label="已覆盖人班">{hasScheduleData(selectedPlan) ? formatMetric(selectedPlan.analysis.coveredShifts, '人班') : '无可计算值'}</Descriptions.Item>
          <Descriptions.Item label="未覆盖人班">{hasScheduleData(selectedPlan) ? formatMetric(selectedPlan.analysis.gapShifts, '人班') : '无可计算值'}</Descriptions.Item>
          <Descriptions.Item label="计薪工时">{formatMetric(selectedPlan.analysis.paidHours, 'h')}</Descriptions.Item>
          <Descriptions.Item label="成本口径">演示费率 {formatMetric(selectedPlan.analysis.simulatedHourlyRate, '元/h')}；加班倍率 {formatMetric(selectedPlan.analysis.simulatedOvertimeMultiplier)} 倍</Descriptions.Item>
          <Descriptions.Item label="有效满意度样本">{selectedPlan.analysis.satisfaction.responseCount} 份；无样本时不计算平均值</Descriptions.Item>
          <Descriptions.Item label={verificationEvidence(selectedPlan).countLabel}>{formatMetric(verificationEvidence(selectedPlan).count, '项')}</Descriptions.Item>
          <Descriptions.Item label="方案来源说明">{selectedPlan.record.verification?.verification_state ?? sourceLabel(selectedPlan.record.source_type)}</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" className="small-note top-space">成本依据现有排班管理分析计算器生成，只用于同口径方案的相对比较，不代表工资或企业实际支出。满意度取自关联到该方案版本的有效本机反馈；合成演示方案的规则模拟结果不属于独立核验。</Typography.Paragraph>
      </Card>}
      {selectedPlan && <Card title="缺口与约束解释" className="section-card">
        <Typography.Paragraph type="secondary">解释只引用当前方案 CSV 和方案登记核验字段。缺口只能说明未覆盖量，不能单独证明员工不可用或技能不匹配。核验状态与证据说明独立显示；岗位缺口可分页浏览。</Typography.Paragraph>
        <Space direction="vertical" className="full-width">
          {verificationExplanations.map((item, index) => <Alert key={`${item.title}-${index}`} type={item.severity} showIcon message={item.title} description={<><div>{item.detail}</div><Typography.Text type="secondary" className="small-note">来源：{item.source}</Typography.Text></>} />)}
        </Space>
        <Typography.Title level={5} className="top-space">岗位缺口明细（{gapExplanations.length} 条）</Typography.Title>
        <Table rowKey={(item, index) => `${item.title}-${index}`} size="small" dataSource={gapExplanations} columns={[
          { title: '产线', dataIndex: 'lineCode', key: 'lineCode', width: 110 },
          { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
          { title: '班次', dataIndex: 'shift', key: 'shift', width: 100 },
          { title: '岗位编码', dataIndex: 'positionCode', key: 'positionCode', width: 180 },
          { title: '问题与数据说明', dataIndex: 'detail', key: 'detail', render: (value: string) => <Typography.Paragraph className="small-note">{value}</Typography.Paragraph> },
          { title: '数据来源', dataIndex: 'source', key: 'source', width: 350, render: (value: string) => <Typography.Text type="secondary" className="small-note">{value}</Typography.Text> },
        ]} pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} scroll={{ x: 1200 }} locale={{ emptyText: '当前方案没有已记录的岗位缺口' }} />
      </Card>}
    </>}
    {selectedGroup.excluded.length > 0 && <Collapse className="section-card" items={[{
      key: 'excluded',
      label: `未纳入当前比较组的方案（${selectedGroup.excluded.length} 套）`,
      children: <Table rowKey="planId" size="small" dataSource={selectedGroup.excluded.map((item) => ({ ...item, name: plans.find((plan) => plan.record.id === item.planId)?.scenarioName ?? item.planId }))} columns={[
        { title: '方案', dataIndex: 'name', key: 'name' },
        { title: '排除原因', dataIndex: 'reason', key: 'reason' },
      ]} pagination={{ pageSize: 5 }} />,
    }]} />}
  </>;
}
