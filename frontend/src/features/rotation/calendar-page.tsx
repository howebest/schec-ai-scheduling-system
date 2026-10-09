import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Select, Segmented, Space, Tag, Tooltip, Typography, message } from 'antd';
import { LeftOutlined, RightOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import PageHeader from '../../components/PageHeader';
import FieldHelp from '../../components/FieldHelp';
import DataSourceTag from '../../components/DataSourceTag';
import { api } from '../../api/client';
import { helpText } from '../../help/metadata';
import type { CalendarEntry, LineRecord, ScheduleConfigRecord } from './types';

const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const iso = (date: Dayjs) => date.format('YYYY-MM-DD');
const monthGridStart = (date: Dayjs) => date.startOf('month').subtract((date.startOf('month').day() + 6) % 7, 'day');
const mondayOf = (date: Dayjs) => date.startOf('day').subtract((date.day() + 6) % 7, 'day');
const label = (text: string, key: string) => <>{text}<FieldHelp definition={helpText[key]} /></>;

export default function RotationCalendarPage() {
  const [lines, setLines] = useState<LineRecord[]>([]);
  const [configs, setConfigs] = useState<ScheduleConfigRecord[]>([]);
  const [lineId, setLineId] = useState('');
  const [configId, setConfigId] = useState('');
  const [anchor, setAnchor] = useState(dayjs());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api.rotationLines().then((result) => {
      const available = result.items.filter((item) => item.is_active);
      setLines(available); if (available.length) setLineId((current) => current || available[0].line_id);
    }).catch((error) => message.error((error as Error).message));
  }, []);
  useEffect(() => {
    if (!lineId) { setConfigs([]); setConfigId(''); return; }
    api.rotationConfigurations({ line_id: lineId, is_active: true, page_size: 200 }).then((result) => {
      setConfigs(result.items); setConfigId((current) => result.items.some((item) => item.config_id === current) ? current : '');
    }).catch((error) => message.error((error as Error).message));
  }, [lineId]);
  const range = useMemo(() => view === 'month' ? { start: anchor.startOf('month'), end: anchor.endOf('month') } : { start: mondayOf(anchor), end: mondayOf(anchor).add(6, 'day') }, [anchor, view]);
  const load = useCallback(async () => {
    if (!lineId) return;
    setLoading(true);
    try {
      const result = await api.rotationCalendar({ line_id: lineId, start_date: iso(range.start), end_date: iso(range.end), config_id: configId || undefined });
      setEntries(result.items ?? []);
    } catch (error) { message.error((error as Error).message); setEntries([]); }
    finally { setLoading(false); }
  }, [configId, lineId, range]);
  useEffect(() => { void load(); }, [load]);
  const entryByDate = useMemo(() => entries.reduce<Record<string, CalendarEntry[]>>((map, entry) => {
    (map[entry.date] ??= []).push(entry); return map;
  }, {}), [entries]);
  const visibleDays = useMemo(() => view === 'week'
    ? Array.from({ length: 7 }, (_, index) => range.start.add(index, 'day'))
    : Array.from({ length: Math.ceil(((anchor.startOf('month').day() + 6) % 7 + anchor.daysInMonth()) / 7) * 7 }, (_, index) => monthGridStart(anchor).add(index, 'day')),
  [anchor, range.start, view]);
  const step = (amount: number) => setAnchor((current) => view === 'month' ? current.add(amount, 'month') : current.add(amount, 'week'));
  const title = view === 'month' ? anchor.format('YYYY 年 M 月') : `${range.start.format('YYYY-MM-DD')} 至 ${range.end.format('YYYY-MM-DD')}`;
  const dayCells = view === 'month' ? visibleDays : visibleDays;
  return <>
    <PageHeader title="排班日历" description="按本机已启用轮班配置即时计算班组或员工的周期日历。日历用于查看配置轮转，不代表已完成生产排班，不改变 MIP 求解输入。" extra={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新<FieldHelp definition={helpText.rotationCalendarDate} /></Button></Space>} />
    <Alert showIcon type="info" message="本机配置日历" description="汽水线与无菌线样例标记为合成演示。跨午夜班次按开始日期归属，并在次日结束时间处标明跨日。无有效配置的日期显示“未配置”。" />
    <Card className="section-card filter-card" title="查询条件">
      <div className="calendar-toolbar">
        <div className="calendar-filter"><span>{label('产线', 'rotationCalendarLine')}</span><Select value={lineId || undefined} onChange={setLineId} placeholder="请选择产线" options={lines.map((item) => ({ value: item.line_id, label: item.display_name }))} /></div>
        <div className="calendar-filter"><span>{label('轮班配置', 'rotationCalendarConfig')}</span><Select value={configId || undefined} onChange={(value) => setConfigId(value ?? '')} allowClear placeholder="该产线全部启用配置" options={configs.map((item) => ({ value: item.config_id, label: item.name }))} /></div>
        <div className="calendar-filter"><span>{label('日期定位', 'rotationCalendarDate')}</span><DatePicker picker={view === 'month' ? 'month' : 'date'} value={anchor} onChange={(value) => value && setAnchor(value)} allowClear={false} /></div>
        <div className="calendar-filter"><span>显示方式<FieldHelp definition={helpText.rotationCalendarView} /></span><Segmented value={view} onChange={(value) => setView(value as 'month' | 'week')} options={[{ value: 'month', label: '月视图' }, { value: 'week', label: '周视图' }]} /></div>
      </div>
    </Card>
    <Card className="section-card rotation-calendar-card" loading={loading} title={<Space><Tooltip title={helpText.rotationCalendarPrevious.purpose}><Button aria-label="上一个周期" icon={<LeftOutlined />} onClick={() => step(-1)} /></Tooltip><Typography.Text strong>{title}</Typography.Text><FieldHelp definition={helpText.rotationCalendarDate} /><Tooltip title={helpText.rotationCalendarNext.purpose}><Button aria-label="下一个周期" icon={<RightOutlined />} onClick={() => step(1)} /></Tooltip></Space>} extra={<Typography.Text type="secondary">查询区间 {range.start.format('YYYY-MM-DD')} 至 {range.end.format('YYYY-MM-DD')} · 共 {range.end.diff(range.start, 'day') + 1} d</Typography.Text>}>
      {!lineId ? <Empty description="当前没有可用产线，请先检查本机排班配置目录。" /> : <>
        <div className="rotation-calendar-weekdays">{dayNames.map((name) => <div key={name}>{name}</div>)}</div>
        <div className={`rotation-calendar-grid ${view === 'week' ? 'is-week' : ''}`}>
          {dayCells.map((date) => {
            const currentMonth = view === 'week' || date.month() === anchor.month();
            const rows = entryByDate[iso(date)] ?? [];
            return <div key={iso(date)} className={`rotation-calendar-cell ${currentMonth ? '' : 'is-outside'} ${date.isSame(dayjs(), 'day') ? 'is-today' : ''}`}>
              <div className="rotation-calendar-date"><b>{date.date()}</b>{view === 'week' && <span>{date.format('YYYY-MM-DD')}</span>}</div>
              {!currentMonth ? <span className="calendar-muted">—</span> : rows.length === 0 ? <Tag className="calendar-unconfigured">未配置</Tag> : <div className="rotation-calendar-events">
                {rows.map((entry) => <div className={`rotation-calendar-event ${entry.status === 'rest' ? 'is-rest' : ''}`} key={`${entry.config_id}-${entry.object_type}-${entry.object_id}`}>
                  <div className="calendar-event-heading"><strong>{entry.object_name}</strong><DataSourceTag sourceType={entry.source_type} /></div>
                  <Typography.Text>{entry.status === 'rest' ? '休息' : entry.shift_name ?? entry.shift_code ?? '班次未命名'}</Typography.Text>
                  {entry.start_time && entry.end_time && <Typography.Text type="secondary">{entry.start_time}–{entry.end_time}{entry.crosses_midnight ? '（次日结束）' : ''}</Typography.Text>}
                  {entry.status !== 'rest' && <div className="calendar-event-personnel">
                    <Typography.Text type="secondary">{entry.object_type === 'team' ? '人员：' : '工号：'}</Typography.Text>
                    <Tooltip title={entry.personnel.length ? <div>{entry.personnel.map((person) => <div key={person.employee_id}>{person.name} · {person.employee_id} · {person.position_name}</div>)}</div> : '当前轮转对象没有未归档员工。'}>
                      <Typography.Text className="calendar-event-personnel-value">{entry.object_type === 'team' ? entry.personnel.map((person) => person.name).join('、') || '未配置成员' : entry.personnel[0]?.employee_id ?? '未配置员工'}</Typography.Text>
                    </Tooltip>
                    <FieldHelp definition={helpText.rotationCalendarPersonnel} />
                  </div>}
                  <Typography.Text type="secondary" className="calendar-config-name">{entry.config_name}</Typography.Text>
                </div>)}
              </div>}
            </div>;
          })}
        </div>
      </>}
    </Card>
  </>;
}
