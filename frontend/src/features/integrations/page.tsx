import { Card, Table, Tag, Typography } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import type { PageProps } from '../types';

const connectors = [
  ['HR 人事', '员工主数据、组织关系和岗位信息'], ['APS 计划', '生产计划、工单和需求计划'],
  ['MES 制造执行', '生产状态、产量和设备运行事件'], ['考勤系统', '实际出勤、请假和工时记录'],
  ['OCC 订单协同', '订单、交期和优先级'], ['QMS 质量', '质量状态和生产限制'],
  ['WMS 仓储', '物料与库存状态'], ['企业微信/短信', '通知、确认和应急调度消息'],
  ['手环/定位设备', '现场状态与在岗确认'],
];

export default function IntegrationsPage(_props: PageProps) {
  return <>
    <PageHeader title="连接器状态" description="列示 RFP 中相关系统的本机集成边界。当前工程包不建立真实外部系统连接。" />
    <Card className="section-card">
      <Table rowKey="name" size="middle" pagination={false} dataSource={connectors.map(([name, scope]) => ({ name, scope }))} columns={[
        { title: '系统', dataIndex: 'name', key: 'name', width: 230, render: (value: string) => <span><ApiOutlined />　{value}</span> },
        { title: '计划接口数据', dataIndex: 'scope', key: 'scope' },
        { title: '本机状态', key: 'status', width: 180, render: () => <Tag>未连接</Tag> },
        { title: '处理方式', key: 'mode', width: 240, render: () => <Typography.Text type="secondary">使用包内样例或本机模拟数据</Typography.Text> },
      ]} />
      <Typography.Paragraph className="top-space" type="secondary">外部系统认证、凭证保存、数据传输和联调验收不属于本机工程包。页面不提供真实连接凭证输入，也不将本机模拟回执标记为外部系统成功回执。</Typography.Paragraph>
    </Card>
  </>;
}
