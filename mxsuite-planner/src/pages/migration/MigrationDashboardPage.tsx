import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, usePageTitle } from '@mxsuite/shared';
import {
  Table, Tag, Typography, Spin, message, Row, Col, Card, Input, Select, Space, Button, Tooltip, Timeline, Modal,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DashboardOutlined, SearchOutlined, AppstoreOutlined, UnorderedListOutlined, WarningOutlined, ForwardOutlined } from '@ant-design/icons';
import type { MigrationProject, MigrationStats, MigrationBlueprint, SlaAlertDto } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';
import type { AuditEventDto } from '../../services/migrationApi';
import StatsCards from '../../components/migration/StatsCards';
import PhaseLifecycleDots from '../../components/migration/PhaseLifecycleDots';
import BlueprintCards from '../../components/migration/BlueprintCards';

const { Title, Text } = Typography;

// All colors pass WCAG AA contrast
const STATUS_CONFIG: Record<string, {
  border: string; bg: string;
  tagStyle: React.CSSProperties; label: string;
}> = {
  ACTIVE:    { border: '#6b4fa0', bg: '#f3eeff', tagStyle: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }, label: 'Active' },
  PAUSED:    { border: '#d46b08', bg: '#fff7e6', tagStyle: { backgroundColor: '#fff7e6', color: '#874d00', borderColor: '#ffd591' }, label: 'Paused' },
  COMPLETED: { border: '#237804', bg: '#f6ffed', tagStyle: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' }, label: 'Completed' },
  CANCELLED: { border: '#8c8c8c', bg: '#fafafa', tagStyle: { backgroundColor: '#f5f5f5', color: '#595959', borderColor: '#d9d9d9' }, label: 'Cancelled' },
};

const PHASE_ORDER = ['DISCOVER', 'MAP', 'GENERATE', 'DRY_RUN', 'MIGRATE', 'CUT_OVER'];
const PHASE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover', MAP: 'Map', GENERATE: 'Generate',
  DRY_RUN: 'Dry Run', MIGRATE: 'Migrate', CUT_OVER: 'Cut Over',
};

/** Format a duration in minutes to a human-readable string */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Get the active phase time entry for a project */
function getActivePhaseTime(project: MigrationProject): { phase: string; durationMinutes: number } | null {
  const entry = project.phaseTimes?.find((pt) => pt.active);
  return entry ? { phase: entry.phase, durationMinutes: entry.durationMinutes } : null;
}

function ReconBar({ pct }: { pct: number }) {
  const color = pct >= 95 ? '#52c41a' : '#2d1854';
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% reconciled`}
      style={{ width: 80, height: 6, backgroundColor: '#f5f5f5', borderRadius: 3, overflow: 'hidden', display: 'inline-block' }}
    >
      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
    </div>
  );
}

export default function MigrationDashboardPage() {
  usePageTitle('Onboarding Overview');
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewKey = `migration_dashboard_view_${user?.id ?? 'default'}`;
  const [projects, setProjects] = useState<MigrationProject[]>([]);
  const [stats, setStats] = useState<MigrationStats>({
    activeMigrations: 0, gatesAwaitingApproval: 0,
    avgCycleTimeDays: 0, reconciliationPassRate: 0,
  });
  const [blueprints, setBlueprints] = useState<MigrationBlueprint[]>([]);
  const [recentActivity, setRecentActivity] = useState<AuditEventDto[]>([]);
  const [alerts, setAlerts] = useState<SlaAlertDto[]>([]);
  const [alertCount, setAlertCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    const key = `migration_dashboard_view_${user?.id ?? 'default'}`;
    return (localStorage.getItem(key) as 'cards' | 'table') || 'cards';
  });
  const [advanceTarget, setAdvanceTarget] = useState<MigrationProject | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const switchView = (mode: 'cards' | 'table') => {
    setViewMode(mode);
    localStorage.setItem(viewKey, mode);
  };

  /** Get the current phase's gate status and blocked reason for a project */
  const getCurrentGate = (project: MigrationProject) => {
    const gate = (project.phaseGates || []).find(
      (g) => g.phase === project.migrationPhase,
    );
    return gate || null;
  };

  /** Can the project advance? Gate must be CLEARED or SKIPPED, and not at final phase */
  const canAdvance = (project: MigrationProject): { allowed: boolean; reason?: string } => {
    if (project.migrationStatus === 'COMPLETED' || project.migrationStatus === 'CANCELLED') {
      return { allowed: false, reason: 'Project is ' + project.migrationStatus.toLowerCase() };
    }
    if (project.migrationPhase === 'CUT_OVER') {
      return { allowed: false, reason: 'Already at the final phase' };
    }
    const gate = getCurrentGate(project);
    if (!gate) return { allowed: true }; // no gate found — allow
    if (gate.gateStatus === 'CLEARED' || gate.gateStatus === 'SKIPPED') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: gate.blockedReason || `Gate is ${gate.gateStatus} — resolve before advancing`,
    };
  };

  const handleAdvancePhase = async () => {
    if (!advanceTarget) return;
    setAdvancing(true);
    try {
      await migrationApi.advancePhase(advanceTarget.id);
      message.success(`Advanced to ${PHASE_LABELS[PHASE_ORDER[PHASE_ORDER.indexOf(advanceTarget.migrationPhase) + 1]] || 'next phase'}`);
      // Refresh dashboard data
      const [projRes, statsRes] = await Promise.all([
        migrationApi.listProjects({ page: 0, size: 20 }),
        migrationApi.getStats(),
      ]);
      setProjects(projRes.data.content);
      setStats(statsRes.data);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to advance phase';
      message.error(msg);
    } finally {
      setAdvancing(false);
      setAdvanceTarget(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [projRes, statsRes, bpRes, activityRes] = await Promise.all([
          migrationApi.listProjects({ page: 0, size: 20 }),
          migrationApi.getStats(),
          migrationApi.listBlueprints(),
          migrationApi.getRecentActivity({ page: 0, size: 10 }),
        ]);
        setProjects(projRes.data.content);
        setStats(statsRes.data);
        setBlueprints(bpRes.data);
        setRecentActivity(activityRes.data.content ?? []);

        // Fetch alerts (non-blocking — graceful degradation)
        try {
          const alertsRes = await migrationApi.getAlerts();
          setAlerts(alertsRes.data);
          setAlertCount(alertsRes.data.length);
        } catch {
          // Alerts are optional — silently ignore (may be 403 for non-admin)
        }
      } catch {
        message.error('Failed to load migration dashboard');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = projects.filter((p) => {
    if (statusFilter && p.migrationStatus !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const tenantName = (p as any).tenant?.name || '';
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sourceSystem || '').toLowerCase().includes(q) ||
        tenantName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const columns: ColumnsType<MigrationProject> = [
    {
      title: 'Project',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record) => (
        <div>
          <Button
            type="link"
            style={{ padding: 0, height: 'auto', fontWeight: 600, color: '#6b4fa0' }}
            onClick={(e) => { e.stopPropagation(); navigate(`projects/${record.id}/mappings`); }}
          >
            {name}
          </Button>
          <br />
          <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>
            {(record as any).tenant?.name || ''}
          </Text>
        </div>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'sourceSystem',
      key: 'sourceSystem',
      sorter: (a, b) => (a.sourceSystem || '').localeCompare(b.sourceSystem || ''),
    },
    {
      title: 'Target',
      dataIndex: 'targetSystem',
      key: 'targetSystem',
      sorter: (a, b) => (a.targetSystem || '').localeCompare(b.targetSystem || ''),
    },
    {
      title: 'Phase',
      key: 'phase',
      sorter: (a, b) => PHASE_ORDER.indexOf(a.migrationPhase) - PHASE_ORDER.indexOf(b.migrationPhase),
      render: (_, record) => {
        const active = getActivePhaseTime(record);
        return (
          <div>
            <PhaseLifecycleDots currentPhase={record.migrationPhase} gates={record.phaseGates} />
            <Text style={{ fontSize: 11, color: 'rgba(0,0,0,0.65)', marginTop: 2, display: 'block' }}>
              {PHASE_LABELS[record.migrationPhase] || record.migrationPhase}
              {active && <span style={{ marginLeft: 6, color: '#6b4fa0', fontWeight: 500 }}>· {formatDuration(active.durationMinutes)}</span>}
            </Text>
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'migrationStatus',
      key: 'migrationStatus',
      sorter: (a, b) => a.migrationStatus.localeCompare(b.migrationStatus),
      filters: [
        { text: 'Active', value: 'ACTIVE' },
        { text: 'Paused', value: 'PAUSED' },
        { text: 'Completed', value: 'COMPLETED' },
        { text: 'Cancelled', value: 'CANCELLED' },
      ],
      onFilter: (value, record) => record.migrationStatus === value,
      render: (status: string) => {
        const cfg = STATUS_CONFIG[status];
        return cfg ? <Tag style={cfg.tagStyle}>{cfg.label}</Tag> : <Tag>{status}</Tag>;
      },
    },
    {
      title: 'Reconciliation',
      dataIndex: 'reconciliationPct',
      key: 'reconciliationPct',
      align: 'center',
      sorter: (a, b) => (a.reconciliationPct || 0) - (b.reconciliationPct || 0),
      render: (pct: number) => <ReconBar pct={pct || 0} />,
    },
    {
      title: 'Owner',
      dataIndex: 'ownerName',
      key: 'ownerName',
      sorter: (a, b) => (a.ownerName || '').localeCompare(b.ownerName || ''),
    },
    {
      title: '',
      key: 'actions',
      width: 220,
      render: (_, record) => {
        const { allowed, reason } = canAdvance(record);
        const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(record.migrationPhase) + 1];
        return (
          <Space size={0}>
            <Button size="small" type="link" style={{ color: '#6b4fa0', padding: '0 4px' }}
              onClick={(e) => { e.stopPropagation(); navigate(`projects/${record.id}/mappings`); }}>
              Mappings
            </Button>
            <Button size="small" type="link" style={{ color: '#6b4fa0', padding: '0 4px' }}
              onClick={(e) => { e.stopPropagation(); navigate(`projects/${record.id}/data-review`); }}>
              Review
            </Button>
            <Button size="small" type="link" style={{ color: '#6b4fa0', padding: '0 4px' }}
              onClick={(e) => { e.stopPropagation(); navigate(`projects/${record.id}/reconciliation`); }}>
              Recon
            </Button>
            <Button size="small" type="link" style={{ color: '#6b4fa0', padding: '0 4px' }}
              onClick={(e) => { e.stopPropagation(); navigate(`projects/${record.id}/metrics`); }}>
              Metrics
            </Button>
            {nextPhase && (
              <Tooltip title={allowed ? `Advance to ${PHASE_LABELS[nextPhase]}` : reason}>
                <Button
                  size="small"
                  type="link"
                  disabled={!allowed}
                  icon={<ForwardOutlined />}
                  style={{ color: allowed ? '#237804' : undefined, padding: '0 4px' }}
                  onClick={(e) => { e.stopPropagation(); setAdvanceTarget(record); }}
                >
                  Advance
                </Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading migration dashboard..." />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
        margin: '-24px -24px 24px -24px',
        padding: '28px 32px 20px 32px',
        borderBottom: '3px solid #6b4fa0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <DashboardOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Onboarding Projects</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>
              Every migration in flight, its current lifecycle phase, and reconciliation state.
            </Text>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <StatsCards stats={stats} alertCount={alertCount} />

      {/* Search + status filter + view toggle */}
      <Row align="middle" gutter={8} style={{ marginBottom: 16, marginTop: 8 }}>
        <Col flex="auto">
          <Input
            placeholder="Search by name, source, or tenant..."
            prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 340 }}
          />
        </Col>
        <Col>
          <Select
            placeholder="All statuses"
            allowClear
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 140 }}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'PAUSED', label: 'Paused' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
        </Col>
        {(search || statusFilter) && (
          <Col>
            <Text style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>
              {filtered.length} of {projects.length}
            </Text>
          </Col>
        )}
        <Col>
          <Space size={4}>
            <Tooltip title="Card view">
              <Button
                type={viewMode === 'cards' ? 'primary' : 'default'}
                icon={<AppstoreOutlined />}
                size="small"
                onClick={() => switchView('cards')}
                aria-label="Card view"
                aria-pressed={viewMode === 'cards'}
                style={viewMode === 'cards' ? { background: '#2d1854', borderColor: '#2d1854', color: '#fff' } : {}}
              />
            </Tooltip>
            <Tooltip title="Table view">
              <Button
                type={viewMode === 'table' ? 'primary' : 'default'}
                icon={<UnorderedListOutlined />}
                size="small"
                onClick={() => switchView('table')}
                aria-label="Table view"
                aria-pressed={viewMode === 'table'}
                style={viewMode === 'table' ? { background: '#2d1854', borderColor: '#2d1854', color: '#fff' } : {}}
              />
            </Tooltip>
          </Space>
        </Col>
      </Row>

      {/* Card view */}
      {viewMode === 'cards' && (
        <>
          {filtered.length > 0 ? (
            <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
              {filtered.map((project) => {
                const cfg = STATUS_CONFIG[project.migrationStatus] || STATUS_CONFIG.CANCELLED;
                const pct = project.reconciliationPct || 0;
                const reconColor = pct >= 95 ? '#237804' : pct >= 70 ? '#874d00' : '#d32029';
                return (
                  <Col key={project.id} xs={24} sm={12} xl={8}>
                    <Card
                      size="small"
                      hoverable
                      style={{
                        borderLeft: `4px solid ${cfg.border}`,
                        backgroundColor: cfg.bg,
                        height: '100%',
                      }}
                      styles={{ body: { padding: '12px 16px' } }}
                      onClick={() => navigate(`projects/${project.id}/mappings`)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Tag style={{ ...cfg.tagStyle, margin: 0 }}>{cfg.label}</Tag>
                        <Text style={{ fontSize: 11, color: 'rgba(0,0,0,0.65)' }}>
                          {PHASE_LABELS[project.migrationPhase] || project.migrationPhase}
                        </Text>
                      </div>
                      <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 2, color: 'rgba(0,0,0,0.88)' }}>
                        {project.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', display: 'block', marginBottom: 8 }}>
                        {(project as any).tenant?.name || project.sourceSystem || '—'}
                      </Text>
                      <PhaseLifecycleDots currentPhase={project.migrationPhase} gates={project.phaseGates} />
                      {(() => {
                        const active = getActivePhaseTime(project);
                        const totalMinutes = (project.phaseTimes || []).reduce((sum, pt) => sum + pt.durationMinutes, 0);
                        if (!active && totalMinutes === 0) return null;
                        return (
                          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                            {active && (
                              <Text style={{ color: '#6b4fa0' }}>
                                {PHASE_LABELS[active.phase] || active.phase}: <strong>{formatDuration(active.durationMinutes)}</strong>
                              </Text>
                            )}
                            {totalMinutes > 0 && (
                              <Text style={{ color: 'rgba(0,0,0,0.45)' }}>
                                Total: {formatDuration(totalMinutes)}
                              </Text>
                            )}
                          </div>
                        );
                      })()}
                      {pct > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <Text style={{ fontSize: 11, color: 'rgba(0,0,0,0.65)' }}>Reconciliation</Text>
                            <Text style={{ fontSize: 11, fontWeight: 600, color: reconColor }}>{pct}%</Text>
                          </div>
                          <div
                            role="progressbar"
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${pct}% reconciled`}
                            style={{ width: '100%', height: 4, backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 2, overflow: 'hidden' }}
                          >
                            <div style={{
                              width: `${pct}%`, height: '100%', borderRadius: 2,
                              backgroundColor: pct >= 95 ? '#52c41a' : '#2d1854',
                            }} />
                          </div>
                        </div>
                      )}
                      {/* Card action bar */}
                      {(() => {
                        const { allowed, reason } = canAdvance(project);
                        const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(project.migrationPhase) + 1];
                        if (!nextPhase) return null;
                        return (
                          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'flex-end' }}>
                            <Tooltip title={allowed ? `Advance to ${PHASE_LABELS[nextPhase]}` : reason}>
                              <Button
                                size="small"
                                type={allowed ? 'primary' : 'default'}
                                disabled={!allowed}
                                icon={<ForwardOutlined />}
                                style={allowed ? { background: '#237804', borderColor: '#237804', fontSize: 12 } : { fontSize: 12 }}
                                onClick={(e) => { e.stopPropagation(); setAdvanceTarget(project); }}
                              >
                                Advance to {PHASE_LABELS[nextPhase]}
                              </Button>
                            </Tooltip>
                          </div>
                        );
                      })()}
                    </Card>
                  </Col>
                );
              })}
            </Row>
          ) : (
            <Text style={{ color: 'rgba(0,0,0,0.65)', display: 'block', marginBottom: 24 }}>
              No projects match your search.
            </Text>
          )}
          {/* Phase legend */}
          <div style={{ marginBottom: 32, display: 'flex', gap: 16, fontSize: 12, color: 'rgba(0,0,0,0.65)', flexWrap: 'wrap' }}>
            <span>Phase dots:</span>
            <span style={{ color: '#237804' }}>● Complete</span>
            <span style={{ color: '#fa8c16' }}>● Current</span>
            <span style={{ color: '#d32029' }}>● Gate needs action</span>
            <span>Discover → Map → Generate → Dry Run → Migrate → Cut Over</span>
          </div>
        </>
      )}

      {/* Table view */}
      {viewMode === 'table' && (
        <>
          {filtered.length === 0 && (
            <Text style={{ color: 'rgba(0,0,0,0.65)', display: 'block', marginBottom: 24 }}>
              No projects match your search.
            </Text>
          )}
          <Table
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            pagination={{ pageSize: 20, hideOnSinglePage: true, showTotal: (t) => `${t} projects` }}
            size="middle"
            style={{ marginBottom: 32 }}
            onRow={(record) => ({
              style: { cursor: 'pointer' },
              onClick: () => navigate(`projects/${record.id}/mappings`),
            })}
          />
        </>
      )}

      {/* SLA Alerts */}
      {alerts.length > 0 && (
        <Card
          title={
            <Space>
              <WarningOutlined style={{ color: '#fa8c16' }} />
              <>Projects Needing Attention</>
              <Tag color="orange">{alerts.length}</Tag>
            </Space>
          }
          size="small"
          style={{ marginBottom: 24, borderTop: '3px solid #fa8c16', borderColor: '#ffe58f' }}
        >
          <Table
            dataSource={alerts}
            rowKey="projectId"
            pagination={false}
            size="small"
            columns={[
              { title: 'Project', dataIndex: 'projectName', key: 'projectName',
                render: (name: string) => <Text strong>{name}</Text> },
              { title: 'Organization', dataIndex: 'tenantName', key: 'tenantName' },
              { title: 'Owner', dataIndex: 'ownerName', key: 'ownerName' },
              { title: 'Phase', dataIndex: 'phase', key: 'phase',
                render: (phase: string) => (
                  <Tag style={{ backgroundColor: '#fff7e6', color: '#ad6800', borderColor: '#ffe58f' }}>
                    {PHASE_LABELS[phase] || phase}
                  </Tag>
                ) },
              { title: 'Time in Phase', dataIndex: 'minutesInPhase', key: 'minutesInPhase',
                render: (min: number) => formatDuration(min) },
              { title: '% Over', dataIndex: 'percentOverThreshold', key: 'pctOver',
                render: (pct: number) => (
                  <Text style={{ color: pct > 100 ? '#cf1322' : '#fa8c16', fontWeight: 600 }}>
                    +{Math.round(pct)}%
                  </Text>
                ) },
            ]}
          />
        </Card>
      )}

      {/* Blueprints */}
      <Title level={5} style={{ marginTop: 32, marginBottom: 16, color: '#2d1854' }}>Blueprints available for reuse</Title>
      <BlueprintCards blueprints={blueprints} />

      {/* Recent Activity */}
      <Row gutter={24} style={{ marginTop: 40 }}>
        <Col xs={24} lg={14}>
          <Card
            title={<>Recent Activity</>}
            size="small"
            styles={{ header: { fontWeight: 600 } }}
          >
            {recentActivity.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 13 }}>No recent activity.</Text>
            ) : (
              <Timeline
                style={{ marginTop: 12 }}
                items={recentActivity.map((evt) => {
                  const ACTION_LABELS: Record<string, string> = {
                    UPDATE_MAPPING: 'Updated mapping',
                    APPROVE_MAPPING: 'Approved mapping',
                    APPROVE_PHASE_GATE: 'Approved phase gate',
                    ADVANCE_PHASE: 'Advanced phase',
                    SIGN_OFF_RECONCILIATION: 'Signed off reconciliation',
                    AUTHORIZE_APPROVAL: 'Authorized approval',
                    REJECT_APPROVAL: 'Rejected approval',
                    APPROVE_DECISION: 'Approved decision',
                    REJECT_DECISION: 'Rejected decision',
                    CREATE_PROJECT: 'Created project',
                    GATE_CLEARED: 'Gate cleared',
                    GENERATE_RECON: 'Generated reconciliation report',
                  };
                  const label = ACTION_LABELS[evt.action] ?? evt.action.replace(/_/g, ' ').toLowerCase();
                  const when = new Date(evt.timestamp);
                  const now = new Date();
                  const diffMin = Math.round((now.getTime() - when.getTime()) / 60000);
                  const timeAgo = diffMin < 1 ? 'just now'
                    : diffMin < 60 ? `${diffMin}m ago`
                    : diffMin < 1440 ? `${Math.round(diffMin / 60)}h ago`
                    : when.toLocaleDateString();
                  return {
                    color: '#6b4fa0',
                    children: (
                      <div>
                        <Text style={{ fontSize: 13 }}>
                          <Text strong>{evt.actorName}</Text>
                          {' '}
                          <Text>{label}</Text>
                          {evt.entityName && (
                            <Text type="secondary"> — {evt.entityName}</Text>
                          )}
                        </Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 11 }}>{timeAgo}</Text>
                      </div>
                    ),
                  };
                })}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Advance Phase confirmation modal */}
      <Modal
        title="Advance Phase"
        open={!!advanceTarget}
        onOk={handleAdvancePhase}
        onCancel={() => setAdvanceTarget(null)}
        confirmLoading={advancing}
        okText="Advance"
        okButtonProps={{ style: { background: '#237804', borderColor: '#237804' } }}
      >
        {advanceTarget && (() => {
          const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(advanceTarget.migrationPhase) + 1];
          const gate = getCurrentGate(advanceTarget);
          return (
            <div>
              <p>
                Advance <strong>{advanceTarget.name}</strong> from{' '}
                <Tag style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>
                  {PHASE_LABELS[advanceTarget.migrationPhase]}
                </Tag>
                {' '}to{' '}
                <Tag style={{ backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' }}>
                  {PHASE_LABELS[nextPhase]}
                </Tag>
              </p>
              {advanceTarget.migrationPhase === 'MAP' && (
                <p style={{ color: '#6b4fa0', fontSize: 13 }}>
                  This will auto-trigger data validation on the latest uploaded file.
                </p>
              )}
              {gate && gate.gateStatus === 'CLEARED' && (
                <p style={{ color: '#237804', fontSize: 13 }}>
                  Gate is cleared — ready to proceed.
                </p>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
