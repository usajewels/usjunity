import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Breadcrumb, Button, Card, Col, Row, Spin, Table, Tag, Tabs, Typography,
  Progress, Statistic, Alert, Space, Input, Select, Modal, message,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
  WarningOutlined, ReloadOutlined, InfoCircleOutlined,
  ThunderboltOutlined, EditOutlined, UploadOutlined, ApartmentOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { usePageTitle } from '@mxsuite/shared';
import ProjectSubNav from '../../components/migration/ProjectSubNav';
import {
  migrationApi,
  type ValidationRunDto,
  type ValidationIssueDto,
  type EntitySummaryDto,
  type RuleSummaryDto,
} from '../../services/migrationApi';

const { Title, Text } = Typography;

// -- Status configs --

const SEVERITY_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  ERROR: { color: 'error', icon: <CloseCircleOutlined />, label: 'Error' },
  WARNING: { color: 'warning', icon: <ExclamationCircleOutlined />, label: 'Warning' },
  INFO: { color: 'processing', icon: <InfoCircleOutlined />, label: 'Info' },
};

const RULE_LABELS: Record<string, string> = {
  REQUIRED: 'Required field missing',
  UNMAPPED_REQUIRED: 'Required field not mapped',
  TYPE_MISMATCH: 'Invalid data type',
  FORMAT_EMAIL: 'Invalid email format',
  FORMAT_DATE: 'Invalid date format',
  FORMAT_PHONE: 'Invalid phone format',
  FK_BROKEN: 'Broken reference',
  DUPLICATE: 'Duplicate value',
};

function qualityGrade(pct: number): { label: string; color: string } {
  if (pct >= 95) return { label: 'Excellent', color: '#52c41a' };
  if (pct >= 80) return { label: 'Good', color: '#1677ff' };
  if (pct >= 60) return { label: 'Fair', color: '#fa8c16' };
  return { label: 'Poor', color: '#ff4d4f' };
}

// -- Entity Health Card --

function EntityHealthCard({ item, totalRows }: { item: EntitySummaryDto; totalRows: number }) {
  const cleanRows = totalRows > 0 ? Math.max(0, totalRows - item.errors) : 0;
  const pct = totalRows > 0 ? Math.round((cleanRows / totalRows) * 100) : 100;
  const grade = qualityGrade(pct);

  return (
    <Card size="small" style={{ height: '100%', borderTop: `3px solid ${grade.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <Text strong style={{ fontSize: 14 }}>{item.entity}</Text>
        <Tag color={grade.color === '#52c41a' ? 'success' : grade.color === '#ff4d4f' ? 'error' : grade.color === '#fa8c16' ? 'warning' : 'processing'}>
          {grade.label}
        </Tag>
      </div>
      <Progress
        percent={pct}
        strokeColor={grade.color}
        size="small"
        style={{ marginBottom: 8 }}
      />
      <div style={{ fontSize: 12, lineHeight: 2 }}>
        {item.errors > 0 && (
          <div>
            <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 4 }} />
            <Text type="secondary">{item.errors.toLocaleString()} errors</Text>
          </div>
        )}
        {item.warnings > 0 && (
          <div>
            <ExclamationCircleOutlined style={{ color: '#fa8c16', marginRight: 4 }} />
            <Text type="secondary">{item.warnings.toLocaleString()} warnings</Text>
          </div>
        )}
        {item.errors === 0 && item.warnings === 0 && (
          <div>
            <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 4 }} />
            <Text type="secondary">No issues</Text>
          </div>
        )}
      </div>
    </Card>
  );
}

// -- Main Page --

export default function DataHealthPage() {
  usePageTitle('Data Review');
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [run, setRun] = useState<ValidationRunDto | null>(null);
  const [entitySummary, setEntitySummary] = useState<EntitySummaryDto[]>([]);
  const [ruleSummary, setRuleSummary] = useState<RuleSummaryDto[]>([]);
  const [issues, setIssues] = useState<ValidationIssueDto[]>([]);
  const [issuePage, setIssuePage] = useState(0);
  const [issueTotal, setIssueTotal] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [entityFilter, setEntityFilter] = useState<string | undefined>(undefined);
  const [resolvedFilter, setResolvedFilter] = useState<boolean | undefined>(undefined);
  const [resolveModal, setResolveModal] = useState<ValidationIssueDto | null>(null);
  const [resolveValue, setResolveValue] = useState('');
  const [resolving, setResolving] = useState(false);

  // Fetch project name for breadcrumb
  useEffect(() => {
    if (!projectId) return;
    migrationApi.getProject(projectId)
      .then(({ data }) => setProjectName(data.name || projectId))
      .catch(() => {});
  }, [projectId]);

  // Fetch latest validation run
  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { data: runData } = await migrationApi.getLatestValidation(projectId);
      setRun(runData);
      if (runData && runData.status === 'COMPLETED') {
        const [entityRes, ruleRes] = await Promise.all([
          migrationApi.getIssuesByEntity(projectId, runData.id),
          migrationApi.getIssuesByRule(projectId, runData.id),
        ]);
        setEntitySummary(entityRes.data);
        setRuleSummary(ruleRes.data);
      }
    } catch {
      // No validation run yet — that's OK
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Fetch issues for the issues tab
  const fetchIssues = useCallback(async () => {
    if (!projectId || !run) return;
    try {
      const { data } = await migrationApi.listValidationIssues(projectId, run.id, {
        severity: severityFilter,
        entity: entityFilter,
        resolved: resolvedFilter,
        page: issuePage,
        size: 20,
      });
      setIssues(data.content);
      setIssueTotal(data.totalElements);
    } catch {
      message.error('Failed to load issues');
    }
  }, [projectId, run, severityFilter, entityFilter, resolvedFilter, issuePage]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { if (run?.status === 'COMPLETED') fetchIssues(); }, [fetchIssues, run]);

  // Trigger validation
  const handleValidate = async () => {
    if (!projectId) return;
    setValidating(true);
    try {
      // Get uploads for the project to find the latest parsed one
      const { data: assets } = await migrationApi.getProject(projectId);
      // For now, trigger with the project context — the API will handle finding the upload
      // We need the upload ID. Let's fetch it from the assets endpoint
      const uploadsRes = await (await import('@mxsuite/shared')).api.get<any[]>(
        `/projects/${projectId}/assets`);
      const uploads = uploadsRes.data || [];
      const parsed = uploads.find((u: any) => u.uploadStatus === 'PARSED' || u.uploadStatus === 'COMPLETED');
      if (!parsed) {
        message.warning('No parsed data upload found. Please upload and parse data first.');
        setValidating(false);
        return;
      }
      await migrationApi.triggerValidation(projectId, parsed.id);
      message.success('Validation started — results will appear shortly');
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const { data: latest } = await migrationApi.getLatestValidation(projectId);
          if (latest.status !== 'RUNNING') {
            clearInterval(poll);
            setRun(latest);
            setValidating(false);
            if (latest.status === 'COMPLETED') {
              const [entityRes, ruleRes] = await Promise.all([
                migrationApi.getIssuesByEntity(projectId, latest.id),
                migrationApi.getIssuesByRule(projectId, latest.id),
              ]);
              setEntitySummary(entityRes.data);
              setRuleSummary(ruleRes.data);
              message.success('Validation complete');
            } else {
              message.error('Validation failed');
            }
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch {
      message.error('Failed to start validation');
      setValidating(false);
    }
  };

  // Resolve single issue
  const handleResolve = async () => {
    if (!projectId || !run || !resolveModal) return;
    setResolving(true);
    try {
      await migrationApi.resolveIssue(projectId, run.id, resolveModal.id, resolveValue);
      message.success('Issue resolved');
      setResolveModal(null);
      setResolveValue('');
      await Promise.all([fetchData(), fetchIssues()]);
    } catch {
      message.error('Failed to resolve issue');
    } finally {
      setResolving(false);
    }
  };

  const headerBlock = (
    <div style={{
      background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
      margin: '-24px -24px 20px -24px',
      padding: '28px 32px 16px 32px',
      borderBottom: '2px solid #e0d4f5',
    }}>
      <Breadcrumb
        style={{ marginBottom: 10 }}
        items={[
          { title: <Button type="link" size="small" icon={<ArrowLeftOutlined />} style={{ padding: 0, color: '#1a0e3a' }} onClick={() => navigate('/plans/onboarding-projects/projects')}>Projects</Button> },
          { title: <span style={{ color: '#6b4fa0' }}>{projectName || '…'}</span> },
          { title: <span style={{ color: '#2d1854', fontWeight: 500 }}>Data Review</span> },
        ]}
      />
      <ProjectSubNav projectId={projectId!} activeKey="data-review" />
    </div>
  );

  if (loading) {
    return (
      <div>
        {headerBlock}
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin tip="Loading data review..." />
        </div>
      </div>
    );
  }

  const qualityPct = run && run.totalRows > 0
    ? Math.round((run.validRows / run.totalRows) * 100) : 0;
  const grade = qualityGrade(qualityPct);

  // -- Issue table columns --
  const issueColumns: ColumnsType<ValidationIssueDto> = [
    {
      title: 'Row',
      dataIndex: 'rowNumber',
      key: 'row',
      width: 70,
      render: (r: number) => r === 0 ? <Tag color="purple">Schema</Tag> : r.toLocaleString(),
    },
    {
      title: 'Entity',
      dataIndex: 'targetEntity',
      key: 'entity',
      width: 130,
      render: (e: string) => <Text strong style={{ fontSize: 13 }}>{e}</Text>,
    },
    {
      title: 'Field',
      dataIndex: 'targetField',
      key: 'field',
      width: 160,
      render: (f: string, record) => (
        <div>
          <Text code style={{ fontSize: 12 }}>{f}</Text>
          {record.sourceColumn && (
            <div><Text type="secondary" style={{ fontSize: 11 }}>from: {record.sourceColumn}</Text></div>
          )}
        </div>
      ),
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      width: 100,
      render: (s: string) => {
        const cfg = SEVERITY_CONFIG[s] || SEVERITY_CONFIG.INFO;
        return <Tag icon={cfg.icon} color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Rule',
      dataIndex: 'ruleCode',
      key: 'rule',
      width: 180,
      render: (code: string) => (
        <Text style={{ fontSize: 12 }}>{RULE_LABELS[code] || code}</Text>
      ),
    },
    {
      title: 'Current Value',
      dataIndex: 'currentValue',
      key: 'value',
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v
        ? <Text style={{ fontSize: 12 }}>{v}</Text>
        : <Text type="secondary" italic style={{ fontSize: 12 }}>empty</Text>,
    },
    {
      title: 'Message',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
      render: (m: string) => <Text style={{ fontSize: 12 }}>{m}</Text>,
    },
    {
      title: '',
      key: 'action',
      width: 160,
      render: (_: unknown, record: ValidationIssueDto) => {
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
                  onClick={() => { setResolveModal(record); setResolveValue(record.resolvedValue || record.currentValue || ''); }}
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
            onClick={() => { setResolveModal(record); setResolveValue(record.currentValue || ''); }}
          >
            Fix
          </Button>
        );
      },
    },
  ];

  // Rule summary columns
  const ruleColumns: ColumnsType<RuleSummaryDto> = [
    {
      title: 'Rule',
      dataIndex: 'rule',
      key: 'rule',
      render: (code: string) => <Text strong style={{ fontSize: 13 }}>{RULE_LABELS[code] || code}</Text>,
    },
    {
      title: 'Field',
      dataIndex: 'field',
      key: 'field',
      render: (f: string | null) => f ? <Text code style={{ fontSize: 12 }}>{f}</Text> : '—',
    },
    {
      title: 'Count',
      dataIndex: 'count',
      key: 'count',
      width: 100,
      align: 'right',
      render: (c: number) => <Text strong>{c.toLocaleString()}</Text>,
    },
  ];

  return (
    <div>
      {headerBlock}
      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Data Review</Title>
            <Text style={{ fontSize: 12, color: '#6b4fa0' }}>
              Validate uploaded data against GrowthZone requirements before import.
            </Text>
          </div>
          <Button
            type="primary"
            icon={validating ? <ReloadOutlined spin /> : <ThunderboltOutlined />}
            onClick={handleValidate}
            loading={validating}
            style={{ background: '#2d1854', borderColor: '#2d1854', color: '#fff' }}
          >
            {validating ? 'Validating...' : 'Run Validation'}
          </Button>
        </div>

      {/* No run yet — stepped guidance */}
      {!run && (
        <Card style={{ marginBottom: 24, borderColor: '#e0d4f5', borderTop: '3px solid #6b4fa0' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <ThunderboltOutlined style={{ fontSize: 36, color: '#6b4fa0', marginBottom: 8 }} />
            <Title level={5} style={{ color: '#2d1854', marginBottom: 4 }}>No validation run yet</Title>
            <Text type="secondary">Complete these steps, then run validation to check for issues.</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
            {[
              { icon: <UploadOutlined />, label: '1. Upload source data' },
              { icon: <ApartmentOutlined />, label: '2. Map fields to schema' },
              { icon: <ThunderboltOutlined />, label: '3. Run Validation' },
            ].map((step) => (
              <div key={step.label} style={{ textAlign: 'center', minWidth: 120 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: '#f3eeff', border: '1px solid #e0d4f5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 8px', fontSize: 18, color: '#6b4fa0',
                }}>
                  {step.icon}
                </div>
                <Text style={{ fontSize: 12, color: '#2d1854' }}>{step.label}</Text>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Running status */}
      {run?.status === 'RUNNING' && (
        <Alert
          type="info"
          showIcon
          icon={<ReloadOutlined spin />}
          message="Validation in progress..."
          description="Checking your data against GrowthZone requirements. This may take a moment for large files."
          style={{ marginBottom: 24 }}
        />
      )}

      {/* Completed results */}
      {run?.status === 'COMPLETED' && (
        <>
          {/* KPI cards */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" style={{ borderTop: `3px solid ${grade.color}` }}>
                <Statistic
                  title="Data Quality"
                  value={qualityPct}
                  suffix="%"
                  valueStyle={{ color: grade.color, fontSize: 28 }}
                  prefix={qualityPct >= 95
                    ? <CheckCircleOutlined />
                    : qualityPct >= 60
                    ? <ExclamationCircleOutlined />
                    : <CloseCircleOutlined />}
                />
                <Tag color={grade.color === '#52c41a' ? 'success' : grade.color === '#ff4d4f' ? 'error' : 'warning'} style={{ marginTop: 4 }}>
                  {grade.label}
                </Tag>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" style={{ borderTop: '3px solid #2d1854' }}>
                <Statistic
                  title="Total Rows"
                  value={run.totalRows}
                  valueStyle={{ color: '#2d1854', fontSize: 28 }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" style={{ borderTop: '3px solid #ff4d4f' }}>
                <Statistic
                  title="Rows with Errors"
                  value={run.errorRows}
                  valueStyle={{ color: run.errorRows > 0 ? '#ff4d4f' : '#52c41a', fontSize: 28 }}
                  prefix={<CloseCircleOutlined />}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small" style={{ borderTop: '3px solid #fa8c16' }}>
                <Statistic
                  title="Rows with Warnings"
                  value={run.warningRows}
                  valueStyle={{ color: run.warningRows > 0 ? '#fa8c16' : '#52c41a', fontSize: 28 }}
                  prefix={<ExclamationCircleOutlined />}
                />
              </Card>
            </Col>
          </Row>

          {/* Tabs: Per-Entity / Issues / By Rule */}
          <Card style={{ borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}>
            <Tabs items={[
              {
                key: 'entities',
                label: <span><CheckCircleOutlined /> Per Entity</span>,
                children: (
                  <Row gutter={[16, 16]}>
                    {entitySummary.map(item => (
                      <Col xs={24} sm={12} md={8} lg={6} key={item.entity}>
                        <EntityHealthCard item={item} totalRows={run.totalRows} />
                      </Col>
                    ))}
                    {entitySummary.length === 0 && (
                      <Col span={24}>
                        <div style={{ textAlign: 'center', padding: 32 }}>
                          <CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a', marginBottom: 8 }} />
                          <div><Text type="secondary">No issues found — all data looks clean</Text></div>
                        </div>
                      </Col>
                    )}
                  </Row>
                ),
              },
              {
                key: 'issues',
                label: (
                  <span>
                    <WarningOutlined /> All Issues
                    {(run.errorRows + run.warningRows) > 0 && (
                      <Tag color="red" style={{ marginLeft: 6 }}>
                        {(run.errorRows + run.warningRows).toLocaleString()}
                      </Tag>
                    )}
                  </span>
                ),
                children: (
                  <div>
                    {/* Filters */}
                    <Space style={{ marginBottom: 16 }}>
                      <Select
                        placeholder="Severity"
                        allowClear
                        style={{ width: 140 }}
                        value={severityFilter}
                        onChange={v => { setSeverityFilter(v); setIssuePage(0); }}
                        options={[
                          { value: 'ERROR', label: 'Errors' },
                          { value: 'WARNING', label: 'Warnings' },
                          { value: 'INFO', label: 'Info' },
                        ]}
                      />
                      <Select
                        placeholder="Entity"
                        allowClear
                        style={{ width: 180 }}
                        value={entityFilter}
                        onChange={v => { setEntityFilter(v); setIssuePage(0); }}
                        options={entitySummary.map(e => ({ value: e.entity, label: e.entity }))}
                      />
                      <Select
                        placeholder="Status"
                        allowClear
                        style={{ width: 140 }}
                        value={resolvedFilter}
                        onChange={v => { setResolvedFilter(v); setIssuePage(0); }}
                        options={[
                          { value: false, label: 'Unresolved' },
                          { value: true, label: 'Resolved' },
                        ]}
                      />
                    </Space>

                    <Table<ValidationIssueDto>
                      columns={issueColumns}
                      dataSource={issues}
                      rowKey="id"
                      size="small"
                      pagination={{
                        current: issuePage + 1,
                        pageSize: 20,
                        total: issueTotal,
                        showSizeChanger: false,
                        showTotal: (t, range) => `${range[0]}-${range[1]} of ${t}`,
                        onChange: (p) => setIssuePage(p - 1),
                      }}
                      locale={{ emptyText: 'No issues match your filters.' }}
                    />
                  </div>
                ),
              },
              {
                key: 'rules',
                label: <span><InfoCircleOutlined /> By Rule</span>,
                children: (
                  <Table<RuleSummaryDto>
                    columns={ruleColumns}
                    dataSource={ruleSummary}
                    rowKey={(r) => `${r.rule}-${r.field}`}
                    size="small"
                    pagination={false}
                    locale={{ emptyText: 'No issues found.' }}
                  />
                ),
              },
            ]} />
          </Card>
        </>
      )}

      {/* Failed run */}
      {run?.status === 'FAILED' && (
        <Alert
          type="error"
          showIcon
          message="Validation failed"
          description="An error occurred during validation. Please try again."
          action={
            <Button size="small" onClick={handleValidate}>Retry</Button>
          }
          style={{ marginBottom: 24 }}
        />
      )}

      {/* Resolve modal */}
      <Modal
        title={resolveModal ? `Fix: ${resolveModal.targetField}` : 'Fix Issue'}
        open={!!resolveModal}
        onOk={handleResolve}
        onCancel={() => { setResolveModal(null); setResolveValue(''); }}
        confirmLoading={resolving}
        okText="Save Fix"
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854', color: '#fff' } }}
      >
        {resolveModal && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary">Row {resolveModal.rowNumber}</Text>
              <div><Text strong>{resolveModal.message}</Text></div>
            </div>
            {resolveModal.resolved && resolveModal.resolvedByName && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  <Text style={{ fontSize: 12 }}>
                    Previously corrected by <strong>{resolveModal.resolvedByName}</strong>
                    {resolveModal.resolvedAt && (
                      <> on {new Date(resolveModal.resolvedAt).toLocaleDateString()}</>
                    )}
                  </Text>
                }
              />
            )}
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Current value:</Text>
              <div>
                <Text delete style={{ color: '#ff4d4f' }}>
                  {resolveModal.currentValue || '(empty)'}
                </Text>
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Corrected value:</Text>
              <Input
                value={resolveValue}
                onChange={e => setResolveValue(e.target.value)}
                placeholder={`Enter ${resolveModal.targetField}`}
                style={{ marginTop: 4 }}
                autoFocus
              />
            </div>
          </div>
        )}
      </Modal>
      </div>
    </div>
  );
}
