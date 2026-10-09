import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Empty, Row, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { api, type JobRecord, type Metric, type ScheduleRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import StatTile from '../../components/StatTile';
import ChartPanel from '../../components/ChartPanel';
import DataSourceTag from '../../components/DataSourceTag';
import { formatDate, formatMetric, statusLabel } from '../../lib/display.js';
import { helpText } from '../../help/metadata';
import type { EChartsOption } from 'echarts';

export default function DashboardPage({ datasetId, refresh }: PageProps) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [schedule, setSchedule] = useState<ScheduleRecord | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.jobs({ limit: 8 }), api.analytics({ dataset_id: datasetId })])
      .then(([jobResult, analysis]) => {
        if (!active) return;
        setJobs(jobResult.items ?? []);
        setMetrics(analysis.items ?? []);
        setSchedule(analysis.active_schedule ?? null);
      })
      .catch(() => { if (active) { setJobs([]); setMetrics([]); setSchedule(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [datasetId, refresh]);

  const metric = (id: string) => metrics.find((item) => item.metric_id === id);
  const jobName = (job: JobRecord) => {
    const parameters = job.request?.parameters as Record<string, unknown> | undefined;
    const scenarioName = parameters?.scenario_name;
    const name = typeof scenarioName === 'string' && scenarioName.trim() ? scenarioName : null;
    const typeNames: Record<string, string> = {
      info: '数据概况检查', solve_demo: '7 天演示排班', solve_full: '整周期排班',
      verify_baseline: '基准方案复核', reschedule: '异常场景重排', kpi: '方案 KPI 复算',
    };
    const result = job.result as Record<string, any> | null | undefined;
    const zeroAssignment = job.status === 'succeeded' && result?.summary?.kpi?.assigned === 0;
    return `${name ?? typeNames[job.kind] ?? '排班任务'}${zeroAssignment ? ' · 零排班预警' : ''}`;
  };
  const demandOption: EChartsOption = useMemo(() => ({
    color: ['#245b8f', '#7f9dbb'],
    tooltip: { trigger: 'axis' },
    legend: { bottom: 4, data: ['已覆盖人班', '未覆盖人班'] },
    grid: { left: 54, right: 22, top: 28, bottom: 52 },
    xAxis: { type: 'category', data: ['排班基准'], axisTick: { show: false }, axisLine: { lineStyle: { color: '#d9e0e8' } } },
    yAxis: { type: 'value', name: '人班', splitLine: { lineStyle: { color: '#eef1f4' } } },
    series: [
      { name: '已覆盖人班', type: 'bar', stack: 'demand', barWidth: 48, data: [metric('assigned_shifts')?.value ?? 0], itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: '未覆盖人班', type: 'bar', stack: 'demand', barWidth: 48, data: [metric('uncovered_shifts')?.value ?? 0], itemStyle: { color: '#bdc8d4', borderRadius: [3, 3, 0, 0] } },
    ],
  }), [metrics]);
  const columns = [
    { title: '任务名称', key: 'task_name', width: 190, render: (_: unknown, row: JobRecord) => <Typography.Text title={row.id} ellipsis>{jobName(row)}</Typography.Text> },
    { title: '任务编号', dataIndex: 'id', key: 'id', ellipsis: true, width: 150, render: (value: string) => <Typography.Text code title={value}>{value.slice(0, 12)}</Typography.Text> },
    { title: '任务类型', dataIndex: 'kind', key: 'kind', render: (value: string) => ({ solve_demo: '7 天演示求解', solve_full: '整周期求解', reschedule: '异常场景重排', verify_baseline: '基准复核', kpi: 'KPI 复算', info: '数据检查' }[value] ?? value) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'succeeded' ? 'green' : value === 'failed' ? 'red' : 'blue'}>{statusLabel(value)}</Tag> },
    { title: '求解器终止状态', dataIndex: 'solver_termination', key: 'solver_termination', render: (value: string | null) => value || '—' },
    { title: '提交时间', dataIndex: 'created_at', key: 'created_at', render: formatDate, width: 190 },
  ];

  return <>
    <PageHeader title="运行总览" description="查看当前数据版本、最近任务和排班覆盖指标。已验收登记结果与本机重新计算结果分别展示。" extra={<Button icon={<ReloadOutlined />} onClick={refresh}>刷新数据</Button>} />
    <Row gutter={[16, 16]} className="stat-row">
      <Col xs={24} sm={12} xl={6}><StatTile title="岗位覆盖率" value={metric('coverage_rate')?.value} suffix="%" precision={2} loading={loading} help={helpText.sourceType} note={schedule ? `方案版本 ${schedule.version}` : '暂无本机排班方案'} /></Col>
      <Col xs={24} sm={12} xl={6}><StatTile title="整班指派" value={metric('assigned_shifts')?.value} suffix="人班" loading={loading} help={{ title: '整班指派', purpose: '统计排班方案中完成的整班指派数量。', sourceOrDefault: '由当前排班方案文件复算。', unit: '人班', impact: '可用于查看需求覆盖规模。', limitation: '不代表实际到岗或生产完成数量。' }} /></Col>
      <Col xs={24} sm={12} xl={6}><StatTile title="未覆盖需求" value={metric('uncovered_shifts')?.value} suffix="人班" loading={loading} help={{ title: '未覆盖需求', purpose: '显示排班方案未分配人员的岗位需求。', sourceOrDefault: '由当前排班方案文件或已验收登记值提供。', unit: '人班', impact: '用于识别容量或资格不足。', limitation: '基准登记值不是本机重新求解结果。' }} /></Col>
      <Col xs={24} sm={12} xl={6}><StatTile title="加班工时" value={metric('overtime_hours')?.value} suffix="h" loading={loading} help={{ title: '加班工时', purpose: '汇总模型方案中的加班小时数。', sourceOrDefault: '由当前排班方案或已验收登记值提供。', unit: 'h', impact: '用于规则核查和员工工时分析。', limitation: '不代表真实考勤工时。' }} /></Col>
    </Row>
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={10}><ChartPanel title="需求覆盖结构" option={demandOption} height={300} /></Col>
      <Col xs={24} xl={14}>
        <Card title="当前数据边界" className="notice-card">
          <Space direction="vertical" size={12}>
            <Space wrap><DataSourceTag sourceType={schedule?.source_type ?? (datasetId?.startsWith('synthetic') ? 'synthetic_demo' : 'accepted_baseline')} /><Typography.Text>{schedule ? `当前登记方案：${jobs.find((job) => job.id === schedule.job_id) ? jobName(jobs.find((job) => job.id === schedule.job_id)!) : `方案 ${schedule.schedule_id.slice(0, 8)}`}，版本 ${schedule.version}` : '当前数据版本尚无排班方案。'}</Typography.Text></Space>
            <Typography.Paragraph type="secondary">覆盖率依据排班需求口径计算，不代表实际产量、实际到岗或交付达成。未接入真实 HR、APS、MES、考勤和消息系统。</Typography.Paragraph>
            {datasetId?.startsWith('synthetic') && <Tag color="gold">合成数据用于本机方案比较、订单与产能分析，不进入现有 MIP 求解任务</Tag>}
            {schedule?.verification?.all_pass === true && <Tag color="green">本机独立硬约束核验通过</Tag>}
            {schedule?.verification?.all_pass === false && <Tag color="red">本机独立硬约束核验未通过</Tag>}
          </Space>
        </Card>
      </Col>
    </Row>
    <Card className="section-card" title="最近任务" extra={<Button type="link" icon={<ArrowRightOutlined />} onClick={() => window.dispatchEvent(new CustomEvent('navigate-page', { detail: 'scheduling' }))}>打开任务中心</Button>}>
      {jobs.length ? <Table rowKey="id" size="middle" columns={columns} dataSource={jobs} pagination={false} scroll={{ x: 900 }} /> : <Empty description="当前没有任务记录" />}
      {!loading && jobs.length === 0 && <Typography.Text type="secondary">提交求解、核验或异常重排任务后，状态将在此处显示。</Typography.Text>}
    </Card>
    <Card size="small" className="footnote-card"><Typography.Text type="secondary">{metric('coverage_rate') ? `指标定义：${metric('coverage_rate')?.definition} 样本数：${formatMetric(metric('coverage_rate')?.sample_count, '条')}` : '当前没有可计算的排班指标。'}</Typography.Text></Card>
  </>;
}
