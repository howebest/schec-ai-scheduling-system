import { useEffect } from 'react';
import { Button, Card, Checkbox, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Typography } from 'antd';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import type { EmployeeProfile, EmployeeSkill, EmployeeWrite, PositionRecord, TeamRecord } from '../rotation/types';

const fieldLabel = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;
type Props = { open: boolean; initial?: EmployeeProfile; teams: TeamRecord[]; positions: PositionRecord[]; onClose: () => void; onSave: (data: EmployeeWrite, reason: string, id?: string) => Promise<void> };

export default function EmployeeForm({ open, initial, teams, positions, onClose, onSave }: Props) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (open) form.setFieldsValue(initial ? { ...initial, reason: '', skills: initial.skills.map((skill) => ({ ...skill })) } : {
      employee_id: '', name: '', position_id: undefined, team_id: null, collaboration_score: null, is_archived: false, reason: '',
      skills: [{ skill_code: '', skill_name: '', skill_score: null, is_active: true }],
    });
  }, [form, initial, open]);
  const submit = async (values: Record<string, any>) => {
    const skills: EmployeeSkill[] = (values.skills ?? []).map((skill: any) => ({
      skill_code: skill.skill_code?.trim() ?? '', skill_name: skill.skill_name?.trim() ?? '',
      skill_score: skill.skill_score === '' || skill.skill_score === undefined ? null : skill.skill_score,
      is_active: skill.is_active !== false,
    }));
    const data: EmployeeWrite = { employee_id: values.employee_id.trim(), name: values.name.trim(), position_id: values.position_id, team_id: values.team_id || null, skills, collaboration_score: values.collaboration_score ?? null, is_archived: Boolean(values.is_archived) };
    await onSave(data, values.reason.trim(), initial?.employee_id);
  };
  return <Drawer title={initial ? '编辑员工档案' : '新增员工档案'} open={open} width={700} onClose={onClose} destroyOnClose extra={<Typography.Text type="secondary">本机档案维护</Typography.Text>}>
    <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
      <Card size="small" title="员工信息" className="rotation-form-card"><Row gutter={16}>
        <Col xs={24} sm={12}><Form.Item name="employee_id" label={fieldLabel('员工编号', 'employeeId')} rules={[{ required: true, whitespace: true, message: '请填写员工编号。' }]}><Input maxLength={80} disabled={Boolean(initial)} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="name" label={fieldLabel('姓名', 'employeeName')} rules={[{ required: true, whitespace: true, message: '请填写员工姓名。' }]}><Input maxLength={80} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="position_id" label={fieldLabel('主要岗位', 'employeePosition')} rules={[{ required: true, message: '请选择主要岗位。' }]}><Select showSearch optionFilterProp="label" options={positions.filter((item) => item.is_active).map((item) => ({ value: item.position_id, label: `${item.display_name}（${item.position_id}）` }))} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="team_id" label={fieldLabel('所属班组', 'employeeTeam')}><Select allowClear showSearch optionFilterProp="label" options={teams.filter((item) => item.is_active).map((item) => ({ value: item.team_id, label: item.name }))} /></Form.Item></Col>
        <Col xs={24} sm={12}><Form.Item name="collaboration_score" label={fieldLabel('协作评分', 'employeeCollaboration')}><InputNumber min={0} max={100} precision={1} className="full-width" addonAfter="分" /></Form.Item></Col>
        {initial && <Col xs={24} sm={12}><Form.Item name="is_archived" valuePropName="checked" label={fieldLabel('档案状态', 'rotationArchive')}><Checkbox>归档该员工</Checkbox></Form.Item></Col>}
      </Row></Card>
      <Card size="small" title={fieldLabel('技能项目', 'employeeSkills')} className="rotation-form-card">
        <Typography.Paragraph type="secondary">技能评分为有效技能中有评分项目的算术平均值；综合评分仅在技能评分和协作评分均存在时计算。缺失值不按 0 分处理。</Typography.Paragraph>
        <Form.List name="skills">{(fields, { add, remove }) => <>
          {fields.map((field, index) => <div className="rotation-repeat-row" key={field.key}><Row gutter={12} align="middle">
            <Col xs={24} sm={7}><Form.Item name={[field.name, 'skill_code']} label={index === 0 ? fieldLabel('技能编码', 'employeeSkillCode') : undefined} rules={[{ required: true, message: '请填写技能编码。' }]}><Input maxLength={60} /></Form.Item></Col>
            <Col xs={24} sm={7}><Form.Item name={[field.name, 'skill_name']} label={index === 0 ? fieldLabel('技能名称', 'employeeSkillName') : undefined} rules={[{ required: true, message: '请填写技能名称。' }]}><Input maxLength={80} /></Form.Item></Col>
            <Col xs={18} sm={6}><Form.Item name={[field.name, 'skill_score']} label={index === 0 ? fieldLabel('评分', 'employeeSkills') : undefined}><InputNumber min={0} max={100} precision={1} className="full-width" addonAfter="分" /></Form.Item></Col>
            <Col xs={6} sm={2}><Form.Item name={[field.name, 'is_active']} valuePropName="checked" label={index === 0 ? fieldLabel('有效', 'employeeSkillActive') : undefined}><Checkbox aria-label="技能有效" /></Form.Item></Col>
            <Col xs={24} sm={2}><Button type="link" danger onClick={() => remove(field.name)}>移除<FieldHelp definition={helpText.rotationRemoveItem} /></Button></Col>
          </Row></div>)}
          <Button onClick={() => add({ skill_code: '', skill_name: '', skill_score: null, is_active: true })}>新增技能<FieldHelp definition={helpText.employeeSkills} /></Button>
        </>}</Form.List>
      </Card>
      <Card size="small" title="变更记录" className="rotation-form-card"><Form.Item name="reason" label={fieldLabel('操作原因', 'rotationReason')} rules={[{ required: true, whitespace: true, message: '请填写操作原因。' }]}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item></Card>
      <div className="rotation-form-footer"><Space><Button onClick={onClose}>取消</Button><Button type="primary" htmlType="submit">保存员工档案<FieldHelp definition={helpText.rotationSave} /></Button></Space></div>
    </Form>
  </Drawer>;
}
