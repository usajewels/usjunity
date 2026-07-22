import { useEffect, useState } from 'react';
import {
  Table, Tag, Typography, Input, Select, Space, Card, Tooltip, ConfigProvider,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api, usePageTitle } from '@mxsuite/shared';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

interface AuditEvent {
  id: string;
  actorName: string;
  actorRole: string;
  platformAction: boolean;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string;
  timestamp: string;
}

const ACTION_STYLES: Record<string, { label: string; style: React.CSSProperties }> = {
  CREATE: { label: 'Created', style: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' } },
  UPDATE: { label: 'Updated', style: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' } },
  APPROVE: { label: 'Approved', style: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' } },
  REJECT: { label: 'Rejected', style: { backgroundColor: '#fff2f0', color: '#cf1322', borderColor: '#ffa39e' } },
  UPLOAD: { label: 'Uploaded', style: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' } },
  UPLOAD_LOGO: { label: 'Logo Upload', style: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' } },
  ASSIGN_COACH: { label: 'Coach Assigned', style: { backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' } },
  UNASSIGN_COACH: { label: 'Coach Removed', style: { backgroundColor: '#fff2f0', color: '#cf1322', borderColor: '#ffa39e' } },
  ADVANCE_PHASE: { label: 'Phase Advanced', style: { backgroundColor: '#fffbe6', color: '#ad6800', borderColor: '#ffe58f' } },
  UPDATE_MAPPING: { label: 'Mapping Updated', style: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' } },
  APPROVE_MAPPING: { label: 'Mapping Approved', style: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' } },
  AUTHORIZE: { label: 'Authorized', style: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' } },
};

const ENTITY_LABELS: Record<string, string> = {
  FieldMapping: 'Field Mapping',
  SemanticDecision: 'Decision',
  ApprovalRequest: 'Approval',
  ProjectAsset: 'File',
  OnboardingProject: 'Onboarding',
  Project: 'Project',
  Tenant: 'Organization',
};

export default function TenantActivityPage() {
  usePageTitle('Activity');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/audit', {
        params: { page, size: pageSize, sort: 'timestamp,desc' },
      });
      setEvents(data.content || []);
      setTotal(data.totalElements || 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvents(); }, [page, pageSize]);

  // Client-side filtering for search, action, and entity type
  const filtered = events.filter((evt) => {
    if (actionFilter && evt.action !== actionFilter) return false;
    if (entityFilter && evt.entityType !== entityFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        evt.actorName.toLowerCase().includes(q) ||
        (evt.entityName || '').toLowerCase().includes(q) ||
        evt.action.toLowerCase().includes(q) ||
        evt.entityType.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Unique values for filter dropdowns
  const uniqueActions = [...new Set(events.map((e) => e.action))];
  const uniqueEntities = [...new Set(events.map((e) => e.entityType))];

  const columns: ColumnsType<AuditEvent> = [
    {
      title: 'When',
      dataIndex: 'timestamp',
      width: 180,
      sorter: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      defaultSortOrder: 'descend',
      render: (t: string) => (
        <Tooltip title={dayjs(t).format('YYYY-MM-DD HH:mm:ss')}>
          <Text>{dayjs(t).fromNow()}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Who',
      dataIndex: 'actorName',
      width: 180,
      sorter: (a, b) => (a.actorName || '').localeCompare(b.actorName || ''),
      render: (name: string, r: AuditEvent) => (
        <Space size={4}>
          <Text>{name}</Text>
          {r.platformAction && <Tag style={{ backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0', fontSize: 11 }}>Coach</Tag>}
        </Space>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      width: 160,
      sorter: (a, b) => (a.action || '').localeCompare(b.action || ''),
      render: (a: string) => {
        const info = ACTION_STYLES[a] || { label: a.replace(/_/g, ' '), style: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' } };
        return <Tag style={info.style}>{info.label}</Tag>;
      },
    },
    {
      title: 'What',
      sorter: (a, b) => (a.entityType || '').localeCompare(b.entityType || ''),
      render: (_: unknown, r: AuditEvent) => {
        const entityLabel = ENTITY_LABELS[r.entityType] || r.entityType;
        return (
          <Text>
            {entityLabel}{r.entityName ? `: ${r.entityName}` : ''}
          </Text>
        );
      },
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
        <Title level={4} style={{ margin: 0, color: '#2d1854' }}>Activity</Title>
        <Text style={{ color: '#6b4fa0' }}>All onboarding activity for your organization</Text>
      </div>

      <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        <Card size="small" style={{ marginBottom: 16, borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}>
          <Space wrap>
            <Input
              placeholder="Search activity..."
              prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
              style={{ width: 220 }}
            />
            <Select
              placeholder="Action"
              value={actionFilter}
              onChange={setActionFilter}
              allowClear
              style={{ width: 160 }}
              suffixIcon={<SearchOutlined style={{ color: '#6b4fa0' }} />}
              options={uniqueActions.map((a) => ({
                value: a,
                label: ACTION_STYLES[a]?.label || a.replace(/_/g, ' '),
              }))}
            />
            <Select
              placeholder="Type"
              value={entityFilter}
              onChange={setEntityFilter}
              allowClear
              style={{ width: 160 }}
              suffixIcon={<SearchOutlined style={{ color: '#6b4fa0' }} />}
              options={uniqueEntities.map((e) => ({
                value: e,
                label: ENTITY_LABELS[e] || e,
              }))}
            />
          </Space>
        </Card>

        <Table
          columns={columns}
          dataSource={filtered}
          loading={loading}
          rowKey="id"
          pagination={{
            current: page + 1,
            pageSize,
            total: search || actionFilter || entityFilter ? filtered.length : total,
            onChange: (p, ps) => {
              setPage(p - 1);
              setPageSize(ps);
            },
            showSizeChanger: true,
            showTotal: (t) => `${t} events`,
          }}
        />
      </ConfigProvider>
    </div>
  );
}
