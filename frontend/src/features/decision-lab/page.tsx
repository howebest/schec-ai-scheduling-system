import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api, type JobRecord, type ScheduleRecord } from '../../api/client';
import type { PageProps } from '../types';
import PageHeader from '../../components/PageHeader';
import { groupComparablePlans } from './metrics.js';
import { loadAnalyzedDecisionPlan } from './plan-data';
import PlanComparison from './PlanComparison';
import ScenarioForm from './ScenarioForm';
import ScenarioRunPanel from './ScenarioRunPanel';
import type { AnalyzedDecisionPlan, ScenarioSubmission } from './types';

type ArchiveItem = { schedule: ScheduleRecord; job?: JobRecord | null };

async function loadPlans(items: ArchiveItem[], concurrency = 5) {
  const pending = [...items];
  const plans: AnalyzedDecisionPlan[] = [];
  const errors: string[] = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (pending.length) {
      const item = pending.shift();
      if (!item) return;
      try {
        plans.push(await loadAnalyzedDecisionPlan({ ...item.schedule, job: item.job }));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `读取方案 ${item.schedule.schedule_id} 失败。`);
      }
    }
  }));
  return { plans, errors };
}

export default function DecisionLabPage({ datasetId, datasets, refresh, notify }: PageProps) {
  const [plans, setPlans] = useState<AnalyzedDecisionPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [readErrors, setReadErrors] = useState<string[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submittedJob, setSubmittedJob] = useState<JobRecord | null>(null);
  const [runBaseline, setRunBaseline] = useState<AnalyzedDecisionPlan | null>(null);
  const [resultPlan, setResultPlan] = useState<AnalyzedDecisionPlan | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [jobPollError, setJobPollError] = useState('');
  const [lastJobReadAt, setLastJobReadAt] = useState('');
  const groups = useMemo(() => groupComparablePlans(plans), [plans]);
  const dataset = datasets.find((item) => item.id === datasetId);

  const submitScenario = async (values: ScenarioSubmission) => {
    const baselinePlan = plans.find((plan) => plan.record.id === values.baselineScheduleId) ?? null;
    if (!baselinePlan || !dataset || (dataset.source_type !== 'accepted_baseline' && dataset.source_type !== 'user_import')) {
      setSubmitError('当前数据集或基线方案不满足本机重排条件。');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    setJobPollError('');
    setLastJobReadAt('');
    setResultPlan(null);
    try {
      const result = await api.createJob({
        kind: 'reschedule',
        dataset_id: values.datasetId,
        baseline_schedule_id: values.baselineScheduleId,
        actor_id: values.actorId,
        actor_role: values.actorRole,
        reason: values.reason,
        event: values.event,
        parameters: { window_days: 7, time_limit_seconds: 45, scenario_name: values.scenarioName },
      });
      setSubmittedJob(result.job);
      setRunBaseline(baselinePlan);
      notify(`情景重排任务已提交，编号 ${result.job.id}。`);
    } catch (error) {
      const requestError = error as Error & { fieldErrors?: Array<{ field?: string; message?: string; code?: string }> };
      const fieldMessages = requestError.fieldErrors?.map((item) => [item.field, item.message ?? item.code].filter(Boolean).join('：')).filter(Boolean) ?? [];
      setSubmitError([requestError.message || '服务端拒绝了本次情景任务。', ...fieldMessages].join('；'));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!submittedJob || ['succeeded', 'failed', 'cancelled'].includes(submittedJob.status)) return undefined;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await api.job(submittedJob.id);
        if (!active) return;
        setJobPollError('');
        setLastJobReadAt(new Date().toLocaleString('zh-CN'));
        setSubmittedJob(response.job);
        if (['succeeded', 'failed', 'cancelled'].includes(response.job.status)) {
          if (response.job.status !== 'succeeded') return;
          setResultLoading(true);
          try {
            for (let attempt = 0; attempt < 4; attempt += 1) {
              const archive = await api.archive({ dataset_id: response.job.dataset_id, limit: 500 });
              const item = archive.items.find((entry) => entry.schedule.job_id === response.job.id);
              if (item) {
                const analyzed = await loadAnalyzedDecisionPlan({ ...item.schedule, job: item.job ?? response.job });
                if (active) {
                  setResultPlan(analyzed);
                  setReloadKey((value) => value + 1);
                  refresh();
                }
                return;
              }
              if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 5000));
            }
          } catch (error) {
            if (active) setSubmitError(error instanceof Error ? error.message : '读取重排结果失败。');
          } finally {
            if (active) setResultLoading(false);
          }
          return;
        }
        timer = setTimeout(poll, 5000);
      } catch (error) {
        if (active) {
          setJobPollError(error instanceof Error ? error.message : '读取任务状态失败。');
          timer = setTimeout(poll, 5000);
        }
      }
    };
    void poll();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [submittedJob?.id]);

  useEffect(() => {
    let active = true;
    if (!datasetId) {
      setPlans([]);
      setSelectedPlanId(undefined);
      setReadErrors([]);
      setArchiveError('');
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setPlans([]);
    setSelectedPlanId(undefined);
    setArchiveError('');
    setReadErrors([]);
    api.archive({ dataset_id: datasetId, limit: 100 })
      .then(async (result) => {
        const available = (result.items ?? []).filter((item) => item.schedule.dataset_id === datasetId);
        const loaded = await loadPlans(available);
        if (!active) return;
        setPlans(loaded.plans);
        setReadErrors(loaded.errors);
        setSelectedPlanId((current) => loaded.plans.some((plan) => plan.record.id === current) ? current : loaded.plans[0]?.record.id);
      })
      .catch((error: Error) => {
        if (active) {
          setPlans([]);
          setReadErrors([]);
          setArchiveError(error.message || '无法读取当前数据版本的方案档案。');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [datasetId, refresh, reloadKey]);

  return <>
    <PageHeader title="排班决策实验室" description="围绕已登记排班方案开展同口径成本与覆盖率权衡分析，查看方案差异，并在兼容数据集上提交事件驱动的增量重排情景。" extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => setReloadKey((value) => value + 1)}>刷新方案</Button>} />
    <Alert className="section-card" type="info" showIcon message="分析与推演边界" description="方案指标从已登记 CSV 和关联本机反馈计算。模拟成本是工时成本代理值；合成数据和规则模拟结果不代表现场实绩或独立核验结论。情景重排只向服务端判定兼容的已验收基准或用户导入数据开放。" />
    {dataset && <Space className="section-card"><span>当前数据集：{dataset.display_name} · {dataset.version}</span><span>来源：{dataset.source_type}</span></Space>}
    {archiveError && <Alert className="section-card" type="error" showIcon message="方案档案读取失败" description={archiveError} />}
    {readErrors.length > 0 && <Alert className="section-card" type="warning" showIcon message={`有 ${readErrors.length} 套方案读取失败`} description={<ul>{readErrors.slice(0, 8).map((error) => <li key={error}>{error}</li>)}</ul>} />}
    {loading && plans.length === 0 && <Card className="section-card"><div className="initial-loading"><Spin /><span>正在读取方案档案和排班指标</span></div></Card>}
    {!loading && !archiveError && dataset && <ScenarioForm datasetId={datasetId} datasets={datasets} baselines={plans.map((plan) => plan.record)} plans={plans} submitting={submitting} submitError={submitError} onSubmit={submitScenario} />}
    {submittedJob && <ScenarioRunPanel job={submittedJob} baseline={runBaseline} result={resultPlan} loading={resultLoading} pollError={jobPollError} lastStatusReadAt={lastJobReadAt} />}
    {!loading && !archiveError && plans.length > 0 && <PlanComparison groups={groups} plans={plans} loading={loading} selectedPlanId={selectedPlanId} onSelectPlan={setSelectedPlanId} />}
    {!loading && !archiveError && plans.length === 0 && <Card className="section-card"><Empty description="当前数据版本没有可分析的已登记排班方案" /></Card>}
    <div className="visually-hidden" aria-live="polite">当前分析方案编号：{selectedPlanId ?? '无'}</div>
  </>;
}
