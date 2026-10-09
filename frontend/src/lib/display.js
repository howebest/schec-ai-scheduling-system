const STATUS_LABELS = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const SOURCE_LABELS = {
  accepted_baseline: '已验收基准',
  raw_sample: '原始样本',
  user_import: '用户导入',
  synthetic_demo: '合成演示',
  simulated_feedback: '本机模拟反馈',
  local_config: '本机配置',
  local_reference: '本地参考清单',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status ?? '未知状态';
}

export function sourceLabel(sourceType) {
  return SOURCE_LABELS[sourceType] ?? sourceType ?? '来源未登记';
}

export function formatMetric(value, unit = '') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '无可计算值';
  const formatted = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value));
  if (unit === '%') return `${formatted}%`;
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('zh-CN', { hour12: false });
}
