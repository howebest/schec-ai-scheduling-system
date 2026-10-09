import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, type ScheduleRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import FieldHelp from '../../components/FieldHelp';
import DataSourceTag from '../../components/DataSourceTag';
import { helpText } from '../../help/metadata';

const SCENARIOS = [
  { type: 'insert', title: '新增订单插单', line: 'SX-QC', date: '2026-07-12', shift: '白班', description: '针对指定产线、日期和班次增加岗位需求。' },
  { type: 'rampup', title: '产线增产', line: 'SX-CAN01', date: '2026-07-21', add_per_position: 1, description: '按每岗位增加人数调整指定日期的岗位需求。' },
  { type: 'changeover', title: '产品换型', line: 'HB-PET01', date: '2026-07-20', shift: '白班', description: '调整换型班次的岗位覆盖惩罚与非完整班次策略。' },
  { type: 'equipment_fail', title: '设备故障停线', line: 'SX-PET01', dates: ['2026-07-21', '2026-07-22', '2026-07-23'], description: '取消指定停线日期的岗位需求并释放人员。' },
  { type: 'absence', title: '员工突发离岗', employee: 'EMPHB0325', date: '2026-07-20', description: '在离岗日期后按场景窗口禁止该员工排班并执行增量补位。' },
];

export default function IncidentsPage({ datasetId, datasets, notify, refresh }: PageProps) {
  const [form] = Form.useForm();
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const selectedDataset = datasets.find((item) => item.id === datasetId);
  const canRun = selectedDataset?.source_type === 'accepted_baseline' || selectedDataset?.source_type === 'user_import';
  const eventType = Form.useWatch('type', form) ?? 'absence';
  const selected = SCENARIOS.find((scenario) => scenario.type === eventType)!;

  useEffect(() => { api.schedules(datasetId).then((result) => setSchedules(result.items ?? [])).catch(() => setSchedules([])); }, [datasetId, refresh]);
  const submit = async (values: Record<string, any>) => {
    if (!datasetId) return;
    const baseline = schedules[0];
    if (!baseline) { message.warning('当前数据版本没有可用于增量重排的基准方案。'); return; }
    let event: Record<string, unknown> = { type: values.type, event_id: `LOCAL-${Date.now()}` };
    if (values.type === 'absence') event = { ...event, employee: values.employee, date: values.date.format('YYYY-MM-DD') };
    if (values.type === 'equipment_fail') event = { ...event, line: values.line, dates: [values.startDate.format('YYYY-MM-DD'), values.endDate.format('YYYY-MM-DD')] };
    if (values.type === 'rampup') event = { ...event, line: values.line, date: values.date.format('YYYY-MM-DD'), add_per_position: values.add_per_position };
    if (values.type === 'insert' || values.type === 'changeover') event = { ...event, line: values.line, date: values.date.format('YYYY-MM-DD'), shift: values.shift };
    setSubmitting(true);
    try {
      const result = await api.createJob({ kind: 'reschedule', dataset_id: datasetId, baseline_schedule_id: baseline.id,
        actor_id: values.actor_id, actor_role: values.actor_role, reason: values.reason,
        event, parameters: { window_days: 7, time_limit_seconds: 45 } });
      notify(`异常重排任务已提交，编号 ${result.job.id}。`); refresh();
    } catch (error) { message.error((error as Error).message); }
    finally { setSubmitting(false); }
  };
  const scheduleOptions = schedules.map((schedule) => ({ value: schedule.id, label: `${schedule.schedule_id} · V${schedule.version}` }));

  return <>
    <PageHeader title="异常调度" description="使用本机已登记方案模拟五类异常事件，并提交锁定式增量重排任务。实际影响以求解器输出和独立核验结果为准。" />
    <Alert type="warning" showIcon message="本机场景数据" description="场景默认日期、产线和员工编号来自项目随附示例文件。它们仅用于本机演示，提交前应按所选数据集的日期范围和编码调整。真实订单、设备和考勤事件未接入。" />
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={9}>
        <Card title="创建异常重排" className="full-height-card">
          <Space wrap className="form-source-line"><DataSourceTag sourceType={selectedDataset?.source_type ?? 'raw_sample'} /><FieldHelp definition={helpText.dataset} /></Space>
          {!canRun && <Alert className="form-alert" type="info" showIcon message="请选择可用于求解的原始数据集" />}
          <Form form={form} layout="vertical" initialValues={{ type: 'absence', line: 'SX-PET01', employee: 'EMPHB0325', shift: '白班', date: dayjs(selected.date), startDate: dayjs('2026-07-21'), endDate: dayjs('2026-07-23'), add_per_position: 1, actor_id: '本机计划员', actor_role: '计划员' }} onFinish={submit}>
            <Form.Item name="type" label="异常类型" rules={[{ required: true }]}><Select options={SCENARIOS.map((item) => ({ value: item.type, label: item.title }))} /></Form.Item>
            <Typography.Paragraph type="secondary">{selected.description}</Typography.Paragraph>
            {eventType !== 'absence' && <Form.Item name="line" label="产线编码" rules={[{ required: true }]}><Input maxLength={40} /></Form.Item>}
            {eventType === 'absence' && <Form.Item name="employee" label="员工编号" rules={[{ required: true }]}><Input maxLength={40} /></Form.Item>}
            {eventType === 'equipment_fail' ? <Row gutter={8}>
              <Col span={12}><Form.Item name="startDate" label="停线开始日期" rules={[{ required: true }]}><DatePicker className="full-width" /></Form.Item></Col>
              <Col span={12}><Form.Item name="endDate" label="停线结束日期" rules={[{ required: true }]}><DatePicker className="full-width" /></Form.Item></Col>
            </Row> : <Form.Item name="date" label="事件日期" rules={[{ required: true }]}><DatePicker className="full-width" /></Form.Item>}
            {(eventType === 'insert' || eventType === 'changeover') && <Form.Item name="shift" label="班次" rules={[{ required: true }]}><Select options={['白班', '夜班', '常白班'].map((value) => ({ value, label: value }))} /></Form.Item>}
            {eventType === 'rampup' && <Form.Item name="add_per_position" label="每岗位增加人数" rules={[{ required: true }]}><InputNumber min={0} precision={0} className="full-width" /></Form.Item>}
            <Form.Item label={<span>重排基准方案 <FieldHelp definition={{ title: '重排基准方案', purpose: '作为锁定窗口外排班和原有指派的参照。', sourceOrDefault: '使用当前数据版本最近登记方案。', impact: '新方案以此版本生成并登记为独立版本。', limitation: '仅能选择与当前数据版本关联的方案。' }} /></span>}>
              <Select value={schedules[0]?.id} options={scheduleOptions} placeholder="当前版本尚无方案" disabled />
            </Form.Item>
            <Row gutter={8}>
              <Col span={12}><Form.Item label={<span>操作人 <FieldHelp definition={helpText.actor} /></span>} name="actor_id" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item></Col>
              <Col span={12}><Form.Item label="操作角色" name="actor_role" rules={[{ required: true }]}><Select options={['计划员', '班组长', '主管', '系统管理员'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
            </Row>
            <Form.Item label={<span>调度原因 <FieldHelp definition={helpText.reason} /></span>} name="reason" rules={[{ required: true, whitespace: true, message: '请填写异常调度原因。' }]}><Input.TextArea rows={2} maxLength={300} placeholder="说明该事件的来源和处理目标" /></Form.Item>
            <Button block type="primary" icon={<ThunderboltOutlined />} htmlType="submit" loading={submitting} disabled={!canRun || !schedules.length}>提交重排任务</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card title="事件定义与响应范围" className="full-height-card">
          <Table rowKey="type" size="middle" pagination={false} dataSource={SCENARIOS} columns={[
            { title: '事件类型', dataIndex: 'title', key: 'title', width: 155 },
            { title: '服务字段', dataIndex: 'type', key: 'type', render: (value: string) => <Typography.Text code>{value}</Typography.Text>, width: 150 },
            { title: '场景作用', dataIndex: 'description', key: 'description' },
          ]} />
          <div className="explanation-box"><Typography.Text strong>系统处理过程</Typography.Text><Typography.Paragraph type="secondary">提交后，系统读取指定基准方案，按事件窗口更新需求或可用人员，运行增量优化，并生成新方案文件。任务状态、求解器终止状态、覆盖变化和硬约束核验分别保存。未获得可行解时不会登记为通过方案。</Typography.Paragraph></div>
        </Card>
      </Col>
    </Row>
  </>;
}
