import { useEffect, useState } from 'react';
import { Button, Card, DatePicker, Form, Input, Select, Space, Table, Tag } from 'antd';
import { DownloadOutlined, FilterOutlined } from '@ant-design/icons';
import { api, type ScheduleRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import DataSourceTag from '../../components/DataSourceTag';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import { formatDate } from '../../lib/display.js';

interface ArchiveItem { schedule: ScheduleRecord; download_id: string; job?: Record<string, any> }

export default function ArchivePage({ datasets, datasetId }: PageProps) {
  const [form] = Form.useForm();
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const query = async (values: Record<string, any> = {}) => {
    setLoading(true);
    try {
      const dateRange = values.date_range;
      const result = await api.archive({
        dataset_id: values.dataset_id ?? datasetId,
        source_type: values.source_type,
        employee_id: values.employee_id,
        factory_code: values.factory_code,
        line_code: values.line_code,
        shift_code: values.shift_code,
        date_from: dateRange?.[0]?.format('YYYY-MM-DD'),
        date_to: dateRange?.[1]?.format('YYYY-MM-DD'),
        limit: 200,
      });
      setItems(result.items ?? []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void query(); }, [datasetId]);

  const columns = [
    { title: '方案名称', key: 'scenario_name', width: 190, render: (_: unknown, row: ArchiveItem) => {
      const name = row.job?.request?.parameters?.scenario_name;
      const assigned = row.job?.result?.summary?.kpi?.assigned;
      return <Space size={6}><span title={row.schedule.schedule_id}>{typeof name === 'string' && name.trim() ? name : `历史方案 ${row.schedule.schedule_id.slice(0, 8)}`}</span>{assigned === 0 && <Tag color="red">零排班</Tag>}</Space>;
    } },
    { title: '方案编号', dataIndex: ['schedule', 'schedule_id'], key: 'schedule_id', width: 150, render: (value: string) => <span title={value}>{value.slice(0, 12)}</span> },
    { title: '版本', dataIndex: ['schedule', 'version'], key: 'version', render: (value: number) => `V${value}`, width: 80 },
    { title: '数据集', dataIndex: ['schedule', 'dataset_id'], key: 'dataset_id', render: (value: string) => datasets.find((item) => item.id === value)?.display_name ?? value },
    { title: '来源', dataIndex: ['schedule', 'source_type'], key: 'source_type', render: (value: string) => <DataSourceTag sourceType={value} />, width: 135 },
    { title: '核验', dataIndex: ['schedule', 'verification'], key: 'verification', render: (value: Record<string, any>) => value?.all_pass === true ? <Tag color="green">通过</Tag> : value?.all_pass === false ? <Tag color="red">未通过</Tag> : <Tag>未核验</Tag>, width: 95 },
    { title: '生成时间', dataIndex: ['schedule', 'created_at'], key: 'created_at', render: formatDate, width: 190 },
    { title: '任务编号', dataIndex: ['schedule', 'job_id'], key: 'job_id', render: (value: string | null) => value || '基准登记' },
    { title: '文件', key: 'download', fixed: 'right' as const, render: (_: unknown, row: ArchiveItem) => <a href={`/api/v1/files/${row.download_id}`}><Button size="small" icon={<DownloadOutlined />}>下载 CSV</Button></a> },
  ];

  return <>
    <PageHeader title="调度档案" description="按数据集、来源、员工、工厂、产线、日期和班次筛选已登记方案。下载文件会校验登记 SHA-256。" />
    <Card size="small" className="section-card filter-card">
      <Form form={form} layout="vertical" onFinish={query} initialValues={{ dataset_id: datasetId }}>
        <div className="filter-grid">
          <Form.Item name="dataset_id" label={<span>数据集 <FieldHelp definition={helpText.dataset} /></span>}><Select allowClear options={datasets.map((item) => ({ value: item.id, label: item.display_name }))} /></Form.Item>
          <Form.Item name="source_type" label={<span>来源类型 <FieldHelp definition={helpText.sourceType} /></span>}><Select allowClear options={[
            ['accepted_baseline', '已验收基准'], ['user_import', '用户导入'], ['synthetic_demo', '合成演示'], ['simulated_feedback', '本机模拟反馈'],
          ].map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="employee_id" label="员工编号"><Input placeholder="精确匹配" /></Form.Item>
          <Form.Item name="factory_code" label="工厂代码"><Input placeholder="例如 SX" /></Form.Item>
          <Form.Item name="line_code" label="产线代码"><Input placeholder="精确匹配" /></Form.Item>
          <Form.Item name="shift_code" label="班次代码"><Input placeholder="代码或名称" /></Form.Item>
          <Form.Item name="date_range" label="日期范围"><DatePicker.RangePicker /></Form.Item>
          <Form.Item label=" "><Button htmlType="submit" type="primary" icon={<FilterOutlined />} loading={loading}>查询档案</Button></Form.Item>
        </div>
      </Form>
    </Card>
    <Card title={`方案文件与版本（${items.length}）`} className="section-card">
      <Table rowKey={(row) => row.schedule.id} size="middle" dataSource={items} columns={columns} loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1100 }} locale={{ emptyText: '没有符合条件的方案记录' }} />
    </Card>
  </>;
}
