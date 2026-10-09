import { InfoCircleOutlined } from '@ant-design/icons';
import { Popover, Typography } from 'antd';
import type { HelpDefinition } from '../help/metadata';

export default function FieldHelp({ definition }: { definition: HelpDefinition }) {
  return (
    <Popover
      title={definition.title}
      content={(
        <div className="field-help-content">
          <Typography.Paragraph><b>用途：</b>{definition.purpose}</Typography.Paragraph>
          <Typography.Paragraph><b>来源或默认值：</b>{definition.sourceOrDefault}</Typography.Paragraph>
          {definition.unit && <Typography.Paragraph><b>单位：</b>{definition.unit}</Typography.Paragraph>}
          <Typography.Paragraph><b>影响：</b>{definition.impact}</Typography.Paragraph>
          {definition.limitation && <Typography.Paragraph><b>限制：</b>{definition.limitation}</Typography.Paragraph>}
        </div>
      )}
      trigger="click"
      placement="topLeft"
    >
      <button type="button" className="field-help-button" aria-label={`${definition.title}说明`}>
        <InfoCircleOutlined />
      </button>
    </Popover>
  );
}
