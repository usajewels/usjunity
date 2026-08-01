import { useEffect, useState } from 'react';
import { Table, Tag, Tabs, Typography, Spin, Button, Divider, List, Modal, Input, Select, Checkbox, Space, message } from 'antd';
import { BulbOutlined, CheckCircleOutlined, CloseCircleOutlined, RobotOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { SemanticDecisionDto, DecisionStatsDto, DecisionStatus } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { migrationApi } from '../../services/migrationApi';

const { Title, Text, Paragraph } = Typography;

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

const LAST_VISIT_KEY = 'mxsuite:coach-decisions:lastVisit';

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export default function DecisionsPage() {
  usePageTitle('Decisions');
  const [decisions, setDecisions] = useState<SemanticDecisionDto[]>([]);
  const [stats, setStats] = useState<DecisionStatsDto>({ all: 0, open: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SemanticDecisionDto | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [actionLoading, setActionLoading] = useState(false);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; tenantId?: string; tenantName?: string }>>([]);
  const [form, setForm] = useState({
    title: '',
    summary: '',
    tenantId: undefined as string | undefined,
    projectId: undefined as string | undefined,
    fieldContext: '',
    options: [{ label: '', description: '', isRecommended: false }, { label: '', description: '', isRecommended: false }] as Array<{ label: string; description: string; isRecommended: boolean }>,
    requirements: [] as Array<{ description: string }>,
  });

  // Track "New" decisions since last visit
  const [lastVisit] = useState(() => {
    const stored = localStorage.getItem(LAST_VISIT_KEY);
    return stored ? parseInt(stored, 10) : 0;
  });
  const isNew = (d: SemanticDecisionDto) =>
    d.decisionStatus === 'OPEN' && new Date(d.createdAt).getTime() > lastVisit;

  const load = async (status?: DecisionStatus) => {
    try {
      const [listRes, statsRes] = await Promise.all([
        migrationApi.listDecisions({ status, page: 0, size: 50 }),
        migrationApi.getDecisionStats(),
      ]);
      setDecisions(listRes.data.content);
      setStats(statsRes.data);
    } catch {
      message.error('Failed to load decisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setTimeout(() => localStorage.setItem(LAST_VISIT_KEY, String(Date.now())), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleTabChange = (key: string) => {
    setActiveTab(key);
    const statusMap: Record<string, DecisionStatus | undefined> = {
      all: undefined, open: 'OPEN', approved: 'APPROVED', rejected: 'REJECTED',
    };
    setLoading(true);
    load(statusMap[key]);
  };

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      const { data } = await migrationApi.approveDecision(id);
      setDecisions(prev => prev.map(d => d.id === id ? data : d));
      setSelected(data);
      message.success('Decision approved');
      migrationApi.getDecisionStats().then(r => setStats(r.data));
    } catch {
      message.error('Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(true);
    try {
      const { data } = await migrationApi.rejectDecision(id);
      setDecisions(prev => prev.map(d => d.id === id ? data : d));
      setSelected(data);
      message.success('Decision rejected');
      migrationApi.getDecisionStats().then(r => setStats(r.data));
    } catch {
      message.error('Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  // Derive unique organizations from the projects list (already coach-scoped, only orgs with data)
  const orgs = projects.reduce<Array<{ id: string; name: string }>>((acc, p) => {
    if (p.tenantId && p.tenantName && !acc.some(o => o.id === p.tenantId)) {
      acc.push({ id: p.tenantId, name: p.tenantName });
    }
    return acc;
  }, []);

  const openCreateModal = async () => {
    setCreateOpen(true);
    if (projects.length === 0) {
      try {
        const projectsRes = await migrationApi.listProjects({ page: 0, size: 50 });
        setProjects(projectsRes.data.content.map((p: any) => ({
          id: p.id, name: p.name, tenantId: p.tenantId, tenantName: p.tenantName,
        })));
      } catch { /* ignore */ }
    }
  };

  const resetForm = () => setForm({
    title: '', summary: '', tenantId: undefined, projectId: undefined, fieldContext: '',
    options: [{ label: '', description: '', isRecommended: false }, { label: '', description: '', isRecommended: false }],
    requirements: [],
  });

  const handleCreate = async () => {
    if (!form.tenantId) { message.warning('Organization is required'); return; }
    if (!form.title.trim()) { message.warning('Title is required'); return; }
    const validOptions = form.options.filter(o => o.label.trim());
    if (validOptions.length < 2) { message.warning('At least 2 options are required'); return; }

    setCreateLoading(true);
    try {
      await migrationApi.createDecision({
        title: form.title.trim(),
        summary: form.summary.trim() || undefined,
        tenantId: form.tenantId,
        projectId: form.projectId,
        fieldContext: form.fieldContext.trim() || undefined,
        options: validOptions,
        requirements: form.requirements.filter(r => r.description.trim()),
      });
      message.success('Decision created');
      setCreateOpen(false);
      resetForm();
      load(activeTab === 'all' ? undefined : activeTab.toUpperCase() as DecisionStatus);
    } catch {
      message.error('Failed to create decision');
    } finally {
      setCreateLoading(false);
    }
  };

  const updateOption = (idx: number, field: string, value: any) => {
    setForm(prev => {
      const options = [...prev.options];
      options[idx] = { ...options[idx], [field]: value };
      return { ...prev, options };
    });
  };

  const columns: ColumnsType<SemanticDecisionDto> = [
    {
      title: 'Decision',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: SemanticDecisionDto) => (
        <span>
          <Text strong style={{ fontSize: 13 }}>{title}</Text>
          {isNew(record) && (
            <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>New</Tag>
          )}
          {record.source === 'AI' && (
            <Tag icon={<RobotOutlined />} style={{ marginLeft: 6, fontSize: 10, backgroundColor: '#f3eeff', color: '#6b4fa0', borderColor: '#e0d4f5' }}>AI</Tag>
          )}
        </span>
      ),
    },
    {
      title: 'Project',
      dataIndex: 'projectName',
      key: 'project',
      render: (name: string) => <Text style={{ fontSize: 12 }}>{name || '—'}</Text>,
    },
    {
      title: 'Field / Context',
      dataIndex: 'fieldContext',
      key: 'fieldContext',
      render: (ctx: string) => <Text type="secondary" style={{ fontSize: 12 }}>{ctx || '—'}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'decisionStatus',
      key: 'status',
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status]}>{status}</Tag>
      ),
    },
    {
      title: 'Age',
      dataIndex: 'createdAt',
      key: 'age',
      width: 70,
      render: (date: string) => <Text type="secondary" style={{ fontSize: 12 }}>{daysAgo(date)}d</Text>,
    },
  ];

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
        margin: '-24px -24px 24px -24px',
        padding: '28px 32px 20px 32px',
        borderBottom: '3px solid #6b4fa0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BulbOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Semantic decisions</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>
              Every open semantic decision across all projects. Each item carries a description, its options, an owner and a status.
            </Text>
          </div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreateModal}
          style={{ borderColor: '#fff', color: '#fff', background: 'transparent' }}
        >
          New Decision
        </Button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin tip="Loading decisions..." />
        </div>
      ) : (
      <div style={{ display: 'flex', height: 'calc(100vh - 200px)' }}>
      {/* Main table */}
      <div style={{ flex: 1, overflow: 'auto' }}>

        <Tabs
          activeKey={activeTab}
          onChange={handleTabChange}
          size="small"
          items={[
            { key: 'all', label: `All ${stats.all}` },
            { key: 'open', label: `Open ${stats.open}` },
            { key: 'approved', label: `Approved ${stats.approved}` },
            { key: 'rejected', label: `Rejected ${stats.rejected}` },
          ]}
        />

        <Table
          columns={columns}
          dataSource={decisions}
          rowKey="id"
          size="small"
          pagination={false}
          onRow={(record) => ({
            onClick: () => setSelected(record),
            style: {
              cursor: 'pointer',
              background: selected?.id === record.id ? '#f0f5ff' : undefined,
            },
          })}
        />
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{
          width: 340,
          borderLeft: '1px solid #f0f0f0',
          overflow: 'auto',
          padding: 16,
          flexShrink: 0,
          marginLeft: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>DECISION DETAIL</Text>
            <a onClick={() => setSelected(null)} style={{ fontSize: 12 }}>Close</a>
          </div>

          <Title level={5} style={{ marginBottom: 8 }}>{selected.title}</Title>

          {selected.summary && (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>SUMMARY</Text>
              <Paragraph style={{ fontSize: 12, marginTop: 4 }}>{selected.summary}</Paragraph>
            </>
          )}

          {selected.fieldContext && (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>FIELD / CONTEXT</Text>
              <div style={{ marginTop: 4, marginBottom: 12 }}>
                <Text code style={{ fontSize: 12 }}>{selected.fieldContext}</Text>
              </div>
            </>
          )}

          {selected.options && selected.options.length > 0 && (
            <>
              <Text type="secondary" style={{ fontSize: 11 }}>OPTIONS</Text>
              <List
                size="small"
                dataSource={selected.options}
                renderItem={(opt, idx) => (
                  <List.Item style={{
                    padding: '6px 0',
                    background: selected.selectedOption === idx ? '#f6ffed' : undefined,
                  }}>
                    <div>
                      <Text strong={selected.selectedOption === idx} style={{ fontSize: 12 }}>
                        {opt.label}
                        {opt.isRecommended && <Tag color="blue" style={{ marginLeft: 4, fontSize: 10 }}>Recommended</Tag>}
                      </Text>
                      {opt.description && (
                        <div><Text type="secondary" style={{ fontSize: 11 }}>{opt.description}</Text></div>
                      )}
                    </div>
                  </List.Item>
                )}
              />
            </>
          )}

          {selected.requirements && selected.requirements.length > 0 && (
            <>
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>TRACKED REQUIREMENTS</Text>
              <List
                size="small"
                dataSource={selected.requirements}
                renderItem={(req) => (
                  <List.Item style={{ padding: '4px 0' }}>
                    <Text style={{ fontSize: 12 }}>{String(req.label || req.description || JSON.stringify(req))}</Text>
                  </List.Item>
                )}
              />
            </>
          )}

          <Divider style={{ margin: '12px 0' }} />

          {selected.decisionStatus === 'OPEN' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => handleApprove(selected.id)}
                loading={actionLoading}
                style={{ flex: 1, background: '#52c41a', borderColor: '#52c41a' }}
              >
                Approve
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => handleReject(selected.id)}
                loading={actionLoading}
                style={{ flex: 1 }}
              >
                Reject
              </Button>
            </div>
          )}

          {selected.decisionStatus !== 'OPEN' && (
            <Tag color={STATUS_COLORS[selected.decisionStatus]} style={{ fontSize: 13 }}>
              {selected.decisionStatus}
            </Tag>
          )}
        </div>
      )}

      </div>
      )}

      {/* Create Decision Modal */}
      <Modal
        title="New Decision"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); resetForm(); }}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="Create"
        width={560}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <div>
            <Text strong style={{ fontSize: 12 }}>Organization *</Text>
            <Select
              value={form.tenantId}
              onChange={v => setForm(prev => ({ ...prev, tenantId: v, projectId: undefined }))}
              placeholder="Select organization"
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
              options={orgs.map(t => ({ value: t.id, label: t.name }))}
            />
          </div>

          <div>
            <Text strong style={{ fontSize: 12 }}>Title *</Text>
            <Input
              value={form.title}
              onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
              placeholder="e.g. How should duplicate contacts be handled?"
              maxLength={100}
            />
          </div>

          <div>
            <Text strong style={{ fontSize: 12 }}>Summary</Text>
            <Input.TextArea
              value={form.summary}
              onChange={e => setForm(prev => ({ ...prev, summary: e.target.value }))}
              placeholder="Describe the issue and why a decision is needed"
              rows={3}
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Text strong style={{ fontSize: 12 }}>Project</Text>
              <Select
                value={form.projectId}
                onChange={v => setForm(prev => ({ ...prev, projectId: v }))}
                placeholder="Select project (optional)"
                allowClear
                style={{ width: '100%' }}
                options={projects
                  .filter(p => !form.tenantId || p.tenantId === form.tenantId)
                  .map(p => ({ value: p.id, label: p.name }))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text strong style={{ fontSize: 12 }}>Field / Context</Text>
              <Input
                value={form.fieldContext}
                onChange={e => setForm(prev => ({ ...prev, fieldContext: e.target.value }))}
                placeholder="e.g. Contact.email"
              />
            </div>
          </div>

          <Divider style={{ margin: '8px 0' }} />

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text strong style={{ fontSize: 12 }}>Options * (min 2)</Text>
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => setForm(prev => ({
                  ...prev,
                  options: [...prev.options, { label: '', description: '', isRecommended: false }],
                }))}
              >
                Add
              </Button>
            </div>
            {form.options.map((opt, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <Input
                    size="small"
                    value={opt.label}
                    onChange={e => updateOption(idx, 'label', e.target.value)}
                    placeholder={`Option ${idx + 1} label`}
                  />
                  <Input
                    size="small"
                    value={opt.description}
                    onChange={e => updateOption(idx, 'description', e.target.value)}
                    placeholder="Description (optional)"
                    style={{ marginTop: 2 }}
                  />
                </div>
                <Checkbox
                  checked={opt.isRecommended}
                  onChange={e => updateOption(idx, 'isRecommended', e.target.checked)}
                  style={{ marginTop: 4 }}
                >
                  <Text style={{ fontSize: 11 }}>Rec.</Text>
                </Checkbox>
                {form.options.length > 2 && (
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setForm(prev => ({
                      ...prev,
                      options: prev.options.filter((_, i) => i !== idx),
                    }))}
                  />
                )}
              </div>
            ))}
          </div>

          <Divider style={{ margin: '8px 0' }} />

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text strong style={{ fontSize: 12 }}>Requirements</Text>
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => setForm(prev => ({
                  ...prev,
                  requirements: [...prev.requirements, { description: '' }],
                }))}
              >
                Add
              </Button>
            </div>
            {form.requirements.map((req, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <Input
                  size="small"
                  value={req.description}
                  onChange={e => setForm(prev => {
                    const requirements = [...prev.requirements];
                    requirements[idx] = { description: e.target.value };
                    return { ...prev, requirements };
                  })}
                  placeholder="Requirement description"
                  style={{ flex: 1 }}
                />
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setForm(prev => ({
                    ...prev,
                    requirements: prev.requirements.filter((_, i) => i !== idx),
                  }))}
                />
              </div>
            ))}
          </div>
        </Space>
      </Modal>
    </div>
  );
}
