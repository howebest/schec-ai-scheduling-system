import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { CheckCircleOutlined, LockOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { api, type ScheduleDetail, type ScheduleRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import DataSourceTag from '../../components/DataSourceTag';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import { formatDate } from '../../lib/display.js';

type ActionKind = 'validate' | 'review' | 'lock' | 'simulated_publish' | 'reject' | 'adjust';
const ACTIONS: Record<ActionKind, string> = {
  validate: '独立核验', review: '复核通过', lock: '锁定方案', simulated_publish: '模拟发布', reject: '驳回方案', adjust: '人工调整',
};

export default function SchedulesPage({ datasetId, refresh, notify }: PageProps) {
  const [items, setItems] = useState<ScheduleRecord[]>([]);
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  const load = () => api.schedules(datasetId).then((result) => setItems(result.items ?? [])).catch(() => setItems([]));
  useEffect(() => { void load(); }, [datasetId, refresh]);
  const openDetail = async (record: ScheduleRecord) => {
    try { setDetail(await api.schedule(record.id)); setDrawerOpen(true); }
    catch (error) { message.error((error as Error).message); }
  };
  const openAction = (kind: ActionKind) => {
    setAction(kind);
    form.resetFields();
    form.setFieldsValue({ actor_id: '本机计划员', actor_role: '计划员', reason: '' });
  };
  const submitAction = async (values: Record<string, any>) => {
    if (!detail || !action) return;
    const schedule = detail.schedule;
    setBusy(true);
    try {
      const common = { expected_version: schedule.version, actor_id: values.actor_id, actor_role: values.actor_role, reason: values.reason };
      if (action === 'validate') await api.validateSchedule(schedule.id, { ...common, demand_profile: values.demand_profile ?? 'solver' });
      else if (action === 'adjust') await api.adjustSchedule(schedule.id, { ...common, operation: {
        type: values.adjustment_type, employee_id: values.employee_id, position_code: values.position_code,
        date: values.date.format('YYYY-MM-DD'), shift_code: values.shift_code,
      } });
      else await api.approveSchedule(schedule.id, { ...common, action });
      notify(`${ACTIONS[action]}请求已提交。`);
      setAction(null); await load(); refresh();
      if (action === 'validate' || action === 'adjust') message.info('请在任务记录中查看异步处理状态。');
    } catch (error) { message.error((error as Error).message); }
    finally { setBusy(false); }
  };

  const columns = [
    { title: '方案名称', key: 'scenario_name', width: 150, render: (_: unknown, row: ScheduleRecord) => row.verification?.scenario_name ?? row.schedule_id },
    { title: '业务场景', key: 'scenario_family', width: 120, render: (_: unknown, row: ScheduleRecord) => row.verification?.scenario_family ?? '常规排班' },
    { title: '策略口径', key: 'strategy', width: 190, ellipsis: true, render: (_: unknown, row: ScheduleRecord) => row.verification?.strategy ?? '求解结果' },
    { title: '方案编号', dataIndex: 'schedule_id', key: 'schedule_id', width: 150 },
    { title: '版本', dataIndex: 'version', key: 'version', render: (value: number) => `V${value}`, width: 85 },
    { title: '数据来源', dataIndex: 'source_type', key: 'source_type', render: (value: string) => <DataSourceTag sourceType={value} />, width: 145 },
    { title: '核验状态', dataIndex: ['verification', 'all_pass'], key: 'verification', render: (_: unknown, row: ScheduleRecord) => {
      const pass = row.verification?.all_pass;
      return pass === true ? <Tag color="green">硬约束通过</Tag> : pass === false ? <Tag color="red">核验未通过</Tag> : <Tag>未核验</Tag>;
    }, width: 130 },
    { title: '方案文件', dataIndex: 'artifact_path', key: 'artifact_path', ellipsis: true },
    { title: '登记时间', dataIndex: 'created_at', key: 'created_at', render: formatDate, width: 190 },
    { title: '操作', key: 'action', fixed: 'right' as const, render: (_: unknown, row: ScheduleRecord) => <Button type="link" onClick={() => void openDetail(row)}>查看方案</Button> },
  ];

  return <>
    <PageHeader title="方案管理" description="查看方案版本、缺口记录和非完整班次记录。人工调整、硬约束核验、复核、锁定和模拟发布均按版本号进行控制。" extra={<Button onClick={() => void load()}>刷新</Button>} />
    <Alert type="info" showIcon message="发布前置条件" description="锁定和模拟发布必须以当前方案版本的独立硬约束核验结果 all_pass=true 为前提。更新后的方案会创建新版本，旧版本仍保留在调度档案中。" />
    <Card className="section-card" title="当前数据版本方案">
      <Table rowKey="id" size="middle" columns={columns} dataSource={items} pagination={{ pageSize: 10 }} scroll={{ x: 1450 }} locale={{ emptyText: '当前数据版本尚无登记方案' }} />
    </Card>
    <Drawer title={detail ? `${detail.schedule.schedule_id} · V${detail.schedule.version}` : '方案详情'} width="min(1160px, 96vw)" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
      {detail && <>
        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} className="detail-descriptions">
          <Descriptions.Item label="业务场景">{detail.schedule.verification?.scenario_name ?? '常规排班'}</Descriptions.Item>
          <Descriptions.Item label="场景分类">{detail.schedule.verification?.scenario_family ?? '未分类'}</Descriptions.Item>
          <Descriptions.Item label="方案策略">{detail.schedule.verification?.strategy ?? '未标注'}</Descriptions.Item>
          <Descriptions.Item label="对比组">{detail.schedule.verification?.comparison_group === 'baseline-demand' ? '基准需求组' : detail.schedule.verification?.comparison_group === 'peak-demand' ? '旺季需求组' : '未标注'}</Descriptions.Item>
          <Descriptions.Item label="方案来源"><DataSourceTag sourceType={detail.schedule.source_type} /></Descriptions.Item>
          <Descriptions.Item label="硬约束核验">{detail.schedule.verification?.all_pass === true ? <Tag color="green">通过</Tag> : detail.schedule.verification?.all_pass === false ? <Tag color="red">未通过</Tag> : '未核验'}</Descriptions.Item>
          <Descriptions.Item label="整班指派">{detail.content.assignment_count.toLocaleString('zh-CN')} 人班</Descriptions.Item>
          <Descriptions.Item label="缺口记录">{detail.content.gap_record_count.toLocaleString('zh-CN')} 条</Descriptions.Item>
          <Descriptions.Item label="非完整班次">{detail.content.fractional_record_count.toLocaleString('zh-CN')} 条</Descriptions.Item>
          <Descriptions.Item label="SHA-256"><Typography.Text code copyable>{detail.schedule.sha256}</Typography.Text></Descriptions.Item>
        </Descriptions>
        {detail.schedule.verification?.verification_state && <Alert className="top-space" type="warning" showIcon message="场景数据说明" description={detail.schedule.verification.verification_state} />}
        <Space wrap className="action-row">
          <Button icon={<SafetyCertificateOutlined />} onClick={() => openAction('validate')}>独立核验</Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => openAction('adjust')}>人工调整</Button>
          <Button icon={<CheckCircleOutlined />} onClick={() => openAction('review')}>复核</Button>
          <Button icon={<LockOutlined />} onClick={() => openAction('lock')}>锁定</Button>
          <Button type="primary" onClick={() => openAction('simulated_publish')}>模拟发布</Button>
          <Button danger onClick={() => openAction('reject')}>驳回</Button>
          <a href={`/api/v1/files/${detail.schedule.sha256}`}><Button>下载方案文件</Button></a>
        </Space>
        <Typography.Title level={5}>排班指派（最多显示 1,000 条）</Typography.Title>
        <Table rowKey={(_row, index) => String(index)} size="small" pagination={{ pageSize: 10 }} dataSource={detail.content.assignments} scroll={{ x: 1150 }} columns={[
          { title: '产线', dataIndex: 'line_code', key: 'line_code' }, { title: '日期', dataIndex: 'date', key: 'date' },
          { title: '班次', dataIndex: 'shift', key: 'shift' }, { title: '员工编号', dataIndex: 'employee_id', key: 'employee_id' },
          { title: '岗位编码', dataIndex: 'position_code', key: 'position_code' }, { title: '岗位名称', dataIndex: 'position_name', key: 'position_name' },
          { title: '计薪工时', dataIndex: 'paid_hours', key: 'paid_hours', render: (value: string) => `${value} h` },
        ]} />
        <Typography.Title level={5}>缺口记录</Typography.Title>
        <Table rowKey={(_row, index) => String(index)} size="small" pagination={{ pageSize: 8 }} dataSource={detail.content.gaps} columns={[
          { title: '岗位编码', dataIndex: 'position_code', key: 'position_code' }, { title: '岗位名称', dataIndex: 'position_name', key: 'position_name' },
          { title: '产线', dataIndex: 'line_code', key: 'line_code' }, { title: '日期', dataIndex: 'date', key: 'date' },
          { title: '班次', dataIndex: 'shift', key: 'shift' }, { title: '缺口', dataIndex: 'gap_shifts', key: 'gap_shifts', render: (value: string) => `${value} 人班` },
        ]} />
      </>}
    </Drawer>
    <Modal title={action ? ACTIONS[action] : ''} open={Boolean(action)} onCancel={() => setAction(null)} onOk={() => form.submit()} confirmLoading={busy} okText="提交" cancelText="取消">
      <Form form={form} layout="vertical" onFinish={submitAction}>
        {action === 'validate' && <Form.Item label={<span>需求口径 <FieldHelp definition={helpText.demandProfile} /></span>} name="demand_profile" initialValue="solver"><Select options={[{ value: 'solver', label: '求解输入口径' }, { value: 'reference', label: '岗位台账与运行计划重建口径' }]} /></Form.Item>}
        {action === 'adjust' && <>
          <Form.Item name="adjustment_type" label="调整操作" rules={[{ required: true }]}><Select options={[{ value: 'assign', label: '新增人员指派' }, { value: 'remove', label: '移除人员指派' }]} /></Form.Item>
          <Row gutter={8}><Col span={12}><Form.Item name="employee_id" label="员工编号" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={12}><Form.Item name="position_code" label="岗位编码" rules={[{ required: true }]}><Input /></Form.Item></Col></Row>
          <Row gutter={8}><Col span={12}><Form.Item name="date" label="日期" rules={[{ required: true }]}><DatePicker className="full-width" /></Form.Item></Col><Col span={12}><Form.Item name="shift_code" label="班次编码" rules={[{ required: true }]}><Select options={['D12', 'N12', 'D8', '白班', '夜班', '常白班'].map((value) => ({ value, label: value }))} /></Form.Item></Col></Row>
          <Alert type="warning" showIcon message="提交后将生成新的方案版本，必须对新版本重新核验。" />
        </>}
        <Row gutter={8}><Col span={12}><Form.Item name="actor_id" label="操作人" rules={[{ required: true }]}><Input maxLength={80} /></Form.Item></Col><Col span={12}><Form.Item name="actor_role" label="操作角色" rules={[{ required: true }]}><Select options={['计划员', '班组长', '主管', '系统管理员'].map((value) => ({ value, label: value }))} /></Form.Item></Col></Row>
        <Form.Item label={<span>操作原因 <FieldHelp definition={helpText.reason} /></span>} name="reason" rules={[{ required: true, whitespace: true, message: '请填写操作原因。' }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
      </Form>
    </Modal>
  </>;
}
