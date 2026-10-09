import { useMemo } from 'react';
import { Alert, Card, Descriptions, Empty, Row, Col, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { JobRecord } from '../../api/client';
import DataSourceTag from '../../components/DataSourceTag';
import { formatMetric } from '../../lib/display.js';
import { buildScheduleExplanations, verificationEvidence } from './metrics.js';
import type { AnalyzedDecisionPlan, ScenarioDiff } from './types';

const statusLabels: Record<string, string> = {
  queued: '排队中', running: '运行中', succeeded: '任务已完成', failed: '任务失败', cancelled: '已取消',
};

const eventLabels: Record<string, string> = {
  absence: '员工突发离岗', equipment_fail: '设备故障停线', rampup: '产线增产', insert: '新增订单插单', changeover: '产品换型',
};

function eventDescription(job: JobRecord) {
  const event = job.request?.event;
  if (!event || typeof event !== 'object') return '任务记录没有事件字段。';
  const value = event as Record<string, any>;
  const type = typeof value.type === 'string' ? value.type : '';
  const equipmentDates = Array.isArray(value.dates) ? value.dates.filter((date) => typeof date === 'string').sort() : [];
  const equipmentDateLabel = equipmentDates.length > 1
    ? `${equipmentDates[0]} 至 ${equipmentDates.at(-1)}（${equipmentDates.length} 个排班日）`
    : equipmentDates[0] ?? '日期未记录';
  const details = type === 'absence'
    ? `员工 ${value.employee ?? '未记录'} · ${value.date ?? '日期未记录'}`
    : type === 'equipment_fail'
      ? `${value.line ?? '产线未记录'} · ${equipmentDateLabel}`
      : type === 'rampup'
        ? `${value.line ?? '产线未记录'} · ${value.date ?? '日期未记录'} · 每岗位增加 ${value.add_per_position ?? '未记录'} 人`
        : `${value.line ?? '产线未记录'} · ${value.date ?? '日期未记录'} · ${value.shift ?? '班次未记录'}`;
  return `${eventLabels[type] ?? type}：${details}`;
}

function parseAssignment(key: string) {
  const [kind, employeeId, positionCode, date, shiftCode, rawHours] = JSON.parse(key) as [string, string, string, string, string, number?];
  return {
    employeeId,
    positionCode,
    date,
    shiftCode,
    recordType: kind === 'fractional' ? '非完整班次' as const : '整班指派' as const,
    hours: kind === 'fractional' && Number.isFinite(rawHours) ? Number(rawHours) : null,
  };
}

function buildDiff(baseline: AnalyzedDecisionPlan, result: AnalyzedDecisionPlan): ScenarioDiff {
  const baselineKeys = new Set(baseline.assignmentKeys);
  const resultKeys = new Set(result.assignmentKeys);
  const addedAssignments = [...resultKeys].filter((key) => !baselineKeys.has(key)).map(parseAssignment);
  const removedAssignments = [...baselineKeys].filter((key) => !resultKeys.has(key)).map(parseAssignment);
  const gapMap = (plan: AnalyzedDecisionPlan) => {
    const map = new Map<string, { lineCode: string; positionCode: string; date: string; shift: string; count: number }>();
    for (const gap of plan.analysis.gaps) {
      const key = [gap.lineCode, gap.positionCode, gap.date, gap.shift].join('\u0000');
      const row = map.get(key) ?? { lineCode: gap.lineCode, positionCode: gap.positionCode, date: gap.date, shift: gap.shift, count: 0 };
      row.count += gap.gapShifts;
      map.set(key, row);
    }
    return map;
  };
  const baselineGaps = gapMap(baseline);
  const resultGaps = gapMap(result);
  const changedGaps = [...new Set([...baselineGaps.keys(), ...resultGaps.keys()])].flatMap((key) => {
    const before = baselineGaps.get(key);
    const after = resultGaps.get(key);
    const beforeCount = before?.count ?? 0;
    const afterCount = after?.count ?? 0;
    if (beforeCount === afterCount) return [];
    const row = after ?? before!;
    return [{ lineCode: row.lineCode, positionCode: row.positionCode, date: row.date, shift: row.shift, before: beforeCount, after: afterCount, delta: afterCount - beforeCount }];
  }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  const metricValues: Array<{ key: string; label: string; unit: string; before: number | null; after: number | null }> = [
    { key: 'coverage', label: '需求覆盖率', unit: '%', before: baseline.analysis.coverageRate, after: result.analysis.coverageRate },
    { key: 'paidHours', label: '计薪工时', unit: 'h', before: baseline.analysis.paidHours, after: result.analysis.paidHours },
    { key: 'estimatedLaborCost', label: '工时成本代理值', unit: '元', before: baseline.analysis.estimatedLaborCost, after: result.analysis.estimatedLaborCost },
    { key: 'overtimeHours', label: '加班工时', unit: 'h', before: baseline.analysis.overtimeHours, after: result.analysis.overtimeHours },
    { key: 'gini', label: '员工工时基尼系数', unit: '', before: baseline.analysis.fairness.gini, after: result.analysis.fairness.gini },
  ];
  return {
    addedAssignments,
    removedAssignments,
    changedGaps,
    kpiDeltas: metricValues.map((item) => ({ ...item, delta: item.before == null || item.after == null ? null : item.after - item.before })),
  };
}

export default function ScenarioRunPanel({ job, baseline, result, loading, pollError = '', lastStatusReadAt = '' }: {
  job: JobRecord | null;
  baseline: AnalyzedDecisionPlan | null;
  result: AnalyzedDecisionPlan | null;
  loading: boolean;
  pollError?: string;
  lastStatusReadAt?: string;
}) {
  const diff = useMemo(() => baseline && result ? buildDiff(baseline, result) : null, [baseline, result]);
  if (!job) return null;
  const event = job.request?.event as Record<string, any> | undefined;
  const parameters = job.request?.parameters as Record<string, any> | undefined;
  const eventDate = event?.type === 'equipment_fail' ? event.dates?.[0] : event?.date;
  const orderedDates = baseline?.analysis.daily.map((item) => item.date).sort() ?? [];
  const startIndex = orderedDates.indexOf(eventDate);
  const requestedWindowDays = parameters?.window_days;
  const configuredWindowDays = typeof requestedWindowDays === 'number' && Number.isInteger(requestedWindowDays) ? requestedWindowDays : null;
  const windowDates = startIndex >= 0 && configuredWindowDays ? orderedDates.slice(startIndex, startIndex + configuredWindowDays) : [];
  const windowLabel = windowDates.length ? `${windowDates[0]} 至 ${windowDates.at(-1)}（${windowDates.length} 个排班日）` : '服务端未返回可定位的调整窗口';
  const errorMessage = typeof job.error?.message === 'string' ? job.error.message : typeof job.error === 'string' ? job.error : '';
  const resultRows = diff?.kpiDeltas ?? [];
  const explanations = result ? buildScheduleExplanations(result) : [];
  const gapExplanations = explanations.filter((item) => Boolean(item.lineCode));
  const verificationExplanations = explanations.filter((item) => !item.lineCode);

  const assignmentColumns: ColumnsType<ScenarioDiff['addedAssignments'][number]> = [
    { title: '员工编号', dataIndex: 'employeeId', key: 'employeeId', width: 150 },
    { title: '岗位编码', dataIndex: 'positionCode', key: 'positionCode', width: 190 },
    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
    { title: '班次代码', dataIndex: 'shiftCode', key: 'shiftCode', width: 110 },
    { title: '记录类别', dataIndex: 'recordType', key: 'recordType', width: 120 },
    { title: '工时', dataIndex: 'hours', key: 'hours', width: 90, align: 'right', render: (value: number | null) => formatMetric(value, 'h') },
  ];

  return <Card className="section-card" title="情景重排任务与结果">
    <Descriptions bordered size="small" column={{ xs: 1, md: 2, xl: 3 }}>
      <Descriptions.Item label="任务编号">{job.id}</Descriptions.Item>
      <Descriptions.Item label="任务状态"><Tag color={job.status === 'succeeded' ? 'green' : job.status === 'failed' ? 'red' : job.status === 'running' ? 'processing' : 'default'}>{statusLabels[job.status] ?? job.status}</Tag></Descriptions.Item>
      <Descriptions.Item label="求解器终止状态">{job.solver_termination ?? '服务端未返回'}</Descriptions.Item>
      <Descriptions.Item label="情景事件">{eventDescription(job)}</Descriptions.Item>
      <Descriptions.Item label="调整窗口">{windowLabel}</Descriptions.Item>
      <Descriptions.Item label="任务时间">{job.started_at ?? job.created_at}{job.finished_at ? ` 至 ${job.finished_at}` : ''}</Descriptions.Item>
    </Descriptions>
    {pollError && <Alert className="form-alert" type="warning" showIcon message="任务状态更新暂时中断" description={`最近一次成功读取：${lastStatusReadAt || '尚无成功读取记录'}。系统将每 5 s 自动重试；当前显示状态可能不是最新状态。读取错误：${pollError}`} />}
    {errorMessage && <Alert className="form-alert" type="error" showIcon message="任务未生成可用方案" description={errorMessage} />}
    {job.status === 'succeeded' && !result && !loading && <Alert className="form-alert" type="warning" showIcon message="任务结束但没有登记新方案" description="系统未找到该任务登记的排班版本。若独立核验未通过、没有可行排班产物或登记尚未完成，结果不会作为成功方案呈现。基线方案保持不变。" />}
    {loading && <div className="initial-loading"><Spin /><span>正在读取新方案文件和独立核验结果</span></div>}
    {result && baseline && diff && <>
      <Alert className="form-alert" type="info" showIcon message="基线与结果方案" description={<Space wrap><span>{baseline.scenarioName} · V{baseline.record.version}</span><span>→</span><span>{result.scenarioName} · V{result.record.version}</span><DataSourceTag sourceType={result.record.source_type} /><Tag color={verificationEvidence(result).kind === 'simulation' ? 'gold' : result.analysis.compliance.status === 'passed' ? 'green' : result.analysis.compliance.status === 'failed' ? 'red' : 'default'}>{verificationEvidence(result).statusLabel}</Tag></Space>} />
      <Row gutter={[12, 12]} className="section-card">
        {diff.kpiDeltas.slice(0, 4).map((metric) => <Col xs={12} xl={6} key={metric.key}><Card size="small" className="stat-card"><Statistic title={metric.label} value={metric.delta == null ? '无可计算值' : metric.delta} precision={metric.delta == null ? undefined : 2} suffix={metric.delta == null ? undefined : metric.unit} valueStyle={{ color: metric.delta == null || metric.delta === 0 ? undefined : metric.delta > 0 ? '#245b8f' : '#ad4a3b' }} /></Card></Col>)}
      </Row>
      <Typography.Paragraph type="secondary" className="small-note">指标差值按“结果方案－基线方案”计算。成本和满意度若无有效数据，不以 0 替代。工时成本为当前演示费率下的代理值。</Typography.Paragraph>
      <Card size="small" title="基线与结果 KPI 差值" className="section-card">
        <Table rowKey="key" size="small" dataSource={resultRows} columns={[
          { title: '指标', dataIndex: 'label', key: 'label' },
          { title: '基线', dataIndex: 'before', key: 'before', align: 'right', render: (value: number | null, row) => formatMetric(value, row.unit) },
          { title: '结果', dataIndex: 'after', key: 'after', align: 'right', render: (value: number | null, row) => formatMetric(value, row.unit) },
          { title: '差值', dataIndex: 'delta', key: 'delta', align: 'right', render: (value: number | null, row) => formatMetric(value, row.unit) },
        ]} pagination={false} />
      </Card>
      <Row gutter={[16, 16]} className="section-card">
        <Col xs={24} xl={12}><Card title={`新增指派（${diff.addedAssignments.length} 条）`}><Table rowKey={(row) => [row.employeeId, row.positionCode, row.date, row.shiftCode, row.recordType, row.hours].join('|')} size="small" dataSource={diff.addedAssignments} columns={assignmentColumns} pagination={{ pageSize: 5 }} scroll={{ x: 800 }} locale={{ emptyText: '没有新增指派' }} /></Card></Col>
        <Col xs={24} xl={12}><Card title={`取消指派（${diff.removedAssignments.length} 条）`}><Table rowKey={(row) => [row.employeeId, row.positionCode, row.date, row.shiftCode, row.recordType, row.hours].join('|')} size="small" dataSource={diff.removedAssignments} columns={assignmentColumns} pagination={{ pageSize: 5 }} scroll={{ x: 800 }} locale={{ emptyText: '没有取消指派' }} /></Card></Col>
      </Row>
      <Card title={`岗位缺口变化（${diff.changedGaps.length} 个单元）`} className="section-card">
        <Table rowKey={(row) => [row.lineCode, row.positionCode, row.date, row.shift].join('|')} size="small" dataSource={diff.changedGaps} columns={[
          { title: '产线', dataIndex: 'lineCode', key: 'lineCode' }, { title: '岗位', dataIndex: 'positionCode', key: 'positionCode' }, { title: '日期', dataIndex: 'date', key: 'date' }, { title: '班次', dataIndex: 'shift', key: 'shift' },
          { title: '基线缺口', dataIndex: 'before', key: 'before', align: 'right' }, { title: '结果缺口', dataIndex: 'after', key: 'after', align: 'right' }, { title: '变化（人班）', dataIndex: 'delta', key: 'delta', align: 'right', render: (value: number) => formatMetric(value, '人班') },
        ]} pagination={{ pageSize: 8 }} scroll={{ x: 850 }} locale={{ emptyText: '未观察到缺口变化' }} />
      </Card>
      <Card title="结果方案缺口与核验解释" className="section-card">
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
        ]} pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} scroll={{ x: 1200 }} locale={{ emptyText: '当前结果方案没有已记录的岗位缺口' }} />
      </Card>
      {resultRows.length === 0 && <Empty description="基线与结果没有可计算的共同 KPI 差值" />}
    </>}
  </Card>;
}
