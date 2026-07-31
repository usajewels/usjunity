import React from 'react';
import { Switch, Tag, Tooltip, Typography } from 'antd';
import type { EntityCoverageEntry } from '@mxsuite/shared';

const { Text } = Typography;

interface Props {
  coverage: EntityCoverageEntry[];
  readOnly?: boolean;
  onToggle?: (entity: string, active: boolean) => void;
}

const confidenceColor = (confidence: number): string => {
  if (confidence >= 90) return '#52c41a'; // green
  if (confidence >= 60) return '#faad14'; // yellow/amber
  return '#ff4d4f'; // red
};

const EntityCoveragePanel: React.FC<Props> = ({ coverage, readOnly = false, onToggle }) => {
  if (!coverage || coverage.length === 0) return null;

  const activeCount = coverage.filter(e => e.active).length;

  return (
    <div style={{
      background: '#fafafa',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      padding: '12px 16px',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>Entity Scope</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {activeCount} of {coverage.length} entities in scope
        </Text>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {coverage.map(entry => {
          const isActive = entry.active;
          const hasOverride = entry.coachOverride !== null && entry.coachOverride !== undefined;

          return (
            <Tooltip
              key={entry.entity}
              title={
                <div style={{ maxWidth: 280 }}>
                  <div><strong>{entry.entity.replace(/([a-z])([A-Z])/g, '$1 $2')}</strong></div>
                  <div style={{ marginTop: 4 }}>{entry.reasoning}</div>
                  <div style={{ marginTop: 4, color: '#aaa' }}>
                    Confidence: {entry.confidence}%
                    {hasOverride && ' (coach override)'}
                  </div>
                </div>
              }
            >
              <Tag
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  borderRadius: 6,
                  opacity: isActive ? 1 : 0.5,
                  borderStyle: hasOverride ? 'dashed' : 'solid',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: confidenceColor(entry.confidence),
                  }}
                />
                <span style={{ fontSize: 12 }}>{entry.entity.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>
                {!readOnly && (
                  <Switch
                    size="small"
                    checked={isActive}
                    onChange={(checked) => onToggle?.(entry.entity, checked)}
                  />
                )}
              </Tag>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};

export default EntityCoveragePanel;
