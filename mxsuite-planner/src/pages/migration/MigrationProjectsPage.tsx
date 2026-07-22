import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Tag, Typography, Input, Card, Progress, message, ConfigProvider } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { MigrationProject } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';
import PhaseLifecycleDots from '../../components/migration/PhaseLifecycleDots';

const { Title, Text } = Typography;

const STATUS_STYLES: Record<string, React.CSSProperties | undefined> = {
  ACTIVE: { backgroundColor: '#ffffff', color: '#6b4fa0', borderColor: '#6b4fa0' },
  PAUSED: undefined,
  COMPLETED: undefined,
  CANCELLED: undefined,
};
const STATUS_COLORS: Record<string, string> = {
  PAUSED: 'orange',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

const PHASE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover',
  MAP: 'Map',
  GENERATE: 'Generate',
  DRY_RUN: 'Dry Run',
  MIGRATE: 'Migrate',
  CUT_OVER: 'Cut Over',
};

export default function MigrationProjectsPage() {
  usePageTitle('Onboarding Projects');
  const navigate = useNavigate();
  const [projects, setProjects] = useState<MigrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    setLoading(true);
    migrationApi.listProjects({ page, size: pageSize })
      .then(({ data }) => {
        setProjects(data.content);
        setTotal(data.totalElements ?? 0);
      })
      .catch(() => message.error('Failed to load projects'))
      .finally(() => setLoading(false));
  }, [page, pageSize]);

  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage((pagination.current ?? 1) - 1);
    setPageSize(pagination.pageSize ?? 20);
  };

  const filtered = searchText.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(searchText.toLowerCase()))
    : projects;

  const columns: ColumnsType<MigrationProject> = [
    {
      title: 'Project',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record) => (
        <div>
          <Text strong>{name}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>PRJ-{record.id.substring(0, 4).toUpperCase()}</Text>
        </div>
      ),
    },
    {
      title: 'Organization',
      dataIndex: 'tenantName',
      key: 'tenantName',
      width: 180,
      sorter: (a, b) => (a.tenantName || '').localeCompare(b.tenantName || ''),
      render: (name: string) => name || <Text type="secondary">—</Text>,
    },
    {
      title: 'Source',
      dataIndex: 'sourceSystem',
      key: 'sourceSystem',
      width: 140,
      render: (v: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Target',
      dataIndex: 'targetSystem',
      key: 'targetSystem',
      width: 140,
      render: (v: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Phase',
      key: 'phase',
      width: 180,
      render: (_, record) => (
        <div>
          <PhaseLifecycleDots currentPhase={record.migrationPhase} gates={record.phaseGates} />
          <Text style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2, display: 'block' }}>
            {PHASE_LABELS[record.migrationPhase] || record.migrationPhase}
          </Text>
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'migrationStatus',
      key: 'migrationStatus',
      width: 120,
      filters: [
        { text: 'Active', value: 'ACTIVE' },
        { text: 'Paused', value: 'PAUSED' },
        { text: 'Completed', value: 'COMPLETED' },
        { text: 'Cancelled', value: 'CANCELLED' },
      ],
      onFilter: (value, record) => record.migrationStatus === value,
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || 'default'} style={STATUS_STYLES[status]}>
          {status === 'ACTIVE' ? 'In review' : status.charAt(0) + status.slice(1).toLowerCase()}
        </Tag>
      ),
    },
    {
      title: 'Reconciliation',
      dataIndex: 'reconciliationPct',
      key: 'reconciliationPct',
      width: 120,
      align: 'center',
      render: (pct: number) => (
        <Progress
          percent={pct || 0}
          size="small"
          strokeColor={pct >= 95 ? '#52c41a' : '#2d1854'}
          style={{ width: 80 }}
        />
      ),
    },
    { title: 'Owner', dataIndex: 'ownerName', key: 'ownerName', width: 150 },
  ];

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Onboarding Projects</Title>
        <Text style={{ color: '#6b4fa0' }}>Click a project to view its mappings and reconciliation.</Text>
      </div>

      <Card style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}>
        <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
          <Input.Search
            placeholder="Search projects..."
            allowClear
            onSearch={setSearchText}
            onChange={(e) => { if (!e.target.value) setSearchText(''); }}
            style={{ width: 320, marginBottom: 16 }}
            prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
            size="large"
          />
          <Table<MigrationProject>
            columns={columns}
            dataSource={filtered}
            loading={loading}
            rowKey="id"
            onChange={handleTableChange}
            onRow={(record) => ({
              onClick: () => navigate(`/plans/onboarding-projects/projects/${record.id}/mappings`),
              style: { cursor: 'pointer' },
            })}
            pagination={{
              current: page + 1,
              pageSize,
              total: searchText.trim() ? filtered.length : total,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50'],
              showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} projects`,
            }}
            locale={{ emptyText: 'No migration projects yet.' }}
          />
        </ConfigProvider>
      </Card>
    </div>
  );
}
