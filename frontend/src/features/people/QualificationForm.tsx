import { useEffect } from 'react';
import { Button, Card, Checkbox, Drawer, Form, Input, Select, Space, Typography } from 'antd';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import type { EmployeeProfile, LineRecord, PositionRecord, QualificationRecord, QualificationWrite, TeamRecord } from '../rotation/types';

const fieldLabel = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;
type Props = { open: boolean; initial?: QualificationRecord; lines: LineRecord[]; positions: PositionRecord[]; teams: TeamRecord[]; employees: EmployeeProfile[]; onClose: () => void; onSave: (data: QualificationWrite, reason: string, id?: string) => Promise<void> };
export default function QualificationForm({ open, initial, lines, positions, teams, employees, onClose, onSave }: Props) {
  const [form] = Form.useForm();
  useEffect(() => { if (open) form.setFieldsValue(initial ? { ...initial, reason: '' } : { qualification_id: null, object_type: 'team', object_id: undefined, position_id: undefined, line_id: undefined, description: '', is_active: true, reason: '' }); }, [form, initial, open]);
  const objectType = Form.useWatch('object_type', form) ?? 'team';
  const objectOptions = objectType === 'team'
    ? teams.filter((item) => item.is_active).map((item) => ({ value: item.team_id, label: `${item.name}（${item.team_id}）` }))
    : employees.filter((item) => !item.is_archived).map((item) => ({ value: item.employee_id, label: `${item.name}（${item.employee_id}）` }));
  const submit = (values: Record<string, any>) => onSave({ qualification_id: initial?.qualification_id ?? null, object_type: values.object_type, object_id: values.object_id, position_id: values.position_id, line_id: values.line_id, description: values.description?.trim() ?? '', is_active: Boolean(values.is_active) }, values.reason.trim(), initial?.qualification_id);
  return <Drawer title={initial ? '编辑岗位产线资格' : '新增岗位产线资格'} open={open} width={620} onClose={onClose} destroyOnClose extra={<Typography.Text type="secondary">本机关系记录</Typography.Text>}>
    <Form form={form} layout="vertical" onFinish={submit}>
      <Form.Item name="object_type" label={fieldLabel('资格对象类型', 'qualificationObjectType')} rules={[{ required: true }]}><Select options={[{ value: 'team', label: '班组' }, { value: 'employee', label: '员工' }]} onChange={() => form.setFieldValue('object_id', undefined)} /></Form.Item>
      <Form.Item name="object_id" label={fieldLabel('资格对象', 'qualificationObject')} rules={[{ required: true, message: '请选择资格对象。' }]}><Select showSearch optionFilterProp="label" options={objectOptions} /></Form.Item>
      <Form.Item name="line_id" label={fieldLabel('适用产线', 'qualificationLine')} rules={[{ required: true, message: '请选择适用产线。' }]}><Select showSearch optionFilterProp="label" options={lines.filter((item) => item.is_active).map((item) => ({ value: item.line_id, label: item.display_name }))} /></Form.Item>
      <Form.Item name="position_id" label={fieldLabel('适用岗位', 'qualificationPosition')} rules={[{ required: true, message: '请选择适用岗位。' }]}><Select showSearch optionFilterProp="label" options={positions.filter((item) => item.is_active).map((item) => ({ value: item.position_id, label: item.display_name }))} /></Form.Item>
      <Form.Item name="description" label={fieldLabel('资格说明', 'qualificationDescription')}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item>
      {initial && <Form.Item name="is_active" valuePropName="checked" label={fieldLabel('关系状态', 'rotationStatus')}><Checkbox>有效关系</Checkbox></Form.Item>}
      <Card size="small" title="变更记录" className="rotation-form-card"><Form.Item name="reason" label={fieldLabel('操作原因', 'rotationReason')} rules={[{ required: true, whitespace: true, message: '请填写操作原因。' }]}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item></Card>
      <div className="rotation-form-footer"><Space><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit">保存资格关系<FieldHelp definition={helpText.rotationSave} /></Button></Space></div>
    </Form>
  </Drawer>;
}
