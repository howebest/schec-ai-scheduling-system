import { useEffect } from 'react';
import { Button, Card, Checkbox, Drawer, Form, Input, Select, Space, Typography } from 'antd';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import type { EmployeeProfile, TeamRecord, TeamWrite } from '../rotation/types';

const fieldLabel = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;
type Props = { open: boolean; initial?: TeamRecord; employees: EmployeeProfile[]; onClose: () => void; onSave: (data: TeamWrite, reason: string, id?: string) => Promise<void> };
export default function TeamForm({ open, initial, employees, onClose, onSave }: Props) {
  const [form] = Form.useForm();
  useEffect(() => { if (open) form.setFieldsValue(initial ? { ...initial, member_ids: initial.members.map((member) => member.employee_id), reason: '' } : { name: '', description: '', is_active: true, member_ids: [], reason: '' }); }, [form, initial, open]);
  const submit = (values: Record<string, any>) => onSave({ team_id: initial?.team_id ?? null, name: values.name.trim(), description: values.description?.trim() ?? '', is_active: Boolean(values.is_active), member_ids: values.member_ids ?? [] }, values.reason.trim(), initial?.team_id);
  return <Drawer title={initial ? '编辑班组' : '新建班组'} open={open} width={600} onClose={onClose} destroyOnClose extra={<Typography.Text type="secondary">本机班组目录</Typography.Text>}>
    <Form form={form} layout="vertical" onFinish={submit}>
      {initial && <Form.Item label={fieldLabel('班组编号', 'teamId')}><Input value={initial.team_id} disabled /></Form.Item>}
      <Form.Item name="name" label={fieldLabel('班组名称', 'teamName')} rules={[{ required: true, whitespace: true, message: '请填写班组名称。' }]}><Input maxLength={100} /></Form.Item>
      <Form.Item name="description" label={fieldLabel('班组说明', 'teamDescription')}><Input.TextArea rows={4} maxLength={300} showCount /></Form.Item>
      <Form.Item name="member_ids" label={fieldLabel('班组成员', 'teamMembers')}>
        <Select mode="multiple" showSearch optionFilterProp="label" maxTagCount="responsive" placeholder="选择一个或多个有效员工" options={employees.map((employee) => ({
          value: employee.employee_id,
          label: `${employee.name} · ${employee.employee_id} · ${employee.position_name}${employee.team_name && employee.team_id !== initial?.team_id ? ` · 当前班组：${employee.team_name}` : ''}`,
        }))} />
      </Form.Item>
      <Typography.Paragraph type="secondary">未选择的现有成员将从本班组移除；选择其他班组的员工会将其转入本班组。每名员工只能归属一个班组。该变更仅更新本机员工档案，不修改 MIP 求解输入。</Typography.Paragraph>
      <Form.Item name="is_active" valuePropName="checked" label={fieldLabel('班组状态', 'rotationStatus')}><Checkbox>有效班组</Checkbox></Form.Item>
      <Card size="small" title="变更记录" className="rotation-form-card"><Form.Item name="reason" label={fieldLabel('操作原因', 'rotationReason')} rules={[{ required: true, whitespace: true, message: '请填写操作原因。' }]}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item></Card>
      <div className="rotation-form-footer"><Space><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit">保存班组<FieldHelp definition={helpText.rotationSave} /></Button></Space></div>
    </Form>
  </Drawer>;
}
