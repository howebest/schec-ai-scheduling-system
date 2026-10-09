import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Row, Select, Space, Spin, Statistic, Table, Tabs, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { EChartsOption } from 'echarts';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api, type ScheduleRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import ChartPanel from '../../components/ChartPanel';
import AdvancedChartPanel from '../schedule-analysis/AdvancedChartPanel';
import DataSourceTag from '../../components/DataSourceTag';
import FieldHelp from '../../components/FieldHelp';
import { formatDate } from '../../lib/display.js';
import { analyzeScheduleData, parseScheduleData, scheduleFilterOptions } from './metrics.js';

interface AnalysisRecord extends ScheduleRecord { job?: Record<string, any> | null }
interface FilterOptionRow { factoryCode?: string; lineCode?: string; shift?: string; positionCode?: string }
interface FilterState {
  dateRange: [Dayjs | null, Dayjs | null];
  factoryCode?: string;
  lineCode?: string;
  shift?: string;
  positionCode?: string;
}

const emptyFilters = (): FilterState => ({ dateRange: [null, null] });

function recordName(record: AnalysisRecord) {
  const scenario = record.job?.request?.parameters?.scenario_name;
  const name = typeof scenario === 'string' && scenario.trim() ? scenario : `排班方案 ${record.schedule_id.slice(0, 8)}`;
  return `${name} · V${record.version} · ${formatDate(record.created_at)}`;
}

function HelpLabel({ title, purpose, source, unit, impact, limitation }: {
  title: string; purpose: string; source: string; unit?: string; impact: string; limitation: string;
}) {
  return <Space size={2}>{title}<FieldHelp definition={{ title, purpose, sourceOrDefault: source, unit, impact, limitation }} /></Space>;
}

function MetricTitle({ title, purpose, source, unit, impact, limitation }: {
  title: string; purpose: string; source: string; unit: string; impact: string; limitation: string;
}) {
  return <HelpLabel {...{ title, purpose, source, unit, impact, limitation }} />;
}

export default function ScheduleDataAnalysisPage({ datasetId, refresh }: PageProps) {
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [dataError, setDataError] = useState('');
  const [data, setData] = useState<ReturnType<typeof parseScheduleData> | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [reloadKey, setReloadKey] = useState(0);
  const [tableTab, setTableTab] = useState('line');

  useEffect(() => {
    let active = true;
    setRecordsLoading(true);
    setRecordError('');
    api.archive({ dataset_id: datasetId, limit: 100 })
      .then((result) => {
        if (!active) return;
        const available = (result.items ?? []).map((item) => ({ ...item.schedule, job: item.job }))
          .filter((item) => item.dataset_id === datasetId);
        setRecords(available);
        setSelectedId((current) => available.some((item) => item.id === current) ? current : available[0]?.id);
      })
      .catch((error: Error) => { if (active) { setRecords([]); setSelectedId(undefined); setRecordError(error.message || '无法读取排班档案。'); } })
      .finally(() => { if (active) setRecordsLoading(false); });
    return () => { active = false; };
  }, [datasetId, reloadKey]);

  useEffect(() => {
    let active = true;
    const record = records.find((item) => item.id === selectedId);
    setData(null);
    setDataError('');
    setFilters(emptyFilters());
    if (!record) { setDataLoading(false); return () => { active = false; }; }
    setDataLoading(true);
    api.scheduleArtifactCsv(record.sha256)
      .then((csv) => { if (active) setData(parseScheduleData(csv)); })
      .catch((error: Error) => { if (active) setDataError(error.message || '无法读取当前方案明细。'); })
      .finally(() => { if (active) setDataLoading(false); });
    return () => { active = false; };
  }, [records, selectedId]);

  const options = useMemo(() => scheduleFilterOptions(data), [data]);
  const filteredOptions = useMemo(() => {
    const rows: FilterOptionRow[] = [...(data?.assignments ?? []), ...(data?.gaps ?? []), ...(data?.fractional ?? [])];
    const related = rows.filter((row) => (!filters.factoryCode || row.factoryCode === filters.factoryCode)
      && (!filters.lineCode || row.lineCode === filters.lineCode));
    const unique = (field: 'lineCode' | 'shift' | 'positionCode') => [...new Set(related.map((row) => row[field]).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { lines: unique('lineCode'), shifts: unique('shift'), positions: unique('positionCode') };
  }, [data, filters.factoryCode, filters.lineCode]);

  const result = useMemo(() => analyzeScheduleData(data, {
    dateFrom: filters.dateRange[0]?.format('YYYY-MM-DD'),
    dateTo: filters.dateRange[1]?.format('YYYY-MM-DD'),
    factoryCode: filters.factoryCode,
    lineCode: filters.lineCode,
    shift: filters.shift,
    positionCode: filters.positionCode,
  }), [data, filters]);
  const summary = result.summary;
  const selectedRecord = records.find((item) => item.id === selectedId);
  const dateLabels = result.daily.map((item) => item.date);

  const trendOption: EChartsOption = useMemo(() => ({
    color: ['#245b8f', '#bd7a35'],
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, data: ['人力覆盖率', '未覆盖人班'] },
    grid: { left: 66, right: 56, top: 28, bottom: 58 },
    xAxis: { type: 'category', data: dateLabels, axisTick: { show: false }, axisLabel: { rotate: 35 } },
    yAxis: [
      { type: 'value', name: '覆盖率（%）', min: 0, max: 100, splitLine: { lineStyle: { color: '#eef1f4' } } },
      { type: 'value', name: '缺口（人班）', min: 0, splitLine: { show: false } },
    ],
    series: [
      { name: '人力覆盖率', type: 'line', data: result.daily.map((item) => item.coverageRate), connectNulls: false, symbolSize: 5 },
      { name: '未覆盖人班', type: 'bar', yAxisIndex: 1, data: result.daily.map((item) => item.gapShifts), barMaxWidth: 18 },
    ],
  }), [dateLabels, result.daily]);

  const heatmapOption: EChartsOption = useMemo(() => {
    const dates = [...new Set(result.heatmap.map((item) => item.date))];
    const lines = [...new Set(result.heatmap.map((item) => item.lineCode))];
    const dataPoints = result.heatmap.flatMap((item) => {
      const x = dates.indexOf(item.date);
      const y = lines.indexOf(item.lineCode);
      return item.coverageRate == null ? [] : [[x, y, Number(item.coverageRate.toFixed(2))]];
    });
    return {
      tooltip: { position: 'top', formatter: (params: any) => {
        const [dateIndex, lineIndex, rate] = params.value as [number, number, number];
        const item = result.heatmap.find((entry) => entry.date === dates[dateIndex] && entry.lineCode === lines[lineIndex]);
        return `${lines[lineIndex]} · ${dates[dateIndex]}<br/>覆盖率：${rate.toFixed(2)}%<br/>缺口：${item?.gapShifts ?? 0} 人班`;
      } },
      grid: { left: 110, right: 24, top: 12, bottom: 64 },
      xAxis: { type: 'category', data: dates, splitArea: { show: true }, axisLabel: { rotate: 45 } },
      yAxis: { type: 'category', data: lines, splitArea: { show: true } },
      visualMap: { min: 0, max: 100, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, text: ['低覆盖', '高覆盖'], inRange: { color: ['#bd5a55', '#f0d6c3', '#e9eef2', '#5f88aa'] } },
      series: [{ type: 'heatmap', data: dataPoints, label: { show: false }, itemStyle: { borderColor: '#fff', borderWidth: 2 }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(35, 51, 70, .25)' } } }],
    };
  }, [result.heatmap]);

  const histogramOption: EChartsOption = useMemo(() => ({
    color: ['#537a9e'],
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${value} 人` },
    grid: { left: 58, right: 22, top: 22, bottom: 52 },
    xAxis: { type: 'category', data: result.distribution.histogram.map((item) => item.label), axisLabel: { rotate: 20 } },
    yAxis: { type: 'value', name: '员工数（人）', minInterval: 1, splitLine: { lineStyle: { color: '#eef1f4' } } },
    series: [{ type: 'bar', barMaxWidth: 42, data: result.distribution.histogram.map((item) => item.count), itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  }), [result.distribution.histogram]);

  const metricHeader = (title: string, purpose: string, unit: string, limitation: string) => (
    <HelpLabel
      title={title}
      purpose={purpose}
      source="所选方案 CSV 中与当前筛选条件匹配的指派、缺口及非完整班次记录。"
      unit={unit}
      impact="用于定位当前样本内的排班供需差异；切换筛选条件后重新计算。"
      limitation={limitation}
    />
  );

  const dimensionColumns: TableColumnsType<(typeof result.byLine)[number]> = [
    { title: metricHeader('维度值', '展示当前页签对应的产线、班次或岗位名称。', '编码或名称', '空编码按未记录归类；多重映射不作推断。'), dataIndex: 'label', key: 'label', fixed: 'left', width: 200 },
    { title: metricHeader('需求人班', '统计该维度的已覆盖人班与未覆盖人班合计。', '人班', '需求仅依据方案文件登记值；非完整班次按 8 h 折算。'), dataIndex: 'demandShifts', key: 'demandShifts', align: 'right', render: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) },
    { title: metricHeader('已覆盖人班', '统计整班指派与非完整班次折算的覆盖数量。', '人班', '非完整班次以工时除以 8 h 折算，不代表完整班次指派。'), dataIndex: 'coveredShifts', key: 'coveredShifts', align: 'right', render: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) },
    { title: metricHeader('未覆盖人班', '统计尚未指派人员的岗位需求量。', '人班', '缺口来源于方案 CSV；缺口记录不包含员工归属。'), dataIndex: 'gapShifts', key: 'gapShifts', align: 'right', render: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) },
    { title: metricHeader('覆盖率', '计算已覆盖人班占需求人班的比例。', '%', '分母为方案记录的需求；不代表现场到岗率或产量。'), dataIndex: 'coverageRate', key: 'coverageRate', align: 'right', render: (value: number | null) => value == null ? '无可计算值' : `${value.toFixed(2)}%` },
    { title: metricHeader('计薪工时', '汇总该维度的方案计薪工时。', 'h', '属于排班计划字段，不等同于考勤实绩或货币成本。'), dataIndex: 'paidHours', key: 'paidHours', align: 'right', render: (value: number) => `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} h` },
    { title: metricHeader('加班工时', '汇总该维度的整班指派加班工时。', 'h', '非完整班次记录未提供加班工时；不代表实际考勤。'), dataIndex: 'overtimeHours', key: 'overtimeHours', align: 'right', render: (value: number) => `${value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} h` },
    { title: metricHeader('有排班员工', '统计该维度至少有一条工时记录的去重员工数。', '人', '缺口记录没有员工编号；未排班人员不纳入。'), dataIndex: 'employeeCount', key: 'employeeCount', align: 'right', render: (value: number) => `${value.toLocaleString('zh-CN')} 人` },
  ];
  const gapColumns: TableColumnsType<(typeof result.gapDetails)[number]> = [
    { title: metricHeader('日期', '显示岗位需求缺口对应的排班日期。', 'YYYY-MM-DD', '仅展示所选方案 CSV 已登记的日期。'), dataIndex: 'date', key: 'date', width: 150 },
    { title: metricHeader('产线', '显示缺口记录中的产线编码。', '编码', '原始文件没有提供的产线名称不会由系统推断。'), dataIndex: 'lineCode', key: 'lineCode', width: 150 },
    { title: metricHeader('班次', '显示缺口记录中的班次名称或编码。', '名称或编码', '具体值沿用方案 CSV 原始记录。'), dataIndex: 'shift', key: 'shift', width: 130 },
    { title: metricHeader('岗位', '显示需求缺口对应的岗位名称。', '名称', '岗位名称以方案 CSV 登记值为准。'), dataIndex: 'positionName', key: 'positionName' },
    { title: metricHeader('岗位编码', '显示用于岗位筛选和映射的岗位编码。', '编码', '编码未登记或映射不唯一时不自行补全。'), dataIndex: 'positionCode', key: 'positionCode', width: 210 },
    { title: metricHeader('缺口人班', '显示该日期、产线、班次和岗位的未覆盖需求量。', '人班', '缺口明细最多显示排序后的前 100 条，并按当前筛选条件过滤。'), dataIndex: 'gapShifts', key: 'gapShifts', align: 'right', render: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) },
  ];
  const planChoices = records.map((record) => ({ value: record.id, label: recordName(record) }));
  const correlation = result.diagnostics.correlationDemandGap;
  const largestGapLine = result.byLine.find((item) => item.gapShifts > 0);

  return <>
    <PageHeader title="排班数据分析" description="按方案明细开展日期、工厂、产线、班次和岗位维度的筛选与统计，支持覆盖趋势、人员工时分布、异常定位和多维下钻。" extra={<Tooltip title="重新读取当前数据版本的排班档案，并刷新本页统计。"><Button icon={<ReloadOutlined />} onClick={() => { setReloadKey((value) => value + 1); refresh(); }}>刷新数据</Button></Tooltip>} />
    <Alert className="section-card" type="info" showIcon message="数据范围与分析口径" description="本页读取当前数据版本已登记方案的完整 CSV，在浏览器本机内存中按所选条件复算。排班需求以方案中的已指派人班、非完整班次工时和缺口记录合计；覆盖率不代表现场到岗率或实际产量。CSV 缺口区未记录工厂字段，系统仅在产线可唯一映射到工厂时归属缺口；无法唯一映射的记录在选择工厂时不计入该工厂结果。统计结果用于描述当前方案样本，不推断因果关系。" />
    {recordError && <Alert className="section-card" type="error" showIcon message="排班档案读取失败" description={recordError} />}
    <Card className="section-card filter-card" size="small">
      <Row gutter={[16, 4]}>
        <Col xs={24} md={12} xl={8}>
          <div className="analysis-filter-label"><HelpLabel title="分析方案" purpose="选择一个已登记方案作为本页统计样本。" source="当前数据版本的本机调度档案，默认选择最近登记的方案。" impact="更换方案会重新读取其 CSV 明细并重置筛选条件。" limitation="一次仅分析一个方案版本；未登记的外部文件不会出现在列表中。" /></div>
          <Select className="full-width" value={selectedId} onChange={setSelectedId} options={planChoices} loading={recordsLoading} placeholder="当前数据版本没有已登记方案" showSearch optionFilterProp="label" />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <div className="analysis-filter-label"><HelpLabel title="日期范围" purpose="限制纳入统计的排班日期，起止日期均包含。" source="所选方案 CSV 中实际出现的排班日期；默认包括全部日期。" impact="改变需求、覆盖率、工时及分布统计的样本范围。" limitation="不补齐 CSV 未出现的无排班日期。" /></div>
          <DatePicker.RangePicker className="full-width" value={filters.dateRange} disabled={!data} disabledDate={(date) => {
            const first = options.dates[0]; const last = options.dates.at(-1);
            return Boolean((first && date.format('YYYY-MM-DD') < first) || (last && date.format('YYYY-MM-DD') > last));
          }} onChange={(range) => setFilters((current) => ({ ...current, dateRange: range ?? [null, null] }))} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <div className="analysis-filter-label"><HelpLabel title="工厂" purpose="按工厂编码筛选可归属到该工厂的排班记录。" source="排班指派明细中的工厂代码。" impact="同步筛选能够唯一映射到该厂的产线、班次和岗位记录。" limitation="缺口明细不含工厂字段；产线代码不能唯一映射时，该缺口不进入此筛选结果。" /></div>
          <Select allowClear className="full-width" value={filters.factoryCode} options={options.factories.map((value) => ({ value, label: value }))} placeholder="全部工厂" onChange={(value) => setFilters((current) => ({ ...current, factoryCode: value, lineCode: undefined }))} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <div className="analysis-filter-label"><HelpLabel title="产线" purpose="限定一条产线查看排班覆盖与人员投入。" source="排班指派与岗位缺口记录中的产线编码。" impact="统计结果仅反映所选产线及其记录。" limitation="编码按原始 CSV 显示，不将缺失的中文名称自行推断。" /></div>
          <Select allowClear className="full-width" value={filters.lineCode} options={filteredOptions.lines.map((value) => ({ value, label: value }))} placeholder="全部产线" onChange={(value) => setFilters((current) => ({ ...current, lineCode: value }))} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <div className="analysis-filter-label"><HelpLabel title="班次" purpose="按班次筛选指派和岗位缺口。" source="排班 CSV 的班次字段；非完整班次记录使用班次代码。" impact="影响覆盖率、缺口及工时统计。" limitation="不同记录区按原始字段值匹配，班次名称与代码分别保留。" /></div>
          <Select allowClear className="full-width" value={filters.shift} options={filteredOptions.shifts.map((value) => ({ value, label: value }))} placeholder="全部班次" onChange={(value) => setFilters((current) => ({ ...current, shift: value }))} />
        </Col>
        <Col xs={24} sm={12} xl={4}>
          <div className="analysis-filter-label"><HelpLabel title="岗位" purpose="筛选具体岗位的指派和需求缺口。" source="岗位编码及岗位名称字段。" impact="用于定位长期覆盖不足或工时投入较高的岗位。" limitation="岗位筛选以岗位编码为键；缺口记录没有员工归属信息。" /></div>
          <Select allowClear showSearch optionFilterProp="label" className="full-width" value={filters.positionCode} options={filteredOptions.positions.map((value) => ({ value, label: `${value} · ${[...(data?.assignments ?? []), ...(data?.gaps ?? [])].find((row) => row.positionCode === value)?.positionName ?? value}` }))} placeholder="全部岗位" onChange={(value) => setFilters((current) => ({ ...current, positionCode: value }))} />
        </Col>
      </Row>
    </Card>

    {dataLoading && <div className="initial-loading"><Spin /><span>正在读取方案明细并计算多维统计</span></div>}
    {dataError && <Alert className="section-card" type="error" showIcon message="方案明细读取失败" description={dataError} />}
    {!recordsLoading && !dataLoading && !recordError && !dataError && !data && <Card className="section-card"><Empty description="当前数据版本没有可分析的排班方案" /></Card>}

    {data && !dataLoading && !dataError && <>
      <Row gutter={[12, 12]} className="section-card">
        <Col xs={12} xl={4}><Card size="small" className="stat-card"><Statistic title={<MetricTitle title="需求人班" purpose="统计筛选范围内的总岗位需求量。" source="整班指派记录数、非完整班次小时数除以 8 h，以及缺口记录之和。" unit="人班" impact="作为覆盖率分母，帮助判断供需规模。" limitation="非完整班次按 8 h 折算；不补入 CSV 未记录需求。" />} value={summary.demandShifts} precision={1} suffix="人班" /></Card></Col>
        <Col xs={12} xl={4}><Card size="small" className="stat-card"><Statistic title={<MetricTitle title="人力覆盖率" purpose="查看已覆盖需求占筛选范围需求的比例。" source="已覆盖人班除以需求人班。" unit="%" impact="用于定位覆盖较低的日期、产线和岗位。" limitation="不代表实际到岗率或生产产量；需求分母仅来自方案文件。" />} value={summary.coverageRate ?? '—'} precision={summary.coverageRate == null ? undefined : 2} suffix={summary.coverageRate == null ? undefined : '%'} /></Card></Col>
        <Col xs={12} xl={4}><Card size="small" className="stat-card"><Statistic title={<MetricTitle title="未覆盖需求" purpose="显示筛选范围内尚未指派人员的人班数量。" source="汇总岗位缺口记录中的缺口人班。" unit="人班" impact="用于按产线、班次及岗位安排复核优先级。" limitation="缺口记录没有员工工号和关键岗位标识，不估算缺失字段。" />} value={summary.gapShifts} precision={1} suffix="人班" /></Card></Col>
        <Col xs={12} xl={4}><Card size="small" className="stat-card"><Statistic title={<MetricTitle title="加班工时" purpose="汇总整班排班指派明细中的加班工时。" source="CSV 的当日加班工时字段。" unit="h" impact="用于识别加班集中日期、产线和班次。" limitation="非完整班次记录不包含加班字段；该值不代表考勤实绩。" />} value={summary.overtimeHours} precision={1} suffix="h" /></Card></Col>
        <Col xs={12} xl={4}><Card size="small" className="stat-card"><Statistic title={<MetricTitle title="有排班员工" purpose="统计筛选范围内至少有一条排班工时记录的员工数。" source="排班指派与非完整班次记录中的去重员工编号。" unit="人" impact="用于解释工时分布样本规模。" limitation="不包含未排班候选人员、休假人员或实际在岗人员。" />} value={result.distribution.employeeCount} suffix="人" /></Card></Col>
        <Col xs={12} xl={4}><Card size="small" className="stat-card"><Statistic title={<MetricTitle title="纳入日期" purpose="展示当前筛选结果实际包含的排班日期数量。" source="所选方案 CSV 中筛选后出现的日期去重计数。" unit="d" impact="用于解释趋势与周期分布的时间样本。" limitation="仅统计存在排班或缺口记录的日期。" />} value={summary.dateCount} suffix="d" /></Card></Col>
      </Row>

      <Row gutter={[16, 16]} className="section-card">
        <Col xs={24} xl={15}>
          {result.daily.length ? <ChartPanel title="每日覆盖率与未覆盖需求趋势" option={trendOption} height={320} /> : <Card title="每日覆盖率与未覆盖需求趋势"><Empty description="所选条件下没有可绘制的日期记录" /></Card>}
        </Col>
        <Col xs={24} xl={9}>
          <Card title="员工工时分布统计" className="chart-card">
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label={metricHeader('P25 工时', '展示员工工时样本的第 25 百分位数。', 'h', '员工样本来自当前筛选记录；不覆盖未排班人员。')}>{result.distribution.p25 == null ? '无可计算值' : `${result.distribution.p25.toFixed(1)} h`}</Descriptions.Item>
              <Descriptions.Item label={metricHeader('中位数', '展示员工工时排序后的第 50 百分位数。', 'h', '员工样本来自当前筛选记录；不代表薪酬公平判断。')}>{result.distribution.median == null ? '无可计算值' : `${result.distribution.median.toFixed(1)} h`}</Descriptions.Item>
              <Descriptions.Item label={metricHeader('P75 工时', '展示员工工时样本的第 75 百分位数。', 'h', '员工样本来自当前筛选记录；不覆盖未排班人员。')}>{result.distribution.p75 == null ? '无可计算值' : `${result.distribution.p75.toFixed(1)} h`}</Descriptions.Item>
              <Descriptions.Item label={metricHeader('四分位距', '计算 P75 与 P25 的差值，用于描述中间 50% 样本的离散程度。', 'h', '样本量较小时分位数波动较大；异常筛查仅供复核。')}>{result.distribution.iqr == null ? '无可计算值' : `${result.distribution.iqr.toFixed(1)} h`}</Descriptions.Item>
              <Descriptions.Item label={metricHeader('工时极差', '计算当前员工工时样本最大值与最小值之差。', 'h', '受极端值影响；不能单独说明排班公平性。')}>{result.distribution.rangeHours == null ? '无可计算值' : `${result.distribution.rangeHours.toFixed(1)} h`}</Descriptions.Item>
              <Descriptions.Item label={metricHeader('基尼系数', '以 0 至 1 的无量纲系数描述员工工时分布离散程度。', '无量纲', '仅描述当前员工工时样本，不作为薪酬公平或合规结论。')}>{result.distribution.gini == null ? '无可计算值' : result.distribution.gini.toFixed(4)}</Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph type="secondary" className="small-note">分位数用于描述有排班员工的工时分布；基尼系数越低，样本工时分布越均匀。以上统计不代表薪酬公平或劳动合规结论。</Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          {result.heatmap.length ? <AdvancedChartPanel title="产线与日期覆盖率热力图" option={heatmapOption} height={Math.min(560, Math.max(270, result.byLine.length * 30 + 100))} /> : <Card title="产线与日期覆盖率热力图"><Empty description="所选条件下没有热力图数据" /></Card>}
        </Col>
        <Col xs={24} xl={12}>
          {result.distribution.histogram.length ? <ChartPanel title="员工计薪工时分布" option={histogramOption} height={320} /> : <Card title="员工计薪工时分布"><Empty description="当前筛选范围没有员工工时样本" /></Card>}
        </Col>
      </Row>

      <Card title="统计诊断与业务解释" className="section-card">
        <Row gutter={[16, 12]}>
          <Col xs={24} md={8}><Typography.Text strong>覆盖瓶颈</Typography.Text><Typography.Paragraph type="secondary">{largestGapLine ? `当前筛选中，${largestGapLine.label} 的缺口最高，为 ${largestGapLine.gapShifts.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 人班；建议结合下方班次与岗位统计定位具体需求单元。` : '当前筛选结果没有登记的岗位缺口。'}</Typography.Paragraph></Col>
          <Col xs={24} md={8}><Typography.Text strong>工时异常筛查</Typography.Text><Typography.Paragraph type="secondary">按当前筛选条件纳入的指派明细统计，员工日加班超过 3 h 的记录有 {result.diagnostics.dailyOverLimitCount} 条，员工月加班超过 36 h 的记录有 {result.diagnostics.monthlyOverLimitCount} 条；超过四分位距 1.5 倍范围的员工工时样本有 {result.diagnostics.outlierCount} 人。选择不完整的日期范围时，日/月加班计数仅反映筛选内记录。统计结果提示复核对象，不替代独立合规核验。</Typography.Paragraph></Col>
          <Col xs={24} md={8}><Typography.Text strong>需求与缺口相关分析</Typography.Text><Typography.Paragraph type="secondary">{correlation == null ? '有效日期少于 3 天或样本无变异，相关系数不计算。' : `按日期计算的需求人班与缺口人班 Pearson 相关系数为 ${correlation.toFixed(3)}。该系数描述当前样本的线性关联，不表示需求变化导致缺口变化。`}</Typography.Paragraph></Col>
        </Row>
        {result.diagnostics.outlierCount > 0 && <Typography.Paragraph type="secondary" className="small-note">工时异常样本采用四分位距规则筛查：小于 P25−1.5×IQR 或大于 P75+1.5×IQR。该规则用于统计异常定位，不能单独认定为排班错误。</Typography.Paragraph>}
      </Card>

      <Card title="产线、班次与岗位统计" className="section-card">
        <Tabs activeKey={tableTab} onChange={setTableTab} items={[
          { key: 'line', label: '按产线', children: <Table rowKey="key" size="small" dataSource={result.byLine} columns={dimensionColumns} pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} locale={{ emptyText: '没有可显示的产线记录' }} /> },
          { key: 'shift', label: '按班次', children: <Table rowKey="key" size="small" dataSource={result.byShift} columns={dimensionColumns} pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} locale={{ emptyText: '没有可显示的班次记录' }} /> },
          { key: 'position', label: '按岗位', children: <Table rowKey="key" size="small" dataSource={result.byPosition} columns={dimensionColumns} pagination={{ pageSize: 10 }} scroll={{ x: 1000 }} locale={{ emptyText: '没有可显示的岗位记录' }} /> },
        ]} />
      </Card>

      <Card title={`未覆盖岗位需求明细（显示前 ${result.gapDetails.length} 条）`} className="section-card">
        <Table rowKey={(_row, index) => String(index)} size="small" dataSource={result.gapDetails} columns={gapColumns} pagination={{ pageSize: 10 }} scroll={{ x: 850 }} locale={{ emptyText: '当前筛选没有岗位缺口记录' }} />
      </Card>

      <Card size="small" className="section-card footnote-card">
        <Space wrap>
          <Typography.Text type="secondary">当前纳入 {result.diagnostics.filteredRecordCount.toLocaleString('zh-CN')} 条明细：</Typography.Text>
          <DataSourceTag sourceType={selectedRecord?.source_type ?? 'accepted_baseline'} />
          <Typography.Text type="secondary">整班 {summary.assignmentCount.toLocaleString('zh-CN')} 条，缺口 {summary.gapRecordCount.toLocaleString('zh-CN')} 条，非完整班次 {summary.fractionalRecordCount.toLocaleString('zh-CN')} 条。数据版本由页面顶部统一选择；外部 HR、APS、MES 与考勤系统未连接。</Typography.Text>
        </Space>
      </Card>
    </>}
  </>;
}
