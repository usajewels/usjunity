import { useEffect, useState, useCallback, useRef } from 'react';
import { Table, Tag, Typography, Modal, Space, Switch, Input, Select, ConfigProvider } from 'antd';
import { SearchOutlined, HistoryOutlined } from '@ant-design/icons';
import type { TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
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

const ALL_ACTIONS = [
  'ACTIVATE', 'ADVANCE_PHASE', 'APPROVE', 'APPROVE_MAPPING', 'ARCHIVE',
  'ASSIGN_COACH', 'AUTHORIZE', 'CANCEL_INVITE', 'CHANGE_PASSWORD',
  'CLEAR_MAPPINGS', 'CLONE_MAPPING', 'CREATE', 'DATA_CORRECTION',
  'DEACTIVATE', 'DELETE', 'ENTITY_COVERAGE_OVERRIDE',
  'EXECUTE_DRY_RUN', 'EXECUTE_FULL_RUN', 'GATE_CLEARED', 'GENERATE_RECON',
  'INVITE', 'LOGIN_FAILED', 'PASSWORD_RESET', 'PUBLISH', 'REJECT', 'REOPEN',
  'RESEND_INVITE', 'SELECT_SHEET', 'SELECT_TABLES', 'SHARE', 'SIGN_OFF',
  'SUBMIT', 'UNASSIGN_COACH', 'UPDATE', 'UPDATE_DEFINITION',
  'UPDATE_MAPPING', 'UPDATE_MIGRATION', 'UPDATE_PROFILE', 'UPDATE_SCHEMA',
  'UPLOAD', 'UPLOAD_LOGO', 'UPLOAD_PREVIEW',
];

const formatAction = (a: string) =>
  a.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

const ACTION_OPTIONS = ALL_ACTIONS.map((a) => ({ value: a, label: formatAction(a) }));

const ACTION_COLOR: Record<string, React.CSSProperties> = {};
const setColor = (actions: string[], style: React.CSSProperties) =>
  actions.forEach((a) => { ACTION_COLOR[a] = style; });

setColor(
  ['CREATE', 'INVITE', 'ACTIVATE', 'CLONE_MAPPING', 'RESEND_INVITE'],
  { backgroundColor: '#f6ffed', color: '#389e0d', borderColor: '#b7eb8f' },
);
setColor(
  ['UPDATE', 'UPDATE_MAPPING', 'UPDATE_MIGRATION', 'UPDATE_DEFINITION', 'UPDATE_PROFILE', 'UPDATE_SCHEMA', 'CHANGE_PASSWORD', 'PASSWORD_RESET', 'DATA_CORRECTION', 'ENTITY_COVERAGE_OVERRIDE'],
  { backgroundColor: '#e6f7ff', color: '#096dd9', borderColor: '#91d5ff' },
);
setColor(
  ['DELETE', 'DEACTIVATE', 'CANCEL_INVITE', 'CLEAR_MAPPINGS', 'REJECT', 'LOGIN_FAILED'],
  { backgroundColor: '#fff1f0', color: '#cf1322', borderColor: '#ffa39e' },
);
setColor(
  ['APPROVE', 'APPROVE_MAPPING', 'AUTHORIZE', 'SIGN_OFF', 'PUBLISH'],
  { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' },
);
setColor(
  ['ADVANCE_PHASE', 'GATE_CLEARED', 'SUBMIT', 'REOPEN', 'ARCHIVE'],
  { backgroundColor: '#fffbe6', color: '#d48806', borderColor: '#ffe58f' },
);
setColor(
  ['ASSIGN_COACH', 'UNASSIGN_COACH'],
  { backgroundColor: '#e6fffb', color: '#08979c', borderColor: '#87e8de' },
);
setColor(
  ['UPLOAD', 'UPLOAD_LOGO', 'UPLOAD_PREVIEW', 'SELECT_SHEET', 'SELECT_TABLES'],
  { backgroundColor: '#f0f5ff', color: '#1d39c4', borderColor: '#adc6ff' },
);
setColor(
  ['EXECUTE_DRY_RUN', 'EXECUTE_FULL_RUN', 'GENERATE_RECON'],
  { backgroundColor: '#fff2e8', color: '#d4380d', borderColor: '#ffbb96' },
);
setColor(
  ['SHARE'],
  { backgroundColor: '#e6fffb', color: '#08979c', borderColor: '#87e8de' },
);

const defaultActionStyle: React.CSSProperties = { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' };

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

export default function ActivityLogPage() {
  usePageTitle('Activity Log');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [platformOnly, setPlatformOnly] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [sortField, setSortField] = useState<string>('timestamp');
  const [sortOrder, setSortOrder] = useState<'ascend' | 'descend'>('descend');

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchEvents = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, size: pageSize };
      if (platformOnly) params.platformOnly = true;
      if (searchText.trim()) params.search = searchText.trim();
      if (actionFilter) params.action = actionFilter;
      if (roleFilter) params.actorRole = roleFilter;
      params.sort = `${sortField},${sortOrder === 'ascend' ? 'asc' : 'desc'}`;

      const { data } = await auditApi.list(params as any);
      if (!signal?.aborted) {
        setEvents(data.content || []);
        setTotal(data.page?.totalElements ?? 0);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, pageSize, platformOnly, searchText, actionFilter, roleFilter, sortField, sortOrder]);

  useEffect(() => {
    const ac = new AbortController();
    fetchEvents(ac.signal);
    return () => ac.abort();
  }, [fetchEvents]);

  const handleSearch = (value: string) => {
    setSearchText(value);
    setPage(0);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!value) {
      setSearchText('');
      setPage(0);
    } else {
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        setSearchText(value);
        setPage(0);
      }, 400);
    }
  };

  const handleTableChange = (pagination: TablePaginationConfig, _filters: any, sorter: SorterResult<AuditEvent> | SorterResult<AuditEvent>[]) => {
    setPage((pagination.current ?? 1) - 1);
    setPageSize(pagination.pageSize ?? 20);
    if (!Array.isArray(sorter) && sorter.field) {
      setSortField(sorter.field as string);
      setSortOrder(sorter.order || 'descend');
    }
  };

  const columns = [
    {
      title: 'Timestamp', dataIndex: 'timestamp', width: 180,
      sorter: true,
      sortOrder: sortField === 'timestamp' ? sortOrder : undefined,
      render: (t: string) => dayjs(t).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: 'Actor', dataIndex: 'actorName', width: 150,
      sorter: true,
      sortOrder: sortField === 'actorName' ? sortOrder : undefined,
    },
    {
      title: 'Role', dataIndex: 'actorRole', width: 140,
      render: (r: string) => <Tag style={ROLE_STYLES[r] || {}}>{ROLE_LABELS[r] || r.replace('_', ' ')}</Tag>,
    },
    {
      title: 'Action', dataIndex: 'action', width: 160,
      sorter: true,
      sortOrder: sortField === 'action' ? sortOrder : undefined,
      render: (a: string) => <Tag style={ACTION_COLOR[a] || defaultActionStyle}>{formatAction(a)}</Tag>,
    },
    {
      title: 'Entity', width: 200,
      render: (_: any, r: AuditEvent) => <Text>{r.entityType}: {r.entityName || r.entityId?.substring(0, 8)}</Text>,
    },
    {
      title: 'Platform', dataIndex: 'platformAction', width: 100,
      render: (p: boolean) => p
        ? <Tag style={{ backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' }}>Platform</Tag>
        : <Tag style={{ backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' }}>Member</Tag>,
    },
  ];

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
        margin: '-24px -24px 24px -24px',
        padding: '28px 32px 20px 32px',
        borderBottom: '3px solid #6b4fa0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <HistoryOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Activity Log</Title>
          </div>
        </div>
        <Space>
          <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Platform actions only:</Text>
          <Switch checked={platformOnly} onChange={(v) => { setPlatformOnly(v); setPage(0); }}
            style={platformOnly ? { backgroundColor: '#2d1854' } : {}} />
        </Space>
      </div>

      <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        <Space style={{ marginBottom: 16 }} size="middle" wrap>
          <Input.Search
            placeholder="Search by actor, entity, or action"
            allowClear
            onSearch={handleSearch}
            onChange={handleSearchChange}
            style={{ width: 320 }}
            size="large"
            enterButton={<SearchOutlined style={{ color: '#fff' }} />}
          />
          <Select
            placeholder="Filter by action"
            allowClear
            style={{ minWidth: 180 }}
            size="large"
            options={ACTION_OPTIONS}
            value={actionFilter}
            onChange={(v) => { setActionFilter(v || undefined); setPage(0); }}
            showSearch
            suffixIcon={<SearchOutlined style={{ color: '#6b4fa0' }} />}
          />
          <Select
            placeholder="Filter by role"
            allowClear
            style={{ minWidth: 180 }}
            size="large"
            options={ROLE_OPTIONS}
            value={roleFilter}
            onChange={(v) => { setRoleFilter(v || undefined); setPage(0); }}
            suffixIcon={<SearchOutlined style={{ color: '#6b4fa0' }} />}
          />
        </Space>

        <Table<AuditEvent>
          columns={columns}
          dataSource={events}
          loading={loading}
          rowKey="id"
          onChange={handleTableChange}
          onRow={(record) => ({ onClick: () => setSelectedEvent(record), style: { cursor: 'pointer' } })}
          pagination={{
            current: page + 1,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} events`,
          }}
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
