import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import PageHeader from '../../components/PageHeader';
import FieldHelp from '../../components/FieldHelp';
import DataSourceTag from '../../components/DataSourceTag';
import { api } from '../../api/client';
import { helpText } from '../../help/metadata';
import type { LineRecord, RotationObjectType, ScheduleConfigDraft, ScheduleConfigRecord, TeamRecord, EmployeeProfile, FieldValidationError } from './types';
import ConfigurationForm from './ConfigurationForm';

const label = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;
type Action = { type: 'activate' | 'deactivate' | 'copy'; record: ScheduleConfigRecord } | null;

export default function RotationConfigPage() {
  const [configs, setConfigs] = useState<ScheduleConfigRecord[]>([]);
  const [lines, setLines] = useState<LineRecord[]>([]);
  const [targetOptions, setTargetOptions] = useState<Array<{ value: string; label: string; objectType: RotationObjectType }>>([]);
  const [filters, setFilters] = useState({ name: '', line_id: '', is_active: '' });
  const [submittedFilters, setSubmittedFilters] = useState({ name: '', line_id: '', is_active: '' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleConfigRecord>();
  const [detail, setDetail] = useState<ScheduleConfigRecord>();
  const [action, setAction] = useState<Action>(null);
  const [actionForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configResult, lineResult] = await Promise.all([
        api.rotationConfigurations({ name: submittedFilters.name || undefined, line_id: submittedFilters.line_id || undefined, is_active: submittedFilters.is_active === '' ? undefined : submittedFilters.is_active === 'true', page: 1, page_size: 200 }),
        api.rotationLines(),
      ]);
      setConfigs(configResult.items ?? []);
      setLines(lineResult.items ?? []);
    } catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  }, [submittedFilters]);
  useEffect(() => { void load(); }, [load]);
  const loadTargets = async () => {
    try {
      const [teams, employees] = await Promise.all([api.teams({ is_active: true, page_size: 200 }), api.employees({ is_archived: false, page_size: 200 })]);
      setTargetOptions([
        ...(teams.items ?? []).map((item: TeamRecord) => ({ value: item.team_id, label: `班组 · ${item.name}（${item.team_id}）`, objectType: 'team' as const })),
        ...(employees.items ?? []).map((item: EmployeeProfile) => ({ value: item.employee_id, label: `员工 · ${item.name}（${item.employee_id}）`, objectType: 'employee' as const })),
      ]);
    } catch (error) { message.error(`读取轮转对象失败：${(error as Error).message}`); }
  };
  const openForm = (record?: ScheduleConfigRecord) => { setEditing(record); setFormOpen(true); void loadTargets(); };
  const save = async (draft: ScheduleConfigDraft, reason: string): Promise<FieldValidationError[]> => {
    setBusy(true);
    try {
      const validation = await api.validateRotationConfiguration(draft);
      if (!validation.valid) return validation.field_errors;
      await api.saveRotationConfiguration(draft, reason, editing?.config_id);
      message.success(editing ? '轮班配置已更新。' : '轮班配置已创建。');
      setFormOpen(false); setEditing(undefined); await load();
      return [];
    } finally { setBusy(false); }
  };
  const runAction = async () => {
    if (!action) return;
    setBusy(true);
    try {
      const values = await actionForm.validateFields();
      if (action.type === 'activate') await api.activateRotationConfiguration(action.record.config_id, values.reason);
      else if (action.type === 'deactivate') await api.deactivateRotationConfiguration(action.record.config_id, values.reason);
      else await api.copyRotationConfiguration(action.record.config_id, values.name, values.start_date, values.end_date || null, values.reason);
      message.success(action.type === 'copy' ? '配置副本已创建，默认停用。' : action.type === 'activate' ? '配置已启用。' : '配置已停用。');
      setAction(null); actionForm.resetFields(); await load();
    } catch (error) {
      if (!(error as { errorFields?: unknown[] }).errorFields) message.error((error as Error).message);
    }
    finally { setBusy(false); }
  };
  const columns = useMemo(() => [
    { title: label('配置名称', 'rotationConfigName'), dataIndex: 'name', key: 'name', width: 190, ellipsis: true },
    { title: label('产线', 'rotationLine'), dataIndex: 'line_name', key: 'line_name', width: 130 },
    { title: label('对象类型', 'rotationObjectType'), dataIndex: 'object_type', key: 'object_type', width: 95, render: (value: string) => value === 'team' ? '班组' : '员工' },
    { title: label('有效期', 'rotationStartDate'), key: 'date', width: 190, render: (_: unknown, row: ScheduleConfigRecord) => `${row.start_date} 至 ${row.end_date ?? '未设结束日期'}` },
    { title: label('周期长度', 'rotationCycleLength'), dataIndex: 'cycle_length', key: 'cycle_length', width: 105, render: (value: number) => `${value} d` },
    { title: label('轮转对象数', 'rotationTargets'), key: 'targets', width: 105, render: (_: unknown, row: ScheduleConfigRecord) => row.targets.length },
    { title: label('状态', 'rotationStatus'), key: 'status', width: 95, render: (_: unknown, row: ScheduleConfigRecord) => <Tag color={row.is_active ? 'green' : 'default'}>{row.is_active ? '已启用' : '已停用'}</Tag> },
    { title: '来源', dataIndex: 'source_type', key: 'source_type', width: 115, render: (value: string) => <DataSourceTag sourceType={value} /> },
    { title: label('更新时间', 'rotationUpdatedAt'), dataIndex: 'updated_at', key: 'updated_at', width: 185, render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
    { title: <>{label('操作', 'rotationSave')}</>, key: 'action', fixed: 'right' as const, width: 285, render: (_: unknown, row: ScheduleConfigRecord) => <Space wrap size={4}>
      <Button type="link" size="small" onClick={() => setDetail(row)}>查看<FieldHelp definition={helpText.rotationSave} /></Button>
      <Button type="link" size="small" onClick={() => openForm(row)}>编辑<FieldHelp definition={helpText.rotationSave} /></Button>
      <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => { setAction({ type: 'copy', record: row }); actionForm.resetFields(); actionForm.setFieldsValue({ name: `${row.name}（副本）`, start_date: row.start_date }); }}>复制<FieldHelp definition={helpText.rotationSave} /></Button>
      {row.is_active ? <Button type="link" danger size="small" onClick={() => { setAction({ type: 'deactivate', record: row }); actionForm.resetFields(); }}>停用<FieldHelp definition={helpText.rotationArchive} /></Button> : <Button type="link" size="small" onClick={() => { setAction({ type: 'activate', record: row }); actionForm.resetFields(); }}>启用<FieldHelp definition={helpText.rotationSave} /></Button>}
    </Space> },
  ], [actionForm]);

  return <>
    <PageHeader title="排班配置" description="维护本机班组或员工的轮班周期、班次定义、生效日期及周期偏移。保存配置不会修改 MIP 求解输入；启用前由服务校验产线资格和有效日期冲突。" extra={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新<FieldHelp definition={helpText.rotationFilter} /></Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>新建配置<FieldHelp definition={helpText.rotationSave} /></Button></Space>} />
    <Alert showIcon type="info" message="独立本机配置" description="轮转日历按此处启用的配置即时生成，不代表已完成生产排班，也不会写入 MIP 求解模型。演示记录带有明确来源标签。" />
    <Card className="section-card filter-card" title="查询条件">
      <div className="filter-grid">
        <Form.Item label={label('配置名称', 'rotationFilter')}><Input value={filters.name} onChange={(event) => setFilters((state) => ({ ...state, name: event.target.value }))} onPressEnter={() => setSubmittedFilters(filters)} allowClear placeholder="按名称查找" maxLength={100} /></Form.Item>
        <Form.Item label={label('产线', 'rotationCalendarLine')}><Select value={filters.line_id || undefined} onChange={(value) => setFilters((state) => ({ ...state, line_id: value ?? '' }))} allowClear placeholder="全部产线" options={lines.map((item) => ({ value: item.line_id, label: item.display_name }))} /></Form.Item>
        <Form.Item label={label('配置状态', 'rotationStatus')}><Select value={filters.is_active || undefined} onChange={(value) => setFilters((state) => ({ ...state, is_active: value ?? '' }))} allowClear placeholder="全部状态" options={[{ value: 'true', label: '已启用' }, { value: 'false', label: '已停用' }]} /></Form.Item>
        <div className="rotation-filter-action"><Button type="primary" onClick={() => setSubmittedFilters(filters)}>查询<FieldHelp definition={helpText.rotationFilter} /></Button><Button onClick={() => { const cleared = { name: '', line_id: '', is_active: '' }; setFilters(cleared); setSubmittedFilters(cleared); }}>重置<FieldHelp definition={helpText.rotationFilter} /></Button></div>
      </div>
    </Card>
    <Card className="section-card" title="轮班配置目录" extra={<Typography.Text type="secondary">共 {configs.length} 条当前页记录</Typography.Text>}>
      <Table rowKey="config_id" size="middle" loading={loading} dataSource={configs} columns={columns as any} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: 1450 }} locale={{ emptyText: '当前筛选条件下没有配置记录。' }} />
    </Card>
    <ConfigurationForm open={formOpen} initial={editing} lines={lines} targetOptions={targetOptions} busy={busy} onClose={() => { setFormOpen(false); setEditing(undefined); }} onSubmit={save} />
    <Drawer title="轮班配置详情" width={720} open={Boolean(detail)} onClose={() => setDetail(undefined)}>
      {detail && <>
        <Descriptions bordered size="small" column={2} items={[
          { key: 'name', label: '配置名称', children: detail.name }, { key: 'line', label: '适用产线', children: `${detail.line_name}（${detail.line_id}）` },
          { key: 'type', label: '轮转对象类型', children: detail.object_type === 'team' ? '班组' : '员工' }, { key: 'length', label: '周期长度', children: `${detail.cycle_length} d` },
          { key: 'range', label: label('有效期', 'rotationStartDate'), span: 2, children: `${detail.start_date} 至 ${detail.end_date ?? '未设结束日期'}` }, { key: 'status', label: label('状态', 'rotationStatus'), children: detail.is_active ? '已启用' : '已停用' },
          { key: 'source', label: label('数据来源', 'rotationRecordSource'), children: <DataSourceTag sourceType={detail.source_type} /> },
        ]} />
        <Card size="small" className="section-card" title="班次定义"><Table rowKey="shift_code" size="small" pagination={false} dataSource={detail.shifts} columns={[{ title: label('班次编码', 'rotationShiftCode'), dataIndex: 'shift_code' }, { title: label('名称', 'rotationShiftName'), dataIndex: 'name' }, { title: label('开始时间', 'rotationShiftStart'), dataIndex: 'start_time' }, { title: label('结束时间', 'rotationShiftEnd'), dataIndex: 'end_time' }]} /></Card>
        <Card size="small" className="section-card" title="周期明细"><Table rowKey="cycle_day" size="small" pagination={false} dataSource={detail.cycle_days} columns={[{ title: '周期日', dataIndex: 'cycle_day' }, { title: '班次或状态', render: (_: unknown, row: ScheduleConfigRecord['cycle_days'][number]) => row.is_rest ? '休息' : detail.shifts.find((shift) => shift.shift_code === row.shift_code)?.name ?? row.shift_code }]} /></Card>
        <Card size="small" className="section-card" title="轮转对象"><Table rowKey="object_id" size="small" pagination={false} dataSource={detail.targets} columns={[{ title: '类型', render: (_: unknown, row: ScheduleConfigRecord['targets'][number]) => row.object_type === 'team' ? '班组' : '员工' }, { title: '对象编号', dataIndex: 'object_id' }, { title: '偏移', dataIndex: 'offset_days', render: (value: number) => `${value} d` }, { title: '状态', render: (_: unknown, row: ScheduleConfigRecord['targets'][number]) => row.is_active ? '有效' : '停用' }]} /></Card>
      </>}
    </Drawer>
    <Modal title={action?.type === 'copy' ? '复制轮班配置' : action?.type === 'activate' ? '启用轮班配置' : '停用轮班配置'} open={Boolean(action)} onCancel={() => setAction(null)} onOk={() => void runAction()} confirmLoading={busy} okText={action?.type === 'deactivate' ? '确认停用' : action?.type === 'activate' ? '确认启用' : '创建副本'}>
      <Form form={actionForm} layout="vertical">
        {action?.type === 'copy' && <>
          <Form.Item name="name" label={label('副本名称', 'rotationConfigName')} rules={[{ required: true, whitespace: true, message: '请填写副本名称。' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item name="start_date" label={label('生效日期', 'rotationStartDate')} rules={[{ required: true }]}><Input type="date" /></Form.Item>
          <Form.Item name="end_date" label={label('失效日期', 'rotationEndDate')}><Input type="date" /></Form.Item>
          <Alert type="info" showIcon message="副本初始状态为停用" description="复制将沿用班次周期与对象偏移。请在启用前核对适用日期、产线资格及冲突情况。" />
        </>}
        <Form.Item name="reason" className="top-space" label={label('操作原因', 'rotationReason')} rules={[{ required: true, whitespace: true, message: '请填写操作原因。' }]}><Input.TextArea rows={3} maxLength={300} showCount /></Form.Item>
      </Form>
    </Modal>
  </>;
}
