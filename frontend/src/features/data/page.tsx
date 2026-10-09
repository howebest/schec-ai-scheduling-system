import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Collapse, Form, Input, Row, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { InboxOutlined, ScanOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import { api, type DatasetRecord, type ImportPreview } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import DataSourceTag from '../../components/DataSourceTag';
import FieldHelp from '../../components/FieldHelp';
import { helpText } from '../../help/metadata';
import { formatDate } from '../../lib/display.js';

const SCHEMAS = [
  { value: 'raw_dataset', label: '原始求解工作簿（XLSX）', description: '包含设备产线台账、人员技能矩阵和排班训练主数据集。仅此模板可登记为原始求解工作簿。', accept: '.xlsx' },
  { value: 'orders', label: '订单需求（CSV）', description: '需要订单编号、产线、产品、需求量、交期和优先级字段；仅用于本机分析。', accept: '.csv' },
  { value: 'line_capacity', label: '产线能力（CSV）', description: '需要产线、产品、线速、效率、可用小时和班次字段；仅用于本机分析。', accept: '.csv' },
  { value: 'attendance_snapshot', label: '考勤快照（CSV）', description: '需要员工编号、日期、班次、状态和来源字段；仅用于本机模拟分析。', accept: '.csv' },
  { value: 'position_requirements', label: '岗位需求（CSV）', description: '采用包内岗位需求文件的中文字段。', accept: '.csv' },
  { value: 'line_run_plan', label: '产线运行计划（CSV）', description: '采用包内产线运行计划的中文字段。', accept: '.csv' },
  { value: 'baseline_schedule', label: '排班方案（CSV）', description: '导入既有排班方案以检查字段。', accept: '.csv' },
  { value: 'event_json', label: '异常事件（JSON）', description: '接受 insert、rampup、changeover、equipment_fail 或 absence 事件结构。', accept: '.json' },
];

const SCHEMA_FIELDS: Record<string, Array<[string, string, string]>> = {
  orders: [
    ['order_id', '订单唯一编号', '文本'], ['line_code', '产线编码', '文本'], ['product_code', '产品编码', '文本'],
    ['required_units', '需求数量', 'unit'], ['due_at', '需求交期', 'ISO 日期或时间'], ['priority', '订单优先级', '数值'],
  ],
  line_capacity: [
    ['line_code', '产线编码', '文本'], ['product_code', '产品编码', '文本'], ['units_per_hour', '每小时理论线速', 'unit/h'],
    ['efficiency_pct', '目标效率', '%'], ['available_hours', '规划周期可用小时数', 'h'], ['shift_code', '可用班次编码', '文本'],
  ],
  attendance_snapshot: [
    ['employee_id', '员工编号', '文本'], ['schedule_date', '排班日期', 'YYYY-MM-DD'],
    ['shift_code', '班次编码', '文本'], ['status', '出勤状态', '枚举文本'], ['source_type', '记录来源', '文本'],
  ],
  position_requirements: [
    ['工厂代码', '工厂唯一编码', '文本'], ['产线编码', '产线唯一编码', '文本'], ['岗位编码', '岗位唯一编码', '文本'],
    ['岗位名称', '岗位中文名称', '文本'], ['岗位类别', '关键岗/一般岗/辅助岗等分类', '文本'],
    ['岗位技能要求等级', '最低资格等级', '等级数值'], ['白班定编', '白班岗位需求人数', '人'], ['夜班定编', '夜班岗位需求人数', '人'], ['轮班模式', '岗位排班周期规则', '文本'],
  ],
  line_run_plan: [['产线编码', '产线唯一编码', '文本'], ['日期', '计划日期', 'YYYY-MM-DD'], ['班次', '计划班次', '文本'], ['生产运行状态', '运行/停线/换型等状态', '文本']],
  baseline_schedule: [
    ['工厂代码', '工厂编码', '文本'], ['产线编码', '产线编码', '文本'], ['日期', '排班日期', 'YYYY-MM-DD'], ['班次', '班次名称', '文本'],
    ['班次代码', '班次编码', '文本'], ['员工工号', '员工编号', '文本'], ['岗位编码', '岗位编号', '文本'], ['岗位名称', '岗位名称', '文本'],
    ['是否关键岗', '关键岗位标记', '布尔值'], ['技能等级', '指派技能等级', '等级数值'], ['计薪工时(h)', '计薪小时', 'h'], ['标准工时(h)', '标准小时', 'h'],
    ['当日加班工时(h)', '当日加班小时', 'h'], ['该班次换型等级', '换型等级', '文本'], ['实验编号', '实验或场景编号', '文本'],
  ],
  event_json: [['type', '事件类型', '枚举文本'], ['event_id', '事件编号', '文本'], ['line/employee', '产线或员工标识', '文本'], ['date/dates', '事件日期或日期数组', 'YYYY-MM-DD'], ['shift', '班次名称', '文本']],
};

function downloadCsvTemplate(schemaId: string) {
  const fields = SCHEMA_FIELDS[schemaId];
  if (!fields) { message.info('原始工作簿请按数据交付规范准备 XLSX 文件。'); return; }
  const csv = `\uFEFF${fields.map(([name]) => `"${name.replaceAll('"', '""')}"`).join(',')}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${schemaId}_template.csv`; link.click(); URL.revokeObjectURL(url);
}

export default function DataPage({ datasets, refresh, notify }: PageProps) {
  const [form] = Form.useForm();
  const [schemaId, setSchemaId] = useState('raw_dataset');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [items, setItems] = useState<DatasetRecord[]>(datasets);
  const [busy, setBusy] = useState(false);
  const schema = SCHEMAS.find((item) => item.value === schemaId)!;
  useEffect(() => setItems(datasets), [datasets]);

  const chooseSchema = (value: string) => { setSchemaId(value); setFile(null); setPreview(null); };
  const onFileChange: NonNullable<UploadProps['onChange']> = (info) => {
    const selected = info.file.originFileObj as File | undefined;
    setFile(selected ?? null); setPreview(null);
  };
  const runPreview = async () => {
    if (!file) { message.warning('请先选择待导入文件。'); return; }
    setBusy(true);
    try {
      const result = await api.previewImport(schemaId, file);
      setPreview(result);
      if (!result.accepted) message.warning('字段检查未通过，请查看逐字段诊断。');
      else message.success(`字段检查通过，共 ${result.accepted_rows} 条有效记录。`);
    } catch (error) { message.error((error as Error).message); }
    finally { setBusy(false); }
  };
  const commit = async (values: Record<string, string>) => {
    if (!preview?.accepted) return;
    setBusy(true);
    try {
      const result = await api.commitImport({
        preview_id: preview.preview_id,
        display_name: values.display_name,
        actor_id: '本机计划员', actor_role: '计划员', reason: values.reason,
      });
      notify(`数据集 ${result.dataset.display_name} 已登记。`);
      setPreview(null); setFile(null); form.resetFields(); refresh();
      const latest = await api.datasets(); setItems(latest.items ?? []);
    } catch (error) { message.error((error as Error).message); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeader title="数据管理" description="检查数据模板、预览字段诊断、登记带哈希的数据集版本。导入过程不会覆盖原始工作簿或基准方案。" />
    <Alert type="info" showIcon message="导入处理顺序" description="先选择模板并上传文件，预览逐字段检查结果；只有检查通过后才能登记数据集。订单、产能和考勤快照等 CSV 用于本机分析；原始求解工作簿必须使用原始工作簿 XLSX 模板。" />
    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={10}>
        <Card title="数据导入预览" className="full-height-card">
          <Form layout="vertical" onFinish={commit} form={form}>
            <Form.Item label={<span>导入模板 <FieldHelp definition={helpText.importSchema} /></span>}>
              <Select value={schemaId} options={SCHEMAS.map(({ value, label }) => ({ value, label }))} onChange={chooseSchema} />
            </Form.Item>
            <Typography.Paragraph type="secondary">{schema.description}</Typography.Paragraph>
            <Collapse className="field-collapse" items={[{
              key: 'fields', label: '字段名称、业务含义与单位',
              children: schemaId === 'raw_dataset'
                ? <Typography.Paragraph type="secondary">工作簿需包含设备产线与工位台账、人员技能矩阵、排班训练主数据集三个工作表。主要字段包括工厂、产线、岗位、岗位类别、技能等级、白夜班定编、员工编号、技能岗位、证书有效期、可胜任班次、累计在岗时长、排班日期、班次、生产运行状态、换型标记和持证要求。请使用原始数据交付工作簿结构；该模板不提供空白表格。</Typography.Paragraph>
                : <Table rowKey="0" size="small" pagination={false} dataSource={SCHEMA_FIELDS[schemaId]?.map(([field, meaning, unit]) => ({ field, meaning, unit })) ?? []} columns={[{ title: '字段名', dataIndex: 'field', key: 'field' }, { title: '业务含义', dataIndex: 'meaning', key: 'meaning' }, { title: '单位或格式', dataIndex: 'unit', key: 'unit' }]} />,
            }]} />
            <Button className="top-space" size="small" onClick={() => downloadCsvTemplate(schemaId)}>下载当前 CSV 表头模板</Button>
            <Upload.Dragger accept={schema.accept} maxCount={1} beforeUpload={() => false} onChange={onFileChange} fileList={file ? [{ uid: 'selected', name: file.name, status: 'done' }] : []} onRemove={() => { setFile(null); setPreview(null); return true; }}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">选择或拖放待检查文件</p>
              <p className="ant-upload-hint">当前模板允许的格式：{schema.accept}</p>
            </Upload.Dragger>
            <Button className="top-space" block icon={<ScanOutlined />} onClick={() => void runPreview()} loading={busy} disabled={!file}>检查并预览</Button>
            {preview && <div className="preview-result">
              <Alert type={preview.accepted ? 'success' : 'error'} showIcon message={preview.accepted ? '字段检查通过' : '字段检查未通过'} description={`文件：${preview.file_name ?? file?.name ?? '—'}；行数：${preview.row_count}；可接受：${preview.accepted_rows}；拒绝：${preview.rejected_rows}`} />
              <Typography.Paragraph className="top-space"><Typography.Text type="secondary">SHA-256：</Typography.Text><Typography.Text code copyable>{preview.sha256}</Typography.Text></Typography.Paragraph>
              {preview.field_errors?.length > 0 && <Table rowKey={(_, index) => String(index)} size="small" pagination={{ pageSize: 5 }} dataSource={preview.field_errors} columns={[
                { title: '行号', dataIndex: 'row', key: 'row', render: (value: number) => value ?? '—', width: 75 },
                { title: '字段', dataIndex: 'field', key: 'field' },
                { title: '诊断', dataIndex: 'message', key: 'message' },
              ]} />}
              {preview.accepted && <>
                <Form.Item className="top-space" name="display_name" label="数据集名称" rules={[{ required: true, whitespace: true, message: '请填写数据集名称。' }]}><Input maxLength={100} placeholder="例如：陕西厂 2026 年 7 月原始排班数据" /></Form.Item>
                <Form.Item name="reason" label={<span>登记原因 <FieldHelp definition={helpText.reason} /></span>} rules={[{ required: true, whitespace: true, message: '请填写登记原因。' }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
                <Button block type="primary" htmlType="submit" icon={<UploadOutlined />} loading={busy}>登记为新数据集</Button>
              </>}
            </div>}
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={14}>
        <Card title={`已登记数据集（${items.length}）`} className="full-height-card">
          <Table rowKey="id" size="middle" dataSource={items} pagination={{ pageSize: 8 }} scroll={{ x: 680 }} columns={[
            { title: '名称', dataIndex: 'display_name', key: 'display_name' },
            { title: '版本', dataIndex: 'version', key: 'version', width: 205 },
            { title: '来源', dataIndex: 'source_type', key: 'source_type', render: (value: string) => <DataSourceTag sourceType={value} />, width: 145 },
            { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: formatDate, width: 175 },
          ]} />
          <Typography.Paragraph type="secondary" className="small-note">已验收基准和原始样本为只读数据。新导入文件会复制到工程包 `data/imported/`，生成独立版本 ID，并记录来源、操作原因和 SHA-256。</Typography.Paragraph>
        </Card>
      </Col>
    </Row>
    <Card className="section-card" title="字段与来源管理" size="small">
      <Typography.Paragraph type="secondary">任务、方案和下载档案保留源数据集标识。合成演示、用户导入、已验收基准和本机模拟反馈使用不同来源标签；业务分析不将合成值解释为现场生产数据。</Typography.Paragraph>
    </Card>
  </>;
}
