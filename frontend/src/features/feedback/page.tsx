import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Rate, Row, Select, Table, Tag, message } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { api } from '../../api/client';
import type { FeedbackRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import FieldHelp from '../../components/FieldHelp';
import DataSourceTag from '../../components/DataSourceTag';
import { helpText } from '../../help/metadata';
import { formatDate } from '../../lib/display.js';

const FEEDBACK_TYPES = [
  { value: 'shift_preference', label: '班次偏好' },
  { value: 'skill_update_suggestion', label: '技能更新建议' },
  { value: 'schedule_issue', label: '排班问题' },
  { value: 'execution_status', label: '现场执行状态' },
];

export default function FeedbackPage({ refresh, notify }: PageProps) {
  const [form] = Form.useForm();
  const [items, setItems] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const load = () => api.feedback().then((result) => setItems(result.items ?? [])).catch(() => setItems([]));
  useEffect(() => { void load(); }, [refresh]);
  const submit = async (values: Record<string, any>) => {
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { content: values.content, review_status: '待复核' };
      if (Number.isInteger(values.satisfaction_score)) payload.satisfaction_score = values.satisfaction_score;
      await api.submitFeedback({
        employee_id: values.employee_id,
        feedback_type: values.feedback_type,
        schedule_id: values.schedule_id || null,
        payload,
      });
      notify('反馈已记录为本机模拟数据。');
      form.resetFields(); await load();
    } catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  };

  return <>
    <PageHeader title="员工反馈" description="记录员工对班次、排班和技能画像的本机模拟反馈，供计划员查看和后续人工复核。" />
    <Alert type="info" showIcon message="反馈数据边界" description="当前反馈保存在本机 SQLite，来源固定为“本机模拟反馈”。尚未接入员工账号认证、HR 画像更新、企业微信或短信通知。" />
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={9}>
        <Card title="提交一条反馈">
          <Form form={form} layout="vertical" onFinish={submit}>
            <Form.Item label="员工编号" name="employee_id" rules={[{ required: true, whitespace: true, message: '请填写员工编号。' }]}><Input maxLength={80} placeholder="例如 DEMO-E001" /></Form.Item>
            <Form.Item label="反馈类别" name="feedback_type" rules={[{ required: true, message: '请选择反馈类别。' }]}><Select options={FEEDBACK_TYPES} /></Form.Item>
            <Form.Item label={<span>方案编号 <FieldHelp definition={{ title: '方案编号', purpose: '将反馈关联到一个已登记排班方案。', sourceOrDefault: '可选；留空表示一般反馈。', impact: '有方案编号的反馈便于与方案版本一并复核。', limitation: '需填写本机登记的方案 ID。' }} /></span>} name="schedule_id"><Input maxLength={80} placeholder="可选" /></Form.Item>
            <Form.Item label={<span>满意度评分 <FieldHelp definition={{ title: '满意度评分', purpose: '记录员工对关联排班方案的整体评价。', sourceOrDefault: '选填，按 1 至 5 分记录。', unit: '分', impact: '仅统计已关联方案且填写有效评分的反馈。', limitation: '本机模拟反馈不代表全体员工抽样结果或真实满意度调查。' }} /></span>} name="satisfaction_score"><Rate count={5} /></Form.Item>
            <Form.Item label="反馈内容" name="content" rules={[{ required: true, whitespace: true, message: '请填写反馈内容。' }]}><Input.TextArea rows={5} maxLength={1000} showCount placeholder="请描述反馈事实和需要核查的事项" /></Form.Item>
            <Button htmlType="submit" type="primary" icon={<SendOutlined />} loading={loading} block>保存模拟反馈</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card title={`反馈记录（${items.length}）`}>
          <Table rowKey="id" size="middle" loading={loading} dataSource={items} pagination={{ pageSize: 8 }} scroll={{ x: 900 }} columns={[
            { title: '员工编号', dataIndex: 'employee_id', key: 'employee_id' },
            { title: '反馈类别', dataIndex: 'feedback_type', key: 'feedback_type', render: (value: string) => FEEDBACK_TYPES.find((item) => item.value === value)?.label ?? value },
            { title: '满意度', dataIndex: ['payload', 'satisfaction_score'], key: 'satisfaction_score', render: (value: number) => Number.isInteger(value) && value >= 1 && value <= 5 ? `${value} 分` : '无评分' },
            { title: '内容', dataIndex: ['payload', 'content'], key: 'content', ellipsis: true },
            { title: '复核状态', dataIndex: ['payload', 'review_status'], key: 'review', render: (value: string) => <Tag>{value ?? '待复核'}</Tag> },
            { title: '来源', dataIndex: 'source_type', key: 'source', render: (value: string) => <DataSourceTag sourceType={value} /> },
            { title: '提交时间', dataIndex: 'created_at', key: 'created_at', render: formatDate, width: 185 },
          ]} locale={{ emptyText: '当前没有反馈记录' }} />
        </Card>
      </Col>
    </Row>
  </>;
}
