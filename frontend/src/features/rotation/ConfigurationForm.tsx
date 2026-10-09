import { useEffect } from 'react';
import { Button, Card, Checkbox, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Typography, message } from 'antd';
import dayjs from 'dayjs';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import type { FieldValidationError, LineRecord, RotationObjectType, RotationTarget, ScheduleConfigDraft, ScheduleConfigRecord, ShiftDefinition } from './types';

type TargetOption = { value: string; label: string; objectType: RotationObjectType };
type Props = { open: boolean; initial?: ScheduleConfigRecord; lines: LineRecord[]; targetOptions: TargetOption[]; busy: boolean; onClose: () => void; onSubmit: (draft: ScheduleConfigDraft, reason: string) => Promise<FieldValidationError[]> };
const label = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;
const initialDraft = (record?: ScheduleConfigRecord): ScheduleConfigDraft => record ? {
  name: record.name, line_id: record.line_id, object_type: record.object_type, start_date: record.start_date, end_date: record.end_date,
  cycle_length: record.cycle_length, shifts: record.shifts.map((shift) => ({ ...shift })),
  cycle_days: record.cycle_days.map((day) => ({ ...day })), targets: record.targets.map((target) => ({ ...target })),
} : {
  name: '', line_id: '', object_type: 'team', start_date: dayjs().format('YYYY-MM-DD'), end_date: null, cycle_length: 3,
  shifts: [{ shift_code: 'DAY', name: '白班', start_time: '07:00', end_time: '19:00', remarks: '', display_order: 1 }, { shift_code: 'NIGHT', name: '夜班', start_time: '19:00', end_time: '07:00', remarks: '次日结束', display_order: 2 }],
  cycle_days: [{ cycle_day: 1, shift_code: 'DAY', is_rest: false }, { cycle_day: 2, shift_code: 'NIGHT', is_rest: false }, { cycle_day: 3, shift_code: null, is_rest: true }], targets: [],
};

export default function ConfigurationForm({ open, initial, lines, targetOptions, busy, onClose, onSubmit }: Props) {
  const [form] = Form.useForm();
  useEffect(() => { if (open) form.setFieldsValue({ ...initialDraft(initial), reason: '' }); }, [form, initial, open]);

  const synchronizeCycle = (_: unknown, values: Record<string, any>) => {
    const length = Number(values.cycle_length);
    if (!Number.isInteger(length) || length < 1 || length > 62) return;
    const current = values.cycle_days ?? [];
    if (current.length === length) return;
    const next = Array.from({ length }, (_, index) => current[index] ?? ({ cycle_day: index + 1, shift_code: null, is_rest: true }));
    form.setFieldsValue({ cycle_days: next.map((item: any, index: number) => ({ ...item, cycle_day: index + 1 })) });
  };
  const submit = async (values: Record<string, any>) => {
    const shifts: ShiftDefinition[] = (values.shifts ?? []).map((shift: any, index: number) => ({
      shift_code: shift.shift_code?.trim() ?? '', name: shift.name?.trim() ?? '',
      start_time: typeof shift.start_time === 'string' ? shift.start_time : shift.start_time?.format('HH:mm') ?? '',
      end_time: typeof shift.end_time === 'string' ? shift.end_time : shift.end_time?.format('HH:mm') ?? '',
      remarks: shift.remarks?.trim() ?? '', display_order: index + 1,
    }));
    const targets: RotationTarget[] = (values.targets ?? []).map((target: any) => ({ ...target, offset_days: Number(target.offset_days), is_active: true }));
    const draft: ScheduleConfigDraft = {
      name: values.name.trim(), line_id: values.line_id, object_type: values.object_type as RotationObjectType,
      start_date: values.start_date, end_date: values.end_date || null, cycle_length: Number(values.cycle_length), shifts,
      cycle_days: (values.cycle_days ?? []).map((day: any, index: number) => ({ cycle_day: index + 1, shift_code: day.is_rest ? null : day.shift_code || null, is_rest: Boolean(day.is_rest) })),
      targets,
    };
    try {
      const errors = await onSubmit(draft, values.reason.trim());
      if (errors.length) form.setFields(errors.map((error) => ({ name: error.path.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part), errors: [error.message] })));
    } catch (error) {
      const fieldErrors = (error as Error & { fieldErrors?: FieldValidationError[] }).fieldErrors ?? [];
      if (fieldErrors.length) form.setFields(fieldErrors.map((item) => ({ name: item.path.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part), errors: [item.message] })));
      else message.error((error as Error).message || '保存失败，请检查本机服务日志。');
    }
  };
  const objectType = Form.useWatch('object_type', form) as RotationObjectType | undefined;
  const cycleLength = Form.useWatch('cycle_length', form) ?? 3;
  return <Drawer title={initial ? '编辑轮班配置' : '新建轮班配置'} open={open} width={860} onClose={onClose} destroyOnClose extra={<Typography.Text type="secondary">本机配置模块，不改变 MIP 求解输入</Typography.Text>}>
    <Form form={form} layout="vertical" initialValues={initialDraft(initial)} onValuesChange={synchronizeCycle} onFinish={(values) => void submit(values)}>
      <Card size="small" title="基本信息" className="rotation-form-card">
        <Row gutter={16}>
          <Col xs={24} md={12}><Form.Item name="name" label={label('配置名称', 'rotationConfigName')} rules={[{ required: true, whitespace: true, message: '请填写配置名称。' }]}><Input maxLength={100} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="line_id" label={label('适用产线', 'rotationLine')} rules={[{ required: true, message: '请选择适用产线。' }]}><Select options={lines.map((item) => ({ value: item.line_id, label: `${item.display_name}（${item.line_id}）` }))} showSearch optionFilterProp="label" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="object_type" label={label('轮转对象类型', 'rotationObjectType')} rules={[{ required: true }]}><Select options={[{ value: 'team', label: '班组' }, { value: 'employee', label: '员工' }]} onChange={() => form.setFieldValue('targets', [])} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="cycle_length" label={label('周期长度', 'rotationCycleLength')} rules={[{ required: true }]}><InputNumber min={1} max={62} precision={0} className="full-width" addonAfter="d" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="start_date" label={label('生效日期', 'rotationStartDate')} rules={[{ required: true, message: '请选择生效日期。' }]}><Input type="date" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="end_date" label={label('失效日期', 'rotationEndDate')}><Input type="date" /></Form.Item></Col>
        </Row>
      </Card>
      <Card size="small" title="班次定义" className="rotation-form-card" extra={<FieldHelp definition={helpText.rotationShiftTime} />}>
        <Form.List name="shifts">{(fields, { add, remove }) => <>
          {fields.map((field, index) => <div className="rotation-repeat-row" key={field.key}>
            <Row gutter={12} align="middle">
              <Col xs={24} sm={5}><Form.Item {...field} name={[field.name, 'shift_code']} label={index === 0 ? label('班次编码', 'rotationShiftCode') : undefined} rules={[{ required: true, message: '请填写班次编码。' }]}><Input maxLength={32} /></Form.Item></Col>
              <Col xs={24} sm={5}><Form.Item {...field} name={[field.name, 'name']} label={index === 0 ? label('班次名称', 'rotationShiftName') : undefined} rules={[{ required: true, message: '请填写班次名称。' }]}><Input maxLength={40} /></Form.Item></Col>
              <Col xs={12} sm={5}><Form.Item {...field} name={[field.name, 'start_time']} label={index === 0 ? label('开始时间', 'rotationShiftStart') : undefined} rules={[{ required: true }]}><Input type="time" /></Form.Item></Col>
              <Col xs={12} sm={5}><Form.Item {...field} name={[field.name, 'end_time']} label={index === 0 ? label('结束时间', 'rotationShiftEnd') : undefined} rules={[{ required: true }]}><Input type="time" /></Form.Item></Col>
              <Col xs={18} sm={3}><Form.Item {...field} name={[field.name, 'remarks']} label={index === 0 ? label('说明', 'rotationShiftRemarks') : undefined}><Input maxLength={120} /></Form.Item></Col>
              <Col xs={6} sm={1}><Button type="link" danger onClick={() => remove(field.name)} aria-label="移除班次">移除<FieldHelp definition={helpText.rotationRemoveItem} /></Button></Col>
            </Row>
          </div>)}
          <Button onClick={() => add({ shift_code: '', name: '', start_time: '07:00', end_time: '19:00', remarks: '' })}>新增班次<FieldHelp definition={helpText.rotationAddShift} /></Button>
        </>}</Form.List>
        <Typography.Paragraph type="secondary" className="small-note">时间按 Asia/Shanghai 本地时刻解释。结束时间早于或等于开始时间时，日历按次日结束展示。</Typography.Paragraph>
      </Card>
      <Card size="small" title={label('周期明细', 'rotationCycleRows')} className="rotation-form-card">
        <Typography.Paragraph type="secondary">当前周期长度：{cycleLength} d。周期日按自然日顺序编号。</Typography.Paragraph>
        <Form.List name="cycle_days">{(fields) => <div className="rotation-cycle-grid">
          {fields.map((field, index) => <Card size="small" key={field.key} className="rotation-cycle-day" title={`第 ${index + 1} 日`}>
            <Form.Item name={[field.name, 'cycle_day']} hidden><InputNumber /></Form.Item>
            <Form.Item name={[field.name, 'is_rest']} valuePropName="checked"><Checkbox>休息日<FieldHelp definition={helpText.rotationRestDay} /></Checkbox></Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.cycle_days?.[field.name]?.is_rest !== next.cycle_days?.[field.name]?.is_rest}>
              {({ getFieldValue }) => getFieldValue(['cycle_days', field.name, 'is_rest']) ? <Typography.Text type="secondary">当日不安排班次</Typography.Text> : <Form.Item name={[field.name, 'shift_code']} label="对应班次" rules={[{ required: true, message: '请选择班次或将该周期日设为休息。' }]}><Select placeholder="请选择班次" options={(form.getFieldValue('shifts') ?? []).map((shift: ShiftDefinition) => ({ value: shift.shift_code, label: `${shift.name}（${shift.shift_code}）` }))} /></Form.Item>}
            </Form.Item>
          </Card>)}
        </div>}</Form.List>
      </Card>
      <Card size="small" title={label('轮转对象', 'rotationTargets')} className="rotation-form-card">
        <Form.List name="targets">{(fields, { add, remove }) => <>
          {fields.map((field, index) => <Row gutter={12} align="middle" className="rotation-target-row" key={field.key}>
            <Col xs={24} sm={16}><Form.Item name={[field.name, 'object_id']} label={index === 0 ? label('对象', 'rotationTargets') : undefined} rules={[{ required: true, message: '请选择轮转对象。' }]}><Select showSearch optionFilterProp="label" placeholder="请选择有效对象" options={targetOptions.filter((option) => option.objectType === objectType)} disabled={!objectType} /></Form.Item></Col>
            <Col xs={18} sm={6}><Form.Item name={[field.name, 'offset_days']} label={index === 0 ? label('周期偏移', 'rotationOffset') : undefined} rules={[{ required: true, message: '请填写周期偏移。' }]}><InputNumber min={0} max={Math.max(0, Number(cycleLength) - 1)} precision={0} className="full-width" addonAfter="d" /></Form.Item></Col>
            <Col xs={6} sm={2}><Button type="link" danger onClick={() => remove(field.name)} aria-label="移除轮转对象">移除<FieldHelp definition={helpText.rotationRemoveItem} /></Button></Col>
          </Row>)}
          <Button onClick={() => add({ object_id: '', offset_days: 0, is_active: true, object_type: objectType ?? 'team' })}>添加对象<FieldHelp definition={helpText.rotationTargets} /></Button>
        </>}</Form.List>
      </Card>
      <Card size="small" title="变更记录" className="rotation-form-card">
        <Form.Item name="reason" label={label('操作原因', 'rotationReason')} rules={[{ required: true, whitespace: true, message: '请填写本次操作原因。' }]}><Input.TextArea rows={3} maxLength={300} showCount placeholder="说明创建或调整该配置的业务依据" /></Form.Item>
      </Card>
      <div className="rotation-form-footer"><Space><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit" loading={busy}>校验并保存<FieldHelp definition={helpText.rotationSave} /></Button></Space></div>
    </Form>
  </Drawer>;
}
