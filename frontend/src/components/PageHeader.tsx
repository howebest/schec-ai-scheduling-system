import { Breadcrumb, Typography } from 'antd';
import type { ReactNode } from 'react';

export default function PageHeader({ title, description, extra, breadcrumbs = [] }: {
  title: string;
  description: string;
  extra?: ReactNode;
  breadcrumbs?: string[];
}) {
  return (
    <div className="page-header">
      {breadcrumbs.length > 0 && <Breadcrumb items={breadcrumbs.map((item) => ({ title: item }))} />}
      <div className="page-header-row">
        <div>
          <Typography.Title level={3}>{title}</Typography.Title>
          <Typography.Paragraph type="secondary" className="page-description">{description}</Typography.Paragraph>
        </div>
        {extra && <div className="page-header-extra">{extra}</div>}
      </div>
    </div>
  );
}
