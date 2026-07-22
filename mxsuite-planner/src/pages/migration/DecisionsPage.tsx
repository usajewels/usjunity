import { useEffect, useState } from 'react';
import { Table, Tag, Tabs, Typography, Spin, Button, Divider, List, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { SemanticDecisionDto, DecisionStatsDto, DecisionStatus } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';

const { Title, Text, Paragraph } = Typography;

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export default function DecisionsPage() {
  usePageTitle('Decisions');
  const [decisions, setDecisions] = useState<SemanticDecisionDto[]>([]);
  const [stats, setStats] = useState<DecisionStatsDto>({ all: 0, open: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SemanticDecisionDto | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [actionLoading, setActionLoading] = useState(false);

  const load = async (status?: DecisionStatus) => {
    try {
      const [listRes, statsRes] = await Promise.all([
        migrationApi.listDecisions({ status, page: 0, size: 50 }),
        migrationApi.getDecisionStats(),
      ]);
      setDecisions(listRes.data.content);
      setStats(statsRes.data);
    } catch {
      message.error('Failed to load decisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    const statusMap: Record<string, DecisionStatus | undefined> = {
      all: undefined, open: 'OPEN', approved: 'APPROVED', rejected: 'REJECTED',
    };
    setLoading(true);
    load(statusMap[key]);
  };

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      const { data } = await migrationApi.approveDecision(id);
      setDecisions(prev => prev.map(d => d.id === id ? data : d));
      setSelected(data);
      message.success('Decision approved');
      migrationApi.getDecisionStats().then(r => setStats(r.data));
    } catch {
      message.error('Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try {
      const { data } = await migrationApi.rejectDecision(id);
      setDecisions(prev => prev.map(d => d.id === id ? data : d));
      setSelected(data);
      message.success('Decision rejected');
      migrationApi.getDecisionStats().then(r => setStats(r.data));
    } catch {
      message.error('Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  const columns: ColumnsType<SemanticDecisionDto> = [
    {
      title: 'Decision',
      dataIndex: 'title',
      key: 'title',
      render: (title: string) => <Text strong style={{ fontSize: 13 }}>{title}</Text>,
    },
    {
      title: 'Project',
      dataIndex: 'projectName',
      key: 'project',
      render: (name: string) => <Text style={{ fontSize: 12 }}>{name || '—'}</Text>,
    },
    {
      title: 'Field / Context',
      dataIndex: 'fieldContext',
      key: 'fieldContext',
      render: (ctx: string) => <Text type="secondary" style={{ fontSize: 12 }}>{ctx || '—'}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'decisionStatus',
      key: 'status',
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status]}>{status}</Tag>
      ),
    },
    {
      title: 'Age',
      dataIndex: 'createdAt',
      key: 'age',
      width: 70,
      render: (date: string) => <Text type="secondary" style={{ fontSize: 12 }}>{daysAgo(date)}d</Text>,
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading decisions..." />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 200px)' }}>
      {/* Main table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
          margin: '-24px -24px 16px -24px',
          padding: '28px 32px 16px 32px',
          borderBottom: '2px solid #e0d4f5',
        }}>
          <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Semantic decisions</Title>
          <Text style={{ fontSize: 12, color: '#6b4fa0' }}>
            Every open semantic decision across all projects. Each item carries a description, its options, an owner and a status.
          </Text>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          size="small"
          items={[
            { key: 'all', label: `All ${stats.all}` },
            { key: 'open', label: `Open ${stats.open}` },
            { key: 'approved', label: `Approved ${stats.approved}` },
            { key: 'rejected', label: `Rejected ${stats.rejected}` },
          ]}
        />

        <Table
          columns={columns}
          dataSource={decisions}
          rowKey="id"
          size="small"
          pagination={false}
          onRow={(record) => ({
            onClick: () => setSelected(record),
            style: {
              cursor: 'pointer',
              background: selected?.id === record.id ? '#f0f5ff' : undefined,
            },
          })}
        />
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{
          width: 340,
          borderLeft: '1px solid #f0f0f0',
          overflow: 'auto',
          padding: 16,
          flexShrink: 0,
          marginLeft: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>DECISION DETAIL</Text>
            <a onClick={() => setSelected(null)} style={{ fontSize: 12 }}>Close</a>
          </div>

          <Title level={5} style={{ marginBottom: 8 }}>{selected.title}</Title>

          {selected.summary && (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>SUMMARY</Text>
              <Paragraph style={{ fontSize: 12, marginTop: 4 }}>{selected.summary}</Paragraph>
            </>
          )}

          {selected.fieldContext && (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>FIELD / CONTEXT</Text>
              <div style={{ marginTop: 4, marginBottom: 12 }}>
                <Text code style={{ fontSize: 12 }}>{selected.fieldContext}</Text>
              </div>
            </>
          )}

          {selected.options && selected.options.length > 0 && (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>OPTIONS</Text>
              <List
                size="small"
                dataSource={selected.options}
                renderItem={(opt, idx) => (
                  <List.Item style={{
                    padding: '6px 0',
                    background: selected.selectedOption === idx ? '#f6ffed' : undefined,
                  }}>
                    <div>
                      <Text strong={selected.selectedOption === idx} style={{ fontSize: 12 }}>
                        {opt.label}
                        {opt.isRecommended && <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>Recommended</Tag>}
                      </Text>
                      {opt.description && (
                        <div><Text type="secondary" style={{ fontSize: 11 }}>{opt.description}</Text></div>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            </>
          )}

          {selected.requirements && selected.requirements.length > 0 && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>TRACKED REQUIREMENTS</Text>
              <List
                size="small"
                dataSource={selected.requirements}
                renderItem={(req) => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Text style={{ fontSize: 12 }}>{String(req.label || req.description || JSON.stringify(req))}</Text>
                  </List.Item>
                )}
              />
            </>
          )}

          <Divider style={{ margin: '12px 0' }} />

          {selected.decisionStatus === 'OPEN' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => handleApprove(selected.id)}
                loading={actionLoading}
                style={{ flex: 1, background: '#52c41a', borderColor: '#52c41a' }}
              >
                Approve
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => handleReject(selected.id)}
                loading={actionLoading}
                style={{ flex: 1 }}
              >
                Reject
              </Button>
            </div>
          )}

          {selected.decisionStatus !== 'OPEN' && (
            <Tag color={STATUS_COLORS[selected.decisionStatus]} style={{ fontSize: 13 }}>
              {selected.decisionStatus}
            </Tag>
          )}
        </div>
      )}
    </div>
  );
}
