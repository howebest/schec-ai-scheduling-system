import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Space, Table, Typography, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { api } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import { formatDate } from '../../lib/display.js';

const FIELDS = [
  { name: 'standard_hours_per_day', label: '每日标准工时', min: 1, max: 24, unit: 'h', description: '每日计入标准工时的上限。模型规定的班次计薪工时口径保持不变。' },
  { name: 'daily_overtime_hours_max', label: '每日加班上限', min: 0, max: 24, unit: 'h', description: '单日加班小时数上限。12 h 班次当前采用 3 h 加班口径。' },
  { name: 'monthly_overtime_hours_max', label: '月加班上限', min: 0, max: 240, unit: 'h', description: '月度加班小时数配置上限。已验收模型使用 36 h。' },
  { name: 'rolling_rest_days', label: '连续休息检查窗口', min: 1, max: 31, unit: 'd', description: '滚动休息约束检查窗口天数。当前模型定义为 7 d。' },
  { name: 'minimum_rest_hours', label: '班间最小休息间隔', min: 0, max: 48, unit: 'h', description: '前一班次结束至下一班次开始之间必须满足的最小休息时长。当前模型定义为 11 h。' },
];

export default function RulesPage({ notify }: PageProps) {
  const [form] = Form.useForm();
  const [history, setHistory] = useState<Array<Record<string, any>>>([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    try {
      const result = await api.rules();
      setHistory(result.history ?? []);
      setVersion(result.latest?.version ?? 0);
      form.setFieldsValue({ ...(result.latest?.values ?? {}), reason: '' });
    } catch { setHistory([]); }
  };
  useEffect(() => { void load(); }, []);
  const save = async (values: Record<string, any>) => {
    setLoading(true);
    const { reason, ...ruleValues } = values;
    try {
      await api.saveRules({ expected_version: version, actor_id: '本机计划员', actor_role: '计划员', reason, values: ruleValues });
      notify('规则配置已保存为新版本。');
      await load();
    } catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  };

  return <>
    <PageHeader title="规则配置" description="查看并版本化本机规则参数。每次保存均记录操作人、版本和原因，并保留历史记录。" />
    <Alert type="warning" showIcon message="规则参数的生效范围" description="当前接口负责规则版本保存和审计。排班模型的硬约束常量定义在已验收模型代码中；此页修改不会自动改变 MIP 约束。需要调整求解口径时，应同步评审模型代码并重新核验。" />
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={14}>
        <Card title={`规则版本 V${version}`} extra={<Typography.Text type="secondary">配置保存与模型运行边界已说明</Typography.Text>}>
          <Form form={form} layout="vertical" onFinish={save}>
            <Row gutter={[16, 0]}>
              {FIELDS.map((field) => <Col xs={24} md={12} key={field.name}>
                <Form.Item label={<span>{field.label} <FieldHelp definition={{ title: field.label, purpose: field.description, sourceOrDefault: '默认采用当前规则版本值。', unit: field.unit, impact: '保存后生成新的版本记录并进入本机审计日志。', limitation: '当前修改只更新规则配置记录，不改变现有 MIP 模型中的固定约束。' }} /></span>} name={field.name} rules={[{ required: true, message: `请填写${field.label}。` }]}>
                  <InputNumber min={field.min} max={field.max} step={field.unit === 'd' ? 1 : 0.5} addonAfter={field.unit} className="full-width" />
                </Form.Item>
              </Col>)}
            </Row>
            <Form.Item label={<span>变更原因 <FieldHelp definition={helpText.reason} /></span>} name="reason" rules={[{ required: true, whitespace: true, message: '请填写变更原因。' }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="说明变更依据和适用范围" /></Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading}>保存新版本</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card title="当前模型硬约束口径" className="full-height-card">
          <ul className="plain-list">
            <li>每日标准工时：8 h。</li>
            <li>每日加班上限：3 h。</li>
            <li>月加班上限：36 h。</li>
            <li>滚动 7 d 内至少 1 d 休息。</li>
            <li>相邻班次间隔至少 11 h。</li>
            <li>同时核查资格、夜班资格和岗位覆盖账目。</li>
          </ul>
          <Typography.Paragraph type="secondary">这些值来自已验收排班模型和独立核验代码。修改数据库中的规则记录不会覆盖源代码中的模型常量。所有方案均应以独立核验输出作为是否通过的依据。</Typography.Paragraph>
        </Card>
      </Col>
    </Row>
    <Card title="历史版本" className="section-card">
      <Table rowKey="id" size="middle" dataSource={history} pagination={{ pageSize: 8 }} columns={[
        { title: '版本', dataIndex: 'version', key: 'version', render: (value: number) => `V${value}`, width: 90 },
        { title: '操作人', dataIndex: 'actor_id', key: 'actor_id', width: 140 },
        { title: '变更原因', dataIndex: 'reason', key: 'reason' },
        { title: '规则值', dataIndex: 'values', key: 'values', render: (value: Record<string, unknown>) => <Typography.Text code>{JSON.stringify(value)}</Typography.Text> },
        { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: formatDate, width: 190 },
      ]} locale={{ emptyText: '尚无规则版本记录' }} />
    </Card>
  </>;
}
