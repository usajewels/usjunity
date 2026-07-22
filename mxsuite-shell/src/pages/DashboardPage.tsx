import { useEffect, useState } from 'react';
import {
  Row, Col, Card, Statistic, Typography, Timeline, Button, Progress, Grid,
  Table, Tag, Alert, Spin, message, Input, Dropdown,
} from 'antd';
import {
  ProjectOutlined, FileTextOutlined, PlayCircleOutlined,
  TeamOutlined, ImportOutlined, BankOutlined,
  CheckCircleOutlined, ArrowRightOutlined,
  WarningOutlined, StopOutlined, BulbOutlined,
  SafetyCertificateOutlined, ClockCircleOutlined,
  DashboardOutlined, DatabaseOutlined, CloudServerOutlined,
  SearchOutlined, UserOutlined, DownloadOutlined, DownOutlined,
  ApiOutlined, HddOutlined, AuditOutlined, MailOutlined,
  GlobalOutlined, WifiOutlined,
} from '@ant-design/icons';
import { Pie } from '@ant-design/charts';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { api, usePageTitle } from '@mxsuite/shared';
import type {
  TenantOnboardingDto, CoachDashboardDto, OrgProgressDto,
  AdminDashboardDto, DependencyDto, ActiveSessionDto, EndpointMetricDto,
} from '@mxsuite/shared';

const { Title, Text } = Typography;

// --- Phase colors for tags and chart ---
const PHASE_COLORS: Record<string, string> = {
  DISCOVER: '#2d1854',
  MAP: '#6b4fa0',
  GENERATE: '#faad14',
  DRY_RUN: '#9b7fd4',
  MIGRATE: '#52c41a',
  CUT_OVER: '#1a0e3a',
};

const PHASE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover',
  MAP: 'Map',
  GENERATE: 'Generate',
  DRY_RUN: 'Dry Run',
  MIGRATE: 'Migrate',
  CUT_OVER: 'Cut Over',
};

// --- Category colors for dependency tags ---
const CATEGORY_COLORS: Record<string, string> = {
  Framework: 'green',
  Security: 'red',
  Database: 'purple',
  ORM: 'purple',
  Observability: 'cyan',
  Documentation: 'orange',
  'File Processing': 'purple',
  Serialization: 'magenta',
  Server: 'volcano',
  Logging: 'gold',
  'Dev Tools': 'default',
};

// --- Relative time helper ---
function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatUptime(millis: number): string {
  const secs = Math.floor(millis / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

// --- Export helpers ---
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDepsAsJson(deps: DependencyDto[]) {
  const data = deps.map(d => ({
    group: d.group,
    name: d.name,
    version: d.version,
    category: d.category,
  }));
  downloadFile(JSON.stringify(data, null, 2), 'mxsuite-dependencies.json', 'application/json');
}

function exportDepsAsCsv(deps: DependencyDto[]) {
  const header = 'Name,Group,Version,Category';
  const rows = deps.map(d =>
    `"${d.name}","${d.group}","${d.version}","${d.category}"`
  );
  downloadFile([header, ...rows].join('\n'), 'mxsuite-dependencies.csv', 'text/csv');
}

function exportDepsAsText(deps: DependencyDto[]) {
  const lines = deps.map(d => `${d.group}:${d.name}:${d.version}`);
  downloadFile(lines.join('\n'), 'mxsuite-dependencies.txt', 'text/plain');
}

// --- Action labels for audit events ---
const ACTION_LABELS: Record<string, string> = {
  CREATE: 'created',
  UPDATE: 'updated',
  APPROVE: 'approved',
  REJECT: 'rejected',
  UPLOAD: 'uploaded data for',
  ASSIGN_COACH: 'assigned coach to',
  ADVANCE_PHASE: 'advanced phase for',
};

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const { user, tenant, isPlatformUser, isPlatformAdmin } = useAuth();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  // Tenant state
  const [onboarding, setOnboarding] = useState<TenantOnboardingDto | null>(null);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);

  // Coach state
  const [dashboard, setDashboard] = useState<CoachDashboardDto | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // Admin state
  const [adminDash, setAdminDash] = useState<AdminDashboardDto | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    if (isPlatformAdmin) {
      setAdminLoading(true);
      api.get<AdminDashboardDto>('/admin/platform-dashboard')
        .then(({ data }) => setAdminDash(data))
        .catch(() => message.error('Failed to load platform dashboard'))
        .finally(() => setAdminLoading(false));
    } else if (isPlatformUser) {
      setDashboardLoading(true);
      api.get<CoachDashboardDto>('/admin/coach-dashboard')
        .then(({ data }) => setDashboard(data))
        .catch(() => message.error('Failed to load dashboard'))
        .finally(() => setDashboardLoading(false));
    } else {
      api.get<TenantOnboardingDto>('/my-onboarding')
        .then(({ data }) => setOnboarding(data))
        .catch(() => {/* no onboarding yet */})
        .finally(() => setOnboardingLoaded(true));
      api.get('/audit', { params: { page: 0, size: 10, sort: 'timestamp,desc' } })
        .then(({ data }) => setNotifications(data.content ?? []))
        .catch(() => {/* ignore */});
    }
  }, [isPlatformUser, isPlatformAdmin]);

  // ========= ADMIN PLATFORM SECTION =========

  const renderAdminDashboard = () => {
    if (adminLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      );
    }

    if (!adminDash) return null;

    const { systemHealth: sh, dependencies } = adminDash;

    const heapPct = sh.heapMax > 0 ? Math.round((sh.heapUsed / sh.heapMax) * 100) : 0;
    const cpuPct = sh.cpuUsage >= 0 ? Math.round(sh.cpuUsage * 100) : -1;
    const poolUsedPct = sh.dbPoolMax > 0
      ? Math.round((sh.dbPoolActive / sh.dbPoolMax) * 100) : 0;

    const heapColor = heapPct > 85 ? '#ff4d4f' : heapPct > 70 ? '#faad14' : '#52c41a';
    const cpuColor = cpuPct > 80 ? '#ff4d4f' : cpuPct > 60 ? '#faad14' : '#52c41a';

    const depColumns = [
      {
        title: 'Name',
        dataIndex: 'name',
        key: 'name',
        sorter: (a: DependencyDto, b: DependencyDto) => a.name.localeCompare(b.name),
      },
      {
        title: 'Group',
        dataIndex: 'group',
        key: 'group',
        responsive: ['md' as const],
        render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
      },
      {
        title: 'Version',
        dataIndex: 'version',
        key: 'version',
        width: 120,
        render: (v: string) => <Tag>{v}</Tag>,
      },
      {
        title: 'Category',
        dataIndex: 'category',
        key: 'category',
        width: 140,
        filters: [...new Set(dependencies.map(d => d.category))].map(c => ({ text: c, value: c })),
        onFilter: (value: unknown, record: DependencyDto) => record.category === value,
        render: (v: string) => <Tag color={CATEGORY_COLORS[v] || 'default'}>{v}</Tag>,
      },
    ];

    return (
      <>
        {/* KPI Cards */}
        <Row gutter={isMobile ? [12, 12] : [16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => navigate('/admin')}
              style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="Organizations"
                value={adminDash.totalOrganizations}
                prefix={<BankOutlined style={{ color: '#2d1854' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="Total Users"
                value={adminDash.totalUsers}
                prefix={<UserOutlined style={{ color: '#6b4fa0' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="Active Coaches"
                value={adminDash.activeCoaches}
                prefix={<TeamOutlined style={{ color: '#6b4fa0' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => navigate('/plans/onboarding-projects/projects')}
              style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="Onboardings In Progress"
                value={adminDash.onboardingsInProgress}
                prefix={<PlayCircleOutlined style={{ color: '#6b4fa0' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
        </Row>

        {/* System Health */}
        <Card
          title={<span style={{ color: '#2d1854' }}><DashboardOutlined style={{ marginRight: 8 }} />System Health</span>}
          size="small"
          style={{ marginBottom: 24, borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
        >
          <Row gutter={[24, 24]}>
            {/* Heap Memory */}
            <Col xs={24} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <Text strong style={{ display: 'block', marginBottom: 12 }}>Heap Memory</Text>
                <Progress
                  type="dashboard"
                  percent={heapPct}
                  strokeColor={heapColor}
                  size={120}
                  format={(pct) => `${pct}%`}
                />
                <div style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 13 }}>
                    {formatBytes(sh.heapUsed)} / {formatBytes(sh.heapMax)}
                  </Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Non-Heap: {formatBytes(sh.nonHeapUsed)}
                  </Text>
                </div>
              </div>
            </Col>

            {/* Threads */}
            <Col xs={24} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <Text strong style={{ display: 'block', marginBottom: 12 }}>Threads</Text>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                  <Statistic title="Active" value={sh.threadCount} valueStyle={{ fontSize: 28, color: '#2d1854' }} />
                  <div style={{ display: 'flex', gap: 24 }}>
                    <div style={{ textAlign: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Peak</Text>
                      <div><Text style={{ fontSize: 16, fontWeight: 500 }}>{sh.peakThreadCount}</Text></div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Daemon</Text>
                      <div><Text style={{ fontSize: 16, fontWeight: 500 }}>{sh.daemonThreadCount}</Text></div>
                    </div>
                  </div>
                </div>
              </div>
            </Col>

            {/* CPU / Uptime / Info */}
            <Col xs={24} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <Text strong style={{ display: 'block', marginBottom: 12 }}>CPU / Runtime</Text>
                {cpuPct >= 0 ? (
                  <Progress
                    type="dashboard"
                    percent={cpuPct}
                    strokeColor={cpuColor}
                    size={120}
                    format={(pct) => `${pct}%`}
                  />
                ) : (
                  <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Text type="secondary">N/A</Text>
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 12 }}>Uptime: {formatUptime(sh.uptimeMillis)}</Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Java {sh.javaVersion} &middot; Spring Boot {sh.springBootVersion}
                  </Text>
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {sh.osName} &middot; {sh.availableProcessors} cores
                  </Text>
                </div>
              </div>
            </Col>
          </Row>

          {/* DB Pool */}
          <div style={{ marginTop: 20, padding: '12px 16px', background: '#fafafa', borderRadius: 6 }}>
            <Row align="middle" gutter={16}>
              <Col>
                <DatabaseOutlined style={{ fontSize: 18, color: '#2d1854' }} />
              </Col>
              <Col flex="auto">
                <Text strong style={{ fontSize: 13, marginRight: 16 }}>Connection Pool (HikariCP)</Text>
                <Text style={{ fontSize: 13 }}>
                  Active: <Text strong>{sh.dbPoolActive}</Text>
                  {' / '}Idle: <Text strong>{sh.dbPoolIdle}</Text>
                  {' / '}Max: <Text strong>{sh.dbPoolMax}</Text>
                </Text>
              </Col>
              <Col style={{ minWidth: 160 }}>
                <Progress
                  percent={poolUsedPct}
                  size="small"
                  strokeColor={poolUsedPct > 80 ? '#ff4d4f' : '#2d1854'}
                />
              </Col>
            </Row>
          </div>
        </Card>

        {/* Active Sessions */}
        <Card
          title={
            <span style={{ color: '#2d1854' }}>
              <WifiOutlined style={{ marginRight: 8 }} />
              Active Sessions ({adminDash.activeSessions.length})
            </span>
          }
          size="small"
          style={{ marginBottom: 24, borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
        >
          {adminDash.activeSessions.length === 0 ? (
            <Text type="secondary">No active sessions</Text>
          ) : (
            <Table
              dataSource={adminDash.activeSessions}
              rowKey="userId"
              size="small"
              pagination={false}
              columns={[
                {
                  title: 'User', dataIndex: 'fullName', key: 'name',
                  render: (name: string, r: ActiveSessionDto) => (
                    <div>
                      <Text strong>{name}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>{r.email}</Text>
                    </div>
                  ),
                },
                {
                  title: 'Role', dataIndex: 'role', key: 'role', width: 140,
                  render: (v: string) => (
                    <Tag color={v === 'PLATFORM_ADMIN' ? 'red' : 'default'} style={v === 'PLATFORM_SUPPORT' ? { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' } : undefined}>
                      {v.replace('_', ' ')}
                    </Tag>
                  ),
                },
                {
                  title: 'Organization', dataIndex: 'tenantName', key: 'tenant', width: 160,
                },
                {
                  title: 'IP', dataIndex: 'ipAddress', key: 'ip', width: 130,
                  render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
                },
                {
                  title: 'Last Active', dataIndex: 'lastActive', key: 'lastActive', width: 100,
                  render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{timeAgo(v)}</Text>,
                },
              ]}
            />
          )}
        </Card>

        {/* API Metrics + Audit + Storage + Invitations */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {/* API Metrics */}
          <Col xs={24} lg={12}>
            <Card
              title={<span style={{ color: '#2d1854' }}><ApiOutlined style={{ marginRight: 8 }} />API Metrics</span>}
              size="small"
              style={{ height: '100%', borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
            >
              <Row gutter={[16, 12]}>
                <Col span={8}>
                  <Statistic
                    title="Total Requests"
                    value={adminDash.apiMetrics.totalRequests}
                    valueStyle={{ fontSize: 20 }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Avg Response"
                    value={adminDash.apiMetrics.avgResponseMs}
                    suffix="ms"
                    valueStyle={{ fontSize: 20, color: adminDash.apiMetrics.avgResponseMs > 500 ? '#faad14' : '#2d1854' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Max Response"
                    value={adminDash.apiMetrics.maxResponseMs}
                    suffix="ms"
                    valueStyle={{ fontSize: 20, color: adminDash.apiMetrics.maxResponseMs > 2000 ? '#ff4d4f' : '#2d1854' }}
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 12, display: 'flex', gap: 16 }}>
                <Tag color="orange">4xx: {adminDash.apiMetrics.clientErrors}</Tag>
                <Tag color={adminDash.apiMetrics.serverErrors > 0 ? 'error' : 'default'}>
                  5xx: {adminDash.apiMetrics.serverErrors}
                </Tag>
              </div>
              {adminDash.apiMetrics.topEndpoints.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Top Endpoints</Text>
                  <Table
                    dataSource={adminDash.apiMetrics.topEndpoints}
                    rowKey={(r) => `${r.method}:${r.uri}`}
                    size="small"
                    pagination={false}
                    showHeader={false}
                    columns={[
                      {
                        dataIndex: 'method', key: 'method', width: 50,
                        render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag>,
                      },
                      {
                        dataIndex: 'uri', key: 'uri',
                        render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
                      },
                      {
                        dataIndex: 'count', key: 'count', width: 60, align: 'right' as const,
                        render: (v: number) => <Text type="secondary" style={{ fontSize: 12 }}>{v}x</Text>,
                      },
                      {
                        dataIndex: 'avgMs', key: 'avgMs', width: 60, align: 'right' as const,
                        render: (v: number) => <Text type="secondary" style={{ fontSize: 12 }}>{v}ms</Text>,
                      },
                    ]}
                  />
                </div>
              )}
            </Card>
          </Col>

          {/* Right column: Audit + Storage + Invitations */}
          <Col xs={24} lg={12}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
              {/* Audit Stats */}
              <Card
                title={<span style={{ color: '#2d1854' }}><AuditOutlined style={{ marginRight: 8 }} />Activity</span>}
                size="small"
                style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
                extra={
                  <Button type="link" size="small" onClick={() => navigate('/admin/activity')} style={{ color: '#6b4fa0' }}>
                    View All
                  </Button>
                }
              >
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic title="Today" value={adminDash.auditStats.eventsToday} valueStyle={{ fontSize: 20 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="This Week" value={adminDash.auditStats.eventsThisWeek} valueStyle={{ fontSize: 20 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="This Month" value={adminDash.auditStats.eventsThisMonth} valueStyle={{ fontSize: 20 }} />
                  </Col>
                </Row>
              </Card>

              {/* Storage */}
              <Card
                title={<span style={{ color: '#2d1854' }}><HddOutlined style={{ marginRight: 8 }} />Storage</span>}
                size="small"
                style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
              >
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic title="Total Files" value={adminDash.storage.totalFiles} valueStyle={{ fontSize: 20 }} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="Total Size" value={formatBytes(adminDash.storage.totalBytes)} valueStyle={{ fontSize: 20 }} />
                  </Col>
                </Row>
              </Card>

              {/* Invitations */}
              <Card
                title={<span style={{ color: '#2d1854' }}><MailOutlined style={{ marginRight: 8 }} />Invitations</span>}
                size="small"
                style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
                extra={
                  <Button type="link" size="small" onClick={() => navigate('/admin/invitations')} style={{ color: '#6b4fa0' }}>
                    Manage
                  </Button>
                }
              >
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic
                      title="Pending"
                      value={adminDash.invitationStats.pending}
                      valueStyle={{ fontSize: 20, color: adminDash.invitationStats.pending > 0 ? '#faad14' : '#2d1854' }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Accepted" value={adminDash.invitationStats.accepted} valueStyle={{ fontSize: 20, color: '#2d1854' }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Total" value={adminDash.invitationStats.total} valueStyle={{ fontSize: 20 }} />
                  </Col>
                </Row>
              </Card>
            </div>
          </Col>
        </Row>

        {/* Dependencies */}
        <Card
          title={<span style={{ color: '#2d1854' }}><CloudServerOutlined style={{ marginRight: 8 }} />Dependencies</span>}
          size="small"
          style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
          extra={
            <Dropdown
              menu={{
                items: [
                  { key: 'json', icon: <DownloadOutlined />, label: 'Export as JSON', onClick: () => exportDepsAsJson(dependencies) },
                  { key: 'csv', icon: <DownloadOutlined />, label: 'Export as CSV', onClick: () => exportDepsAsCsv(dependencies) },
                  { key: 'txt', icon: <DownloadOutlined />, label: 'Export as Text (group:name:version)', onClick: () => exportDepsAsText(dependencies) },
                ],
              }}
            >
              <Button size="small" icon={<DownloadOutlined />}>
                Export <DownOutlined />
              </Button>
            </Dropdown>
          }
        >
          <Table
            dataSource={dependencies}
            columns={depColumns}
            rowKey={(r) => `${r.group}:${r.name}`}
            size="small"
            pagination={false}
          />
        </Card>
      </>
    );
  };

  // ========= TENANT SECTION (unchanged) =========

  const renderOnboardingCard = () => {
    if (!onboardingLoaded) return null;

    if (!onboarding) {
      return (
        <Card
          style={{ marginBottom: 24, background: 'linear-gradient(135deg, #2d1854 0%, #3d2870 100%)', border: 'none' }}
        >
          <Row align="middle" gutter={[16, 16]}>
            <Col flex="auto">
              <Title level={4} style={{ color: '#fff', margin: 0 }}>
                Welcome to MemberSuite!
              </Title>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15 }}>
                Get started by onboarding your data into MemberSuite. We'll guide you through uploading and mapping your information.
              </Text>
            </Col>
            <Col xs={24} md={undefined}>
              <Button
                type="primary"
                size="large"
                icon={<ImportOutlined />}
                onClick={() => navigate('/plans/my-onboarding')}
                style={{ background: '#52c41a', borderColor: '#52c41a' }}
                block={isMobile}
              >
                Start MemberSuite Onboarding
              </Button>
            </Col>
          </Row>
        </Card>
      );
    }

    const { uploadStatus, mappingStats, migrationStatus } = onboarding;
    const status = migrationStatus as string;
    const isSubmitted = status === 'SUBMITTED' || status === 'COMPLETED';

    if (isSubmitted) {
      return (
        <Card style={{ marginBottom: 24 }}>
          <Row align="middle" gutter={16}>
            <Col>
              <CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a' }} />
            </Col>
            <Col flex="auto">
              <Text strong style={{ fontSize: 16 }}>MemberSuite Onboarding Complete</Text>
              <br />
              <Text type="secondary">
                {status === 'SUBMITTED'
                  ? 'Your mappings have been submitted and are being reviewed.'
                  : 'Your data has been successfully onboarded.'}
              </Text>
            </Col>
            <Col>
              <Button icon={<ArrowRightOutlined />} onClick={() => navigate('/plans/my-onboarding')}>
                View Details
              </Button>
            </Col>
          </Row>
        </Card>
      );
    }

    let step = 0;
    let stepLabel = 'Upload Data';

    if (uploadStatus === 'NONE') {
      step = 0;
      stepLabel = 'Upload Data';
    } else if (uploadStatus === 'UPLOADED' || uploadStatus === 'PARSED') {
      const mapped = mappingStats?.mapped ?? 0;
      const total = mappingStats?.total ?? 0;
      if (total > 0 && mapped === total) {
        step = 3;
        stepLabel = 'Review & Submit';
      } else if (mapped > 0) {
        step = 2;
        stepLabel = `Mapping (${mapped}/${total})`;
      } else {
        step = 1;
        stepLabel = 'Map Columns';
      }
    }

    const totalSteps = 4;
    const percent = Math.round((step / totalSteps) * 100);

    return (
      <Card style={{ marginBottom: 24 }}>
        <Row align="middle" gutter={24}>
          <Col flex="auto">
            <Text strong style={{ fontSize: 16 }}>MemberSuite Onboarding</Text>
            <br />
            <Text type="secondary">
              Step {step + 1} of {totalSteps + 1}: {stepLabel}
            </Text>
            <Progress percent={percent} size="small" strokeColor="#2d1854" style={{ marginTop: 8, maxWidth: 300 }} />
          </Col>
          <Col>
            <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => navigate('/plans/my-onboarding')}
              style={{ background: '#2d1854', borderColor: '#2d1854' }}>
              Continue Onboarding
            </Button>
          </Col>
        </Row>
      </Card>
    );
  };


  // ========= COACH/PLATFORM SUPPORT SECTION =========

  const renderCoachDashboard = () => {
    if (dashboardLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <Spin size="large" />
        </div>
      );
    }

    if (!dashboard) return null;

    const { organizations, phaseDistribution, recentActivity, attentionItems } = dashboard;

    // Org table columns
    const orgColumns = [
      {
        title: 'Organization',
        dataIndex: 'name',
        key: 'name',
        render: (name: string, row: OrgProgressDto) => (
          <Text strong style={{ cursor: 'pointer', color: '#2d1854' }}>{name}</Text>
        ),
      },
      {
        title: 'Phase',
        dataIndex: 'phase',
        key: 'phase',
        width: 120,
        render: (phase: string | null) =>
          phase ? (
            <Tag color={PHASE_COLORS[phase] || '#999'}>
              {PHASE_LABELS[phase] || phase}
            </Tag>
          ) : (
            <Tag>Not Started</Tag>
          ),
      },
      {
        title: 'Mappings',
        key: 'mappings',
        width: 180,
        render: (_: unknown, row: OrgProgressDto) => {
          if (row.totalMappings === 0) {
            return <Text type="secondary" style={{ fontSize: 12 }}>No data</Text>;
          }
          const pct = Math.round((row.mappedCount / row.totalMappings) * 100);
          return (
            <div>
              <Progress
                percent={pct}
                size="small"
                style={{ width: 100, marginRight: 8 }}
                strokeColor={pct === 100 ? '#52c41a' : '#2d1854'}
              />
              <Text style={{ fontSize: 12 }}>{row.mappedCount}/{row.totalMappings}</Text>
            </div>
          );
        },
      },
      {
        title: 'Last Active',
        dataIndex: 'lastActivity',
        key: 'lastActivity',
        width: 110,
        render: (val: string | null) => (
          <Text type="secondary" style={{ fontSize: 12 }}>{timeAgo(val)}</Text>
        ),
      },
      {
        title: 'Status',
        key: 'status',
        width: 80,
        align: 'center' as const,
        render: (_: unknown, row: OrgProgressDto) => {
          if (row.hasBlockedGate) {
            return <StopOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />;
          }
          if (row.lastActivity) {
            const daysSince = Math.round(
              (Date.now() - new Date(row.lastActivity).getTime()) / 86400000
            );
            if (daysSince > 3) {
              return <ClockCircleOutlined style={{ color: '#faad14', fontSize: 16 }} />;
            }
          }
          if (!row.phase) {
            return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#d9d9d9' }} />;
          }
          return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#52c41a' }} />;
        },
      },
    ];

    // Phase donut chart data
    const pieData = Object.entries(phaseDistribution).map(([phase, count]) => ({
      type: PHASE_LABELS[phase] || phase,
      value: count,
    }));

    const pieConfig = {
      data: pieData,
      angleField: 'value',
      colorField: 'type',
      innerRadius: 0.6,
      radius: 0.9,
      height: 260,
      color: Object.values(PHASE_COLORS),
      label: {
        type: 'spider' as const,
        content: '{name} ({value})',
        style: { fontSize: 12 },
      },
      legend: {
        position: 'bottom' as const,
      },
      statistic: {
        title: {
          content: 'Total',
          style: { fontSize: '13px', color: '#999' },
        },
        content: {
          content: String(organizations.length),
          style: { fontSize: '24px', fontWeight: 'bold', color: '#2d1854' },
        },
      },
    };

    return (
      <>
        {/* KPI Cards */}
        <Row gutter={isMobile ? [12, 12] : [16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => navigate('/plans/onboarding-projects/projects')}
              style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="My Organizations"
                value={dashboard.myOrganizations}
                prefix={<BankOutlined style={{ color: '#2d1854' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => navigate('/plans/onboarding-projects/projects')}
              style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="Mappings to Review"
                value={dashboard.totalMappingsToReview}
                prefix={<FileTextOutlined style={{ color: '#6b4fa0' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => navigate('/plans/onboarding-projects/decisions')}
              style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="Open Decisions"
                value={dashboard.openDecisions}
                prefix={<BulbOutlined style={{ color: '#6b4fa0' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => navigate('/plans/onboarding-projects/approvals')}
              style={{ borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              <Statistic
                title="Pending Approvals"
                value={dashboard.pendingApprovals}
                prefix={<SafetyCertificateOutlined style={{ color: '#6b4fa0' }} />}
                valueStyle={{ color: '#2d1854' }}
              />
            </Card>
          </Col>
        </Row>

        {/* Organization Progress Table */}
        <Card
          title={<span style={{ color: '#2d1854' }}>Organization Progress</span>}
          size="small"
          style={{ marginBottom: 24, borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}
          extra={
            <Button
              type="link"
              size="small"
              onClick={() => navigate('/plans/onboarding-projects/projects')}
              style={{ color: '#6b4fa0' }}
            >
              View All
            </Button>
          }
        >
          <Table
            dataSource={organizations}
            columns={orgColumns}
            rowKey="id"
            size="small"
            pagination={organizations.length > 10 ? { pageSize: 10 } : false}
            onRow={(record) => ({
              onClick: () => navigate('/plans/onboarding-projects/projects'),
              style: { cursor: 'pointer' },
            })}
            locale={{ emptyText: 'No organizations assigned yet' }}
          />
        </Card>

        {/* Charts + Activity Row */}
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          {/* Phase Distribution Donut */}
          <Col xs={24} lg={10}>
            <Card title={<span style={{ color: '#2d1854' }}>Phase Distribution</span>} size="small" style={{ height: '100%', borderTop: '3px solid #2d1854', borderColor: '#e0d4f5' }}>
              {pieData.length > 0 ? (
                <Pie {...pieConfig} />
              ) : (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <Text type="secondary">No active onboarding projects yet</Text>
                </div>
              )}
            </Card>
          </Col>

          {/* Recent Activity */}
          <Col xs={24} lg={14}>
            <Card title={<span style={{ color: '#2d1854' }}>Recent Activity</span>} size="small" style={{ height: '100%' }}>
              {recentActivity.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  No recent activity yet.
                </Text>
              ) : (
                <Timeline
                  style={{ marginTop: 12 }}
                  items={recentActivity.map((a) => ({
                    color: '#6b4fa0',
                    children: (
                      <div>
                        <Text strong style={{ fontSize: 13 }}>
                          {a.actorName}
                        </Text>
                        <Text style={{ fontSize: 13 }}>
                          {' '}{ACTION_LABELS[a.action] || a.action.toLowerCase()}{' '}
                        </Text>
                        <Text style={{ fontSize: 13 }}>
                          {a.entityType}{a.entityName ? ` "${a.entityName}"` : ''}
                        </Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {a.tenantName} &middot; {timeAgo(a.timestamp)}
                        </Text>
                      </div>
                    ),
                  }))}
                />
              )}
            </Card>
          </Col>
        </Row>

        {/* Attention Needed */}
        {attentionItems.length > 0 && (
          <Card
            title={
              <span>
                <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
                Needs Attention
              </span>
            }
            size="small"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attentionItems.map((item, idx) => (
                <Alert
                  key={idx}
                  type={item.type === 'BLOCKED_GATE' ? 'error' : 'warning'}
                  showIcon
                  message={
                    <span>
                      <Text strong>{item.orgName}</Text>
                      <Text> &mdash; {item.detail}</Text>
                    </span>
                  }
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate('/plans/onboarding-projects/projects')}
                />
              ))}
            </div>
          </Card>
        )}
      </>
    );
  };

  // ========= RENDER =========

  const dashboardLabel = isPlatformAdmin
    ? 'Platform Administration'
    : isPlatformUser
    ? 'Coach Dashboard'
    : tenant?.name;

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={3} style={{ margin: 0, color: '#2d1854' }}>
          Welcome back, {user?.firstName}
        </Title>
        <Text style={{ color: '#6b4fa0' }}>{dashboardLabel}</Text>
      </div>

      {!isPlatformUser && renderOnboardingCard()}

      {isPlatformAdmin
        ? renderAdminDashboard()
        : isPlatformUser
        ? renderCoachDashboard()
        : (
          <>
            <Row gutter={24}>
              <Col xs={24} lg={14}>
                <Card title={<span style={{ color: '#2d1854' }}>Recent Activity</span>} size="small"
                    extra={<Button type="link" size="small" onClick={() => navigate('/plans/my-onboarding/activity')} style={{ color: '#6b4fa0' }}>View All</Button>}>
                  {notifications.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      No recent activity yet. Your coach's updates will appear here.
                    </Text>
                  ) : (
                    <Timeline
                      style={{ marginTop: 12 }}
                      items={notifications.map((evt: any) => {
                        const actionLabel = ACTION_LABELS[evt.action] || evt.action?.toLowerCase();
                        const ta = timeAgo(evt.timestamp);
                        return {
                          color: '#6b4fa0',
                          children: (
                            <div>
                              <Text strong style={{ fontSize: 13 }}>
                                {evt.actorName}
                              </Text>{' '}
                              <Text style={{ fontSize: 13 }}>
                                {actionLabel} {evt.entityType === 'FieldMapping' ? 'mapping' : evt.entityType === 'SemanticDecision' ? 'decision' : evt.entityType === 'ApprovalRequest' ? 'approval' : evt.entityType?.toLowerCase()}{evt.entityName ? `: ${evt.entityName}` : ''}
                              </Text>
                              <br />
                              <Text type="secondary" style={{ fontSize: 11 }}>{ta}</Text>
                            </div>
                          ),
                        };
                      })}
                    />
                  )}
                </Card>
              </Col>
            </Row>
          </>
        )}
    </div>
  );
}
