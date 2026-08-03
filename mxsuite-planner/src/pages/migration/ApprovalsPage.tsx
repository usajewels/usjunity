import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Input, Pagination, Select, Space, Spin,
  Steps, Tabs, Tag, Typography, message,
} from 'antd';
import {
  AuditOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloseCircleOutlined, RightOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { ApprovalRequestDto, ApprovalStatsDto, GateApprovalMode, MigrationProject } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PIPELINE_PAGE_SIZE = 10;
const APPROVALS_PAGE_SIZE = 20;
const PHASE_LABELS = ['Discover', 'Map', 'Generate', 'Dry Run', 'Migrate', 'Cut Over'];
const PHASE_KEYS = ['DISCOVER', 'MAP', 'GENERATE', 'DRY_RUN', 'MIGRATE', 'CUT_OVER'];

const POLL_INTERVAL = 30_000; // 30 seconds

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

const MODE_LABELS: Record<GateApprovalMode, string> = {
  AUTO: 'Auto', MEMBER_ONLY: 'Member', COACH_ONLY: 'Coach', BOTH: 'Both',
};
const MODE_COLORS: Record<GateApprovalMode, string> = {
  AUTO: 'default', MEMBER_ONLY: 'blue', COACH_ONLY: 'purple', BOTH: 'geekblue',
};

function GatePipeline({ project, onNavigate }: { project: MigrationProject; onNavigate: (id: string) => void }) {
  const gates = project.phaseGates || [];

  const items = PHASE_LABELS.map((label, idx) => {
    const gate = gates.find(g => g.phase === PHASE_KEYS[idx]);
    let status: 'finish' | 'process' | 'wait' | 'error' = 'wait';
    let icon;

    if (gate) {
      switch (gate.gateStatus) {
        case 'CLEARED':
          status = 'finish';
          icon = <CheckCircleOutlined style={{ color: '#52c41a' }} />;
          break;
        case 'BLOCKED':
          status = 'error';
          icon = <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
          break;
        case 'PENDING':
          status = 'process';
          icon = <ClockCircleOutlined style={{ color: '#fa8c16' }} />;
          break;
        case 'SKIPPED':
          status = 'finish';
          icon = <CheckCircleOutlined style={{ color: '#d9d9d9' }} />;
          break;
      }
    }

    const modeTag = gate?.approvalMode ? (
      <Tag color={MODE_COLORS[gate.approvalMode]} style={{ fontSize: 9, marginLeft: 4, padding: '0 3px' }}>
        {MODE_LABELS[gate.approvalMode]}
      </Tag>
    ) : null;

    const pendingDesc = gate?.gateStatus === 'PENDING' ? (
      gate.approvalMode === 'AUTO' ? 'Conditions not met' :
      gate.approvalMode === 'MEMBER_ONLY' ? 'Awaiting member' :
      gate.approvalMode === 'COACH_ONLY' ? 'Awaiting coach' :
      gate.memberApproved ? 'Awaiting coach' : 'Awaiting member + coach'
    ) : null;

    return {
      title: <span>{label}{modeTag}</span>,
      status,
      icon,
      description: gate ? (
        <Text style={{ fontSize: 10 }}>
          {gate.gateStatus === 'CLEARED' ? 'Cleared' :
           gate.gateStatus === 'BLOCKED' ? (gate.blockedReason || 'Blocked') :
           gate.gateStatus === 'PENDING' ? pendingDesc : 'Skipped'}
        </Text>
      ) : undefined,
    };
  });

  return (
    <Card
      size="small"
      style={{ marginBottom: 8, cursor: 'pointer' }}
      hoverable
      onClick={() => onNavigate(project.id)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <Text strong>{project.name}</Text>
          {project.sourceSystem && (
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {project.sourceSystem} → {project.targetSystem}
            </Text>
          )}
        </div>
        <RightOutlined style={{ color: '#6b4fa0', fontSize: 12 }} />
      </div>
      <Steps size="small" items={items} style={{ marginTop: 4 }} />
    </Card>
  );
}

function AlphaBar({ activeLetter, onChange, disabled }: {
  activeLetter: string | null;
  onChange: (l: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Space wrap size={4}>
      <Button
        size="small"
        type={activeLetter === null ? 'primary' : 'text'}
        onClick={() => onChange(null)}
        disabled={disabled}
        style={activeLetter === null
          ? { background: '#2d1854', borderColor: '#2d1854', color: '#fff', minWidth: 36 }
          : { color: '#6b4fa0', minWidth: 36 }}
      >
        All
      </Button>
      {LETTERS.map((l) => (
        <Button
          key={l}
          size="small"
          type={activeLetter === l ? 'primary' : 'text'}
          onClick={() => onChange(l)}
          disabled={disabled}
          style={activeLetter === l
            ? { background: '#2d1854', borderColor: '#2d1854', color: '#fff', minWidth: 28, padding: '0 6px' }
            : { color: '#6b4fa0', minWidth: 28, padding: '0 6px' }}
        >
          {l}
        </Button>
      ))}
    </Space>
  );
}

export default function ApprovalsPage() {
  usePageTitle('Approvals');
  const navigate = useNavigate();

  // Shared search / letter — applied to whichever tab is active
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [letter, setLetter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('pipeline');

  // Pipeline state
  const [projects, setProjects] = useState<MigrationProject[]>([]);
  const [projectsTotal, setProjectsTotal] = useState(0);
  const [projectsPage, setProjectsPage] = useState(1);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Approvals queue state
  const [approvals, setApprovals] = useState<ApprovalRequestDto[]>([]);
  const [stats, setStats] = useState<ApprovalStatsDto>({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [approvalsTotal, setApprovalsTotal] = useState(0);
  const [approvalsPage, setApprovalsPage] = useState(1);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [gateType, setGateType] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState('ALL');

  /* ---- Pipeline fetch ---- */
  const fetchProjects = useCallback(async (silent = false) => {
    if (!silent) setProjectsLoading(true);
    try {
      const params: Record<string, unknown> = { page: projectsPage - 1, size: PIPELINE_PAGE_SIZE };
      if (search) params.search = search;
      if (letter) params.letter = letter.toLowerCase();
      const res = await migrationApi.listProjects(params);
      setProjects(res.data.content);
      setProjectsTotal(Math.max(res.data.totalElements ?? 0, res.data.content?.length ?? 0));
    } catch {
      // pipeline is non-critical
    } finally {
      if (!silent) setProjectsLoading(false);
    }
  }, [projectsPage, search, letter]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  /* ---- Approvals fetch ---- */
  const fetchApprovals = useCallback(async (silent = false) => {
    if (!silent) setApprovalsLoading(true);
    try {
      const params: Record<string, unknown> = { page: approvalsPage - 1, size: APPROVALS_PAGE_SIZE };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (gateType) params.gateType = gateType;
      if (search) params.search = search;
      if (letter) params.letter = letter.toLowerCase();

      const [appRes, statsRes] = await Promise.all([
        migrationApi.listApprovals(params as any),
        migrationApi.getApprovalStats(),
      ]);
      setApprovals(appRes.data.content);
      setApprovalsTotal(appRes.data.totalElements);
      setStats(statsRes.data);
    } catch {
      if (!silent) message.error('Failed to load approvals');
    } finally {
      if (!silent) setApprovalsLoading(false);
    }
  }, [approvalsPage, statusFilter, gateType, search, letter]);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  /* ---- Auto-refresh every 30 s ---- */
  useEffect(() => {
    const id = setInterval(() => {
      fetchProjects(true);
      fetchApprovals(true);
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchProjects, fetchApprovals]);

  const handleAuthorize = async (id: string) => {
    setActionLoading(id);
    try {
      await migrationApi.authorizeApproval(id);
      message.success('Gate authorized');
      fetchApprovals();
    } catch {
      message.error('Failed to authorize');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    try {
      await migrationApi.rejectApproval(id);
      message.success('Gate rejected');
      fetchApprovals();
    } catch {
      message.error('Failed to reject');
    } finally {
      setActionLoading(null);
    }
  };

  const commitSearch = () => {
    setSearch(searchInput.trim());
    setProjectsPage(1);
    setApprovalsPage(1);
  };

  const handleLetterChange = (l: string | null) => {
    setLetter(l);
    setProjectsPage(1);
    setApprovalsPage(1);
  };

  const pipelineTab = (
    <div>
      {projectsLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin />
        </div>
      )}
      {!projectsLoading && projects.length === 0 && (
        <Card size="small">
          <Text type="secondary">No projects found{search || letter ? ' for the current filters' : ''}.</Text>
        </Card>
      )}
      {!projectsLoading && projects.map(p => (
        <GatePipeline
          key={p.id}
          project={p}
          onNavigate={id => navigate(`/onboarding-projects/projects/${id}`)}
        />
      ))}
      {!projectsLoading && projectsTotal > PIPELINE_PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Pagination
            current={projectsPage}
            pageSize={PIPELINE_PAGE_SIZE}
            total={projectsTotal}
            showSizeChanger={false}
            size="small"
            onChange={p => setProjectsPage(p)}
          />
        </div>
      )}
    </div>
  );

  const approvalsTab = (
    <div>
      {/* Approvals-specific filters */}
      <Space wrap style={{ marginBottom: 14 }}>
        <Select
          value={statusFilter}
          style={{ width: 150 }}
          onChange={v => { setStatusFilter(v); setApprovalsPage(1); }}
        >
          <Option value="PENDING">Pending</Option>
          <Option value="APPROVED">Approved</Option>
          <Option value="REJECTED">Rejected</Option>
          <Option value="ALL">All statuses</Option>
        </Select>
        <Select
          placeholder="Gate type"
          allowClear
          style={{ width: 160 }}
          value={gateType}
          onChange={v => { setGateType(v); setApprovalsPage(1); }}
        >
          <Option value="DISCOVER">Discover</Option>
          <Option value="MAP">Map</Option>
          <Option value="GENERATE">Generate</Option>
          <Option value="DRY_RUN">Dry Run</Option>
          <Option value="MIGRATE">Migrate</Option>
          <Option value="CUT_OVER">Cut Over</Option>
        </Select>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {stats.pending} pending · {approvalsTotal} result{approvalsTotal !== 1 ? 's' : ''}
        </Text>
      </Space>

      {approvalsLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin tip="Loading approvals..." />
        </div>
      )}
      {!approvalsLoading && approvals.length === 0 && (
        <Card size="small">
          <Text type="secondary">No approval actions required.</Text>
        </Card>
      )}
      {!approvalsLoading && approvals.map(approval => (
        <Card
          key={approval.id}
          size="small"
          style={{ marginBottom: 10 }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 4 }}>
                <Tag color={APPROVAL_STATUS_COLORS[approval.approvalStatus]} style={{ fontSize: 10 }}>
                  {approval.gateType} gate
                </Tag>
                <Tag color={APPROVAL_STATUS_COLORS[approval.approvalStatus]} style={{ fontSize: 10 }}>
                  {approval.approvalStatus}
                </Tag>
                {approval.requiredRole && (
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                    {approval.requiredRole.replace(/_/g, ' ').toLowerCase()}
                  </Text>
                )}
              </div>
              <Text strong style={{ fontSize: 14 }}>
                {approval.projectName} — {approval.title}
              </Text>
              {approval.description && (
                <Paragraph style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', marginTop: 4, marginBottom: 0 }}>
                  {approval.description}
                </Paragraph>
              )}
              {approval.artifactRef && (
                <a style={{ fontSize: 11 }}>{approval.artifactRef}</a>
              )}
            </div>
            {(approval.approvalStatus as string) === 'PENDING' && (
              <div style={{ display: 'flex', gap: 8, marginLeft: 16, flexShrink: 0 }}>
                <Button
                  type="primary"
                  size="small"
                  onClick={() => handleAuthorize(approval.id)}
                  loading={actionLoading === approval.id}
                  style={{ background: '#52c41a', borderColor: '#52c41a' }}
                >
                  Authorize
                </Button>
                <Button
                  danger
                  size="small"
                  onClick={() => handleReject(approval.id)}
                  loading={actionLoading === approval.id}
                >
                  Reject
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
      {!approvalsLoading && approvalsTotal > APPROVALS_PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Pagination
            current={approvalsPage}
            pageSize={APPROVALS_PAGE_SIZE}
            total={approvalsTotal}
            showSizeChanger={false}
            onChange={p => setApprovalsPage(p)}
          />
        </div>
      )}
    </div>
  );

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
          <AuditOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Workflow &amp; approval gates</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>
              Each project advances through the defined lifecycle. The engine enforces phase order
              and stops at explicit human-in-the-loop gates.
            </Text>
          </div>
        </div>
      </div>

      {/* Shared search + alpha — filters whichever tab is active */}
      <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 16 }}>
        <Space wrap>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search organization or project..."
            value={searchInput}
            onChange={e => {
              setSearchInput(e.target.value);
              if (e.target.value === '') {
                setSearch('');
                setProjectsPage(1);
                setApprovalsPage(1);
              }
            }}
            onPressEnter={commitSearch}
            style={{ width: 300 }}
            allowClear
          />
          <Button
            type="primary"
            onClick={commitSearch}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}
          >
            Search
          </Button>
        </Space>
        <AlphaBar activeLetter={letter} onChange={handleLetterChange} />
      </Space>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'pipeline',
            label: `Pipeline (${projectsTotal})`,
            children: pipelineTab,
          },
          {
            key: 'approvals',
            label: `Approvals (${stats.pending} pending)`,
            children: approvalsTab,
          },
        ]}
      />
    </div>
  );
}
