import { Card, Skeleton, Statistic, Typography } from 'antd';
import FieldHelp from './FieldHelp';
import type { HelpDefinition } from '../help/metadata';

export default function StatTile({ title, value, suffix, loading, help, precision = 0, note }: {
  title: string;
  value?: number | null;
  suffix?: string;
  loading?: boolean;
  help?: HelpDefinition;
  precision?: number;
  note?: string;
}) {
  return (
    <Card className="stat-card">
      {loading ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : <>
        <div className="stat-heading"><Typography.Text type="secondary">{title}</Typography.Text>{help && <FieldHelp definition={help} />}</div>
        <Statistic value={value ?? '-'} precision={value == null ? undefined : precision} suffix={value == null ? undefined : suffix} />
        {note && <Typography.Text type="secondary" className="stat-note">{note}</Typography.Text>}
      </>}
    </Card>
  );
}
