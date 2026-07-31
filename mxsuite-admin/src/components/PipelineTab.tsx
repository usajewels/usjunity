import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Card, Steps, Table, Tag, Button, Space, Spin, Typography, Row, Col,
  Statistic, Progress, Popconfirm, message, notification, Empty, Alert,
} from 'antd';
import {
  CloudUploadOutlined, DatabaseOutlined, AuditOutlined,
  SafetyCertificateOutlined, ExportOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { ReconciliationReportDto } from '@mxsuite/shared';
import { pipelineApi, type ValidationRunDto, type EntitySummaryDto } from '../services/api';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  PASS: '#52c41a',
  WARN: '#faad14',
  FAIL: '#ff4d4f',
};

interface Props {
  tenantId: string;
}

export default function PipelineTab({ tenantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploadFilename, setUploadFilename] = useState<string>();
  const [uploadRowCount, setUploadRowCount] = useState<number>();
  const [stagingStatus, setStagingStatus] = useState<string>('NONE');
  const [exportStatus, setExportStatus] = useState<string>('NONE');
  const [exportedAt, setExportedAt] = useState<string>();

  const [validation, setValidation] = useState<ValidationRunDto | null>(null);
  const [entityBreakdown, setEntityBreakdown] = useState<EntitySummaryDto[]>([]);
  const [validating, setValidating] = useState(false);
  const validationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [recon, setRecon] = useState<ReconciliationReportDto | null>(null);
  const [signingOff, setSigningOff] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const { data } = await pipelineApi.getOnboarding(tenantId);
      if (!data.hasProject || !data.projectId) {
        setLoading(false);
        return;
      }
      setProjectId(data.projectId);
      setUploadId(data.uploadId ?? null);
      setUploadFilename(data.uploadFilename);
      setUploadRowCount(data.uploadRowCount);
      setStagingStatus(data.stagingStatus ?? 'NONE');
      setExportStatus(data.s3ExportStatus ?? 'NONE');
      setExportedAt(data.s3ExportedAt);

      // Fetch validation
      try {
        const valRes = await pipelineApi.getLatestValidation(data.projectId);
        setValidation(valRes.data);
        if (valRes.data?.id) {
          const issueRes = await pipelineApi.getIssuesByEntity(data.projectId, valRes.data.id);
          setEntityBreakdown(issueRes.data);
        }
      } catch { /* no validation yet */ }

      // Fetch reconciliation
      try {
        const reconRes = await pipelineApi.getReconLatest(data.projectId);
        setRecon(reconRes.data);
      } catch { /* no recon yet */ }
    } catch {
      // project may not exist yet
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Compute pipeline step
  const computeCurrentStep = () => {
    if (exportStatus === 'EXPORTED') return 4;
    if (recon?.signedOff) return 4;
    if (validation?.status === 'COMPLETED') return 3;
    if (stagingStatus === 'STAGED') return 2;
    if (uploadFilename) return 1;
    return 0;
  };

  const handleRunValidation = async () => {
    if (!projectId || !uploadId) return;
    setValidating(true);
    try {
      await pipelineApi.triggerValidation(projectId, uploadId);
      message.info('Validation started...');

      // Poll for completion
      validationPollRef.current = setInterval(async () => {
        try {
          const { data } = await pipelineApi.getLatestValidation(projectId);
          setValidation(data);
          if (data.status === 'COMPLETED' || data.status === 'FAILED') {
            if (validationPollRef.current) clearInterval(validationPollRef.current);
            setValidating(false);
            if (data.status === 'COMPLETED') {
              notification.success({ message: 'Validation Complete', description: `${data.validRows} of ${data.totalRows} rows passed validation.` });
              const issueRes = await pipelineApi.getIssuesByEntity(projectId, data.id);
              setEntityBreakdown(issueRes.data);
            } else {
              notification.error({ message: 'Validation Failed', description: 'Check server logs for details.' });
            }
          }
        } catch { /* keep polling */ }
      }, 5000);
    } catch {
      message.error('Failed to start validation');
      setValidating(false);
    }
  };

  useEffect(() => {
    return () => { if (validationPollRef.current) clearInterval(validationPollRef.current); };
  }, []);

  const handleSignOff = async () => {
    if (!projectId || !recon?.id) return;
    setSigningOff(true);
    try {
      const { data } = await pipelineApi.signOff(projectId, recon.id, {
        signerName: '', // backend fills from principal
        signerRole: '',
      });
      setRecon(data);
      notification.success({
        message: 'Signed Off',
        description: 'Reconciliation signed off. Parquet export has been triggered.',
      });
      // Re-fetch to get export status
      setTimeout(fetchAll, 3000);
    } catch {
      message.error('Failed to sign off');
    } finally {
      setSigningOff(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  if (!projectId) {
    return <Empty description="No onboarding project found for this organization." />;
  }

  const qualityPct = validation && validation.totalRows > 0
    ? Math.round((validation.validRows / validation.totalRows) * 100)
    : null;

  const entityColumns = [
    { title: 'Entity', dataIndex: 'entity', key: 'entity' },
    { title: 'Errors', dataIndex: 'errors', key: 'errors', render: (v: number) => v > 0 ? <Text type="danger">{v}</Text> : v },
    { title: 'Warnings', dataIndex: 'warnings', key: 'warnings', render: (v: number) => v > 0 ? <Text style={{ color: '#faad14' }}>{v}</Text> : v },
    { title: 'Total', dataIndex: 'total', key: 'total' },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Pipeline Timeline */}
      <Card size="small" title={<Space><Title level={5} style={{ margin: 0 }}>Pipeline Status</Title><Button size="small" icon={<ReloadOutlined />} onClick={fetchAll}>Refresh</Button></Space>}>
        <Steps
          current={computeCurrentStep()}
          size="small"
          items={[
            { title: 'Upload', icon: <CloudUploadOutlined />, description: uploadFilename ? `${uploadFilename}` : 'No upload' },
            { title: 'Staging', icon: <DatabaseOutlined />, description: stagingStatus === 'STAGED' ? `${uploadRowCount ?? 0} rows` : stagingStatus },
            { title: 'Validation', icon: <AuditOutlined />, description: validation?.status === 'COMPLETED' ? `${qualityPct}% quality` : validation?.status ?? 'Not run' },
            { title: 'Sign-Off', icon: <SafetyCertificateOutlined />, description: recon?.signedOff ? `By ${recon.signerName}` : 'Pending' },
            { title: 'Export', icon: <ExportOutlined />, description: exportStatus === 'EXPORTED' ? 'Complete' : exportStatus },
          ]}
        />
      </Card>

      {/* Validation */}
      <Card
        size="small"
        title={<Title level={5} style={{ margin: 0 }}>Validation Results</Title>}
        extra={
          <Button
            type="primary"
            onClick={handleRunValidation}
            loading={validating}
            disabled={stagingStatus !== 'STAGED' || validating}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}
          >
            {validating ? 'Running...' : 'Run Validation'}
          </Button>
        }
      >
        {!validation ? (
          <Empty description={stagingStatus !== 'STAGED' ? 'Data must be staged before validation can run.' : 'No validation has been run yet. Click "Run Validation" to start.'} />
        ) : (
          <>
            <Row gutter={24} style={{ marginBottom: 16 }}>
              <Col>
                <Progress type="circle" percent={qualityPct ?? 0} size={80}
                  strokeColor={qualityPct !== null && qualityPct >= 95 ? '#52c41a' : qualityPct !== null && qualityPct >= 80 ? '#faad14' : '#ff4d4f'} />
              </Col>
              <Col>
                <Statistic title="Total Rows" value={validation.totalRows} />
              </Col>
              <Col>
                <Statistic title="Errors" value={validation.errorRows} valueStyle={{ color: validation.errorRows > 0 ? '#ff4d4f' : undefined }} />
              </Col>
              <Col>
                <Statistic title="Warnings" value={validation.warningRows} valueStyle={{ color: validation.warningRows > 0 ? '#faad14' : undefined }} />
              </Col>
              <Col>
                <Statistic title="Status" value={validation.status} />
              </Col>
            </Row>
            {entityBreakdown.length > 0 && (
              <Table
                dataSource={entityBreakdown}
                columns={entityColumns}
                rowKey="entity"
                pagination={false}
                size="small"
              />
            )}
          </>
        )}
      </Card>

      {/* Reconciliation */}
      <Card
        size="small"
        title={<Title level={5} style={{ margin: 0 }}>Reconciliation</Title>}
        extra={
          recon && !recon.signedOff ? (
            <Popconfirm
              title="Sign off reconciliation?"
              description="This will approve the data quality and trigger Parquet export to S3."
              onConfirm={handleSignOff}
              okText="Sign Off"
            >
              <Button
                type="primary"
                loading={signingOff}
                style={{ background: '#2d1854', borderColor: '#2d1854' }}
                icon={<SafetyCertificateOutlined />}
              >
                Sign Off
              </Button>
            </Popconfirm>
          ) : null
        }
      >
        {!recon ? (
          <Empty description="No reconciliation report available yet. Run validation first." />
        ) : (
          <>
            {recon.signedOff && (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message={`Signed off by ${recon.signerName || 'Coach'} (${recon.signerRole || ''})`}
                description={recon.signedAt ? `on ${new Date(recon.signedAt).toLocaleString()}` : undefined}
                style={{ marginBottom: 16 }}
              />
            )}
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong>Overall: </Text>
                <Tag color={STATUS_COLORS[recon.overallStatus] || '#999'}>{recon.overallStatus}</Tag>
                {recon.warningCount > 0 && <Text type="warning">({recon.warningCount} warnings)</Text>}
              </div>
              {recon.tiers?.map((tier, i) => (
                <div key={i}>
                  <Text>{tier.tier}: </Text>
                  <Tag color={STATUS_COLORS[tier.status] || '#999'}>{tier.status}</Tag>
                  {tier.matchRate != null && <Text type="secondary">({Math.round(Number(tier.matchRate) * 100)}% match)</Text>}
                </div>
              ))}
            </Space>
          </>
        )}
      </Card>

      {/* Export Status */}
      <Card size="small" title={<Title level={5} style={{ margin: 0 }}>Export Status</Title>}>
        {exportStatus === 'EXPORTED' ? (
          <Alert
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            message="Data exported successfully"
            description={exportedAt ? `Exported on ${new Date(exportedAt).toLocaleString()}` : 'Parquet files uploaded to S3.'}
          />
        ) : exportStatus === 'EXPORTING' ? (
          <Alert type="info" showIcon icon={<Spin size="small" />} message="Exporting data to S3..." description="Parquet files are being generated and uploaded." />
        ) : exportStatus === 'FAILED' ? (
          <Alert type="error" showIcon icon={<CloseCircleOutlined />} message="Export failed" description="Check server logs for details." />
        ) : (
          <Text type="secondary">
            {recon?.signedOff ? 'Export should start automatically after sign-off.' : 'Export will begin after reconciliation sign-off.'}
          </Text>
        )}
      </Card>
    </Space>
  );
}
