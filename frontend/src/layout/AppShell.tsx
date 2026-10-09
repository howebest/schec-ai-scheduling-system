import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  MenuFoldOutlined, MenuUnfoldOutlined, ScheduleOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Layout, Select, Space, Tag, Typography } from 'antd';
import Navigation, { type PageKey } from './Navigation';
import type { DatasetRecord } from '../api/client';

const { Sider, Content } = Layout;

export default function AppShell({ selected, onSelect, datasets, datasetId, onDatasetChange, children }: {
  selected: PageKey;
  onSelect: (key: PageKey) => void;
  datasets: DatasetRecord[];
  datasetId?: string;
  onDatasetChange: (id: string) => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const choices = useMemo(() => datasets.map((dataset) => ({
    value: dataset.id,
    label: `${dataset.display_name} · ${dataset.version}`,
  })), [datasets]);
  return (
    <Layout className="app-layout">
      <Sider width={244} collapsedWidth={72} collapsed={collapsed} className="app-sider">
        <div className="brand-row">
          <div className="brand-mark"><ScheduleOutlined /></div>
          {!collapsed && <div className="brand-copy"><Typography.Text strong>智能排班工作台</Typography.Text><Typography.Text type="secondary">本机工程演示系统</Typography.Text></div>}
        </div>
        <div className="navigation-scroll"><Navigation selected={selected} collapsed={collapsed} onSelect={onSelect} /></div>
        <div className="sider-footer">
          <Button
            type="text"
            block={!collapsed}
            className="collapse-button"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开菜单' : '收起菜单'}
          >{collapsed ? null : '收起菜单'}</Button>
        </div>
      </Sider>
      <Layout className="main-layout">
        <div className="topbar">
          <Space size={12} className="topbar-context">
            <span className="context-label">数据版本</span>
            <Select
              aria-label="数据版本"
              className="dataset-select"
              size="middle"
              value={datasetId}
              options={choices}
              onChange={onDatasetChange}
              placeholder="请选择数据版本"
              showSearch
              optionFilterProp="label"
            />
            <Tag color="gold">本机演示</Tag>
          </Space>
          <Space className="user-menu"><Avatar size="small">計</Avatar><Typography.Text>本机计划员</Typography.Text></Space>
        </div>
        <Content className="content-scroll"><div className="content-inner">{children}</div></Content>
        <footer className="site-footer">本机运行 · 外部系统未连接 · 页面中的演示数据均标明来源</footer>
      </Layout>
    </Layout>
  );
}
