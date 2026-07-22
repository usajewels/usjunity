import { useEffect, useState } from 'react';
import { Button, Card, Spin, Steps, Tag, Typography, message } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ApprovalRequestDto, ApprovalStatsDto, PhaseGateDto, MigrationProject } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';

const { Title, Text, Paragraph } = Typography;

const PHASE_LABELS = ['Discover', 'Map', 'Generate', 'Dry Run', 'Migrate', 'Cut Over'];

function GatePipeline({ project }: { project: MigrationProject }) {
  const gates = project.phaseGates || [];

  const items = PHASE_LABELS.map((label, idx) => {
    const gate = gates.find(g => g.phase === ['DISCOVER', 'MAP', 'GENERATE', 'DRY_RUN', 'MIGRATE', 'CUT_OVER'][idx]);
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

    return {
      title: label,
      status,
      icon,
      description: gate ? (
        <Text style={{ fontSize: 10 }}>
          {gate.gateStatus === 'CLEARED' ? 'GATE CLEARED' :
           gate.gateStatus === 'BLOCKED' ? (gate.blockedReason || 'BLOCKED') :
           gate.gateStatus === 'PENDING' ? 'AWAITING APPROVAL' : 'SKIPPED'}
        </Text>
      ) : undefined,
    };
  });

  return (
    <Card size="small" style={{ marginBottom: 24 }}>
      <div style={{ marginBottom: 8 }}>
        <Text strong>{project.name}</Text>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          {project.sourceSystem} → {project.targetSystem}
        </Text>
      </div>
      <Steps
        size="small"
        items={items}
        style={{ marginTop: 8 }}
      />
    </Card>
  );
}

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

export default function ApprovalsPage() {
  usePageTitle('Approvals');
  const [approvals, setApprovals] = useState<ApprovalRequestDto[]>([]);
  const [projects, setProjects] = useState<MigrationProject[]>([]);
  const [stats, setStats] = useState<ApprovalStatsDto>({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [appRes, statsRes, projRes] = await Promise.all([
          migrationApi.listApprovals({ status: 'PENDING', page: 0, size: 50 }),
          migrationApi.getApprovalStats(),
          migrationApi.listProjects({ page: 0, size: 10 }),
        ]);
        setApprovals(appRes.data.content);
        setStats(statsRes.data);
        setProjects(projRes.data.content);
      } catch {
        message.error('Failed to load approvals');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleAuthorize = async (id: string) => {
    setActionLoading(id);
    try {
      await migrationApi.authorizeApproval(id);
      setApprovals(prev => prev.filter(a => a.id !== id));
      message.success('Gate authorized');
      // Refresh stats + pipeline
      const [statsRes, projRes] = await Promise.all([
        migrationApi.getApprovalStats(),
        migrationApi.listProjects({ page: 0, size: 10 }),
      ]);
      setStats(statsRes.data);
      setProjects(projRes.data.content);
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
      setApprovals(prev => prev.filter(a => a.id !== id));
      message.success('Gate rejected');
      const [statsRes, projRes] = await Promise.all([
        migrationApi.getApprovalStats(),
        migrationApi.listProjects({ page: 0, size: 10 }),
      ]);
      setStats(statsRes.data);
      setProjects(projRes.data.content);
    } catch {
      message.error('Failed to reject');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading approvals..." />
      </div>
    );
  }

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Workflow & approval gates</Title>
        <Text style={{ fontSize: 12, color: '#6b4fa0' }}>
          Each project advances through the defined lifecycle. The engine enforces phase order
          and stops at explicit human-in-the-loop gates. A gate cannot be bypassed, and a
          project cannot advance past a gate that has not been cleared.
        </Text>
      </div>

      {/* Pipeline visualization for active projects */}
      {projects.filter(p => p.phaseGates?.length > 0).map(project => (
        <GatePipeline key={project.id} project={project} />
      ))}

      {/* Approvals queue */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0 }}>Approvals queue</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {stats.pending} pending
        </Text>
      </div>

      {approvals.length === 0 && (
        <Card size="small">
          <Text type="secondary">No pending approvals. All gates are clear.</Text>
        </Card>
      )}

      {approvals.map(approval => (
        <Card
          key={approval.id}
          size="small"
          style={{ marginBottom: 12 }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 4 }}>
                <Tag color={APPROVAL_STATUS_COLORS[approval.approvalStatus]} style={{ fontSize: 10 }}>
                  {approval.gateType} gate
                </Tag>
                {approval.requiredRole && (
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
                    {approval.requiredRole.replace('_', ' ').toLowerCase()}
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
          </div>
        </Card>
      ))}
    </div>
  );
}
