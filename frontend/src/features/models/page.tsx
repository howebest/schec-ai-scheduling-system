import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Modal,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  DownloadOutlined,
  ExperimentOutlined,
  EyeOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import type { PageProps } from '../types';
import catalog from './catalog.json';

type StageReport = (typeof catalog.reports)[number];

const tasks = [
  { name: '数据概况', command: 'info', input: '原始工作簿 XLSX', result: '输入字段、样本规模和摘要' },
  { name: '7 天演示排班', command: 'solve-demo', input: '原始工作簿 XLSX', result: '演示周期方案 CSV' },
  { name: '62 天整周期求解', command: 'solve-full', input: '原始工作簿 XLSX', result: '完整周期方案 CSV' },
  { name: '基准方案复核', command: 'verify-baseline', input: '原始工作簿和基准 CSV', result: '硬约束和双需求口径指标' },
  { name: '异常增量重排', command: 'reschedule', input: '原始工作簿、基准方案和事件 JSON', result: '锁定式增量重排方案' },
  { name: '指标复算', command: 'kpi', input: '基准方案 CSV', result: 'KPI 汇总与产线适配文件' },
];

const versionColumns: TableColumnsType<(typeof catalog.versionChain)[number]> = [
  { title: '阶段', dataIndex: 'stage', key: 'stage', width: 150 },
  { title: '版本', dataIndex: 'version', key: 'version', width: 180, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
  { title: '范围与内容', dataIndex: 'scope', key: 'scope', width: 310 },
  { title: '证据摘要', dataIndex: 'evidence', key: 'evidence', width: 430 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 130, render: (value: string) => <Tag color={value.includes('本机') ? 'blue' : 'default'}>{value}</Tag> },
];

const weightColumns: TableColumnsType<(typeof catalog.optimizationModel.objectiveWeights)[number]> = [
  { title: '目标项', dataIndex: 'name', key: 'name', width: 190 },
  { title: '权重', dataIndex: 'value', key: 'value', width: 90, align: 'right' },
  { title: '单位', dataIndex: 'unit', key: 'unit', width: 150 },
  { title: '目标方向', dataIndex: 'direction', key: 'direction', width: 120 },
  { title: '业务含义', dataIndex: 'explanation', key: 'explanation' },
];

export default function ModelsPage(_props: PageProps) {
  const [preview, setPreview] = useState<StageReport | null>(null);
  const model = catalog.optimizationModel;
  const baseline = catalog.baseline;
  const coverageRows = [baseline.coverage.solver, baseline.coverage.independent];

  return <>
    <PageHeader
      title="模型与算法"
      description="查看本机可调用的排班优化模型、阶段版本链、求解目标口径与交付报告。静态基准数据来自阶段报告，和本机实时求解结果分开展示。"
    />

    <Alert
      type="info"
      showIcon
      message="算法模型与机器学习训练模型分别管理"
      description="当前可由后端调用的是 Pyomo 与 HiGHS 混合整数规划排班模型 SCHEC-MIP-V1.0。随包交付文件中没有已训练完成、可直接加载的机器学习模型权重；两份阶段报告作为模型版本、求解验证和 KPI 统计的交付证据提供查看。"
    />

    <Row gutter={[16, 16]} className="section-card">
      <Col xs={24} xl={16}>
        <Card
          title={<span><ExperimentOutlined />　{model.name}</span>}
          extra={<Tag color="blue">{model.runtimeStatus}</Tag>}
        >
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="模型版本">{model.version}</Descriptions.Item>
            <Descriptions.Item label="模型类型">{model.category}</Descriptions.Item>
            <Descriptions.Item label="输入数据版本">{model.inputVersion}</Descriptions.Item>
            <Descriptions.Item label="建模框架">{model.framework}</Descriptions.Item>
            <Descriptions.Item label="求解器">{model.solver}</Descriptions.Item>
            <Descriptions.Item label="运行解释器">{model.pythonRuntime}</Descriptions.Item>
            <Descriptions.Item label="62 d 全量规模">{model.fullCycle.variables.toLocaleString()} 个变量；{model.fullCycle.constraints.toLocaleString()} 条约束</Descriptions.Item>
            <Descriptions.Item label="本机演示验收">{model.localDemo.termination}；{model.localDemo.coveredPersonShifts}/{model.localDemo.demandPersonShifts} 人班覆盖；硬约束违例 {model.localDemo.hardConstraintViolations} 项</Descriptions.Item>
            <Descriptions.Item label="优化目标范围" span={2}>缺口、加班和工时均衡共同参与加权目标。工时均衡按候选员工范围计算，包含本次未排班员工；KPI 工时差仅统计有排班指派的员工。</Descriptions.Item>
          </Descriptions>
          <Typography.Paragraph type="secondary" className="small-note">
            后端调用由 Rust 任务服务启动受控 CPython 子进程，使用 `src/service_adapter.py` 的 JSON 任务契约。机器学习训练模型目录当前为 0 项；基于技能画像的补位评分属于规则评分，不提供模型概率或置信度。
          </Typography.Paragraph>
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Card title={<span><SafetyCertificateOutlined />　机器学习训练模型</span>} className="full-height-card">
          <div className="model-empty-state">
            <Typography.Title level={2} className="model-count">{catalog.trainedModels.length}</Typography.Title>
            <Typography.Text strong>已训练且可由后端直接加载的模型</Typography.Text>
            <Typography.Paragraph type="secondary" className="small-note">
              当前目录内的训练阶段文件是交付与统计报告，不是模型权重文件。系统不将运筹优化程序登记为机器学习训练模型。
            </Typography.Paragraph>
          </div>
          <Typography.Paragraph type="secondary" className="small-note">
            当前排班算法的有效版本及阶段证据见下方版本链与报告目录。机器学习模型注册需提供训练产物、特征定义、训练数据版本和独立评估结果。
          </Typography.Paragraph>
        </Card>
      </Col>
    </Row>

    <Card title="模型与交付版本链" className="section-card">
      <Table
        rowKey="version"
        size="middle"
        dataSource={catalog.versionChain}
        columns={versionColumns}
        pagination={false}
        scroll={{ x: 1260 }}
      />
      <Typography.Paragraph type="secondary" className="small-note">
        阶段报告中的全周期规模和性能是报告记录值；本机已实际复现的是 `info` 与 7 d `solve_demo`。完整 62 d 求解的本机验收状态以验收记录为准。
      </Typography.Paragraph>
    </Card>

    <Card title="多目标权重与业务解释" className="section-card">
      <Table
        rowKey="name"
        size="middle"
        dataSource={model.objectiveWeights}
        columns={weightColumns}
        pagination={false}
        scroll={{ x: 940 }}
      />
      <Row gutter={[16, 12]} className="top-space">
        {model.constraintFamilies.map((item) => (
          <Col xs={24} md={12} xl={8} key={item.name}>
            <Card size="small" title={item.name}>
              <Typography.Paragraph type="secondary" className="small-note">{item.explanation}</Typography.Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
      <Typography.Paragraph type="secondary" className="small-note">
        C1-C13 约束编号、业务规则字段对应关系及假设 A1-A15 的完整映射以综合交付报告第 4 章为准。页面摘要不替代约束定义文件。
      </Typography.Paragraph>
    </Card>

    <Card title={`FULL62-W1 阶段基准：${baseline.period}`} className="section-card">
      <Alert type="warning" showIcon message="阶段基准来源限制" description={baseline.sourceNote} />
      <Row gutter={[16, 16]} className="stat-row top-space">
        <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title="计薪总工时" value={baseline.totalPaidHours} suffix="h" /></Card></Col>
        <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title="标准工时" value={baseline.standardHours} suffix="h" /></Card></Col>
        <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title="整班加班工时" value={baseline.overtimeHours} suffix="h" /></Card></Col>
        <Col xs={12} xl={6}><Card size="small" className="stat-card"><Statistic title="非完整班工时" value={baseline.partialShiftHours} suffix="h" /></Card></Col>
      </Row>
      <Table
        rowKey="label"
        size="middle"
        dataSource={coverageRows}
        pagination={false}
        columns={[
          { title: '覆盖需求口径', dataIndex: 'label', key: 'label' },
          { title: '需求', dataIndex: 'demandPersonShifts', key: 'demandPersonShifts', align: 'right', render: (value: number) => `${value.toLocaleString()} 人班` },
          { title: '已覆盖', dataIndex: 'coveredPersonShifts', key: 'coveredPersonShifts', align: 'right', render: (value: number) => `${value.toLocaleString()} 人班` },
          { title: '缺口', dataIndex: 'gapPersonShifts', key: 'gapPersonShifts', align: 'right', render: (value: number) => `${value.toLocaleString()} 人班` },
          { title: '覆盖率', dataIndex: 'ratePercent', key: 'ratePercent', align: 'right', render: (value: number) => `${value.toFixed(2)}%` },
        ]}
        className="top-space"
        scroll={{ x: 780 }}
      />
      <Row gutter={[16, 16]} className="top-space">
        <Col xs={24} xl={12}>
          <Card size="small" title="加班与负荷平衡">
            <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="员工人数">{baseline.employeeCount} 人</Descriptions.Item>
              <Descriptions.Item label="平均加班">{baseline.overtime.meanHoursPerEmployee} h/人</Descriptions.Item>
              <Descriptions.Item label="加班极差">{baseline.overtime.rangeHours} h</Descriptions.Item>
              <Descriptions.Item label="变异系数">{baseline.overtime.coefficientOfVariation}</Descriptions.Item>
              <Descriptions.Item label="基尼系数">{baseline.overtime.gini}</Descriptions.Item>
              <Descriptions.Item label="P90/P10">{baseline.overtime.p90ToP10Ratio}</Descriptions.Item>
              <Descriptions.Item label="超 36 h 人月数">{baseline.overtime.employeeMonthsOver36Hours} 人月</Descriptions.Item>
              <Descriptions.Item label="容量利用率">{baseline.capacityUtilizationPercent}%</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="指标定义与限制">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="产量口径制造生产力">{baseline.manufacturingProductivity.status}</Descriptions.Item>
              <Descriptions.Item label="原因与替代指标">{baseline.manufacturingProductivity.reason}</Descriptions.Item>
              <Descriptions.Item label="生产工时占比">{baseline.productionHoursSharePercent}%</Descriptions.Item>
              <Descriptions.Item label="关键岗缺口双口径">{baseline.keyPositionGap.map((item) => `${item.label}：${item.gapPersonShifts} 人班`).join('；')}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </Card>

    <Card title="阶段报告与验收证据" className="section-card">
      <Row gutter={[16, 16]}>
        {catalog.reports.map((report) => (
          <Col xs={24} xl={12} key={report.id}>
            <Card
              size="small"
              title={report.title}
              extra={<Tag color="blue">{report.fileVersion}</Tag>}
              className="report-card"
            >
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="文件版本">{report.fileVersion}</Descriptions.Item>
                <Descriptions.Item label="正文标题版本">{report.documentVersion}</Descriptions.Item>
                <Descriptions.Item label="交付内容">{report.deliverables}</Descriptions.Item>
                <Descriptions.Item label="统计来源">{report.evidenceScope}</Descriptions.Item>
              </Descriptions>
              {report.fileVersion !== report.documentVersion && (
                <Alert
                  className="top-space"
                  type="info"
                  showIcon
                  message="文件名与正文版本标记不同"
                  description={`文件名标记为 ${report.fileVersion}，报告正文标题标记为 ${report.documentVersion}；系统保留两项原始标记。`}
                />
              )}
              <Typography.Paragraph type="secondary" className="small-note">{report.summary}</Typography.Paragraph>
              <Space wrap>
                <Button type="primary" icon={<EyeOutlined />} onClick={() => setPreview(report)}>查看报告</Button>
                <Button
                  icon={<DownloadOutlined />}
                  href={`/model-reports/${report.assetFile}`}
                  download={report.originalFileName}
                >下载 HTML 原件</Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </Card>

    <Card title="本机任务适配接口" className="section-card">
      <Table rowKey="command" size="middle" dataSource={tasks} pagination={false} columns={[
        { title: '功能', dataIndex: 'name', key: 'name' },
        { title: '适配任务', dataIndex: 'command', key: 'command', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
        { title: '输入', dataIndex: 'input', key: 'input' },
        { title: '输出', dataIndex: 'result', key: 'result' },
      ]} />
      <Typography.Paragraph type="secondary" className="small-note">
        阶段基准覆盖率为 85.28%（求解口径）和 85.03%（独立核验重建口径）。这两项是报告登记值，不是本机新求解结果；两种需求的差异为 {baseline.coverage.differencePersonShifts} 人班、{baseline.coverage.differenceCells} 个班次。
      </Typography.Paragraph>
    </Card>

    <Modal
      title={preview?.title}
      open={preview !== null}
      onCancel={() => setPreview(null)}
      width="min(1440px, calc(100vw - 32px))"
      destroyOnHidden
      footer={preview ? (
        <Space>
          <Typography.Text type="secondary">{preview.evidenceScope}</Typography.Text>
          <Button
            icon={<DownloadOutlined />}
            href={`/model-reports/${preview.assetFile}`}
            download={preview.originalFileName}
          >下载 HTML 原件</Button>
          <Button onClick={() => setPreview(null)}>关闭</Button>
        </Space>
      ) : null}
    >
      {preview && (
        <iframe
          className="model-report-frame"
          title={preview.title}
          src={`/model-reports/${preview.assetFile}`}
          sandbox=""
          referrerPolicy="no-referrer"
        />
      )}
    </Modal>
  </>;
}
