import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Typography, Spin, Button, Progress, Tag, Row, Col, Space, Steps, message,
} from 'antd';
import {
  UploadOutlined, CheckCircleOutlined, ClockCircleOutlined,
  FileTextOutlined, BulbOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { TenantOnboardingDto } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';

const { Title, Text } = Typography;

const PHASE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover', MAP: 'Map', GENERATE: 'Generate',
  DRY_RUN: 'Dry Run', MIGRATE: 'Migrate', CUT_OVER: 'Cut Over',
};

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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading your onboarding..." />
      </div>
    );
  }

  if (!data) return null;

  const mappingTotal = data.mappingStats?.total ?? 0;
  const mappingPct = mappingTotal > 0
    ? Math.round((data.mappingStats!.mapped / mappingTotal) * 100) : 0;

  const nextStep = data.uploadStatus === 'NONE'
    ? { label: 'Upload your data to get started', action: 'Upload Data', path: '/plans/my-onboarding/upload' }
    : data.mappingStats && data.mappingStats.needsReview > 0
    ? { label: 'Review proposed field mappings', action: 'Review Mappings', path: '/plans/my-onboarding/mappings' }
    : data.decisionStats && data.decisionStats.open > 0
    ? { label: 'Decisions need your input', action: 'View Decisions', path: '/plans/my-onboarding/decisions' }
    : { label: 'Check your onboarding status', action: 'View Status', path: '/plans/my-onboarding/status' };

  const PHASE_ORDER: string[] = ['DISCOVER', 'MAP', 'GENERATE', 'DRY_RUN', 'MIGRATE', 'CUT_OVER'];
  const currentPhaseIdx = PHASE_ORDER.indexOf(data.migrationPhase);

  const gateMap = new Map<string, string>(
    (data.phaseGates || []).map((g) => [g.phase as string, g.gateStatus as string])
  );

  const phaseStepStatus = (idx: number): 'finish' | 'process' | 'wait' => {
    if (idx < currentPhaseIdx) return 'finish';
    if (idx === currentPhaseIdx) return 'process';
    const phase = PHASE_ORDER[idx];
    if (gateMap.get(phase) === 'CLEARED') return 'finish';
    return 'wait';
  };

  return (
    <div style={{ margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>My Onboarding</Title>
        <Text style={{ color: '#6b4fa0' }}>{data.projectName}</Text>
      </div>

      {/* Next step banner */}
      <Card
        style={{ marginTop: 16, marginBottom: 24, background: '#f3eeff', borderColor: '#e0d4f5' }}
        size="small"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Text strong>Next step: </Text>
            <Text>{nextStep.label}</Text>
          </div>
          <Button type="primary" onClick={() => navigate(nextStep.path)}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}>
            {nextStep.action}
          </Button>
        </div>
      </Card>

      {/* Phase lifecycle — full-width stepper */}
      <Card size="small" style={{ marginBottom: 16, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
        <Text strong style={{ display: 'block', marginBottom: 16, color: '#2d1854' }}>Onboarding Progress</Text>
        <Steps
          current={currentPhaseIdx}
          size="small"
          items={PHASE_ORDER.map((phase, idx) => ({
            title: PHASE_LABELS[phase] || phase,
            status: phaseStepStatus(idx),
          }))}
        />
      </Card>

      {/* Stats cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
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
          <Card size="small" style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
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
          <Card size="small" style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
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

      {/* Quick actions */}
      <Card size="small" title={<span style={{ color: '#2d1854' }}>Quick Actions</span>} style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
        <Space wrap>
          <Button icon={<UploadOutlined />} onClick={() => navigate('/plans/my-onboarding/upload')}
            style={{ borderColor: '#2d1854', color: '#2d1854', background: '#f3eeff' }}>
            Upload Data
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => navigate('/plans/my-onboarding/mappings')}
            style={{ borderColor: '#2d1854', color: '#2d1854', background: '#f3eeff' }}>
            Review Mappings
          </Button>
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
