import {
  AlertOutlined, ApartmentOutlined, AppstoreOutlined, AreaChartOutlined, BarChartOutlined, DatabaseOutlined,
  DotChartOutlined, FileSearchOutlined, HistoryOutlined, SafetyCertificateOutlined, ExperimentOutlined,
  ScheduleOutlined, SettingOutlined, TeamOutlined, UserOutlined, CalendarOutlined, ControlOutlined,
} from '@ant-design/icons';
import { Menu } from 'antd';

export type PageKey = 'overview' | 'scheduling' | 'schedules' | 'incidents' | 'shopfloor' | 'rotationConfig' | 'rotationCalendar' | 'people' | 'analytics' | 'dataAnalysis' | 'scheduleAnalysis' | 'decisionLab' | 'archive' | 'rules' | 'models' | 'data' | 'integrations' | 'feedback';

const groups = [
  { type: 'group', label: '排班工作台', children: [
    { key: 'overview', icon: <AppstoreOutlined />, label: '运行总览' },
    { key: 'scheduling', icon: <ScheduleOutlined />, label: '排班任务' },
    { key: 'rotationConfig', icon: <ControlOutlined />, label: '排班配置' },
    { key: 'rotationCalendar', icon: <CalendarOutlined />, label: '排班日历' },
    { key: 'schedules', icon: <FileSearchOutlined />, label: '方案管理' },
    { key: 'incidents', icon: <AlertOutlined />, label: '异常调度' },
    { key: 'shopfloor', icon: <ApartmentOutlined />, label: '现场模拟看板' },
  ] },
  { type: 'group', label: '数据分析', children: [
    { key: 'people', icon: <TeamOutlined />, label: '人员与技能' },
    { key: 'analytics', icon: <BarChartOutlined />, label: 'KPI 与解释' },
    { key: 'dataAnalysis', icon: <DotChartOutlined />, label: '排班数据分析' },
    { key: 'scheduleAnalysis', icon: <AreaChartOutlined />, label: '排班管理分析' },
    { key: 'decisionLab', icon: <ExperimentOutlined />, label: '排班决策实验室' },
    { key: 'archive', icon: <HistoryOutlined />, label: '调度档案' },
  ] },
  { type: 'group', label: '系统配置', children: [
    { key: 'rules', icon: <SettingOutlined />, label: '规则配置' },
    { key: 'models', icon: <SafetyCertificateOutlined />, label: '模型与算法' },
    { key: 'data', icon: <DatabaseOutlined />, label: '数据管理' },
    { key: 'integrations', icon: <AlertOutlined />, label: '连接器状态' },
    { key: 'feedback', icon: <UserOutlined />, label: '员工反馈' },
  ] },
];

export default function Navigation({ selected, collapsed, onSelect }: {
  selected: PageKey;
  collapsed: boolean;
  onSelect: (key: PageKey) => void;
}) {
  const items = groups.map((group) => ({
    type: 'group' as const,
    label: group.label,
    children: group.children.map((item) => ({ ...item, title: item.label })),
  }));
  return (
    <Menu
      className="side-menu"
      mode="inline"
      inlineCollapsed={collapsed}
      selectedKeys={[selected]}
      items={items}
      onClick={({ key }) => onSelect(key as PageKey)}
    />
  );
}
