import { useEffect, useState } from 'react';
import {
  Card, Table, Tag, Tabs, Typography, Spin, Button, Radio, Space, Drawer,
  Divider, List, message, ConfigProvider,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { SemanticDecisionDto, DecisionStatus } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';

const { Title, Text, Paragraph } = Typography;

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  OPEN: { backgroundColor: '#fffbe6', color: '#ad6800', borderColor: '#ffe58f' },
  APPROVED: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' },
  REJECTED: { backgroundColor: '#fff2f0', color: '#cf1322', borderColor: '#ffa39e' },
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

interface DecisionStats {
  all: number;
  open: number;
  approved: number;
  rejected: number;
}

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export default function TenantDecisionsPage() {
  usePageTitle('Decisions');
  const [decisions, setDecisions] = useState<SemanticDecisionDto[]>([]);
  const [stats, setStats] = useState<DecisionStats>({ all: 0, open: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [selected, setSelected] = useState<SemanticDecisionDto | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | undefined>(undefined);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async (status?: DecisionStatus) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page: 0, size: 100 };
      if (status) params.status = status;
      const { data } = await tenantOnboardingApi.listDecisions(params);
      const list = (data as { content?: SemanticDecisionDto[] }).content || (data as SemanticDecisionDto[]);
      setDecisions(list);

      // Compute stats from full list when loading "all"
      if (!status) {
        const s: DecisionStats = { all: list.length, open: 0, approved: 0, rejected: 0 };
        list.forEach((d: SemanticDecisionDto) => {
          if (d.decisionStatus === 'OPEN') s.open++;
          else if (d.decisionStatus === 'APPROVED') s.approved++;
          else if (d.decisionStatus === 'REJECTED') s.rejected++;
        });
        setStats(s);
      }
    } catch {
      message.error('Failed to load decisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    const map: Record<string, DecisionStatus | undefined> = {
      all: undefined, open: 'OPEN', approved: 'APPROVED', rejected: 'REJECTED',
    };
    load(map[key]);
  };

  const handleApprove = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await tenantOnboardingApi.updateDecision(selected.id, {
        decisionStatus: 'APPROVED',
        selectedOption,
      });
      message.success('Decision approved');
      load(activeTab === 'all' ? undefined : activeTab.toUpperCase() as DecisionStatus);
      setSelected(null);
    } catch {
      message.error('Failed to approve decision');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await tenantOnboardingApi.updateDecision(selected.id, {
        decisionStatus: 'REJECTED',
        selectedOption,
      });
      message.success('Decision rejected');
      load(activeTab === 'all' ? undefined : activeTab.toUpperCase() as DecisionStatus);
      setSelected(null);
    } catch {
      message.error('Failed to reject decision');
    } finally {
      setActionLoading(false);
    }
  };

  const columns: ColumnsType<SemanticDecisionDto> = [
    {
      title: 'Decision',
      dataIndex: 'title',
      key: 'title',
      sorter: (a, b) => (a.title || '').localeCompare(b.title || ''),
      render: (title: string) => <Text strong>{title}</Text>,
    },
    {
      title: 'Context',
      dataIndex: 'fieldContext',
      key: 'fieldContext',
      sorter: (a, b) => (a.fieldContext || '').localeCompare(b.fieldContext || ''),
      render: (ctx: string) => <Text type="secondary">{ctx || '—'}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'decisionStatus',
      key: 'status',
      width: 120,
      sorter: (a, b) => (a.decisionStatus || '').localeCompare(b.decisionStatus || ''),
      render: (status: string) => <Tag style={STATUS_STYLES[status]}>{STATUS_LABELS[status] || status}</Tag>,
    },
    {
      title: 'Age',
      dataIndex: 'createdAt',
      key: 'age',
      width: 80,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (date: string) => <Text type="secondary">{daysAgo(date)}d</Text>,
    },
  ];

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Decisions</Title>
        <Text style={{ color: '#6b4fa0' }}>
          Review decisions about your data migration. Select an option and approve or reject each decision.
        </Text>
      </div>

      <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        {/* Stats bar */}
        <Card size="small" style={{ marginBottom: 16, borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}>
          <Space size="large">
            <div><Text type="secondary">Total: </Text><Text strong style={{ color: '#2d1854' }}>{stats.all}</Text></div>
            <div><Text type="secondary">Open: </Text><Text strong style={{ color: '#ad6800' }}>{stats.open}</Text></div>
            <div><Text type="secondary">Approved: </Text><Text strong style={{ color: '#237804' }}>{stats.approved}</Text></div>
            <div><Text type="secondary">Rejected: </Text><Text strong style={{ color: '#cf1322' }}>{stats.rejected}</Text></div>
          </Space>
        </Card>

        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          items={[
            { key: 'all', label: `All (${stats.all})` },
            { key: 'open', label: `Open (${stats.open})` },
            { key: 'approved', label: `Approved (${stats.approved})` },
            { key: 'rejected', label: `Rejected (${stats.rejected})` },
          ]}
          style={{ marginBottom: 8 }}
        />

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin tip="Loading decisions..." />
          </div>
        ) : (
          <Table<SemanticDecisionDto>
            columns={columns}
            dataSource={decisions}
            rowKey="id"
            pagination={false}
            onRow={(record) => ({
              onClick: () => {
                setSelected(record);
                setSelectedOption(record.selectedOption);
              },
              style: { cursor: 'pointer' },
            })}
            locale={{ emptyText: 'No decisions yet. Your onboarding coach will create them as they review your data.' }}
          />
        )}
      </ConfigProvider>

      {/* Detail drawer */}
      <Drawer
        title={selected?.title || 'Decision Detail'}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={420}
      >
        {selected && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {selected.summary && (
              <div>
                <Text style={{ color: '#2d1854', fontWeight: 600, fontSize: 11 }}>SUMMARY</Text>
                <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{selected.summary}</Paragraph>
              </div>
            )}

            {selected.fieldContext && (
              <div>
                <Text style={{ color: '#2d1854', fontWeight: 600, fontSize: 11 }}>FIELD / CONTEXT</Text>
                <div style={{ marginTop: 4 }}>
                  <Text code>{selected.fieldContext}</Text>
                </div>
              </div>
            )}

            <div>
              <Text style={{ color: '#2d1854', fontWeight: 600, fontSize: 11 }}>STATUS</Text>
              <div style={{ marginTop: 4 }}>
                <Tag style={STATUS_STYLES[selected.decisionStatus]}>{STATUS_LABELS[selected.decisionStatus] || selected.decisionStatus}</Tag>
              </div>
            </div>

            {selected.options && selected.options.length > 0 && (
              <div>
                <Text style={{ color: '#2d1854', fontWeight: 600, fontSize: 11 }}>OPTIONS</Text>
                <ConfigProvider theme={{ token: { colorPrimary: '#6b4fa0' } }}>
                  <Radio.Group
                    value={selectedOption}
                    onChange={(e) => setSelectedOption(e.target.value)}
                    style={{ width: '100%', marginTop: 8 }}
                    disabled={selected.decisionStatus !== 'OPEN'}
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {selected.options.map((opt, idx) => (
                        <Radio key={idx} value={idx} style={{ display: 'block', lineHeight: '24px' }}>
                          <Text strong={selectedOption === idx}>
                            {opt.label}
                            {opt.isRecommended && (
                              <Tag style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5', marginLeft: 6, fontSize: 10 }}>Recommended</Tag>
                            )}
                          </Text>
                          {opt.description && (
                            <div style={{ marginLeft: 24 }}>
                              <Text type="secondary" style={{ fontSize: 12 }}>{opt.description}</Text>
                            </div>
                          )}
                        </Radio>
                      ))}
                    </Space>
                  </Radio.Group>
                </ConfigProvider>
              </div>
            )}

            {selected.requirements && selected.requirements.length > 0 && (
              <>
                <Divider style={{ margin: '8px 0', borderColor: '#e0d4f5' }} />
                <div>
                  <Text style={{ color: '#2d1854', fontWeight: 600, fontSize: 11 }}>REQUIREMENTS</Text>
                  <List
                    size="small"
                    dataSource={selected.requirements}
                    renderItem={(req) => (
                      <List.Item style={{ padding: '4px 0' }}>
                        <Text style={{ fontSize: 12 }}>
                          {String((req as Record<string, unknown>).label || (req as Record<string, unknown>).description || JSON.stringify(req))}
                        </Text>
                      </List.Item>
                    )}
                  />
                </div>
              </>
            )}

            {selected.decisionStatus === 'OPEN' && (
              <>
                <Divider style={{ margin: '8px 0', borderColor: '#e0d4f5' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    onClick={handleApprove}
                    loading={actionLoading}
                    style={{ flex: 1, background: '#2d1854', borderColor: '#2d1854' }}
                  >
                    Approve
                  </Button>
                  <Button
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={handleReject}
                    loading={actionLoading}
                    style={{ flex: 1 }}
                  >
                    Reject
                  </Button>
                </div>
              </>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
