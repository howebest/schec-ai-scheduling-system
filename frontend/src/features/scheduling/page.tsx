import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlayCircleOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { api, type JobRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import FieldHelp from '../../components/FieldHelp';
import DataSourceTag from '../../components/DataSourceTag';
import { helpText } from '../../help/metadata';
import { formatDate, statusLabel } from '../../lib/display.js';

const TASKS = [
  { value: 'info', label: '数据概况检查' },
  { value: 'solve_demo', label: '7 天演示排班求解' },
  { value: 'solve_full', label: '62 天整周期求解' },
  { value: 'verify_baseline', label: '基准方案复核' },
  { value: 'kpi', label: '方案 KPI 复算' },
];
const OBJECTIVE_PROFILES = [
  { value: 'balanced', label: '均衡排班' },
  { value: 'coverage_first', label: '覆盖优先' },
  { value: 'cost_control', label: '成本优先' },
  { value: 'fairness_first', label: '工时公平优先' },
];

function isZeroAssignmentJob(job: JobRecord) {
  const result = job.result as Record<string, any> | null | undefined;
  return job.status === 'succeeded' && result?.summary?.kpi?.assigned === 0;
}

export default function SchedulingPage({ datasetId, datasets, refresh, notify }: PageProps) {
  const [form] = Form.useForm();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const selectedDataset = datasets.find((item) => item.id === datasetId);
  const canSolve = selectedDataset?.source_type === 'accepted_baseline'
    || (selectedDataset?.source_type === 'user_import' && selectedDataset.manifest?.schema_id === 'raw_dataset');
  const task = Form.useWatch('kind', form) ?? 'solve_demo';

  const load = async () => {
    try { setJobs((await api.jobs({ limit: 100 })).items ?? []); } catch { setJobs([]); }
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [refresh]);

  const submit = async (values: Record<string, any>) => {
    if (!datasetId) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        kind: values.kind,
        dataset_id: datasetId,
        actor_id: values.actor_id,
        actor_role: values.actor_role,
        reason: values.reason,
        parameters: values.kind === 'solve_demo'
          ? {
            time_limit_seconds: values.time_limit_seconds,
            scenario_name: values.scenario_name,
            objective_profile: values.objective_profile,
            demand_multiplier: values.demand_multiplier,
          }
          : { time_limit_seconds: values.time_limit_seconds },
      };
      if (values.kind === 'verify_baseline' || values.kind === 'kpi') payload.baseline_schedule_id = 'baseline-full62-w1';
      const result = await api.createJob(payload);
      notify(`任务已提交，编号 ${result.job.id}。`);
      await load(); refresh();
    } catch (error) { message.error((error as Error).message); }
    finally { setSubmitting(false); }
  };

  const cancel = async (id: string) => {
    try { await api.cancelJob(id); notify('取消请求已提交。'); await load(); }
    catch (error) { message.error((error as Error).message); }
  };

  const columns = useMemo(() => [
    { title: '任务名称', key: 'task_name', width: 190, render: (_: unknown, row: JobRecord) => {
      const parameters = row.request?.parameters as Record<string, unknown> | undefined;
      const name = parameters?.scenario_name;
      const fallback = TASKS.find((item) => item.value === row.kind)?.label ?? '排班任务';
      const displayName = typeof name === 'string' && name.trim() ? name : fallback;
      return <Space size={6}><Typography.Text title={row.id} ellipsis>{displayName}</Typography.Text>{isZeroAssignmentJob(row) && <Tag color="red">零排班</Tag>}</Space>;
    } },
    { title: '任务编号', dataIndex: 'id', key: 'id', width: 150, render: (value: string) => <Typography.Text code title={value}>{value.slice(0, 12)}</Typography.Text> },
    { title: '任务类型', dataIndex: 'kind', key: 'kind', render: (value: string) => TASKS.find((item) => item.value === value)?.label ?? value },
    { title: '数据集', dataIndex: 'dataset_id', key: 'dataset_id', render: (value: string) => <span>{datasets.find((item) => item.id === value)?.display_name ?? value}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'succeeded' ? 'green' : value === 'failed' ? 'red' : value === 'running' ? 'blue' : 'default'}>{statusLabel(value)}</Tag> },
    { title: '求解器状态', dataIndex: 'solver_termination', key: 'solver_termination', render: (value: string | null) => value || '—' },
    { title: '开始时间', dataIndex: 'started_at', key: 'started_at', render: formatDate, width: 180 },
    { title: '完成时间', dataIndex: 'finished_at', key: 'finished_at', render: formatDate, width: 180 },
    { title: '操作', key: 'actions', fixed: 'right' as const, render: (_: unknown, row: JobRecord) => ['queued', 'running'].includes(row.status) ? <Button size="small" danger icon={<StopOutlined />} onClick={() => void cancel(row.id)}>取消</Button> : '—' },
  ], [datasets]);

  return <>
    <PageHeader title="排班任务" description="提交数据检查、周期排班、基准复核和 KPI 复算任务。任务由本机 Rust 服务排队并统一管理 Python 求解进程。" />
    <Alert type="info" showIcon message="任务边界" description="求解任务只接受原始工作簿数据集。合成演示数据用于订单、产能和考勤分析，不进入现有排班 MIP 模型。所有任务均保留输入版本、任务状态和求解器终止状态。" />
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={9}>
        <Card title="创建任务" className="full-height-card">
          <Space className="form-source-line" wrap><DataSourceTag sourceType={selectedDataset?.source_type ?? 'raw_sample'} /><Typography.Text type="secondary">{selectedDataset?.display_name ?? '未选择数据集'}</Typography.Text><FieldHelp definition={helpText.dataset} /></Space>
          <Form form={form} layout="vertical" initialValues={{ kind: 'solve_demo', time_limit_seconds: 120, scenario_name: '常规·均衡', objective_profile: 'balanced', demand_multiplier: 1, actor_id: '本机计划员', actor_role: '计划员' }} onFinish={submit}>
            <Form.Item label={<span>任务类型 <FieldHelp definition={{ title: '任务类型', purpose: '选择要执行的数据检查或排班计算。', sourceOrDefault: '默认选择 7 天演示排班求解。', impact: '任务类型决定服务调用的求解器命令及产物。', limitation: '运行时间取决于模型规模、输入质量和本机性能。' }} /></span>} name="kind" rules={[{ required: true }]}>
              <Select options={TASKS} />
            </Form.Item>
            <Form.Item label={<span>求解时限 <FieldHelp definition={helpText.timeLimit} /></span>} name="time_limit_seconds" rules={[{ required: true, message: '请填写求解时限。' }]}>
              <InputNumber min={1} max={task === 'solve_full' ? 600 : 300} addonAfter="s" className="full-width" />
            </Form.Item>
            {task === 'solve_demo' && <>
              <Form.Item label={<span>方案名称 <FieldHelp definition={{ title: '方案名称', purpose: '为本次演示求解任务和生成方案设置简短业务名称。', sourceOrDefault: '默认值为常规·均衡。', impact: '该名称显示在任务列表、调度档案和排班分析方案选择器中。', limitation: '名称用于本地识别，不改变求解结果。' }} /></span>} name="scenario_name" rules={[{ required: true, whitespace: true, message: '请填写方案名称。' }]}>
                <Input maxLength={40} />
              </Form.Item>
              <Row gutter={8}>
                <Col span={12}><Form.Item label={<span>优化侧重 <FieldHelp definition={{ title: '优化侧重', purpose: '设置目标函数对岗位覆盖、加班和工时均衡的相对权重。', sourceOrDefault: '默认使用均衡排班权重。', impact: '权重会影响目标函数与最终班次安排；成本优先场景额外要求至少 85% 的需求覆盖。所有候选方案仍接受同一组硬约束独立核验。', limitation: '方案属于本机演示求解结果；权重侧重不构成业务最优保证。' }} /></span>} name="objective_profile"><Select options={OBJECTIVE_PROFILES} /></Form.Item></Col>
                <Col span={12}><Form.Item label={<span>需求倍率 <FieldHelp definition={{ title: '需求倍率', purpose: '对演示周期的岗位需求人班统一乘以倍率，构造需求压力场景。', sourceOrDefault: '默认值为 1.00 倍，范围 0.80 至 1.30 倍。', impact: '倍率越高，方案需求规模和缺口风险通常越高。', limitation: '这是模拟场景输入；跨倍率比较需同时参考需求人班和单位覆盖成本。' }} /></span>} name="demand_multiplier"><InputNumber min={0.8} max={1.3} step={0.05} precision={2} addonAfter="倍" className="full-width" /></Form.Item></Col>
              </Row>
            </>}
            <Row gutter={8}>
              <Col span={12}><Form.Item label={<span>操作人 <FieldHelp definition={helpText.actor} /></span>} name="actor_id" rules={[{ required: true, whitespace: true }]}><Input maxLength={80} /></Form.Item></Col>
              <Col span={12}><Form.Item label="操作角色" name="actor_role" rules={[{ required: true }]}><Select options={['计划员', '班组长', '主管', '系统管理员'].map((value) => ({ value, label: value }))} /></Form.Item></Col>
            </Row>
            <Form.Item label={<span>提交原因 <FieldHelp definition={helpText.reason} /></span>} name="reason" rules={[{ required: true, whitespace: true, message: '请填写提交原因。' }]}><Input.TextArea rows={2} maxLength={300} placeholder="说明本次任务目的" /></Form.Item>
            {(task === 'verify_baseline' || task === 'kpi') && <Alert type="warning" showIcon message="将使用包内已验收方案 baseline-full62-w1。复核结果与历史登记值分开展示。" />}
            {!canSolve && <Alert className="form-alert" type="warning" showIcon message="当前数据版本不支持求解" description="请在页面顶部选择“已验收基准数据”或已经登记原始工作簿文件的用户导入数据集。" />}
            <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={submitting} disabled={!canSolve || !datasetId} block>提交任务</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={15}>
        <Card title="运行流程" className="full-height-card">
          <ol className="process-list">
            <li><Typography.Text strong>提交</Typography.Text><Typography.Text type="secondary">Rust 校验数据集引用和任务类型后创建本机任务记录。</Typography.Text></li>
            <li><Typography.Text strong>排队与执行</Typography.Text><Typography.Text type="secondary">单个 Python 子进程加载包内求解代码及隔离依赖。</Typography.Text></li>
            <li><Typography.Text strong>结果登记</Typography.Text><Typography.Text type="secondary">方案、日志、校验状态和 SHA-256 写入本机任务档案。</Typography.Text></li>
            <li><Typography.Text strong>独立核验</Typography.Text><Typography.Text type="secondary">方案通过硬约束复核后才允许锁定或模拟发布。</Typography.Text></li>
          </ol>
          <Typography.Paragraph type="secondary" className="small-note">当前工程运行环境缺少 CPython 3.11、Pyomo 和 HiGHS 时，任务会返回明确依赖错误，不会以成功状态登记。</Typography.Paragraph>
        </Card>
      </Col>
    </Row>
    <Card title="任务记录" className="section-card" extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>}>
      <Table rowKey="id" size="middle" columns={columns} dataSource={jobs} loading={submitting} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 1100 }} locale={{ emptyText: '尚无任务记录' }} />
    </Card>
  </>;
}
