import { useEffect, useMemo, useState } from 'react';
import {
  Table, Tag, Typography, Input, Progress, Space, Select, Button, Popconfirm,
  message, Row, Col, Tabs, Alert, ConfigProvider,
} from 'antd';
import {
  CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
  SearchOutlined, StopOutlined, DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  coachMappingApi,
  type OnboardingMapping,
  type OnboardingMappingStats,
} from '../services/api';

const { Text } = Typography;

const STATUS_CONFIG: Record<string, { style: React.CSSProperties; icon?: React.ReactNode; label: string }> = {
  MAPPED: { style: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' }, icon: <CheckCircleOutlined />, label: 'Approved' },
  NEEDS_REVIEW: { style: { backgroundColor: '#ffffff', color: '#6b4fa0', borderColor: '#6b4fa0' }, icon: <ClockCircleOutlined />, label: 'Needs Review' },
  CFV_PROPOSAL: { style: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' }, icon: <ExclamationCircleOutlined />, label: 'Proposal' },
  REJECTED: { style: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' }, icon: <StopOutlined />, label: 'Skipped' },
  UNMAPPED: { style: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' }, label: 'Unmapped' },
};

const STATUS_SORT_ORDER: Record<string, number> = {
  NEEDS_REVIEW: 0, UNMAPPED: 1, CFV_PROPOSAL: 2, MAPPED: 3, REJECTED: 4,
};

interface Props {
  tenantId: string;
}

export default function CoachMappingsTab({ tenantId }: Props) {
  const [mappings, setMappings] = useState<OnboardingMapping[]>([]);
  const [stats, setStats] = useState<OnboardingMappingStats>({
    total: 0, mapped: 0, needsReview: 0, unmapped: 0, rejected: 0,
  });
  const [loading, setLoading] = useState(true);
  const [hasProject, setHasProject] = useState<boolean | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [targetFilter, setTargetFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadMappings = () => {
    setLoading(true);
    Promise.all([
      coachMappingApi.getProject(tenantId),
      coachMappingApi.listMappings(tenantId, { page: 0, size: 500 }),
      coachMappingApi.getStats(tenantId),
    ])
      .then(([projectRes, mappingsRes, statsRes]) => {
        setHasProject(projectRes.data.hasProject);
        const content = (mappingsRes.data as any).content ?? mappingsRes.data;
        setMappings(Array.isArray(content) ? content : []);
        setStats(statsRes.data);
      })
      .catch(() => message.error('Failed to load mappings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadMappings(); }, [tenantId]);

  const handleClearMappings = async () => {
    try {
      const { data } = await coachMappingApi.clearMappings(tenantId);
      message.success(`Cleared ${data.cleared} mappings. The tenant can now re-upload to trigger fresh mapping.`);
      loadMappings();
    } catch {
      message.error('Failed to clear mappings');
    }
  };

  const entityOptions = useMemo(() => {
    const entities = new Set(mappings.map((m) => m.targetEntity).filter(Boolean));
    return [
      ...Array.from(entities).sort().map((e) => ({ value: e!, label: e! })),
      { value: 'Unassigned', label: 'Unassigned' },
    ];
  }, [mappings]);

  const filtered = mappings.filter((m) => {
    if (statusFilter !== 'ALL' && m.mappingStatus !== statusFilter) return false;
    if (targetFilter === 'Unassigned' && m.targetField) return false;
    if (targetFilter && targetFilter !== 'Unassigned' && m.targetEntity !== targetFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!m.sourceField.toLowerCase().includes(q)
          && !(m.targetField || '').toLowerCase().includes(q)
          && !(m.sampleValue || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const columns: ColumnsType<OnboardingMapping> = [
    {
      title: 'Source Field',
      dataIndex: 'sourceField',
      key: 'sourceField',
      width: 160,
      sorter: (a, b) => a.sourceField.localeCompare(b.sourceField),
      render: (field: string) => <Text strong>{field}</Text>,
    },
    {
      title: 'Sample',
      dataIndex: 'sampleValue',
      key: 'sampleValue',
      width: 150,
      ellipsis: true,
      render: (val: string) => <Text type="secondary" style={{ fontSize: 12 }}>{val || '—'}</Text>,
    },
    {
      title: 'Target Field',
      key: 'target',
      width: 230,
      sorter: (a, b) => {
        const aKey = `${a.targetEntity || ''}.${a.targetField || ''}`;
        const bKey = `${b.targetEntity || ''}.${b.targetField || ''}`;
        return aKey.localeCompare(bKey);
      },
      render: (_, record) =>
        record.targetField ? (
          <Tag style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>
            {record.targetEntity ? `${record.targetEntity}.` : ''}{record.targetField}
          </Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Customer Note',
      dataIndex: 'customerComment',
      key: 'comment',
      width: 180,
      ellipsis: true,
      render: (val: string) => val
        ? <Text type="secondary" style={{ fontSize: 12 }} title={val}>{val}</Text>
        : null,
    },
    {
      title: 'Confidence',
      dataIndex: 'confidencePct',
      key: 'confidence',
      width: 110,
      align: 'center',
      sorter: (a, b) => (a.confidencePct ?? -1) - (b.confidencePct ?? -1),
      render: (pct: number) => pct != null ? (
        <Progress
          percent={pct}
          size="small"
          strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#6b4fa0' : '#ff4d4f'}
          style={{ width: 75 }}
        />
      ) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'mappingStatus',
      key: 'status',
      width: 130,
      sorter: (a, b) =>
        (STATUS_SORT_ORDER[a.mappingStatus] ?? 99) - (STATUS_SORT_ORDER[b.mappingStatus] ?? 99),
      render: (status: string) => {
        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.UNMAPPED;
        return <Tag icon={cfg.icon} style={cfg.style}>{cfg.label}</Tag>;
      },
    },
  ];

  const tabs = [
    { key: 'ALL', label: `All (${stats.total})` },
    { key: 'NEEDS_REVIEW', label: `Needs Review (${stats.needsReview})` },
    { key: 'MAPPED', label: `Mapped (${stats.mapped})` },
    { key: 'UNMAPPED', label: `Unmapped (${stats.unmapped})` },
    ...(stats.rejected > 0 ? [{ key: 'REJECTED', label: `Skipped (${stats.rejected})` }] : []),
  ];

  if (hasProject === false) {
    return (
      <Alert
        type="info"
        message="No onboarding project yet"
        description="This organization has not started their onboarding. An onboarding project is created automatically when they first visit the My Onboarding page."
        showIcon
        style={{ marginTop: 8, background: '#f3eeff', borderColor: '#e0d4f5' }}
      />
    );
  }

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
    <div>
      <Row align="middle" style={{ marginBottom: 8 }}>
        <Col flex="auto">
          <Tabs
            activeKey={statusFilter}
            onChange={setStatusFilter}
            items={tabs}
            style={{ marginBottom: 0 }}
            size="small"
          />
        </Col>
        <Col>
          <Space>
            <Input
              placeholder="Search fields..."
              prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 180 }}
              size="small"
            />
            <Select
              placeholder="Target entity"
              allowClear
              value={targetFilter}
              onChange={setTargetFilter}
              style={{ width: 140 }}
              size="small"
              options={entityOptions}
            />
            <Popconfirm
              title="Clear all mappings?"
              description="This will delete all mappings for this project. The tenant will need to re-upload their file to generate fresh mappings."
              onConfirm={handleClearMappings}
              okText="Clear"
              okButtonProps={{ danger: true }}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
              >
                Clear Mappings
              </Button>
            </Popconfirm>
          </Space>
        </Col>
      </Row>

      <Table<OnboardingMapping>
        columns={columns}
        dataSource={filtered}
        loading={loading}
        rowKey="id"
        size="small"
        scroll={{ x: 1000 }}
        pagination={{ pageSize: 50, hideOnSinglePage: true, showTotal: (t) => `${t} fields` }}
        locale={{ emptyText: loading ? 'Loading...' : 'No mappings found.' }}
        rowClassName={(r) => r.mappingStatus === 'REJECTED' ? 'opacity-50' : ''}
      />
    </div>
    </ConfigProvider>
  );
}
