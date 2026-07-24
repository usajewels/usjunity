import { useEffect, useState, useMemo } from 'react';
import { Table, Tag, Typography, Modal, Space, Switch, Input, Select, ConfigProvider } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import { auditApi, type AuditEvent } from '../services/api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const ROLE_STYLES: Record<string, React.CSSProperties> = {
  PLATFORM_ADMIN: { backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' },
  COACH_ADMIN: { backgroundColor: '#44336b', color: '#ffffff', borderColor: '#44336b' },
  PLATFORM_SUPPORT: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' },
  TENANT_ADMIN: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' },
  TENANT_USER: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' },
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  COACH_ADMIN: 'Coach Admin',
  PLATFORM_SUPPORT: 'Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

export default function ActivityLogPage() {
  usePageTitle('Activity Log');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [platformOnly, setPlatformOnly] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const { data } = await auditApi.list({ page: 0, size: 50, platformOnly });
      setEvents(data.content || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvents(); }, [platformOnly]);

  // Derive unique action values for filter dropdown
  const actionOptions = useMemo(() => {
    const unique = [...new Set(events.map((e) => e.action))].sort();
    return unique.map((a) => ({ value: a, label: a }));
  }, [events]);

  // Derive unique role values for filter dropdown
  const roleOptions = useMemo(() => {
    const unique = [...new Set(events.map((e) => e.actorRole))].sort();
    return unique.map((r) => ({ value: r, label: ROLE_LABELS[r] || r.replace('_', ' ') }));
  }, [events]);

  // Client-side filtering
  const filteredEvents = useMemo(() => {
    let result = events;
    if (searchText) {
      const lower = searchText.toLowerCase();
      result = result.filter((e) =>
        e.actorName?.toLowerCase().includes(lower) ||
        e.entityName?.toLowerCase().includes(lower) ||
        e.entityType?.toLowerCase().includes(lower) ||
        e.action?.toLowerCase().includes(lower)
      );
    }
    if (actionFilter) {
      result = result.filter((e) => e.action === actionFilter);
    }
    if (roleFilter) {
      result = result.filter((e) => e.actorRole === roleFilter);
    }
    return result;
  }, [events, searchText, actionFilter, roleFilter]);

  const columns = [
    {
      title: 'Timestamp', dataIndex: 'timestamp', width: 180,
      sorter: (a: AuditEvent, b: AuditEvent) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: 'Actor', dataIndex: 'actorName', width: 150,
      sorter: (a: AuditEvent, b: AuditEvent) => (a.actorName || '').localeCompare(b.actorName || ''),
    },
    {
      title: 'Role', dataIndex: 'actorRole', width: 140,
      sorter: (a: AuditEvent, b: AuditEvent) => (a.actorRole || '').localeCompare(b.actorRole || ''),
      render: (r: string) => <Tag style={ROLE_STYLES[r] || {}}>{ROLE_LABELS[r] || r.replace('_', ' ')}</Tag>,
    },
    {
      title: 'Action', dataIndex: 'action', width: 160,
      sorter: (a: AuditEvent, b: AuditEvent) => (a.action || '').localeCompare(b.action || ''),
      render: (a: string) => <Tag style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>{a}</Tag>,
    },
    {
      title: 'Entity', width: 200,
      sorter: (a: AuditEvent, b: AuditEvent) => (a.entityType || '').localeCompare(b.entityType || ''),
      render: (_: any, r: AuditEvent) => <Text>{r.entityType}: {r.entityName || r.entityId?.substring(0, 8)}</Text>,
    },
    {
      title: 'Platform', dataIndex: 'platformAction', width: 100,
      sorter: (a: AuditEvent, b: AuditEvent) => Number(a.platformAction) - Number(b.platformAction),
      render: (p: boolean) => p
        ? <Tag style={{ backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' }}>Platform</Tag>
        : <Tag style={{ backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' }}>Member</Tag>,
    },
  ];

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <Title level={4} style={{ margin: 0, color: '#2d1854' }}>Activity Log</Title>
        <Space>
          <Text style={{ color: '#6b4fa0' }}>Platform actions only:</Text>
          <Switch checked={platformOnly} onChange={setPlatformOnly}
            style={platformOnly ? { backgroundColor: '#2d1854' } : {}} />
        </Space>
      </div>

      <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        <Space style={{ marginBottom: 16 }} size="middle" wrap>
          <Input.Search
            placeholder="Search by actor, entity, or action"
            allowClear
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 320 }}
            size="large"
            enterButton={<SearchOutlined style={{ color: '#fff' }} />}
          />
          <Select
            placeholder="Filter by action"
            allowClear
            style={{ minWidth: 180 }}
            size="large"
            options={actionOptions}
            value={actionFilter}
            onChange={(v) => setActionFilter(v || undefined)}
            suffixIcon={<SearchOutlined style={{ color: '#6b4fa0' }} />}
          />
          <Select
            placeholder="Filter by role"
            allowClear
            style={{ minWidth: 180 }}
            size="large"
            options={roleOptions}
            value={roleFilter}
            onChange={(v) => setRoleFilter(v || undefined)}
            suffixIcon={<SearchOutlined style={{ color: '#6b4fa0' }} />}
          />
        </Space>

        <Table<AuditEvent>
          columns={columns}
          dataSource={filteredEvents}
          loading={loading}
          rowKey="id"
          onRow={(record) => ({ onClick: () => setSelectedEvent(record), style: { cursor: 'pointer' } })}
        />
      </ConfigProvider>

      <Modal title="Event Details" open={!!selectedEvent} onCancel={() => setSelectedEvent(null)}
        footer={null} width={700}>
        {selectedEvent && (
          <div>
            <p><strong>Actor:</strong> {selectedEvent.actorName} ({ROLE_LABELS[selectedEvent.actorRole] || selectedEvent.actorRole})</p>
            <p><strong>Action:</strong> {selectedEvent.action}</p>
            <p><strong>Entity:</strong> {selectedEvent.entityType} — {selectedEvent.entityName}</p>
            <p><strong>Trace ID:</strong> {selectedEvent.traceId || 'N/A'}</p>
            {selectedEvent.beforeState && (
              <>
                <Title level={5}>Before</Title>
                <pre style={{ background: '#f9f6ff', padding: 12, borderRadius: 4, maxHeight: 200, overflow: 'auto', border: '1px solid #e0d4f5' }}>
                  {JSON.stringify(selectedEvent.beforeState, null, 2)}
                </pre>
              </>
            )}
            {selectedEvent.afterState && (
              <>
                <Title level={5}>After</Title>
                <pre style={{ background: '#f6ffed', padding: 12, borderRadius: 4, maxHeight: 200, overflow: 'auto', border: '1px solid #b7eb8f' }}>
                  {JSON.stringify(selectedEvent.afterState, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
