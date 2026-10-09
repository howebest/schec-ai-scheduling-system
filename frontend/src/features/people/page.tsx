import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import FieldHelp from '../../components/FieldHelp';
import DataSourceTag from '../../components/DataSourceTag';
import { api } from '../../api/client';
import { helpText } from '../../help/metadata';
import type { EmployeeEquipmentWrite, EmployeeProfile, EmployeeWrite, EquipmentRecord, LineRecord, PositionRecord, QualificationRecord, QualificationWrite, TeamMemberSummary, TeamRecord, TeamWrite } from '../rotation/types';
import EmployeeForm from './EmployeeForm';
import TeamForm from './TeamForm';
import QualificationForm from './QualificationForm';
import EmployeeEquipmentForm from './EmployeeEquipmentForm';
import { parseScheduleData } from '../data-analysis/metrics.js';
import type { PageProps } from '../types';

const helpLabel = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;
type EditorState<T> = { open: boolean; record?: T };
const emptyEditor = { open: false };
const scoreLabel = (value: number | null | undefined) => value === null || value === undefined ? '无可计算值' : `${value.toFixed(1)} 分`;

export default function PeoplePage({ datasets }: PageProps) {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [teamEmployees, setTeamEmployees] = useState<EmployeeProfile[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [qualifications, setQualifications] = useState<QualificationRecord[]>([]);
  const [lines, setLines] = useState<LineRecord[]>([]);
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [equipmentCatalog, setEquipmentCatalog] = useState<EquipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [employeeLine, setEmployeeLine] = useState('');
  const [employeePosition, setEmployeePosition] = useState('');
  const [employeeTeam, setEmployeeTeam] = useState('');
  const [employeeEquipmentId, setEmployeeEquipmentId] = useState('');
  const [appliedEmployeeFilters, setAppliedEmployeeFilters] = useState({ query: '', line_id: '', position_id: '', team_id: '', equipment_id: '', include_archived: false });
  const [qualLine, setQualLine] = useState('');
  const [qualPosition, setQualPosition] = useState('');
  const [qualObjectType, setQualObjectType] = useState('');
  const [activeTab, setActiveTab] = useState('employees');
  const [employeeEditor, setEmployeeEditor] = useState<EditorState<EmployeeProfile>>(emptyEditor);
  const [equipmentEditor, setEquipmentEditor] = useState<EditorState<EmployeeProfile>>(emptyEditor);
  const [teamEditor, setTeamEditor] = useState<EditorState<TeamRecord>>(emptyEditor);
  const [qualificationEditor, setQualificationEditor] = useState<EditorState<QualificationRecord>>(emptyEditor);
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState('');
  const [scheduleRows, setScheduleRows] = useState<Array<Record<string, any>>>([]);
  const [lookupBusy, setLookupBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [employeePage, teamPage, qualificationPage, lineResult, positionResult, equipmentPage, teamEmployeePage] = await Promise.all([
        api.employees({ query: appliedEmployeeFilters.query || undefined, line_id: appliedEmployeeFilters.line_id || undefined, position_id: appliedEmployeeFilters.position_id || undefined, team_id: appliedEmployeeFilters.team_id || undefined, equipment_id: appliedEmployeeFilters.equipment_id || undefined, is_archived: appliedEmployeeFilters.include_archived ? undefined : false, page: 1, page_size: 200 }),
        api.teams({ page: 1, page_size: 200 }),
        api.qualifications({ line_id: qualLine || undefined, position_id: qualPosition || undefined, object_type: qualObjectType ? qualObjectType as 'team' | 'employee' : undefined, page: 1, page_size: 200 }),
        api.rotationLines(), api.rotationPositions(), api.equipment({ page: 1, page_size: 200 }),
        api.employees({ is_archived: false, page: 1, page_size: 200 }),
      ]);
      setEmployees(employeePage.items); setTeams(teamPage.items); setQualifications(qualificationPage.items);
      setTeamEmployees(teamEmployeePage.items);
      setLines(lineResult.items); setPositions(positionResult.items); setEquipmentCatalog(equipmentPage.items);
    } catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  }, [appliedEmployeeFilters, qualLine, qualObjectType, qualPosition]);
  useEffect(() => { void load(); }, [load]);

  const saveEmployee = async (data: EmployeeWrite, reason: string, id?: string) => {
    try { await api.saveEmployee(data, reason, id); message.success(id ? '员工档案已更新。' : '员工档案已创建。'); setEmployeeEditor(emptyEditor); await load(); }
    catch (error) { message.error((error as Error).message); }
  };
  const saveTeam = async (data: TeamWrite, reason: string, id?: string) => {
    try { await api.saveTeam(data, reason, id); message.success(id ? '班组档案已更新。' : '班组档案已创建。'); setTeamEditor(emptyEditor); await load(); }
    catch (error) { message.error((error as Error).message); }
  };
  const saveQualification = async (data: QualificationWrite, reason: string, id?: string) => {
    try { await api.saveQualification(data, reason, id); message.success(id ? '岗位产线资格关系已更新。' : '岗位产线资格关系已创建。'); setQualificationEditor(emptyEditor); await load(); }
    catch (error) { message.error((error as Error).message); }
  };
  const saveEquipment = async (data: EmployeeEquipmentWrite[], reason: string, id: string) => {
    try { await api.saveEmployeeEquipment(id, data, reason); message.success('人员设备关系已更新。'); setEquipmentEditor(emptyEditor); await load(); }
    catch (error) { message.error((error as Error).message); }
  };
  const lookupSchedule = async () => {
    const id = scheduleEmployeeId.trim();
    if (!id) { message.warning('请选择员工姓名。'); return; }
    setLookupBusy(true);
    try {
      const archive = await api.archive({ employee_id: id, limit: 500 });
      const rowsBySchedule = await Promise.all(archive.items.map(async ({ schedule }) => {
        const csv = await api.scheduleArtifactCsv(schedule.sha256);
        return parseScheduleData(csv).assignments
          .filter((assignment) => assignment.employeeId === id)
          .map((assignment) => ({
          schedule_id: schedule.schedule_id,
          dataset_id: schedule.dataset_id,
          version: schedule.version,
            date: assignment.date,
            shift: assignment.shift,
            factory_code: assignment.factoryCode,
            line_code: assignment.lineCode,
            position_name: assignment.positionName,
            paid_hours: assignment.paidHours,
            source_type: schedule.source_type,
          }));
      }));
      const rows = rowsBySchedule.flat();
      setScheduleRows(rows);
      if (!rows.length) {
        const selectedEmployee = teamEmployees.find((employee) => employee.employee_id === id);
        message.info(selectedEmployee
          ? `${selectedEmployee.name}（${selectedEmployee.employee_id}）在已登记排班档案中没有匹配记录。`
          : '未找到所选员工档案。请刷新人员数据后重试。');
      }
    } catch (error) { message.error((error as Error).message); setScheduleRows([]); }
    finally { setLookupBusy(false); }
  };
  const applyEmployeeFilters = () => setAppliedEmployeeFilters({ query: employeeQuery, line_id: employeeLine, position_id: employeePosition, team_id: employeeTeam, equipment_id: employeeEquipmentId, include_archived: showArchived });

  const employeeColumns = [
    { title: helpLabel('姓名', 'employeeName'), dataIndex: 'name', key: 'name', width: 105 },
    { title: helpLabel('员工编号', 'employeeId'), dataIndex: 'employee_id', key: 'employee_id', width: 145 },
    { title: helpLabel('主要岗位', 'employeePosition'), dataIndex: 'position_name', key: 'position_name', width: 130 },
    { title: helpLabel('适用产线', 'qualificationLine'), dataIndex: 'line_ids', key: 'line_ids', width: 155, render: (values: string[]) => values.length ? values.join('、') : '未登记' },
    { title: helpLabel('设备工作能力', 'employeeEquipment'), key: 'equipment_mappings', width: 360, render: (_: unknown, row: EmployeeProfile) => row.equipment_mappings.length ? <Space size={[4, 4]} wrap>{row.equipment_mappings.map((mapping) => <Tooltip key={mapping.equipment_id} title={`${mapping.equipment_code} · ${mapping.line_name} · ${mapping.equipment_category}`}><Tag color="green">{mapping.equipment_name} · {mapping.ability_level} 级</Tag></Tooltip>)}</Space> : <Typography.Text type="secondary">未配置</Typography.Text> },
    { title: helpLabel('通用技能项目', 'employeeSkills'), key: 'skills', width: 225, render: (_: unknown, row: EmployeeProfile) => row.skills.filter((skill) => skill.is_active).map((skill) => <Tag key={`${skill.skill_code}-${skill.skill_name}`}>{skill.skill_name}</Tag>) },
    { title: helpLabel('技能均分', 'employeeSkills'), dataIndex: 'skill_score', key: 'skill_score', width: 125, render: scoreLabel },
    { title: helpLabel('协作评分', 'employeeCollaboration'), dataIndex: 'collaboration_score', key: 'collaboration_score', width: 120, render: scoreLabel },
    { title: helpLabel('综合评分', 'employeeCompositeScore'), dataIndex: 'composite_score', key: 'composite_score', width: 120, render: scoreLabel },
    { title: helpLabel('所属班组', 'employeeTeam'), dataIndex: 'team_name', key: 'team_name', width: 150, render: (value: string | null) => value || '未分配' },
    { title: helpLabel('来源', 'rotationRecordSource'), dataIndex: 'source_type', key: 'source_type', width: 112, render: (value: string) => <DataSourceTag sourceType={value} /> },
    { title: helpLabel('操作', 'rotationSave'), key: 'actions', fixed: 'right' as const, width: 170, render: (_: unknown, row: EmployeeProfile) => <Space size={4}><Button type="link" onClick={() => setEquipmentEditor({ open: true, record: row })}>{row.is_archived ? '查看设备' : '配置设备'}<FieldHelp definition={helpText.equipmentConfigure} /></Button><Button type="link" disabled={row.is_archived} onClick={() => setEmployeeEditor({ open: true, record: row })}>编辑<FieldHelp definition={helpText.rotationSave} /></Button></Space> },
  ];
  const teamColumns = [
    { title: helpLabel('班组编号', 'teamId'), dataIndex: 'team_id', key: 'team_id', width: 190 },
    { title: helpLabel('班组名称', 'teamName'), dataIndex: 'name', key: 'name', width: 190 },
    { title: '班组分类', dataIndex: 'team_category', key: 'team_category', width: 130 },
    { title: helpLabel('说明', 'teamDescription'), dataIndex: 'description', key: 'description', ellipsis: true },
    { title: helpLabel('有效成员', 'teamMemberCount'), dataIndex: 'member_count', key: 'member_count', width: 100, render: (value: number) => `${value} 人` },
    { title: '成员姓名与岗位', dataIndex: 'members', key: 'members', width: 300, render: (members: TeamMemberSummary[] = []) => members.length ? <Space size={[4, 4]} wrap>{members.map((member) => <Tooltip key={member.employee_id} title={`${member.employee_id} · ${member.position_name}`}><Tag>{member.name}</Tag></Tooltip>)}</Space> : <Typography.Text type="secondary">暂无有效成员</Typography.Text> },
    { title: helpLabel('适用产线数', 'teamLineCount'), dataIndex: 'qualification_line_count', key: 'qualification_line_count', width: 110, render: (value: number) => `${value} 条` },
    { title: helpLabel('状态', 'rotationStatus'), dataIndex: 'is_active', key: 'is_active', width: 90, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '有效' : '停用'}</Tag> },
    { title: helpLabel('来源', 'rotationRecordSource'), dataIndex: 'source_type', key: 'source_type', width: 112, render: (value: string) => <DataSourceTag sourceType={value} /> },
    { title: '操作', key: 'actions', width: 100, fixed: 'right' as const, render: (_: unknown, row: TeamRecord) => <Button type="link" onClick={() => setTeamEditor({ open: true, record: row })}>编辑<FieldHelp definition={helpText.rotationSave} /></Button> },
  ];
  const qualificationColumns = [
    { title: helpLabel('对象类型', 'qualificationObjectType'), dataIndex: 'object_type', key: 'object_type', width: 100, render: (value: string) => value === 'team' ? '班组' : '员工' },
    { title: helpLabel('资格对象', 'qualificationObject'), dataIndex: 'object_name', key: 'object_name', width: 190 },
    { title: helpLabel('适用产线', 'qualificationLine'), dataIndex: 'line_name', key: 'line_name', width: 140 },
    { title: helpLabel('适用岗位', 'qualificationPosition'), dataIndex: 'position_name', key: 'position_name', width: 150 },
    { title: helpLabel('资格说明', 'qualificationDescription'), dataIndex: 'description', key: 'description', ellipsis: true },
    { title: helpLabel('状态', 'rotationStatus'), dataIndex: 'is_active', key: 'is_active', width: 90, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '有效' : '停用'}</Tag> },
    { title: helpLabel('来源', 'rotationRecordSource'), dataIndex: 'source_type', key: 'source_type', width: 112, render: (value: string) => <DataSourceTag sourceType={value} /> },
    { title: '操作', key: 'actions', width: 100, fixed: 'right' as const, render: (_: unknown, row: QualificationRecord) => <Button type="link" onClick={() => setQualificationEditor({ open: true, record: row })}>编辑<FieldHelp definition={helpText.rotationSave} /></Button> },
  ];
  const scheduleColumns = [
    { title: '方案版本', dataIndex: 'schedule_id', key: 'schedule_id', render: (value: string, row: Record<string, any>) => `${value} · V${row.version}` },
    { title: '数据集', dataIndex: 'dataset_id', key: 'dataset_id', width: 230, render: (value: string) => datasets.find((dataset) => dataset.id === value)?.display_name ?? value },
    { title: '排班日期', dataIndex: 'date', key: 'date' }, { title: '班次', dataIndex: 'shift', key: 'shift' },
    { title: '工厂', dataIndex: 'factory_code', key: 'factory_code' }, { title: '产线', dataIndex: 'line_code', key: 'line_code' },
    { title: '岗位', dataIndex: 'position_name', key: 'position_name' }, { title: '计薪工时', dataIndex: 'paid_hours', key: 'paid_hours', render: (value: string) => `${value} h` },
    { title: '来源', dataIndex: 'source_type', key: 'source_type', render: (value: string) => <DataSourceTag sourceType={value} /> },
  ];

  return <>
    <PageHeader title="人员与技能" description="维护本机员工档案、班组及岗位产线资格关系，并支持按员工姓名查询已登记排班档案。评分缺失时显示“无可计算值”，演示记录不代表 HR 主数据或正式资质核验。" extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新<FieldHelp definition={helpText.rotationFilter} /></Button>} />
    <Alert showIcon type="info" message="本机维护范围" description="员工技能和资格关系保存在本机管理库。档案与班组数据不自动改写 MIP 求解输入；岗位产线资格用于轮转配置的有效性校验。" />
    <Tabs className="section-card" activeKey={activeTab} onChange={setActiveTab} items={[
      { key: 'employees', label: '员工档案与技能', children: <>
        <Card size="small" className="filter-card" title="查询条件" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEmployeeEditor({ open: true })}>新增员工<FieldHelp definition={helpText.rotationSave} /></Button>}>
          <Space wrap>
            <span>{helpLabel('员工编号或姓名', 'employeeSearch')}</span><Input value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} onPressEnter={applyEmployeeFilters} allowClear maxLength={100} placeholder="输入员工编号或姓名" style={{ width: 230 }} />
            <span>{helpLabel('产线', 'qualificationLine')}</span><Select value={employeeLine || undefined} onChange={(value) => setEmployeeLine(value ?? '')} allowClear placeholder="全部产线" options={lines.map((line) => ({ value: line.line_id, label: line.display_name }))} style={{ width: 170 }} />
            <span>{helpLabel('主要岗位', 'employeePositionFilter')}</span><Select value={employeePosition || undefined} onChange={(value) => setEmployeePosition(value ?? '')} allowClear placeholder="全部岗位" options={positions.map((position) => ({ value: position.position_id, label: position.display_name }))} style={{ width: 170 }} />
            <span>{helpLabel('所属班组', 'employeeTeamFilter')}</span><Select value={employeeTeam || undefined} onChange={(value) => setEmployeeTeam(value ?? '')} allowClear placeholder="全部班组" options={teams.map((team) => ({ value: team.team_id, label: team.name }))} style={{ width: 170 }} />
            <span>{helpLabel('适用设备', 'equipmentFilter')}</span><Select value={employeeEquipmentId || undefined} onChange={(value) => setEmployeeEquipmentId(value ?? '')} allowClear showSearch optionFilterProp="label" placeholder="全部设备" options={equipmentCatalog.map((item) => ({ value: item.equipment_id, label: `${item.equipment_name} · ${item.line_name}` }))} style={{ width: 220 }} />
            <span>{helpLabel('员工状态', 'rotationArchive')}</span><Select value={showArchived ? 'all' : 'active'} onChange={(value) => setShowArchived(value === 'all')} options={[{ value: 'active', label: '仅有效员工' }, { value: 'all', label: '包含已归档员工' }]} style={{ width: 190 }} /><Button onClick={applyEmployeeFilters}>查询<FieldHelp definition={helpText.rotationFilter} /></Button>
          </Space>
        </Card>
        <Card className="section-card" title={<span><TeamOutlined />　员工档案目录</span>} extra={<Typography.Text type="secondary">综合评分为通用技能均分与协作评分的算术平均值；设备等级单独展示，不参与综合评分</Typography.Text>}>
          <Table rowKey="employee_id" size="middle" loading={loading} dataSource={employees} columns={employeeColumns as any} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: 1770 }} locale={{ emptyText: '当前筛选条件下没有员工档案。' }} />
        </Card>
      </> },
      { key: 'teams', label: '班组管理', children: <Card title="本机班组目录" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setTeamEditor({ open: true })}>新增班组<FieldHelp definition={helpText.rotationSave} /></Button>}>
        <Typography.Paragraph type="secondary">成员列表展示当前班组下未归档员工的姓名；将鼠标移至姓名可查看员工编号和主要岗位。成员人数按未归档员工档案汇总，适用产线数量按有效岗位资格关系汇总。</Typography.Paragraph>
        <Table rowKey="team_id" size="middle" loading={loading} dataSource={teams} columns={teamColumns as any} pagination={{ pageSize: 10 }} scroll={{ x: 1450 }} locale={{ emptyText: '当前没有班组记录。' }} />
      </Card> },
      { key: 'qualifications', label: '岗位人员与产线资格', children: <>
        <Card size="small" className="filter-card" title="资格关系筛选" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setQualificationEditor({ open: true })}>新增资格关系<FieldHelp definition={helpText.rotationSave} /></Button>}>
          <Space wrap><span>{helpLabel('产线', 'qualificationLine')}</span><Select value={qualLine || undefined} onChange={(value) => setQualLine(value ?? '')} allowClear placeholder="全部产线" options={lines.map((line) => ({ value: line.line_id, label: line.display_name }))} style={{ minWidth: 190 }} /><span>{helpLabel('岗位', 'qualificationPosition')}</span><Select value={qualPosition || undefined} onChange={(value) => setQualPosition(value ?? '')} allowClear placeholder="全部岗位" options={positions.map((position) => ({ value: position.position_id, label: position.display_name }))} style={{ minWidth: 190 }} /><span>{helpLabel('对象类型', 'qualificationObjectType')}</span><Select value={qualObjectType || undefined} onChange={(value) => setQualObjectType(value ?? '')} allowClear placeholder="员工和班组" options={[{ value: 'team', label: '班组' }, { value: 'employee', label: '员工' }]} style={{ minWidth: 150 }} /><Button onClick={() => void load()}>查询<FieldHelp definition={helpText.qualificationFilter} /></Button></Space>
        </Card>
        <Card className="section-card" title="岗位资格关系">
          <Typography.Paragraph type="secondary">有效资格关系用于启用轮转配置时校验对象与产线是否匹配。该关系为本机人工维护数据，不等同于外部证书或人事系统的正式验证结果。</Typography.Paragraph>
          <Table rowKey="qualification_id" size="middle" loading={loading} dataSource={qualifications} columns={qualificationColumns as any} pagination={{ pageSize: 10 }} scroll={{ x: 1250 }} locale={{ emptyText: '当前筛选条件下没有岗位资格关系。' }} />
        </Card>
      </> },
      { key: 'schedule', label: '员工本人排班查询', children: <Card title="按员工姓名查询排班">
        <Space wrap><span>{helpLabel('员工姓名', 'employeeName')}</span><Select
          showSearch
          loading={loading}
          value={scheduleEmployeeId || undefined}
          placeholder="输入或选择员工姓名"
          style={{ width: 340 }}
          filterOption={(input, option) => String(option?.searchName ?? '').includes(input.trim())}
          onChange={(value: string) => { setScheduleEmployeeId(value); setScheduleRows([]); }}
          options={teamEmployees.map((employee) => ({
            value: employee.employee_id,
            label: `${employee.name}（${employee.employee_id}）`,
            searchName: employee.name,
          }))}
          notFoundContent="没有匹配的员工姓名。"
        /><Button type="primary" loading={lookupBusy} onClick={() => void lookupSchedule()}>查询方案记录<FieldHelp definition={helpText.rotationFilter} /></Button></Space>
        <Typography.Paragraph type="secondary" className="top-space">选择员工姓名后，系统使用员工档案编号跨已登记方案档案匹配完整排班明细，并标注每条记录所属数据集。查询不受顶部数据集选择影响。本机演示不接入员工身份认证，查询结果不用于正式员工通知。</Typography.Paragraph>
        <Table rowKey={(_row, index) => String(index)} className="top-space" dataSource={scheduleRows} columns={scheduleColumns} pagination={{ pageSize: 10 }} scroll={{ x: 1180 }} locale={{ emptyText: '选择员工姓名并查询后显示排班记录。' }} />
      </Card> },
    ]} />
    <EmployeeForm open={employeeEditor.open} initial={employeeEditor.record} teams={teams} positions={positions} onClose={() => setEmployeeEditor(emptyEditor)} onSave={saveEmployee} />
    <EmployeeEquipmentForm open={equipmentEditor.open} employee={equipmentEditor.record} onClose={() => setEquipmentEditor(emptyEditor)} onSave={saveEquipment} />
    <TeamForm open={teamEditor.open} initial={teamEditor.record} employees={teamEmployees} onClose={() => setTeamEditor(emptyEditor)} onSave={saveTeam} />
    <QualificationForm open={qualificationEditor.open} initial={qualificationEditor.record} lines={lines} positions={positions} teams={teams} employees={employees} onClose={() => setQualificationEditor(emptyEditor)} onSave={saveQualification} />
  </>;
}
