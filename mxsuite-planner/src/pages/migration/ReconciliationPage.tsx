import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button, Card, Col, Modal, Row, Spin, Table, Tag, Typography, message,
} from 'antd';
import {
  CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ReconciliationReportDto, ReconTierDto, ReconTableRowDto, ReconStatus } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';

const { Title, Text, Paragraph } = Typography;

const STATUS_CONFIG: Record<ReconStatus, { color: string; icon: React.ReactNode; bg: string }> = {
  PASS: { color: '#52c41a', icon: <CheckCircleOutlined />, bg: '#f6ffed' },
  WARN: { color: '#fa8c16', icon: <ExclamationCircleOutlined />, bg: '#fffbe6' },
  FAIL: { color: '#ff4d4f', icon: <CloseCircleOutlined />, bg: '#fff2f0' },
};

function StatusTag({ status }: { status: ReconStatus }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PASS;
  return <Tag color={cfg.color} icon={cfg.icon}>{status}</Tag>;
}

function TierCard({ tier }: { tier: ReconTierDto }) {
  const cfg = STATUS_CONFIG[tier.status] || STATUS_CONFIG.PASS;
  return (
    <Card
      size="small"
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text strong style={{ fontSize: 13 }}>{tier.tier}</Text>
          <StatusTag status={tier.status} />
        </div>
      }
      style={{ height: '100%', borderTop: `3px solid ${cfg.color}` }}
    >
      <div style={{ fontSize: 12, lineHeight: 2 }}>
        {tier.threshold != null && <div><Text type="secondary">Threshold:</Text> {tier.threshold}%</div>}
        {tier.sourceRows != null && <div><Text type="secondary">Source rows:</Text> {tier.sourceRows.toLocaleString()}</div>}
        {tier.targetRows != null && <div><Text type="secondary">Target rows:</Text> {tier.targetRows.toLocaleString()}</div>}
        {tier.variance != null && <div><Text type="secondary">Variance:</Text> {tier.variance}</div>}
        {tier.columnsHashed != null && <div><Text type="secondary">Columns hashed:</Text> {tier.columnsHashed}</div>}
        {tier.matched != null && <div><Text type="secondary">Matched:</Text> {tier.matched}</div>}
        {tier.mismatched != null && <div><Text type="secondary">Mismatched:</Text> {tier.mismatched}</div>}
        {tier.fieldsSampled != null && <div><Text type="secondary">Fields sampled:</Text> {tier.fieldsSampled}</div>}
        {tier.matchRate != null && <div><Text type="secondary">Match rate:</Text> {tier.matchRate}%</div>}
        {tier.orphanRows != null && <div><Text type="secondary">Orphan rows:</Text> {tier.orphanRows}</div>}
      </div>
    </Card>
  );
}

export default function ReconciliationPage() {
  usePageTitle('Reconciliation');
  const { projectId } = useParams<{ projectId: string }>();
  const [report, setReport] = useState<ReconciliationReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [signOffOpen, setSignOffOpen] = useState(false);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    migrationApi.getLatestRecon(projectId)
      .then(({ data }) => setReport(data))
      .catch(() => { /* no report yet */ })
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleSignOff = async () => {
    if (!projectId || !report) return;
    setSigning(true);
    try {
      const { data } = await migrationApi.signOffRecon(projectId, report.id, {});
      setReport(data);
      setSignOffOpen(false);
      message.success('Reconciliation signed off');
    } catch {
      message.error('Failed to sign off');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading reconciliation..." />
      </div>
    );
  }

  if (!report) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Title level={5}>No reconciliation report</Title>
        <Text type="secondary">No reconciliation report has been generated for this project yet.</Text>
      </div>
    );
  }

  const overallCfg = STATUS_CONFIG[report.overallStatus] || STATUS_CONFIG.PASS;

  const tableColumns: ColumnsType<ReconTableRowDto> = [
    {
      title: 'Target Table',
      dataIndex: 'table',
      key: 'table',
      render: (t: string) => <Text strong style={{ fontSize: 13 }}>{t}</Text>,
    },
    { title: 'Source Rows', dataIndex: 'sourceRows', key: 'sourceRows', align: 'right',
      render: (v: number) => v?.toLocaleString() },
    { title: 'Target Rows', dataIndex: 'targetRows', key: 'targetRows', align: 'right',
      render: (v: number) => v?.toLocaleString() },
    { title: 'Row-Count', dataIndex: 'rowCount', key: 'rowCount', align: 'center',
      render: (s: ReconStatus) => <StatusTag status={s} /> },
    { title: 'Checksum', dataIndex: 'checksum', key: 'checksum', align: 'center',
      render: (s: ReconStatus) => <StatusTag status={s} /> },
    { title: 'Ref. Integrity', dataIndex: 'refIntegrity', key: 'refIntegrity', align: 'center',
      render: (s: ReconStatus) => <StatusTag status={s} /> },
    { title: 'Field-Level', dataIndex: 'fieldLevel', key: 'fieldLevel', align: 'center',
      render: (s: ReconStatus) => <StatusTag status={s} /> },
  ];

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Full reconciliation</Title>
          <Text style={{ fontSize: 12, color: '#6b4fa0' }}>
            Four tiers, cheapest to strongest. Reconciliation proves data moved faithfully.
          </Text>
        </div>
        {!report.signedOff && (
          <Button
            type="primary"
            icon={<SafetyCertificateOutlined />}
            onClick={() => setSignOffOpen(true)}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}
          >
            Sign Off
          </Button>
        )}
      </div>

      {/* Signed-off banner */}
      {report.signedOff && (
        <Card size="small" style={{ marginBottom: 16, background: '#f6ffed', borderColor: '#b7eb8f' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a' }} />
            <div>
              <Text strong>
                Signed by {report.signerName} · {report.signerRole}
              </Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Overall: <StatusTag status={report.overallStatus} />
                  {report.warningCount > 0 && ` with ${report.warningCount} warning${report.warningCount > 1 ? 's' : ''}`}
                </Text>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Overall status if not signed */}
      {!report.signedOff && (
        <Card size="small" style={{ marginBottom: 16, background: overallCfg.bg }}>
          <Text strong>Overall: <StatusTag status={report.overallStatus} /></Text>
          {report.warningCount > 0 && (
            <Text type="secondary"> with {report.warningCount} warning{report.warningCount > 1 ? 's' : ''}</Text>
          )}
        </Card>
      )}

      {/* Tier cards */}
      <Title level={5} style={{ marginBottom: 12 }}>Reconciliation tiers</Title>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {(report.tiers || []).map((tier, idx) => (
          <Col xs={24} sm={12} md={6} key={idx}>
            <TierCard tier={tier} />
          </Col>
        ))}
      </Row>

      {/* Warning detail */}
      {report.warningDetail && (
        <Card
          size="small"
          style={{ marginBottom: 24, background: '#fffbe6', borderColor: '#ffe58f' }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <ExclamationCircleOutlined style={{ color: '#fa8c16', marginTop: 3 }} />
            <div>
              <Text strong style={{ fontSize: 12 }}>Warning detail</Text>
              <Paragraph style={{ fontSize: 12, marginBottom: 0, marginTop: 4 }}>
                {report.warningDetail}
              </Paragraph>
            </div>
          </div>
        </Card>
      )}

      {/* Per-table breakdown */}
      {report.tableBreakdown && report.tableBreakdown.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 12 }}>Per-table breakdown</Title>
          <Table
            columns={tableColumns}
            dataSource={report.tableBreakdown}
            rowKey="table"
            size="small"
            pagination={false}
          />
        </>
      )}

      {/* Sign-off modal */}
      <Modal
        title="Sign off reconciliation"
        open={signOffOpen}
        onOk={handleSignOff}
        onCancel={() => setSignOffOpen(false)}
        confirmLoading={signing}
        okText="Confirm Sign Off"
      >
        <Paragraph>
          By signing off, you confirm that the reconciliation results have been reviewed
          and the data migration is accurate within the defined thresholds.
        </Paragraph>
        <Paragraph type="secondary">
          Overall status: <StatusTag status={report.overallStatus} />
          {report.warningCount > 0 && ` (${report.warningCount} warnings)`}
        </Paragraph>
      </Modal>
    </div>
  );
}
