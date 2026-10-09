import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Alert, App as AntApp, Spin } from 'antd';
import type { ReactNode } from 'react';
import { api, type DatasetRecord } from './api/client';
import type { PageKey } from './layout/Navigation';
import AppShell from './layout/AppShell';
import DashboardPage from './features/dashboard/page';
import SchedulingPage from './features/scheduling/page';
import SchedulesPage from './features/schedules/page';
import IncidentsPage from './features/incidents/page';
import ShopfloorPage from './features/shopfloor/page';
import PeoplePage from './features/people/page';
import AnalyticsPage from './features/analytics/page';
import ArchivePage from './features/archive/page';
import RulesPage from './features/rules/page';
import ModelsPage from './features/models/page';
import DataPage from './features/data/page';
import IntegrationsPage from './features/integrations/page';
import FeedbackPage from './features/feedback/page';
import RotationConfigPage from './features/rotation/config-page';
import RotationCalendarPage from './features/rotation/calendar-page';

const ScheduleAnalysisPage = lazy(() => import('./features/schedule-analysis/page'));
const ScheduleDataAnalysisPage = lazy(() => import('./features/data-analysis/page'));
const DecisionLabPage = lazy(() => import('./features/decision-lab/page'));

const TITLES: Record<PageKey, string> = {
  overview: '运行总览', scheduling: '排班任务', rotationConfig: '排班配置', rotationCalendar: '排班日历', schedules: '方案管理', incidents: '异常调度', shopfloor: '现场模拟看板',
  people: '人员与技能', analytics: 'KPI 与解释', dataAnalysis: '排班数据分析', scheduleAnalysis: '排班管理分析', decisionLab: '排班决策实验室', archive: '调度档案', rules: '规则配置',
  models: '模型与算法', data: '数据管理', integrations: '连接器状态', feedback: '员工反馈',
};

export default function App() {
  const { message: messageApi } = AntApp.useApp();
  const [page, setPage] = useState<PageKey>('overview');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [datasetId, setDatasetId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    Promise.all([api.health(), api.datasets()])
      .then(([health, result]) => {
        if (!active) return;
        setConnectionError('');
        setDatasets(result.items ?? []);
        setDatasetId((current) => current ?? result.items?.find((item) => item.id === 'accepted-baseline-v1')?.id ?? result.items?.[0]?.id);
        if (health.status !== 'ok') setConnectionError('本机服务状态异常，请检查服务进程和日志。');
      })
      .catch((error: Error) => { if (active) setConnectionError(error.message || '无法连接本机服务。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PageKey>).detail;
      if (detail in TITLES) setPage(detail);
    };
    window.addEventListener('navigate-page', handler);
    return () => window.removeEventListener('navigate-page', handler);
  }, []);

  const onDatasetChange = (id: string) => {
    setDatasetId(id);
    messageApi.success('数据版本已切换。');
  };

  let content;
  if (loading) content = <div className="initial-loading"><Spin size="large" /><span>正在读取本机服务状态</span></div>;
  else if (connectionError) content = <div className="connection-error"><Alert type="error" showIcon message="本机服务不可用" description={connectionError} /><p>请在工程包目录运行统一启动脚本，并确认健康检查返回正常状态。</p></div>;
  else {
    const common = { datasetId, datasets, refresh, notify: (text: string) => messageApi.success(text) };
    const pageContent: Record<PageKey, ReactNode> = {
      overview: <DashboardPage {...common} />,
      scheduling: <SchedulingPage {...common} />,
      rotationConfig: <RotationConfigPage />,
      rotationCalendar: <RotationCalendarPage />,
      schedules: <SchedulesPage {...common} />,
      incidents: <IncidentsPage {...common} />,
      shopfloor: <ShopfloorPage {...common} />,
      people: <PeoplePage {...common} />,
      analytics: <AnalyticsPage {...common} />,
      dataAnalysis: <Suspense fallback={<div className="initial-loading"><Spin /><span>正在载入排班数据分析</span></div>}><ScheduleDataAnalysisPage {...common} /></Suspense>,
      scheduleAnalysis: <Suspense fallback={<div className="initial-loading"><Spin /><span>正在载入排班管理分析</span></div>}><ScheduleAnalysisPage {...common} /></Suspense>,
      decisionLab: <Suspense fallback={<div className="initial-loading"><Spin /><span>正在载入排班决策实验室</span></div>}><DecisionLabPage {...common} /></Suspense>,
      archive: <ArchivePage {...common} />,
      rules: <RulesPage {...common} />,
      models: <ModelsPage {...common} />,
      data: <DataPage {...common} />,
      integrations: <IntegrationsPage {...common} />,
      feedback: <FeedbackPage {...common} />,
    };
    content = pageContent[page];
  }

  return (
    <AppShell selected={page} onSelect={setPage} datasets={datasets} datasetId={datasetId} onDatasetChange={onDatasetChange}>
      <div className="visually-hidden" aria-live="polite">当前页面：{TITLES[page]}</div>
      {content}
    </AppShell>
  );
}
