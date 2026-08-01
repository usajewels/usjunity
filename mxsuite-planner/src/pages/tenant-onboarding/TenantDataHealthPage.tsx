import { useEffect, useState } from 'react';
import { usePageTitle } from '@mxsuite/shared';
import {
  Alert, Button, Card, Table, Tag, Typography, Spin, message, Row, Col, Progress, Modal, Input, Select, Space, Empty,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined, EditOutlined, ExclamationCircleOutlined, InfoCircleOutlined, HeartOutlined,
} from '@ant-design/icons';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';
import type {
  TenantDataHealthDto, TenantDataHealthIssueDto, TenantEntityHealthDto,
} from '../../services/tenantOnboardingApi';

const { Title, Text, Paragraph } = Typography;

const SEVERITY_CONFIG: Record<string, { color: string; tagColor: string; label: string; icon: React.ReactNode }> = {
  ERROR: { color: '#cf1322', tagColor: 'error', label: 'Needs fixing', icon: <ExclamationCircleOutlined /> },
  WARNING: { color: '#d46b08', tagColor: 'warning', label: 'Review', icon: <ExclamationCircleOutlined /> },
  INFO: { color: '#096dd9', tagColor: 'processing', label: 'Info', icon: <InfoCircleOutlined /> },
};

const RULE_LABELS: Record<string, string> = {
  REQUIRED: 'Required field is empty',
  UNMAPPED_REQUIRED: 'Required field has no data source',
  TYPE_MISMATCH: 'Value type doesn\'t match',
  FORMAT_EMAIL: 'Invalid email format',
  FORMAT_DATE: 'Invalid date format',
  FORMAT_PHONE: 'Invalid phone format',
  FK_BROKEN: 'Related record not found',
  DUPLICATE: 'Duplicate value',
};

function qualityGrade(pct: number): { label: string; color: string } {
  if (pct >= 95) return { label: 'Excellent', color: '#237804' };
  if (pct >= 80) return { label: 'Good', color: '#096dd9' };
  if (pct >= 60) return { label: 'Fair', color: '#d46b08' };
  return { label: 'Needs attention', color: '#cf1322' };
}

export default function TenantDataHealthPage() {
  usePageTitle('Data Review');
  const [health, setHealth] = useState<TenantDataHealthDto | null>(null);
  const [entities, setEntities] = useState<TenantEntityHealthDto[]>([]);
  const [issues, setIssues] = useState<TenantDataHealthIssueDto[]>([]);
  const [totalIssues, setTotalIssues] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<string | undefined>();
  const [entityFilter, setEntityFilter] = useState<string | undefined>();
  const [resolvedFilter, setResolvedFilter] = useState<boolean | undefined>(false);
  const [fixModal, setFixModal] = useState<TenantDataHealthIssueDto | null>(null);
  const [fixValue, setFixValue] = useState('');
  const [fixing, setFixing] = useState(false);

  const loadData = async () => {
    try {
      const [healthRes, entityRes] = await Promise.all([
        tenantOnboardingApi.getDataHealth(),
        tenantOnboardingApi.getDataHealthByEntity(),
      ]);
      setHealth(healthRes.data);
      setEntities(entityRes.data ?? []);
    } catch {
      // Silently handle — might not have validation data yet
    }
  };

  const loadIssues = async () => {
    try {
      const res = await tenantOnboardingApi.getDataHealthIssues({
        severity: severityFilter,
        entity: entityFilter,
        resolved: resolvedFilter,
        page,
        size: 20,
      });
      setIssues(res.data.content ?? []);
      setTotalIssues(res.data.totalElements);
    } catch {
      // No issues available yet
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadData();
      await loadIssues();
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => { loadIssues(); }, [page, severityFilter, entityFilter, resolvedFilter]);

  const handleFix = async () => {
    if (!fixModal || !fixValue.trim()) return;
    setFixing(true);
    try {
      await tenantOnboardingApi.resolveDataHealthIssue(fixModal.id, fixValue.trim());
      message.success('Value updated');
      setFixModal(null);
      setFixValue('');
      await Promise.all([loadData(), loadIssues()]);
    } catch {
      message.error('Failed to save');
    } finally {
      setFixing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Checking your data..." />
      </div>
    );
  }

  // No validation has run yet
  if (!health) {
    return (
      <div>
        <div style={{
          background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
          margin: '-24px -24px 24px -24px',
          padding: '28px 32px 20px 32px',
          borderBottom: '3px solid #6b4fa0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <HeartOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
            <div>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>Data Review</Title>
              <Text style={{ color: 'rgba(255,255,255,0.7)' }}>
                See how ready your data is for migration.
              </Text>
            </div>
          </div>
        </div>
        <Empty
          description={
            <div>
              <Paragraph style={{ fontSize: 15, color: 'rgba(0,0,0,0.65)' }}>
                Your data hasn't been checked yet.
              </Paragraph>
              <Paragraph type="secondary">
                Once your field mappings are reviewed, your onboarding coach will run a data quality check.
                You'll see the results here.
              </Paragraph>
            </div>
          }
        />
      </div>
    );
  }

  // Validation is still running
  if (health.status === 'RUNNING') {
    return (
      <div>
        <div style={{
          background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
          margin: '-24px -24px 24px -24px',
          padding: '28px 32px 20px 32px',
          borderBottom: '3px solid #6b4fa0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <HeartOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
            <div>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>Data Review</Title>
              <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Checking your data...</Text>
            </div>
          </div>
        </div>
        <Card style={{ textAlign: 'center', padding: 32 }}>
          <Spin size="large" />
          <Title level={5} style={{ marginTop: 16, color: '#6b4fa0' }}>
            Checking your data...
          </Title>
          <Text type="secondary">
            We're scanning your uploaded file to make sure everything is ready for migration.
            This page will update automatically.
          </Text>
        </Card>
      </div>
    );
  }

  const grade = qualityGrade(health.qualityPct);

  const issueColumns: ColumnsType<TenantDataHealthIssueDto> = [
    {
      title: 'Row',
      dataIndex: 'rowNumber',
      key: 'row',
      width: 70,
      render: (row: number) => row === 0
        ? <Tag color="purple">Setup</Tag>
        : <Text style={{ fontFamily: 'monospace' }}>{row}</Text>,
    },
    {
      title: 'Field',
      key: 'field',
      render: (_, record) => (
        <div>
          <Text strong>{record.targetField || '—'}</Text>
          {record.targetEntity && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {record.targetEntity}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: 'Issue',
      key: 'severity',
      width: 110,
      render: (_, record) => {
        const cfg = SEVERITY_CONFIG[record.severity];
        return (
          <Tag color={cfg?.tagColor} icon={cfg?.icon}>
            {cfg?.label || record.severity}
          </Tag>
        );
      },
    },
    {
      title: 'What\'s wrong',
      dataIndex: 'message',
      key: 'message',
      render: (msg: string, record) => (
        <div>
          <Text>{RULE_LABELS[record.ruleCode] || msg}</Text>
          {record.currentValue && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
              Current value: "{record.currentValue}"
            </Text>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 160,
      render: (_, record) => {
        if (record.resolved) {
          return (
            <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
              <Tag icon={<CheckCircleOutlined />} color="success">Fixed</Tag>
              {record.resolvedByName && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  by {record.resolvedByName}
                </Text>
              )}
              {record.resolvedAt && (
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {new Date(record.resolvedAt).toLocaleDateString()}
                </Text>
              )}
              {record.rowNumber > 0 && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, fontSize: 11, height: 'auto' }}
                  onClick={() => { setFixModal(record); setFixValue(record.resolvedValue || record.currentValue || ''); }}
                >
                  Edit
                </Button>
              )}
            </Space>
          );
        }
        if (record.rowNumber === 0) return null;
        return (
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => { setFixModal(record); setFixValue(record.currentValue || ''); }}
          >
            Fix
          </Button>
        );
      },
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
          <HeartOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Data Review</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>
              Here's how your uploaded data looks. Fix any issues below so your migration goes smoothly.
            </Text>
          </div>
        </div>
      </div>

      {/* Quality score */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${grade.color}` }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: grade.color }}>
              {health.qualityPct}%
            </div>
            <Text strong style={{ color: grade.color }}>{grade.label}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>Data Quality Score</Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#2d1854' }}>
              {health.totalRows.toLocaleString()}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>Total Rows</Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" style={{ textAlign: 'center' }}>
            <Row>
              <Col span={12}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#cf1322' }}>
                  {health.errorRows.toLocaleString()}
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>Need fixing</Text>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#d46b08' }}>
                  {health.warningRows.toLocaleString()}
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>To review</Text>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* Per-entity health */}
      {entities.length > 0 && (
        <>
          <Title level={5} style={{ color: '#2d1854', marginBottom: 12 }}>Health by data type</Title>
          <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
            {entities.map((e) => {
              const total = e.errors + e.warnings + e.infos;
              const healthPct = total > 0 ? Math.round((1 - e.errors / Math.max(total, 1)) * 100) : 100;
              const g = qualityGrade(healthPct);
              return (
                <Col key={e.entity} xs={12} sm={8} md={6}>
                  <Card size="small" hoverable style={{ textAlign: 'center' }}
                    onClick={() => { setEntityFilter(e.entity); setPage(0); }}>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>{e.entity}</Text>
                    <Progress
                      type="circle"
                      size={50}
                      percent={healthPct}
                      strokeColor={g.color}
                      format={() => <span style={{ fontSize: 12, color: g.color }}>{g.label}</span>}
                    />
                    {e.errors > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <Text style={{ fontSize: 11, color: '#cf1322' }}>{e.errors} to fix</Text>
                      </div>
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </>
      )}

      {/* Issues table */}
      <Card
        title={
          <Space>
            <span style={{ color: '#2d1854', fontWeight: 600 }}>Items to review</span>
            <Tag>{totalIssues}</Tag>
          </Space>
        }
        size="small"
        style={{}}
        extra={
          <Space size={8}>
            <Select
              placeholder="All types"
              allowClear
              value={severityFilter}
              onChange={(v) => { setSeverityFilter(v); setPage(0); }}
              style={{ width: 130 }}
              options={[
                { value: 'ERROR', label: 'Needs fixing' },
                { value: 'WARNING', label: 'Review' },
                { value: 'INFO', label: 'Info' },
              ]}
            />
            <Select
              placeholder="All data types"
              allowClear
              value={entityFilter}
              onChange={(v) => { setEntityFilter(v); setPage(0); }}
              style={{ width: 140 }}
              options={entities.map((e) => ({ value: e.entity, label: e.entity }))}
            />
            <Select
              placeholder="Status"
              allowClear
              value={resolvedFilter}
              onChange={(v) => { setResolvedFilter(v); setPage(0); }}
              style={{ width: 130 }}
              options={[
                { value: false, label: 'Unresolved' },
                { value: true, label: 'Fixed' },
              ]}
            />
          </Space>
        }
      >
        {totalIssues === 0 ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <CheckCircleOutlined style={{ fontSize: 32, color: '#237804' }} />
            <Title level={5} style={{ color: '#237804', marginTop: 8 }}>Everything looks good!</Title>
            <Text type="secondary">No unresolved issues found in your data.</Text>
          </div>
        ) : (
          <Table
            columns={issueColumns}
            dataSource={issues}
            rowKey="id"
            size="small"
            pagination={{
              current: page + 1,
              pageSize: 20,
              total: totalIssues,
              showTotal: (t) => `${t} items`,
              onChange: (p) => setPage(p - 1),
            }}
          />
        )}
      </Card>

      {/* Fix modal */}
      <Modal
        title="Provide the correct value"
        open={!!fixModal}
        onOk={handleFix}
        onCancel={() => { setFixModal(null); setFixValue(''); }}
        confirmLoading={fixing}
        okText="Save"
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854', color: '#fff' } }}
      >
        {fixModal && (
          <div>
            <Paragraph>
              <strong>Field:</strong> {fixModal.targetField}
              {fixModal.targetEntity && ` (${fixModal.targetEntity})`}
            </Paragraph>
            <Paragraph>
              <strong>Issue:</strong> {RULE_LABELS[fixModal.ruleCode] || fixModal.message}
            </Paragraph>
            {fixModal.resolved && fixModal.resolvedByName && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  <Text style={{ fontSize: 12 }}>
                    Previously corrected by <strong>{fixModal.resolvedByName}</strong>
                    {fixModal.resolvedAt && (
                      <> on {new Date(fixModal.resolvedAt).toLocaleDateString()}</>
                    )}
                  </Text>
                }
              />
            )}
            {fixModal.currentValue && (
              <Paragraph>
                <strong>Current value:</strong>{' '}
                <Text delete type="danger">{fixModal.currentValue}</Text>
              </Paragraph>
            )}
            <Paragraph style={{ marginBottom: 4 }}>
              <strong>Enter the correct value:</strong>
            </Paragraph>
            <Input
              value={fixValue}
              onChange={(e) => setFixValue(e.target.value)}
              placeholder="Type the correct value..."
              onPressEnter={handleFix}
              autoFocus
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
