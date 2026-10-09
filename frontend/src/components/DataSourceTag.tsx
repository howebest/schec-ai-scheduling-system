import { Tag } from 'antd';
import { sourceLabel } from '../lib/display.js';

const colors: Record<string, string> = {
  accepted_baseline: 'blue', raw_sample: 'default', user_import: 'cyan',
  synthetic_demo: 'gold', simulated_feedback: 'purple', local_config: 'blue', local_reference: 'cyan',
};

export default function DataSourceTag({ sourceType }: { sourceType: string }) {
  return <Tag color={colors[sourceType] ?? 'default'}>{sourceLabel(sourceType)}</Tag>;
}
