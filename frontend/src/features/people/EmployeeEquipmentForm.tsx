import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Drawer, Input, Select, Space, Table, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import FieldHelp from '../../components/FieldHelp';
import { api } from '../../api/client';
import { helpText } from '../../help/metadata';
import type { EmployeeEquipmentRecord, EmployeeEquipmentWrite, EmployeeProfile, EquipmentRecord } from '../rotation/types';

const fieldLabel = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;
const levelOptions = [
  { value: 1, label: '1 级 · 入门' },
  { value: 2, label: '2 级 · 需指导完成常规操作' },
  { value: 3, label: '3 级 · 可独立完成常规操作' },
  { value: 4, label: '4 级 · 熟练操作并处理常见异常' },
  { value: 5, label: '5 级 · 可指导他人' },
];

type Props = {
  open: boolean;
  employee?: EmployeeProfile;
  onClose: () => void;
  onSave: (data: EmployeeEquipmentWrite[], reason: string, id: string) => Promise<void>;
};

type MappingRow = EquipmentRecord & { ability_level: number; mapping_valid: boolean };

export default function EmployeeEquipmentForm({ open, employee, onClose, onSave }: Props) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadedScopeKey, setLoadedScopeKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [equipment, setEquipment] = useState<EquipmentRecord[]>([]);
  const [mappings, setMappings] = useState<EmployeeEquipmentWrite[]>([]);
  const [query, setQuery] = useState('');
  const [lineFilter, setLineFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [newEquipmentId, setNewEquipmentId] = useState('');
  const [reason, setReason] = useState('');
  const employeeScopeKey = employee ? `${employee.employee_id}:${[...employee.line_ids].sort().join(',')}` : '';

  useEffect(() => {
    if (!open || !employee) return;
    let active = true;
    const employeeId = employee.employee_id;
    const scopeKey = employeeScopeKey;
    const lineIds = [...employee.line_ids];
    setLoading(true);
    setLoadError(false);
    setLoadedScopeKey('');
    setEquipment([]);
    setMappings([]);
    setQuery(''); setLineFilter(''); setCategoryFilter(''); setNewEquipmentId(''); setReason('');
    Promise.all([
      api.employeeEquipment(employeeId),
      ...lineIds.map((lineId) => api.equipment({ line_id: lineId, page: 1, page_size: 200 })),
    ]).then(([relations, ...catalogues]) => {
      if (!active) return;
      const unique = new Map<string, EquipmentRecord>();
      catalogues.forEach((page) => page.items.forEach((item) => unique.set(item.equipment_id, item)));
      // Include existing relationships even when the employee's qualification has since changed.
      // They must remain visible so the planner can remove them explicitly and audit the change.
      relations.items.forEach((item: EmployeeEquipmentRecord) => {
        if (!unique.has(item.equipment_id)) unique.set(item.equipment_id, item);
      });
      setEquipment([...unique.values()].sort((a, b) => a.line_name.localeCompare(b.line_name, 'zh-CN') || a.equipment_name.localeCompare(b.equipment_name, 'zh-CN')));
      setMappings(relations.items.map((item: EmployeeEquipmentRecord) => ({ equipment_id: item.equipment_id, ability_level: item.ability_level })));
      setLoadedScopeKey(scopeKey);
    }).catch((error) => {
      if (active) {
        setEquipment([]);
        setMappings([]);
        setLoadError(true);
        message.error((error as Error).message);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, employee, employeeScopeKey, reloadToken]);

  const categories = useMemo(() => [...new Set(equipment.map((item) => item.equipment_category).filter(Boolean))].sort(), [equipment]);
  const filteredEquipment = useMemo(() => equipment.filter((item) => {
    const text = query.trim().toLocaleLowerCase();
    return (!text || `${item.equipment_name} ${item.equipment_code}`.toLocaleLowerCase().includes(text))
      && (!lineFilter || item.line_id === lineFilter)
      && (!categoryFilter || item.equipment_category === categoryFilter);
  }), [equipment, query, lineFilter, categoryFilter]);
  const selectedIds = useMemo(() => new Set(mappings.map((item) => item.equipment_id)), [mappings]);
  const mappingRows = useMemo(() => mappings.flatMap((mapping) => {
    const record = equipment.find((item) => item.equipment_id === mapping.equipment_id);
    if (!record) return [];
    return [{
      ...record,
      ability_level: mapping.ability_level,
      mapping_valid: record.is_active && Boolean(employee?.line_ids.includes(record.line_id)),
    }];
  }), [equipment, mappings, employee]);
  const invalidMappingCount = mappingRows.filter((item) => !item.mapping_valid).length;
  const addOptions = filteredEquipment.filter((item) => item.is_active && Boolean(employee?.line_ids.includes(item.line_id)) && !selectedIds.has(item.equipment_id)).map((item) => ({
    value: item.equipment_id,
    label: `${item.equipment_name} · ${item.line_name} · ${item.equipment_code}`,
  }));
  const readOnly = Boolean(employee?.is_archived);
  const currentDataReady = Boolean(employeeScopeKey && loadedScopeKey === employeeScopeKey && !loading && !loadError);
  const currentDataEditable = currentDataReady && !saving;

  const addEquipment = () => {
    if (!currentDataEditable || !newEquipmentId) return;
    setMappings((current) => [...current, { equipment_id: newEquipmentId, ability_level: 3 }]);
    setNewEquipmentId('');
  };
  const submit = async () => {
    if (!employee || readOnly || !currentDataEditable || invalidMappingCount > 0) return;
    if (!reason.trim()) { message.warning('请填写设备关系变更原因。'); return; }
    setSaving(true);
    try { await onSave(mappings, reason.trim(), employee.employee_id); }
    finally { setSaving(false); }
  };

  const columns = [
    { title: fieldLabel('设备', 'equipmentCode'), key: 'equipment', width: 310, render: (_: unknown, row: EquipmentRecord) => <Space direction="vertical" size={0}><Typography.Text>{row.equipment_name}</Typography.Text><Typography.Text type="secondary">{row.equipment_code}</Typography.Text></Space> },
    { title: fieldLabel('适用产线', 'equipmentLine'), key: 'line_name', width: 180, render: (_: unknown, row: MappingRow) => <Space direction="vertical" size={0}><Typography.Text>{row.line_name}</Typography.Text>{!row.mapping_valid && <Typography.Text type="danger">{row.is_active ? '员工产线资格已失效' : '设备已停用'}</Typography.Text>}</Space> },
    { title: fieldLabel('设备类别', 'equipmentCategory'), dataIndex: 'equipment_category', key: 'equipment_category', width: 130 },
    { title: fieldLabel('能力等级', 'equipmentAbilityLevel'), key: 'ability_level', width: 280, render: (_: unknown, row: MappingRow) => <Select aria-label={`设置${row.equipment_name}能力等级`} value={row.ability_level} disabled={!currentDataEditable || readOnly || !row.mapping_valid} options={levelOptions} onChange={(value) => setMappings((current) => current.map((item) => item.equipment_id === row.equipment_id ? { ...item, ability_level: value } : item))} style={{ width: '100%' }} /> },
    { title: fieldLabel('操作', 'equipmentRemove'), key: 'actions', width: 95, render: (_: unknown, row: MappingRow) => <Button type="link" danger disabled={!currentDataEditable || readOnly} onClick={() => setMappings((current) => current.filter((item) => item.equipment_id !== row.equipment_id))}>移除<FieldHelp definition={helpText.equipmentRemove} /></Button> },
  ];

  return <Drawer
    title={employee ? `${readOnly ? '查看' : '配置'}设备能力 · ${employee.name}` : '配置设备能力'}
    open={open}
    width={900}
    closable={!saving}
    maskClosable={!saving}
    keyboard={!saving}
    onClose={saving ? () => undefined : onClose}
    destroyOnClose
    extra={<Typography.Text type="secondary">本机人员资料</Typography.Text>}
  >
    {employee && <>
      <Alert
        showIcon
        type={readOnly ? 'warning' : 'info'}
        message={readOnly ? '员工已归档，设备关系仅供查看。' : '能力等级为本机资料分级。'}
        description="1 级为入门，2 级为需指导完成常规操作，3 级为可独立完成常规操作，4 级为熟练操作并处理常见异常，5 级为可指导他人。该等级不构成证书、现场能力核验或 MIP 求解输入。"
      />
      {loadError && <Alert showIcon type="error" className="section-card" message="员工设备关系或设备目录加载失败；当前资料不完整，已停用保存。" action={<Button size="small" icon={<ReloadOutlined />} onClick={() => setReloadToken((current) => current + 1)}>重试加载</Button>} />}
      <Card size="small" title="人员与适用范围" className="section-card">
        <Space wrap>
          <Typography.Text strong>{employee.name}</Typography.Text>
          <Typography.Text type="secondary">工号：{employee.employee_id}</Typography.Text>
          <Typography.Text type="secondary">岗位：{employee.position_name}</Typography.Text>
          <Typography.Text type="secondary">适用产线：{employee.line_ids.length ? employee.line_ids.join('、') : '未登记'}</Typography.Text>
        </Space>
      </Card>
      <Card size="small" title="设备目录筛选" className="section-card" extra={<Button icon={<ReloadOutlined />} onClick={() => setQuery('')}>清除筛选<FieldHelp definition={helpText.equipmentFilter} /></Button>}>
        <Space wrap>
          <span>{fieldLabel('设备名称或编码', 'equipmentFilter')}</span>
          <Input allowClear value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入设备名称或编码" style={{ width: 240 }} />
          <span>{fieldLabel('适用产线', 'equipmentLine')}</span>
          <Select allowClear value={lineFilter || undefined} onChange={(value) => setLineFilter(value ?? '')} placeholder="全部适用产线" options={[...new Map(equipment.map((item) => [item.line_id, { value: item.line_id, label: item.line_name }])).values()]} style={{ width: 180 }} />
          <span>{fieldLabel('设备类别', 'equipmentCategory')}</span>
          <Select allowClear value={categoryFilter || undefined} onChange={(value) => setCategoryFilter(value ?? '')} placeholder="全部类别" options={categories.map((value) => ({ value, label: value }))} style={{ width: 160 }} />
        </Space>
      </Card>
      <Card size="small" title={fieldLabel('已匹配设备', 'employeeEquipment')} className="section-card" extra={<Typography.Text type="secondary">当前 {mappings.length} 项</Typography.Text>}>
        {!readOnly && currentDataReady && <Space direction="vertical" size={6} style={{ display: 'flex', marginBottom: 16 }}>
          <span>{fieldLabel('新增设备', 'equipmentAdd')}</span>
          <Space.Compact style={{ display: 'flex' }}>
          <Select
            showSearch
            optionFilterProp="label"
            value={newEquipmentId || undefined}
            onChange={setNewEquipmentId}
            disabled={!currentDataEditable}
            options={addOptions}
            placeholder="选择设备后添加"
            notFoundContent="没有可添加的设备；检查筛选条件和员工适用产线。"
            style={{ flex: 1 }}
          />
          <Button type="primary" icon={<PlusOutlined />} disabled={!currentDataEditable || !newEquipmentId} onClick={addEquipment}>添加设备<FieldHelp definition={helpText.equipmentAdd} /></Button>
          </Space.Compact>
        </Space>}
        {currentDataReady && invalidMappingCount > 0 && <Alert showIcon type="warning" className="section-card" message={`检测到 ${invalidMappingCount} 项失效设备关系；保存前请逐项移除。系统不会自动删除既有关系。`} description="失效条件包括员工已不具备该设备所属产线的有效资格，或设备目录记录已停用。失效关系可查看并移除，不可继续调整能力等级。" />}
        {currentDataReady && employee.line_ids.length === 0 && invalidMappingCount === 0 && <Alert showIcon type="warning" message="该员工没有有效产线资格，不能新增设备关系。" />}
        <Table rowKey="equipment_id" size="small" loading={loading || (!currentDataReady && !loadError)} dataSource={mappingRows} columns={columns as any} pagination={false} scroll={{ x: 820 }} locale={{ emptyText: loadError ? '请重试加载设备资料。' : '尚未配置设备能力关系。' }} />
      </Card>
      {!readOnly && <Card size="small" title="变更记录" className="section-card">
        <Typography.Paragraph type="secondary">提交时以单个数据库事务替换当前员工的完整设备清单。服务端会校验员工产线资格、设备适用范围和能力等级，并记录本机审计信息。</Typography.Paragraph>
        <Input.TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={300} showCount placeholder="说明新增、调整或移除设备关系的原因" aria-label="设备关系变更原因" disabled={!currentDataEditable} />
        <div className="rotation-form-footer"><Space><Button disabled={saving} onClick={onClose}>取消<FieldHelp definition={helpText.rotationCancel} /></Button><Button type="primary" loading={saving} disabled={!currentDataReady || invalidMappingCount > 0} onClick={() => void submit()}>保存设备关系<FieldHelp definition={helpText.equipmentConfigure} /></Button></Space></div>
      </Card>}
    </>}
  </Drawer>;
}
