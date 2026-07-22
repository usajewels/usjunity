import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Table, Tag, Typography, Button, Space, Progress, Card, Descriptions, Modal, Spin } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import { planApi } from '../services/api';

const { Title, Text } = Typography;

export default function RunHistoryPage() {
  usePageTitle('Run History');
  const { projectId, planId } = useParams<{ projectId: string; planId: string }>();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<any>(null);

  useEffect(() => {
    if (!projectId || !planId) return;
    planApi.listRuns(projectId, planId, { page: 0, size: 50 })
      .then(({ data }) => setRuns(data.content || []))
      .finally(() => setLoading(false));
  }, [projectId, planId]);

  const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    QUEUED: { color: 'default', icon: <ClockCircleOutlined /> },
    RUNNING: { color: 'processing', icon: <LoadingOutlined /> },
    COMPLETED: { color: 'success', icon: <CheckCircleOutlined /> },
    FAILED: { color: 'error', icon: <CloseCircleOutlined /> },
  };

  const columns = [
    { title: 'Run Type', dataIndex: 'runType',
      render: (t: string) => <Tag color={t === 'DRY_RUN' ? 'orange' : 'blue'}>{t.replace('_', ' ')}</Tag> },
    { title: 'Status', dataIndex: 'status',
      render: (s: string) => <Tag icon={statusConfig[s]?.icon} color={statusConfig[s]?.color}>{s}</Tag> },
    { title: 'Plan Version', dataIndex: 'planVersion' },
    { title: 'Records', render: (_: any, r: any) => (
      r.recordsProcessed != null ? (
        <Space>
          <Text>{r.recordsProcessed} processed</Text>
          <Text type="success">{r.recordsSucceeded} ok</Text>
          {r.recordsFailed > 0 && <Text type="danger">{r.recordsFailed} failed</Text>}
        </Space>
      ) : <Text type="secondary">—</Text>
    )},
    { title: 'Started', dataIndex: 'startedAt',
      render: (d: string) => d ? new Date(d).toLocaleString() : '—' },
    { title: 'Duration', render: (_: any, r: any) => {
      if (!r.startedAt || !r.completedAt) return '—';
      const ms = new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime();
      return `${(ms / 1000).toFixed(1)}s`;
    }},
  ];

  return (
    <div>
      <Space style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/plans')}>Back</Button>
        <Title level={4} style={{ margin: 0 }}>Run History</Title>
      </Space>

      <Table columns={columns} dataSource={runs} loading={loading} rowKey="id"
        onRow={(record) => ({ onClick: () => setSelectedRun(record), style: { cursor: 'pointer' } })} />

      <Modal title="Run Details" open={!!selectedRun} onCancel={() => setSelectedRun(null)}
        footer={null} width={700}>
        {selectedRun && (
          <div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="Type">{selectedRun.runType}</Descriptions.Item>
              <Descriptions.Item label="Status"><Tag color={statusConfig[selectedRun.status]?.color}>{selectedRun.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="Plan Version">{selectedRun.planVersion}</Descriptions.Item>
              <Descriptions.Item label="Processed">{selectedRun.recordsProcessed ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Succeeded">{selectedRun.recordsSucceeded ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Failed">{selectedRun.recordsFailed ?? '—'}</Descriptions.Item>
            </Descriptions>
            {selectedRun.errors && (
              <div style={{ marginTop: 16 }}>
                <Title level={5}>Errors</Title>
                <pre style={{ background: '#fff2f0', padding: 12, borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
                  {JSON.stringify(selectedRun.errors, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
