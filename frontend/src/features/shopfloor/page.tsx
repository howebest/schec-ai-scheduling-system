import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, DatePicker, Row, Select, Space, Table, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { EChartsOption } from 'echarts';
import { api } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import ChartPanel from '../../components/ChartPanel';
import DataSourceTag from '../../components/DataSourceTag';
import StatTile from '../../components/StatTile';

const STATUS_LABELS: Record<string, string> = { present: '模拟到岗', absent: '模拟缺勤', leave: '模拟请假' };

export default function ShopfloorPage(_props: PageProps) {
  const [date, setDate] = useState<Dayjs | null>(dayjs('2026-10-01'));
  const [shift, setShift] = useState<string>();
  const [rows, setRows] = useState<Array<{ employee_id: string; schedule_date: string; shift_code: string; status: string }>>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [limitations, setLimitations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.attendance({ date: date?.format('YYYY-MM-DD'), shift_code: shift })
      .then((result) => { if (active) { setRows(result.items ?? []); setTotals(result.totals ?? {}); setLimitations(result.limitations ?? []); } })
      .catch(() => { if (active) { setRows([]); setTotals({}); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [date, shift]);
  const option: EChartsOption = useMemo(() => ({
    color: ['#237a57', '#b42318', '#ad6800'],
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 24, top: 24, bottom: 36 },
    xAxis: { type: 'category', data: ['模拟到岗', '模拟缺勤', '模拟请假'], axisTick: { show: false } },
    yAxis: { type: 'value', name: '人', splitLine: { lineStyle: { color: '#eef1f4' } } },
    series: [{ type: 'bar', barWidth: 48, data: [totals.present ?? 0, totals.absent ?? 0, totals.leave ?? 0], itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  }), [totals]);
  const columns = [
    { title: '员工编号', dataIndex: 'employee_id', key: 'employee_id' },
    { title: '日期', dataIndex: 'schedule_date', key: 'schedule_date' },
    { title: '模拟班次', dataIndex: 'shift_code', key: 'shift_code' },
    { title: '模拟状态', dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'present' ? 'green' : value === 'absent' ? 'red' : 'gold'}>{STATUS_LABELS[value] ?? value}</Tag> },
    { title: '来源', key: 'source', render: () => <DataSourceTag sourceType="synthetic_demo" /> },
  ];

  return <>
    <PageHeader title="现场模拟看板" description="按日期和班次查看随包生成的考勤快照，用于展示状态分布、事件筛选和调度分析交互。" extra={<DataSourceTag sourceType="synthetic_demo" />} />
    <Alert type="warning" showIcon message="非现场实绩" description="页面数据来自固定随机种子的合成考勤快照，不代表真实到岗、请假或生产执行情况。真实 HR、考勤和 MES 系统未连接。" />
    <Card size="small" className="section-card filter-card">
      <Space wrap>
        <Typography.Text>快照日期</Typography.Text>
        <DatePicker value={date} onChange={setDate} disabledDate={(candidate) => candidate.isBefore(dayjs('2026-10-01'), 'day') || candidate.isAfter(dayjs('2026-10-14'), 'day')} />
        <Typography.Text>班次</Typography.Text>
        <Select allowClear value={shift} onChange={setShift} placeholder="全部班次" style={{ width: 150 }} options={['D12', 'N12', 'D8'].map((value) => ({ value, label: value }))} />
      </Space>
    </Card>
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} sm={8}><StatTile title="模拟到岗" value={totals.present ?? 0} suffix="人" loading={loading} /></Col>
      <Col xs={24} sm={8}><StatTile title="模拟缺勤" value={totals.absent ?? 0} suffix="人" loading={loading} /></Col>
      <Col xs={24} sm={8}><StatTile title="模拟请假" value={totals.leave ?? 0} suffix="人" loading={loading} /></Col>
    </Row>
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={9}><ChartPanel title="状态汇总" option={option} height={275} /></Col>
      <Col xs={24} xl={15}><Card title={`快照明细（${rows.length}）`}><Table rowKey={(row) => `${row.employee_id}-${row.schedule_date}-${row.shift_code}`} size="middle" loading={loading} dataSource={rows} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 600 }} locale={{ emptyText: '该日期和班次没有模拟快照记录' }} /></Card></Col>
    </Row>
    {limitations.map((item) => <Typography.Paragraph key={item} className="small-note" type="secondary">{item}</Typography.Paragraph>)}
  </>;
}
