import { Button, Divider, List, Progress, Tag, Typography, Input, message } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import type { FieldMappingEntryDto } from '@mxsuite/shared';
import { useState } from 'react';
import { migrationApi } from '../../services/migrationApi';

const { Text, Title } = Typography;
const { TextArea } = Input;

const STATUS_COLORS: Record<string, string> = {
  MAPPED: 'green',
  NEEDS_REVIEW: 'orange',
  CFV_PROPOSAL: 'purple',
  REJECTED: 'red',
  UNMAPPED: 'default',
};

interface Props {
  mapping: FieldMappingEntryDto;
  projectId: string;
  isPlatformUser: boolean;
  onUpdated: (updated: FieldMappingEntryDto) => void;
  onClose: () => void;
}

export default function MappingDetailPanel({ mapping, projectId, isPlatformUser, onUpdated, onClose }: Props) {
  const [comment, setComment] = useState(mapping.customerComment || '');
  const [saving, setSaving] = useState(false);

  const handleApprove = async () => {
    setSaving(true);
    try {
      const { data } = await migrationApi.approveMapping(projectId, mapping.id);
      onUpdated(data);
      message.success('Mapping approved');
    } catch {
      message.error('Failed to approve mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveComment = async () => {
    setSaving(true);
    try {
      const { data } = await migrationApi.updateMapping(projectId, mapping.id, { customerComment: comment });
      onUpdated(data);
      message.success('Comment saved');
    } catch {
      message.error('Failed to save comment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      width: 340,
      borderLeft: '1px solid #f0f0f0',
      overflow: 'auto',
      padding: 16,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Title level={5} style={{ margin: 0, fontSize: 14 }}>
          {mapping.sourceEntity}.{mapping.sourceField}
        </Title>
        <a onClick={onClose} style={{ fontSize: 12 }}>Close</a>
      </div>

      <Tag color={STATUS_COLORS[mapping.mappingStatus]}>{mapping.mappingStatus.replace('_', ' ')}</Tag>

      {mapping.targetField && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>PROPOSED TARGET</Text>
          <div style={{ marginTop: 4 }}>
            <Text strong>{mapping.targetEntity}.{mapping.targetField}</Text>
          </div>
          {mapping.coercion && (
            <Text type="secondary" style={{ fontSize: 12 }}>{mapping.coercion}</Text>
          )}
          {mapping.confidencePct != null && (
            <Progress percent={mapping.confidencePct} size="small" style={{ width: 120, marginTop: 4 }} />
          )}
        </div>
      )}

      <Divider style={{ margin: '12px 0' }} />

      <Text type="secondary" style={{ fontSize: 11 }}>CANDIDATE FIELDS</Text>
      <List
        size="small"
        dataSource={mapping.candidates}
        renderItem={candidate => (
          <List.Item style={{ padding: '6px 0' }}>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12 }}>{candidate.targetField}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {candidate.matchPct}%
                </Text>
              </div>
              {candidate.description && (
                <Text type="secondary" style={{ fontSize: 11 }}>{candidate.description}</Text>
              )}
            </div>
          </List.Item>
        )}
        locale={{ emptyText: 'No candidates' }}
      />

      <Divider style={{ margin: '12px 0' }} />

      <Text type="secondary" style={{ fontSize: 11 }}>CUSTOMER COMMENT</Text>
      <TextArea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={3}
        placeholder="Add a comment..."
        style={{ marginTop: 4, fontSize: 12 }}
        disabled={isPlatformUser}
      />
      {!isPlatformUser && comment !== (mapping.customerComment || '') && (
        <Button size="small" onClick={handleSaveComment} loading={saving} style={{ marginTop: 4 }}>
          Save Comment
        </Button>
      )}

      <Divider style={{ margin: '12px 0' }} />

      {mapping.mappingStatus !== 'MAPPED' && (
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          block
          onClick={handleApprove}
          loading={saving}
          style={{ background: '#52c41a', borderColor: '#52c41a' }}
        >
          Approve Mapping
        </Button>
      )}
    </div>
  );
}
