import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, DatePicker, Empty, Row, Select, Slider, Space, Table, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { EChartsOption } from 'echarts';
import { api, type Metric } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import ChartPanel from '../../components/ChartPanel';
import DataSourceTag from '../../components/DataSourceTag';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import { formatMetric } from '../../lib/display.js';

const METRIC_LABELS: Record<string, string> = {
  assigned_shifts: '整班指派', coverage_rate: '岗位覆盖率', uncovered_shifts: '未覆盖需求',
  key_position_gap: '关键岗缺口', general_position_gap: '一般岗缺口', overtime_hours: '加班工时',
  paid_hours: '计薪工时', hours_range: '员工工时差值', employee_hours_q25: '员工工时 P25',
  employee_hours_median: '员工工时中位数', employee_hours_q75: '员工工时 P75',
  employee_hours_gini: '员工工时基尼系数', employees_with_assignments: '有指派员工',
  solver_bound: '求解下界', objective_value: '加权目标复算值',
  synthetic_order_units: '合成订单需求', synthetic_available_capacity_units: '合成可用产能',
  synthetic_capacity_utilization: '合成产能利用率',
};

export default function AnalyticsPage({ datasetId }: PageProps) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [limitations, setLimitations] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [demandChange, setDemandChange] = useState(0);
  const [capacityChange, setCapacityChange] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const [from, to] = dateRange;
    api.analytics({ dataset_id: datasetId, date_from: from?.format('YYYY-MM-DD'), date_to: to?.format('YYYY-MM-DD') })
      .then((result) => { if (active) { setMetrics(result.items ?? []); setLimitations(result.limitations ?? []); } })
      .catch(() => { if (active) { setMetrics([]); setLimitations([]); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [datasetId, dateRange]);
  const get = (id: string) => metrics.find((item) => item.metric_id === id);
  const coverage = get('coverage_rate');
  const isSynthetic = datasetId?.startsWith('synthetic-demo-') ?? false;
  const workload = [get('employee_hours_q25'), get('employee_hours_median'), get('employee_hours_q75')];
  const workloadMetrics = workload.filter((item): item is Metric => item !== undefined);
  const workloadOption: EChartsOption = useMemo(() => ({
    color: ['#537a9e'],
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${value} h` },
    grid: { left: 54, right: 24, top: 30, bottom: 50 },
    xAxis: { type: 'category', data: ['P25', '中位数', 'P75'], axisTick: { show: false } },
    yAxis: { type: 'value', name: '工时（h）', splitLine: { lineStyle: { color: '#eef1f4' } } },
    series: [{ type: 'bar', barWidth: 42, data: workload.map((item) => item?.value ?? 0), itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  }), [metrics]);
  const capacity = get('synthetic_available_capacity_units')?.value;
  const demand = get('synthetic_order_units')?.value;
  const adjustedDemand = demand == null ? null : demand * (1 + demandChange / 100);
  const adjustedCapacity = capacity == null ? null : capacity * (1 + capacityChange / 100);
  const utilization = adjustedDemand == null || !adjustedCapacity ? null : adjustedDemand / adjustedCapacity * 100;
  const sensitivityOption: EChartsOption = useMemo(() => ({
    color: ['#245b8f', '#bdc8d4'],
    tooltip: { trigger: 'axis' },
    legend: { bottom: 4, data: ['需求量', '估算产能'] },
    grid: { left: 68, right: 24, top: 28, bottom: 54 },
    xAxis: { type: 'category', data: ['当前场景', '参数调整后'] },
    yAxis: { type: 'value', name: 'unit', splitLine: { lineStyle: { color: '#eef1f4' } } },
    series: [
      { name: '需求量', type: 'bar', barWidth: 42, data: [demand ?? 0, adjustedDemand ?? 0], itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '估算产能', type: 'bar', barWidth: 42, data: [capacity ?? 0, adjustedCapacity ?? 0], itemStyle: { borderRadius: [3, 3, 0, 0] } },
    ],
  }), [demand, capacity, adjustedDemand, adjustedCapacity]);
  const columns = [
    { title: '指标', dataIndex: 'metric_id', key: 'metric_id', render: (value: string) => METRIC_LABELS[value] ?? value },
    { title: '数值', dataIndex: 'value', key: 'value', render: (_: number | null, row: Metric) => formatMetric(row.value, row.unit) },
    { title: '样本数', dataIndex: 'sample_count', key: 'sample_count', render: (value: number) => formatMetric(value, '条') },
    { title: '来源', dataIndex: 'source_type', key: 'source_type', render: (value: string) => <DataSourceTag sourceType={value} /> },
    { title: '指標定义与口径', dataIndex: 'definition', key: 'definition' },
  ];

  return <>
    <PageHeader title="KPI 与解释" description="查看岗位覆盖、缺口、工时分布和求解器信息。指标均附计算定义、单位、样本数和数据来源。" />
    <Card className="section-card filter-card" size="small">
      <Space wrap>
        <Typography.Text>日期范围</Typography.Text><FieldHelp definition={{ title: '日期范围', purpose: '限定排班方案指标的复算日期区间。', sourceOrDefault: '默认不限制日期。', impact: '改变样本数量和分母，覆盖率仅基于所选区间重算。', limitation: '两端日期均包含；基准已验收登记值不支持按日期拆分。' }} />
        <DatePicker.RangePicker value={dateRange} onChange={(range) => setDateRange(range ?? [null, null])} />
        {isSynthetic && <DataSourceTag sourceType="synthetic_demo" />}
      </Space>
    </Card>
    {isSynthetic && <Alert className="section-card" type="warning" showIcon message="合成演示数据的用途限制" description="订单需求、线速、效率与估算产能用于二次统计和参数敏感性分析，不进入现有排班 MIP 优化决策。" />}
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={12}><ChartPanel title="员工计薪工时分布摘要" option={workloadOption} height={285} /></Col>
      <Col xs={24} xl={12}>
        <Card title="分布统计解释" className="chart-card">
          <Table rowKey="metric_id" size="small" pagination={false} dataSource={workloadMetrics} columns={[
            { title: '统计量', dataIndex: 'metric_id', key: 'metric_id', render: (value: string) => METRIC_LABELS[value] ?? value },
            { title: '结果', dataIndex: 'value', key: 'value', render: (_: number | null, row: Metric) => formatMetric(row.value, row.unit) },
            { title: '样本数', dataIndex: 'sample_count', key: 'sample_count', render: (value: number) => `${value} 人` },
          ]} locale={{ emptyText: '当前方案没有员工工时样本' }} />
          <Typography.Paragraph type="secondary" className="small-note">员工工时分布只统计至少存在一条整班指派的员工。分布结果用于查看排班负荷差异，不代表劳动合同、考勤或工资实绩。</Typography.Paragraph>
        </Card>
      </Col>
    </Row>
    {isSynthetic && <Card className="section-card" title="订单与产能敏感性分析" extra={<FieldHelp definition={{ title: '敏感性参数', purpose: '对合成订单需求和线体可用产能做比例扰动，观察估算利用率变化。', sourceOrDefault: '以固定随机种子生成的合成演示 CSV 汇总值为基准。', unit: '%', impact: '用于讨论需求与能力变化方向。', limitation: '该分析不重新运行人员排班优化，也不代表生产实绩。' }} />}>
      <Row gutter={[24, 8]}>
        <Col xs={24} md={7}><Typography.Text>订单需求变化：{demandChange}%</Typography.Text><Slider min={-30} max={30} step={5} value={demandChange} onChange={setDemandChange} /></Col>
        <Col xs={24} md={7}><Typography.Text>可用产能变化：{capacityChange}%</Typography.Text><Slider min={-30} max={30} step={5} value={capacityChange} onChange={setCapacityChange} /></Col>
        <Col xs={24} md={10}><ChartPanel title="参数变化对比" option={sensitivityOption} height={250} /></Col>
      </Row>
      <Typography.Paragraph type="secondary">调整后需求：{formatMetric(adjustedDemand, 'unit')}；估算产能：{formatMetric(adjustedCapacity, 'unit')}；估算产能利用率：{formatMetric(utilization, '%')}。利用率定义为需求量除以估算可用产能。</Typography.Paragraph>
    </Card>}
    <Card title="指标清单" className="section-card">
      {limitations.map((item) => <Typography.Paragraph key={item} type="secondary">{item}</Typography.Paragraph>)}
      <Table rowKey="metric_id" size="middle" loading={loading} dataSource={metrics} columns={columns} pagination={{ pageSize: 12 }} scroll={{ x: 1100 }} locale={{ emptyText: <Empty description="当前没有指标数据" /> }} />
    </Card>
    <Card className="section-card" title="优化结果解释框架" size="small">
      <Row gutter={[16, 12]}>
        <Col xs={24} md={8}><Typography.Text strong>可行性</Typography.Text><Typography.Paragraph type="secondary">由独立硬约束核验给出，包括资格、工时、休息、班间隔及岗位覆盖账目。</Typography.Paragraph></Col>
        <Col xs={24} md={8}><Typography.Text strong>业务目标</Typography.Text><Typography.Paragraph type="secondary">模型以减少岗位缺口、关键岗缺口、加班和负荷不均衡为优化方向。具体任务的最优性以 HiGHS termination、incumbent 和 bound 为准。</Typography.Paragraph></Col>
        <Col xs={24} md={8}><Typography.Text strong>边界与口径</Typography.Text><Typography.Paragraph type="secondary">产能、订单交期和现场实绩不属于当前 MIP 求解决策。求解目标值不可直接解释为业务 KPI。</Typography.Paragraph></Col>
      </Row>
      {coverage?.definition && <Typography.Text type="secondary">当前覆盖率口径：{coverage.definition}</Typography.Text>}
    </Card>
  </>;
}
