import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Typography, Spin, Button, Progress, Tag, Row, Col, Space, Steps, message, Tooltip,
} from 'antd';
import {
  EyeOutlined, UploadOutlined, CheckCircleOutlined, ClockCircleOutlined,
  FileTextOutlined, BulbOutlined, SafetyCertificateOutlined, HeartOutlined,
} from '@ant-design/icons';
import type { TenantOnboardingDto } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';

const { Title, Text } = Typography;

export default function TenantOverviewPage() {
  usePageTitle('Onboarding Overview');
  const navigate = useNavigate();
  const [data, setData] = useState<TenantOnboardingDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tenantOnboardingApi.getMyOnboarding()
      .then(({ data }) => setData(data))
      .catch(() => message.error('Failed to load onboarding'))
      .finally(() => setLoading(false));
  }, []);

  const banner = (
    <div style={{
      background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
      margin: '-24px -24px 24px -24px',
      padding: '28px 32px 20px 32px',
      borderBottom: '3px solid #6b4fa0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <EyeOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
        <div>
          <Title level={3} style={{ margin: 0, color: '#fff' }}>My Onboarding</Title>
          <Text style={{ color: 'rgba(255,255,255,0.7)' }}>{data?.projectName || 'Your onboarding overview'}</Text>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div>
        {banner}
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin tip="Loading your onboarding..." />
        </div>
      </div>
    );
  }

  if (!data) return <div>{banner}</div>;

  const mappingTotal = data.mappingStats?.total ?? 0;
  const mappingPct = mappingTotal > 0
    ? Math.round((data.mappingStats!.mapped / mappingTotal) * 100) : 0;

  const isGenerateOrLater = ['GENERATE', 'DRY_RUN', 'MIGRATE', 'CUT_OVER'].includes(data.migrationPhase);
  const allMappingsDone = data.mappingStats && data.mappingStats.needsReview === 0 && data.mappingStats.mapped > 0;
  const allDecisionsDone = !data.decisionStats || data.decisionStats.open === 0;
  const memberWorkComplete = allMappingsDone && allDecisionsDone && !isGenerateOrLater;

  const nextStep = data.uploadStatus === 'NONE'
    ? { label: 'Upload your data to get started', action: 'Upload Data', path: '/plans/my-onboarding/upload' }
    : data.mappingStats && data.mappingStats.needsReview > 0
    ? { label: 'Review proposed field mappings', action: 'Review Mappings', path: '/plans/my-onboarding/mappings' }
    : data.decisionStats && data.decisionStats.open > 0
    ? { label: 'Decisions need your input', action: 'View Decisions', path: '/plans/my-onboarding/decisions' }
    : isGenerateOrLater
    ? { label: 'Review your data and fix any issues before migration', action: 'Data Review', path: '/plans/my-onboarding/data-review' }
    : memberWorkComplete
    ? { label: "You're all caught up! Your onboarding coach will review and advance to the next step.", action: 'View Status', path: '/plans/my-onboarding/status' }
    : { label: 'Check your onboarding status', action: 'View Status', path: '/plans/my-onboarding/status' };

  // Member-focused onboarding steps
  const uploaded = data.uploadStatus !== 'NONE';
  const hasDataHealth = isGenerateOrLater;

  type MemberStep = { title: string; description: string; done: boolean; active: boolean; icon: React.ReactNode };
  const memberSteps: MemberStep[] = [
    {
      title: 'Upload Data',
      description: uploaded ? (data.uploadFilename || 'File uploaded') : 'Upload your data file',
      done: uploaded,
      active: !uploaded,
      icon: <UploadOutlined />,
    },
    {
      title: 'Review Mappings',
      description: allMappingsDone
        ? `${data.mappingStats?.mapped ?? 0} fields mapped`
        : `${data.mappingStats?.needsReview ?? 0} of ${mappingTotal} to review`,
      done: !!allMappingsDone,
      active: uploaded && !allMappingsDone,
      icon: <FileTextOutlined />,
    },
    {
      title: 'Decisions',
      description: allDecisionsDone
        ? `${data.decisionStats?.approved ?? 0} resolved`
        : `${data.decisionStats?.open ?? 0} need your input`,
      done: allDecisionsDone && uploaded,
      active: !!allMappingsDone && !allDecisionsDone,
      icon: <BulbOutlined />,
    },
    {
      title: 'Data Review',
      description: hasDataHealth ? 'Review and fix any issues' : 'Waiting for coach review',
      done: hasDataHealth && isGenerateOrLater && data.migrationPhase !== 'GENERATE',
      active: hasDataHealth && data.migrationPhase === 'GENERATE',
      icon: <HeartOutlined />,
    },
    {
      title: 'Migration',
      description: data.migrationPhase === 'CUT_OVER' ? 'Complete!' : 'Your coach will handle this',
      done: data.migrationPhase === 'CUT_OVER',
      active: ['DRY_RUN', 'MIGRATE'].includes(data.migrationPhase),
      icon: <SafetyCertificateOutlined />,
    },
  ];

  const completedSteps = memberSteps.filter((s) => s.done).length;
  const overallPct = Math.round((completedSteps / memberSteps.length) * 100);

  return (
    <div style={{ margin: '0 auto' }}>
      {banner}

      {/* Next step banner */}
      <Card
        style={{ marginTop: 16, marginBottom: 24, background: '#f3eeff' }}
        size="small"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text strong>Next step: </Text>
            <Text>{nextStep.label}</Text>
          </div>
          <Button type="primary" onClick={() => navigate(nextStep.path)}
            style={{ background: '#2d1854', borderColor: '#2d1854', color: '#fff' }}>
            {nextStep.action}
          </Button>
        </div>
      </Card>

      {/* Member onboarding progress */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text strong style={{ color: '#2d1854' }}>Your Progress</Text>
          <Space size={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>{completedSteps} of {memberSteps.length} complete</Text>
            <Progress type="circle" size={32} percent={overallPct} strokeColor="#2d1854"
              format={() => <span style={{ fontSize: 10 }}>{overallPct}%</span>} />
          </Space>
        </div>
        <Steps
          direction="vertical"
          size="small"
          current={memberSteps.findIndex((s) => s.active)}
          items={memberSteps.map((step) => ({
            title: step.title,
            description: step.description,
            status: step.done ? 'finish' as const : step.active ? 'process' as const : 'wait' as const,
            icon: step.done
              ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
              : step.active
              ? <span style={{ color: '#2d1854' }}>{step.icon}</span>
              : undefined,
          }))}
        />
      </Card>

      {/* Stats cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Space>
              <UploadOutlined style={{ fontSize: 20, color: '#2d1854' }} />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Upload</Text>
                <div>
                  {data.uploadStatus === 'NONE' ? (
                    <Tag color="default">No data yet</Tag>
                  ) : (
                    <>
                      <Tag icon={<CheckCircleOutlined />} color="success">Uploaded</Tag>
                      <div style={{ fontSize: 12, marginTop: 4 }}>
                        <Text type="secondary">{data.uploadFilename}</Text>
                        {data.uploadRowCount != null && (
                          <Text type="secondary"> · {data.uploadRowCount.toLocaleString()} rows</Text>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Space>
              <FileTextOutlined style={{ fontSize: 20, color: '#2d1854' }} />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Mappings</Text>
                <div>
                  <Text style={{ fontSize: 12 }}>
                    {data.mappingStats?.mapped ?? 0} of {data.mappingStats?.total ?? 0} mapped
                  </Text>
                  {(data.mappingStats?.needsReview ?? 0) > 0 && (
                    <Tag icon={<ClockCircleOutlined />} style={{ marginLeft: 8, backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>
                      {data.mappingStats?.needsReview} to review
                    </Tag>
                  )}
                  <Progress percent={mappingPct} size="small" strokeColor="#2d1854" style={{ width: 120, marginTop: 4 }} />
                </div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Space>
              <BulbOutlined style={{ fontSize: 20, color: '#2d1854' }} />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Decisions</Text>
                <div>
                  {(data.decisionStats?.open || 0) > 0 ? (
                    <Tag icon={<ClockCircleOutlined />} style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>
                      {data.decisionStats?.open} open
                    </Tag>
                  ) : (
                    <Tag icon={<CheckCircleOutlined />} color="success">All resolved</Tag>
                  )}
                  <Text style={{ fontSize: 12, marginLeft: 4 }}>
                    {data.decisionStats?.approved || 0} approved
                  </Text>
                </div>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* All-done banner */}
      {memberWorkComplete && (
        <Card size="small" style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a' }} />
            <div>
              <Text strong style={{ color: '#237804' }}>All tasks complete</Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  All mappings approved and decisions resolved. Your onboarding coach will review
                  everything and advance you to the next step. You'll be notified when there's
                  something new for you to look at.
                </Text>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Quick actions */}
      <Card size="small" title={<>Quick Actions</>}>
        <Space wrap>
          <Button icon={<UploadOutlined />} onClick={() => navigate('/plans/my-onboarding/upload')}
            style={{ borderColor: '#2d1854', color: '#2d1854', background: '#f3eeff' }}>
            Upload Data
          </Button>
          <Tooltip title={data.uploadStatus === 'NONE' ? 'Upload your data first' : undefined}>
            <Button icon={<FileTextOutlined />} onClick={() => navigate('/plans/my-onboarding/mappings')}
              disabled={data.uploadStatus === 'NONE'}
              style={{ borderColor: '#2d1854', color: '#2d1854', background: '#f3eeff' }}>
              Review Mappings
            </Button>
          </Tooltip>
          <Button icon={<BulbOutlined />} onClick={() => navigate('/plans/my-onboarding/decisions')}
            style={{ borderColor: '#2d1854', color: '#2d1854', background: '#f3eeff' }}>
            Decisions
          </Button>
          <Button icon={<SafetyCertificateOutlined />} onClick={() => navigate('/plans/my-onboarding/status')}
            style={{ borderColor: '#2d1854', color: '#2d1854', background: '#f3eeff' }}>
            View Status
          </Button>
        </Space>
      </Card>
    </div>
  );
}
