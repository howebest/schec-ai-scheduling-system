import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { DatasetRecord, ScheduleRecord } from '../../api/client';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import { loadScenarioOptions } from './plan-data';
import type { AnalyzedDecisionPlan, ScenarioEvent, ScenarioSubmission } from './types';

const eventOptions = [
  { value: 'absence', label: '员工突发离岗' },
  { value: 'equipment_fail', label: '设备故障停线' },
  { value: 'rampup', label: '产线增产' },
  { value: 'insert', label: '新增订单插单' },
  { value: 'changeover', label: '产品换型' },
];

const roles = ['计划员', '班组长', '主管', '系统管理员'];

function dateString(value: Dayjs) { return value.format('YYYY-MM-DD'); }

export default function ScenarioForm({ datasetId, datasets, baselines, plans, submitting = false, submitError = '', onSubmit }: {
  datasetId?: string;
  datasets: DatasetRecord[];
  baselines: ScheduleRecord[];
  plans: AnalyzedDecisionPlan[];
  submitting?: boolean;
  submitError?: string;
  onSubmit: (values: ScenarioSubmission) => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [baselineId, setBaselineId] = useState<string>();
  const [options, setOptions] = useState<Awaited<ReturnType<typeof loadScenarioOptions>> | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const selectedDataset = datasets.find((dataset) => dataset.id === datasetId);
  const canRun = selectedDataset?.source_type === 'accepted_baseline' || selectedDataset?.source_type === 'user_import';
  const eventType = Form.useWatch('eventType', form) ?? 'absence';
  const line = Form.useWatch('line', form);
  const eventDate = Form.useWatch('date', form) as Dayjs | undefined;
  const selectedPlan = plans.find((plan) => plan.record.id === baselineId);
  const baselineRecords = useMemo(() => baselines.filter((record) => record.dataset_id === datasetId), [baselines, datasetId]);
  const baselineOptions = baselineRecords.map((record) => ({
    value: record.id,
    label: `${plans.find((plan) => plan.record.id === record.id)?.scenarioName ?? record.schedule_id} · V${record.version}`,
  }));

  useEffect(() => {
    const exists = baselineRecords.some((record) => record.id === baselineId);
    if (!exists) {
      const nextId = baselineRecords[0]?.id;
      setBaselineId(nextId);
      form.setFieldValue('baselineScheduleId', nextId);
      form.setFieldsValue({ line: undefined, employee: undefined, date: undefined, dateRange: undefined, shift: undefined });
    }
  }, [baselineRecords, baselineId, form]);

  useEffect(() => {
    let active = true;
    const baseline = baselineRecords.find((record) => record.id === baselineId);
    if (!baseline || !canRun) {
      setOptions(null);
      setOptionsError('');
      return () => { active = false; };
    }
    setOptionsLoading(true);
    setOptions(null);
    setOptionsError('');
    loadScenarioOptions(baseline)
      .then((value) => { if (active) setOptions(value); })
      .catch((error: Error) => { if (active) setOptionsError(error.message || '读取基线排班字段失败。'); })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [baselineRecords, baselineId, canRun]);

  const lineDateShifts = options?.lineDateShifts ?? [];
  const datesForLine = [...new Set(lineDateShifts.filter((item) => !line || item.line === line).map((item) => item.date))].sort();
  const shiftsForLineDate = [...new Set(lineDateShifts.filter((item) => (!line || item.line === line) && (!eventDate || item.date === dateString(eventDate))).map((item) => item.shift))];
  const disabledDate = (value: Dayjs) => {
    const date = dateString(value);
    if (!options?.dates.includes(date)) return true;
    if (eventType !== 'absence' && line && !datesForLine.includes(date)) return true;
    return false;
  };

  const submit = async (values: Record<string, any>) => {
    if (!datasetId || !baselineId) return;
    const currentOptions = options;
    if (!currentOptions) return;
    const validLineDate = (candidateLine: unknown, candidateDate: unknown) => typeof candidateLine === 'string'
      && typeof candidateDate === 'string'
      && currentOptions.lineDateShifts.some((item) => item.line === candidateLine && item.date === candidateDate);
    const errors: Array<{ name: string; errors: string[] }> = [];
    if (values.eventType === 'absence' && !currentOptions.employees.includes(values.employee)) errors.push({ name: 'employee', errors: ['员工必须存在于当前基线排班记录中。'] });
    if (values.eventType !== 'absence' && !currentOptions.lines.includes(values.line)) errors.push({ name: 'line', errors: ['产线必须存在于当前基线排班记录中。'] });
    if (values.eventType === 'equipment_fail') {
      const start = values.dateRange?.[0] ? dateString(values.dateRange[0]) : '';
      const end = values.dateRange?.[1] ? dateString(values.dateRange[1]) : '';
      const validDates = currentOptions.lineDateShifts.filter((item) => item.line === values.line).map((item) => item.date);
      if (!start || !end || !validDates.includes(start) || !validDates.includes(end) || end < start) errors.push({ name: 'dateRange', errors: ['故障日期范围必须位于当前基线产线的排班日期内。'] });
    } else if (values.eventType !== 'absence') {
      const date = values.date ? dateString(values.date) : '';
      if (!validLineDate(values.line, date)) errors.push({ name: 'date', errors: ['事件日期必须属于当前基线产线的排班日期。'] });
      if ((values.eventType === 'insert' || values.eventType === 'changeover')
        && !currentOptions.lineDateShifts.some((item) => item.line === values.line && item.date === date && item.shift === values.shift)) {
        errors.push({ name: 'shift', errors: ['所选班次必须属于当前基线的产线和日期。'] });
      }
    } else if (values.date && !currentOptions.dates.includes(dateString(values.date))) {
      errors.push({ name: 'date', errors: ['离岗日期必须位于当前基线排班日期内。'] });
    }
    if (errors.length) { form.setFields(errors); return; }
    const eventId = `LAB-${Date.now()}`;
    let event: ScenarioEvent;
    if (values.eventType === 'absence') {
      event = { type: 'absence', event_id: eventId, employee: values.employee, date: dateString(values.date) };
    } else if (values.eventType === 'equipment_fail') {
      const start = dateString(values.dateRange[0]);
      const end = dateString(values.dateRange[1]);
      const dates = [...new Set(currentOptions.lineDateShifts
        .filter((item) => item.line === values.line && item.date >= start && item.date <= end)
        .map((item) => item.date))].sort();
      event = { type: 'equipment_fail', event_id: eventId, line: values.line, dates };
    } else if (values.eventType === 'rampup') {
      event = { type: 'rampup', event_id: eventId, line: values.line, date: dateString(values.date), add_per_position: values.add_per_position };
    } else {
      event = { type: values.eventType, event_id: eventId, line: values.line, date: dateString(values.date), shift: values.shift };
    }
    await onSubmit({
      datasetId,
      baselineScheduleId: baselineId,
      actorId: values.actorId.trim(),
      actorRole: values.actorRole,
      reason: values.reason.trim(),
      scenarioName: values.scenarioName.trim(),
      event,
    });
  };

  const dateField = (label = '事件日期') => <Form.Item name="date" label={<Space size={4}>{label}<FieldHelp definition={{
    title: label, purpose: '指定事件发生的业务日期。', sourceOrDefault: '选项来自所选基线 CSV 中已记录的排班日期。', unit: 'YYYY-MM-DD', impact: '服务端将按事件类型检查其与数据集计划日期的匹配关系。', limitation: '不能选择基线文件未覆盖的日期；最终有效性以 Rust 服务端校验结果为准。',
  }} /></Space>} rules={[{ required: true, message: '请选择事件日期。' }]}><DatePicker className="full-width" disabledDate={disabledDate} /></Form.Item>;

  return <Card title="情景推演与增量重排" className="section-card">
    {!canRun && <Alert type="warning" showIcon message="当前数据集仅支持方案分析" description="求解提交仅对已验收基准或用户导入数据开放。合成演示数据不进入重排求解。" />}
    {canRun && baselineRecords.length === 0 && <Alert type="warning" showIcon message="当前数据版本没有可用基线方案" description="请先在方案管理中登记与当前数据集关联的基准方案。" />}
    {optionsError && <Alert className="form-alert" type="error" showIcon message="基线字段读取失败" description={optionsError} />}
    {options && (options.lines.length === 0 || options.dates.length === 0) && <Alert className="form-alert" type="warning" showIcon message="基线文件缺少事件选项字段" description="当前 CSV 没有可识别的产线、日期、班次或员工指派记录，不能从该文件构造安全的事件选项。" />}
    {submitError && <Alert className="form-alert" type="error" showIcon message="情景任务未提交" description={submitError} />}
    <Form form={form} layout="vertical" initialValues={{ eventType: 'absence', actorId: '本机计划员', actorRole: '计划员' }} onFinish={submit}>
      <Row gutter={16}>
        <Col xs={24} xl={8}>
          <Form.Item name="baselineScheduleId" label={<Space size={4}>重排基线方案<FieldHelp definition={{
            title: '重排基线方案', purpose: '指定事件重排所依据的当前排班版本。', sourceOrDefault: '只列出当前数据集的已登记方案。', impact: 'Rust 服务会校验基线版本归属并将输出登记为后续版本。', limitation: '不能选择其他数据集或无效方案；基线 CSV 读取失败时不能提交。',
          }} /></Space>} rules={[{ required: true, message: '请选择基线方案。' }]}>
            <Select onChange={(nextId) => {
              setBaselineId(nextId);
              form.setFieldsValue({ line: undefined, employee: undefined, date: undefined, dateRange: undefined, shift: undefined });
            }} options={baselineOptions} loading={optionsLoading} placeholder="当前数据版本没有基线方案" showSearch optionFilterProp="label" disabled={!canRun || submitting || baselineRecords.length === 0} />
          </Form.Item>
          {selectedPlan && <Typography.Paragraph type="secondary">日期范围：{selectedPlan.period.start ?? '无'} 至 {selectedPlan.period.end ?? '无'}；来源：{selectedPlan.record.source_type}</Typography.Paragraph>}
          <Form.Item name="scenarioName" label={<Space size={4}>情景名称<FieldHelp definition={{ title: '情景名称', purpose: '为本次推演任务及结果方案提供可识别的业务名称。', sourceOrDefault: '由提交人填写。', impact: '随任务和结果方案登记，便于查询与对比。', limitation: '建议简要说明事件及影响范围。' }} /></Space>} rules={[{ required: true, whitespace: true, message: '请输入情景名称。' }, { max: 80, message: '情景名称最多 80 个字符。' }]}><Input maxLength={80} placeholder="例如：包装线突发离岗补位" disabled={!canRun || submitting} /></Form.Item>
        </Col>
        <Col xs={24} xl={8}>
          <Form.Item name="eventType" label={<Space size={4}>事件类型<FieldHelp definition={{ title: '事件类型', purpose: '选择本次需要模拟的生产或人员变更类别。', sourceOrDefault: '提供离岗、设备故障、增产、插单和换型五类事件。', impact: '事件类型决定需要填写的员工、产线、日期、班次或人数增量。', limitation: '仅使用现有 Rust 服务和 Python 适配器支持的事件协议。' }} /></Space>} rules={[{ required: true }]}><Select options={eventOptions} disabled={!canRun || submitting} /></Form.Item>
          {eventType === 'absence' && <Form.Item name="employee" label={<Space size={4}>员工编号<FieldHelp definition={{ title: '员工编号', purpose: '指定需要从事件日期起排除并执行补位的员工。', sourceOrDefault: '员工编号从所选基线 CSV 的已排班记录生成。', impact: '事件仅针对所选员工建立重排限制。', limitation: '员工须同时存在于所选数据集输入中；Rust 服务会调用适配器进行预检。' }} /></Space>} rules={[{ required: true, message: '请选择员工。' }]}><Select options={(options?.employees ?? []).map((value) => ({ value, label: value }))} showSearch optionFilterProp="label" loading={optionsLoading} disabled={!canRun || submitting} /></Form.Item>}
          {eventType !== 'absence' && <Form.Item name="line" label={<Space size={4}>产线编码<FieldHelp definition={{ title: '产线编码', purpose: '限定故障、增产、插单或换型影响的生产线。', sourceOrDefault: '选项从所选基线 CSV 的产线编码提取。', impact: '与日期及班次共同形成事件影响范围。', limitation: '数据集输入中不存在的产线将被服务端拒绝。' }} /></Space>} rules={[{ required: true, message: '请选择产线。' }]}><Select options={(options?.lines ?? []).map((value) => ({ value, label: value }))} onChange={() => form.setFieldsValue({ date: undefined, shift: undefined, dateRange: undefined })} showSearch optionFilterProp="label" loading={optionsLoading} disabled={!canRun || submitting} /></Form.Item>}
          {eventType === 'rampup' && <Form.Item name="add_per_position" label={<Space size={4}>每岗位增加人数<FieldHelp definition={{ title: '每岗位增加人数', purpose: '设置增产事件中每个岗位增加的需求人数。', sourceOrDefault: '由提交人填写正整数。', unit: '人/岗位', impact: '增加指定产线及日期的排班需求。', limitation: '服务端仅接受非负整数；本页面要求至少增加 1 人。' }} /></Space>} rules={[{ required: true, message: '请输入人数增量。' }]}><InputNumber min={1} max={100} precision={0} className="full-width" disabled={!canRun || submitting} /></Form.Item>}
          {(eventType === 'insert' || eventType === 'changeover') && <Form.Item name="shift" label={<Space size={4}>班次<FieldHelp definition={{ title: '班次', purpose: '选择插单或换型事件影响的生产班次。', sourceOrDefault: '选项从基线 CSV 中对应产线及日期的已登记班次生成。', impact: '仅影响选定班次的岗位需求或换型策略。', limitation: '服务端协议支持白班、夜班和常白班；不在基线范围内的班次不能选择。' }} /></Space>} rules={[{ required: true, message: '请选择班次。' }]}><Select options={shiftsForLineDate.map((value) => ({ value, label: value }))} disabled={!canRun || submitting || optionsLoading || Boolean(line && eventDate && shiftsForLineDate.length === 0)} /></Form.Item>}
        </Col>
        <Col xs={24} xl={8}>
          {eventType === 'equipment_fail' ? <>
            <Form.Item name="dateRange" label={<Space size={4}>设备故障日期范围<FieldHelp definition={{ title: '设备故障日期范围', purpose: '指定设备停线影响的首日和末日。', sourceOrDefault: '日期取自所选产线在基线 CSV 中的排班日期。', unit: 'YYYY-MM-DD', impact: '提交时系统会展开为该产线在起止日期之间出现的全部基线排班日期。', limitation: '结束日期不得早于开始日期；最终日期集合须通过服务端数据集预检。' }} /></Space>} rules={[{ required: true, message: '请选择故障日期范围。' }, { validator: async (_rule, values) => { if (values?.[0] && values?.[1] && values[1].isBefore(values[0], 'day')) throw new Error('结束日期不得早于开始日期。'); } }]}><DatePicker.RangePicker className="full-width" disabledDate={disabledDate} disabled={!canRun || submitting} /></Form.Item>
            <Typography.Text type="secondary" className="small-note">事件会覆盖所选产线在区间内记录的所有排班日。</Typography.Text>
          </> : eventType === 'absence' ? dateField('离岗日期') : dateField()}
          <Form.Item name="actorId" label={<Space size={4}>操作人<FieldHelp definition={helpText.actor} /></Space>} rules={[{ required: true, whitespace: true, message: '请输入操作人。' }, { max: 80 }]}><Input maxLength={80} disabled={!canRun || submitting} /></Form.Item>
          <Form.Item name="actorRole" label={<Space size={4}>操作角色<FieldHelp definition={{ title: '操作角色', purpose: '记录本次提交任务的本机业务角色。', sourceOrDefault: '提供计划员、班组长、主管和系统管理员四种服务端允许值。', impact: '角色随任务请求写入本机任务和审计记录。', limitation: '本机演示未接入统一身份认证；页面角色字段不构成企业权限认证。' }} /></Space>} rules={[{ required: true, message: '请选择操作角色。' }]}><Select options={roles.map((value) => ({ value, label: value }))} disabled={!canRun || submitting} /></Form.Item>
        </Col>
      </Row>
      <Form.Item name="reason" label={<Space size={4}>提交原因<FieldHelp definition={helpText.reason} /></Space>} rules={[{ required: true, whitespace: true, message: '请填写本次情景推演的业务原因。' }, { max: 500, message: '提交原因最多 500 个字符。' }]}><Input.TextArea rows={3} maxLength={500} showCount placeholder="说明本次推演的业务依据及复核目的" disabled={!canRun || submitting} /></Form.Item>
      <Space>
        <Button type="primary" htmlType="submit" loading={submitting} disabled={!canRun || !baselineId || optionsLoading || Boolean(optionsError) || !options?.dates.length || !options?.employees.length && eventType === 'absence' || eventType !== 'absence' && !options?.lines.length}>提交增量重排</Button>
        <Typography.Text type="secondary">任务由 Rust 服务统一校验和管理；提交不会自动发布或替换当前方案。</Typography.Text>
      </Space>
    </Form>
  </Card>;
}
