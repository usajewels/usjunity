import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Card, Col, Row, Select, Space, Spin, Steps, Table, Tag, Typography, message,
} from 'antd';
import {
  ApartmentOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloseCircleOutlined, DatabaseOutlined, HeartOutlined,
  LineChartOutlined, MergeOutlined, RetweetOutlined,
} from '@ant-design/icons';
import type { ApprovalRequestDto, MigrationProject } from '@mxsuite/shared';
import type { GateApprovalMode, MigrationPhase } from '@mxsuite/shared';
import { useAuth, usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';

const { Title, Text } = Typography;

const PHASE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover', MAP: 'Map', GENERATE: 'Generate',
  DRY_RUN: 'Dry Run', MIGRATE: 'Migrate', CUT_OVER: 'Cut Over',
};
const PHASE_KEYS = ['DISCOVER', 'MAP', 'GENERATE', 'DRY_RUN', 'MIGRATE', 'CUT_OVER'] as const;

const MODE_LABELS: Record<GateApprovalMode, string> = {
  AUTO: 'Auto',
  MEMBER_ONLY: 'Member',
  COACH_ONLY: 'Coach',
  BOTH: 'Both',
};
const MODE_COLORS: Record<GateApprovalMode, string> = {
  AUTO: 'default',
  MEMBER_ONLY: 'blue',
  COACH_ONLY: 'purple',
  BOTH: 'geekblue',
};

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

export default function ProjectDetailPage() {
  usePageTitle('Project Detail');
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [project, setProject] = useState<MigrationProject | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modeUpdating, setModeUpdating] = useState<string | null>(null);

  const canEditMode = user?.role === 'PLATFORM_ADMIN' || user?.role === 'COACH_ADMIN';

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      migrationApi.listProjects({ page: 0, size: 1000 }),
      migrationApi.listProjectApprovals(projectId),
    ])
      .then(([projRes, appRes]) => {
        const found = projRes.data.content.find(p => p.id === projectId) ?? null;
        setProject(found);
        setApprovals(appRes.data);
      })
      .catch(() => message.error('Failed to load project'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleModeChange = async (phase: string, mode: GateApprovalMode) => {
    if (!projectId) return;
    setModeUpdating(phase);
    try {
      const res = await migrationApi.updateGateApprovalMode(projectId, phase, mode);
      setProject(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          phaseGates: prev.phaseGates.map(g =>
            g.phase === phase ? { ...g, approvalMode: res.data.approvalMode } : g,
          ),
        };
      });
      message.success(`${PHASE_LABELS[phase]} gate approval mode updated`);
    } catch {
      message.error('Failed to update approval mode');
    } finally {
      setModeUpdating(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <Spin tip="Loading project..." />
      </div>
    );
  }

  if (!project) {
    return (
      <Card>
        <Text type="secondary">Project not found.</Text>
      </Card>
    );
  }

  // --- Phase gate pipeline items ---
  const gateItems = PHASE_KEYS.map(key => {
    const gate = project.phaseGates?.find(g => g.phase === key);
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
      <Tag color={MODE_COLORS[gate.approvalMode]} style={{ fontSize: 10, marginLeft: 4 }}>
        {MODE_LABELS[gate.approvalMode]}
      </Tag>
    ) : null;

    return {
      title: (
        <Space size={4}>
          <span>{PHASE_LABELS[key]}</span>
          {modeTag}
        </Space>
      ),
      status,
      icon,
      description: gate ? (
        <div style={{ fontSize: 10 }}>
          {gate.gateStatus === 'CLEARED' && 'Cleared'}
          {gate.gateStatus === 'BLOCKED' && (gate.blockedReason || 'Blocked')}
          {gate.gateStatus === 'PENDING' && (
            gate.approvalMode === 'AUTO' ? 'Conditions not met' :
            gate.approvalMode === 'MEMBER_ONLY' ? 'Awaiting member' :
            gate.approvalMode === 'COACH_ONLY' ? 'Awaiting coach' :
            gate.memberApproved ? 'Awaiting coach' : 'Awaiting member + coach'
          )}
          {gate.gateStatus === 'SKIPPED' && 'Skipped'}
        </div>
      ) : undefined,
    };
  });

  // --- Approval history columns ---
  const approvalColumns = [
    {
      title: 'Gate',
      dataIndex: 'gateType',
      key: 'gateType',
      render: (v: string) => <Tag>{PHASE_LABELS[v] || v}</Tag>,
      width: 100,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: ApprovalRequestDto) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{v}</Text>
          {r.requiredRole && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
              {r.requiredRole.replace(/_/g, ' ').toLowerCase()}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'approvalStatus',
      key: 'approvalStatus',
      render: (v: string) => (
        <Tag color={APPROVAL_STATUS_COLORS[v] || 'default'}>{v}</Tag>
      ),
      width: 110,
    },
    {
      title: 'Mode',
      dataIndex: 'gateApprovalMode',
      key: 'gateApprovalMode',
      render: (v: GateApprovalMode) => v ? (
        <Tag color={MODE_COLORS[v]} style={{ fontSize: 10 }}>{MODE_LABELS[v]}</Tag>
      ) : null,
      width: 90,
    },
    {
      title: 'Date',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleDateString()}</Text>,
      width: 100,
    },
  ];

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
          <ApartmentOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>{project.name}</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
              {project.tenantName && <>{project.tenantName} · </>}
              {project.sourceSystem && <>{project.sourceSystem} → {project.targetSystem} · </>}
              <Tag color={project.migrationStatus === 'COMPLETED' ? 'success' :
                          project.migrationStatus === 'PAUSED' ? 'warning' : 'processing'}
                   style={{ marginLeft: 4 }}>
                {project.migrationPhase ? PHASE_LABELS[project.migrationPhase] : '—'}
              </Tag>
            </Text>
          </div>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        {/* Left column: gate pipeline + config */}
        <Col xs={24} lg={14}>
          {/* Phase Gate Timeline */}
          <Card
            size="small"
            title="Phase Gate Timeline"
            style={{ marginBottom: 16 }}
          >
            <Steps
              direction="vertical"
              size="small"
              current={PHASE_KEYS.findIndex(k => k === project.migrationPhase)}
              items={gateItems}
            />
          </Card>

          {/* Gate approval mode config (coach/admin only) */}
          {canEditMode && (
            <Card size="small" title="Gate Approval Mode" style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
                Configure who must approve each gate before the phase can advance.
              </Text>
              {PHASE_KEYS.map(key => {
                const gate = project.phaseGates?.find(g => g.phase === key);
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={{ fontSize: 13, minWidth: 90 }}>{PHASE_LABELS[key]}</Text>
                    <Select
                      size="small"
                      style={{ width: 160 }}
                      value={gate?.approvalMode ?? 'AUTO'}
                      loading={modeUpdating === key}
                      disabled={modeUpdating !== null}
                      onChange={(v: GateApprovalMode) => handleModeChange(key, v)}
                    >
                      <Select.Option value="AUTO">Auto (no approval)</Select.Option>
                      <Select.Option value="MEMBER_ONLY">Member only</Select.Option>
                      <Select.Option value="COACH_ONLY">Coach only</Select.Option>
                      <Select.Option value="BOTH">Both (member + coach)</Select.Option>
                    </Select>
                  </div>
                );
              })}
            </Card>
          )}
        </Col>

        {/* Right column: quick links + approvals */}
        <Col xs={24} lg={10}>
          {/* Quick Links */}
          <Card size="small" title="Quick Links" style={{ marginBottom: 16 }}>
            <Row gutter={[8, 8]}>
              <Col span={12}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => navigate(`/onboarding-projects/projects/${projectId}/mappings`)}
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                >
                  <MergeOutlined style={{ fontSize: 20, color: '#2d1854' }} />
                  <div><Text style={{ fontSize: 12 }}>Mappings</Text></div>
                </Card>
              </Col>
              <Col span={12}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => navigate(`/onboarding-projects/projects/${projectId}/data-review`)}
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                >
                  <HeartOutlined style={{ fontSize: 20, color: '#2d1854' }} />
                  <div><Text style={{ fontSize: 12 }}>Data Health</Text></div>
                </Card>
              </Col>
              <Col span={12}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => navigate(`/onboarding-projects/projects/${projectId}/reconciliation`)}
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                >
                  <DatabaseOutlined style={{ fontSize: 20, color: '#2d1854' }} />
                  <div><Text style={{ fontSize: 12 }}>Reconciliation</Text></div>
                </Card>
              </Col>
              <Col span={12}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => navigate(`/onboarding-projects/projects/${projectId}/metrics`)}
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                >
                  <LineChartOutlined style={{ fontSize: 20, color: '#2d1854' }} />
                  <div><Text style={{ fontSize: 12 }}>Metrics</Text></div>
                </Card>
              </Col>
            </Row>
          </Card>

          {/* Approval History */}
          <Card size="small" title={`Approval History (${approvals.length})`}>
            {approvals.length === 0 ? (
              <Text type="secondary" style={{ fontSize: 12 }}>No approval records yet.</Text>
            ) : (
              <Table
                dataSource={approvals}
                columns={approvalColumns}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                scroll={{ x: true }}
              />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
