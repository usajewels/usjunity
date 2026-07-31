import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, ConfigProvider, Descriptions, Tabs, Table, Tag, Button, Spin, Typography,
  Row, Col, Statistic, Space, Modal, Form, Input, Switch, Popconfirm,
  Tooltip, message, notification, Select, Badge, Upload,
} from 'antd';
import {
  ArrowLeftOutlined, TeamOutlined, FileTextOutlined,
  EditOutlined, CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined, DeleteOutlined,
  MailOutlined, UserAddOutlined, SaveOutlined, UploadOutlined,
  ImportOutlined, ControlOutlined, ApartmentOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  tenantApi, userApi, auditApi, invitationApi, assignmentApi,
  type Tenant, type UserResponse, type AuditEvent, type CoachDto,
} from '../services/api';
import OnboardingSchemaTab from '../components/OnboardingSchemaTab';
import OnboardingMetricsTab from '../components/OnboardingMetricsTab';
import FeatureConfigTab from '../components/FeatureConfigTab';
import AiConfigTab from '../components/AiConfigTab';
import CoachMappingsTab from '../components/CoachMappingsTab';
import PipelineTab from '../components/PipelineTab';
import { usePageTitle } from '@mxsuite/shared';

const { Title, Text } = Typography;

const ROLE_STYLES: Record<string, React.CSSProperties> = {
  PLATFORM_ADMIN: { backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' },
  COACH_ADMIN: { backgroundColor: '#44336b', color: '#ffffff', borderColor: '#44336b' },
  PLATFORM_SUPPORT: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' },
  TENANT_ADMIN: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' },
  TENANT_USER: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' },
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  COACH_ADMIN: 'Coach Admin',
  PLATFORM_SUPPORT: 'Onboarding Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

export default function TenantDetailPage() {
  usePageTitle('Organization Details');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  /* ---- data state ---- */
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [activity, setActivity] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  /* ---- edit tenant state ---- */
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);

  /* ---- invite user state ---- */
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteForm] = Form.useForm();
  const [inviting, setInviting] = useState(false);

  /* ---- toggle user active state ---- */
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  /* ---- coach state ---- */
  const [coaches, setCoaches] = useState<CoachDto[]>([]);
  const [availableCoaches, setAvailableCoaches] = useState<CoachDto[]>([]);
  const [loadingCoaches, setLoadingCoaches] = useState(false);
  const [addCoachOpen, setAddCoachOpen] = useState(false);
  const [selectedCoachId, setSelectedCoachId] = useState<string | undefined>();
  const [addingCoach, setAddingCoach] = useState(false);
  const [removingCoachId, setRemovingCoachId] = useState<string | null>(null);

  /* ---- fetch all data ---- */
  const fetchAll = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      tenantApi.get(id),
      userApi.list({ tenantId: id, page: 0, size: 50 }),
      auditApi.list({ tenantId: id, page: 0, size: 20 } as any),
    ])
      .then(([t, u, a]) => {
        setTenant(t.data);
        setUsers((u.data.content ?? []) as UserResponse[]);
        setActivity((a.data.content ?? []) as AuditEvent[]);
      })
      .catch(() => {
        message.error('Failed to load organization details');
      })
      .finally(() => setLoading(false));
  };

  const fetchCoaches = async () => {
    if (!id) return;
    setLoadingCoaches(true);
    try {
      const { data } = await assignmentApi.listCoaches(id);
      setCoaches(data);
    } catch {
      // non-critical
    } finally {
      setLoadingCoaches(false);
    }
  };

  useEffect(() => { fetchAll(); fetchCoaches(); }, [id]);

  /* ---- edit tenant ---- */
  const openEdit = () => {
    if (!tenant) return;
    editForm.setFieldsValue({ name: tenant.name, slug: tenant.slug, brandName: tenant.brandName || 'GrowthZone' });
    setEditModalOpen(true);
  };

  const handleLogoUpload = async (file: File) => {
    if (!tenant) return false;
    try {
      const { data } = await tenantApi.uploadLogo(tenant.id, file);
      setTenant({ ...tenant, logoUrl: data.logoUrl });
      message.success('Logo uploaded');
    } catch {
      message.error('Failed to upload logo');
    }
    return false;
  };

  const handleEditSubmit = async (values: { name: string; slug: string; brandName?: string }) => {
    if (!tenant) return;
    setSaving(true);
    try {
      const { data } = await tenantApi.update(tenant.id, values);
      setTenant(data);
      message.success('Organization updated');
      setEditModalOpen(false);
    } catch {
      message.error('Failed to update organization');
    } finally {
      setSaving(false);
    }
  };

  /* ---- toggle tenant active ---- */
  const handleToggleTenantActive = async () => {
    if (!tenant) return;
    try {
      const { data } = await tenantApi.update(tenant.id, { active: !tenant.active });
      setTenant(data);
      message.success(`Organization ${data.active ? 'activated' : 'deactivated'}`);
    } catch {
      message.error('Failed to update organization status');
    }
  };

  /* ---- invite user ---- */
  const isDevLogin = localStorage.getItem('mxsuite_dev_login') === 'true';
  const handleInvite = async (values: { email: string; role: string }) => {
    setInviting(true);
    try {
      await invitationApi.create(values, tenant?.id);
      notification.success({
        message: isDevLogin ? 'User Created' : 'Invitation Sent',
        description: isDevLogin
          ? `${values.email} created with password Admin123! — ready to use.`
          : `An invitation has been sent to ${values.email}.`,
      });
      setInviteModalOpen(false);
      inviteForm.resetFields();
      fetchAll(); // refresh user list
    } catch {
      message.error('Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  /* ---- open-to-all-coaches toggle ---- */
  const handleToggleOpenToAll = async (checked: boolean) => {
    if (!tenant) return;
    try {
      const { data } = await tenantApi.update(tenant.id, { openToAllCoaches: checked });
      setTenant(data);
      message.success(checked ? 'All coaches now have access' : 'Reverted to assigned coaches only');
    } catch {
      message.error('Failed to update coach access setting');
    }
  };

  /* ---- coaches ---- */
  const loadAvailableCoaches = async () => {
    try {
      const { data } = await assignmentApi.listAvailableCoaches();
      setAvailableCoaches(data);
    } catch {
      // ignore
    }
  };

  const handleAddCoach = async () => {
    if (!selectedCoachId || !id) return;
    setAddingCoach(true);
    try {
      await assignmentApi.assignCoach(id, selectedCoachId);
      message.success('Coach assigned');
      setAddCoachOpen(false);
      setSelectedCoachId(undefined);
      fetchCoaches();
    } catch {
      message.error('Failed to assign coach');
    } finally {
      setAddingCoach(false);
    }
  };

  const handleRemoveCoach = async (userId: string) => {
    if (!id) return;
    setRemovingCoachId(userId);
    try {
      await assignmentApi.unassignCoach(id, userId);
      message.success('Coach removed');
      setCoaches((prev) => prev.filter((c) => c.id !== userId));
    } catch {
      message.error('Failed to remove coach');
    } finally {
      setRemovingCoachId(null);
    }
  };

  /* ---- toggle user active ---- */
  const handleToggleUserActive = async (user: UserResponse) => {
    setTogglingUserId(user.id);
    try {
      await userApi.update(user.id, { active: !user.active });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, active: !u.active } : u)),
      );
      message.success(`${user.firstName} ${user.lastName} ${user.active ? 'deactivated' : 'activated'}`);
    } catch {
      message.error('Failed to update user status');
    } finally {
      setTogglingUserId(null);
    }
  };

  /* ---- delete user (dev mode only) ---- */
  const handleDeleteUser = async (user: UserResponse) => {
    try {
      await userApi.delete(user.id);
      message.success(`Deleted user ${user.email}`);
      fetchAll();
    } catch {
      message.error('Failed to delete user');
    }
  };

  /* ---- delete organization (dev mode only) ---- */
  const handleDeleteTenant = async () => {
    if (!tenant) return;
    try {
      await tenantApi.delete(tenant.id);
      message.success(`Deleted organization ${tenant.name}`);
      navigate('/admin/tenants');
    } catch {
      message.error('Failed to delete organization');
    }
  };

  /* ---- loading / not found states ---- */
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" tip="Loading organization details..." />
      </div>
    );
  }

  if (!tenant) {
    return (
      <Card style={{ textAlign: 'center', padding: 48 }}>
        <Title level={4} type="secondary">Organization not found</Title>
        <Button type="primary" onClick={() => navigate('/admin/tenants')}>
          Back to Organizations
        </Button>
      </Card>
    );
  }

  /* ---- user table columns ---- */
  const userColumns: ColumnsType<UserResponse> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, r) => (
        <Space>
          <Text strong>{r.firstName} {r.lastName}</Text>
          {!r.active && <Badge status="error" />}
        </Space>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (email: string) => <Text copyable={{ tooltips: ['Copy email', 'Copied'] }}>{email}</Text>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role: string) => (
        <Tag style={ROLE_STYLES[role] || {}}>
          {ROLE_LABELS[role] || role}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      width: 110,
      render: (active: boolean) => (
        <Tag
          icon={active ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          color={active ? 'success' : 'default'}
        >
          {active ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: 'Active',
      key: 'toggle',
      width: 80,
      align: 'center',
      render: (_, record) => (
        <Popconfirm
          title={`${record.active ? 'Deactivate' : 'Activate'} this user?`}
          description={record.active
            ? `${record.firstName} will lose access.`
            : `${record.firstName} will regain access.`}
          onConfirm={() => handleToggleUserActive(record)}
          okText="Yes"
          cancelText="No"
          okButtonProps={{ danger: record.active }}
        >
          <Switch
            checked={record.active}
            size="small"
            loading={togglingUserId === record.id}
            style={record.active ? { backgroundColor: '#2d1854' } : {}}
          />
        </Popconfirm>
      ),
    },
    ...(isDevLogin ? [{
      title: '',
      key: 'delete',
      width: 50,
      align: 'center' as const,
      render: (_: unknown, record: UserResponse) => (
        <Popconfirm
          title="Delete this user permanently?"
          description="This cannot be undone."
          onConfirm={() => handleDeleteUser(record)}
          okText="Delete"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    }] : []),
  ];

  /* ---- activity table columns ---- */
  const activityColumns: ColumnsType<AuditEvent> = [
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (t: string) => (
        <Tooltip title={dayjs(t).format('YYYY-MM-DD HH:mm:ss')}>
          <Text type="secondary">{dayjs(t).format('MMM D, YYYY h:mm A')}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Actor',
      dataIndex: 'actorName',
      key: 'actorName',
      width: 150,
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 160,
      render: (a: string) => <Tag style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>{a}</Tag>,
    },
    {
      title: 'Entity',
      key: 'entity',
      render: (_, r) => (
        <Text>{r.entityType}: {r.entityName || r.entityId?.substring(0, 8)}</Text>
      ),
    },
    {
      title: 'Platform',
      dataIndex: 'platformAction',
      key: 'platformAction',
      width: 100,
      render: (p: boolean) =>
        p ? <Tag style={{ backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' }}>Platform</Tag>
          : <Tag style={{ backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' }}>Member</Tag>,
    },
  ];

  /* ---- coach table columns ---- */
  const coachColumns: ColumnsType<CoachDto> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, r) => <Text strong>{r.firstName} {r.lastName}</Text>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (email: string) => <Text copyable={{ tooltips: ['Copy email', 'Copied'] }}>{email}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, record: CoachDto) => (
        <Popconfirm
          title="Remove this coach?"
          description="They will no longer have access to this organization's onboarding project."
          onConfirm={() => handleRemoveCoach(record.id)}
          okText="Remove"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
        >
          <Button
            type="text"
            danger
            size="small"
            loading={removingCoachId === record.id}
          >
            Remove
          </Button>
        </Popconfirm>
      ),
    },
  ];

  /* ---- active user count ---- */
  const activeUserCount = users.filter((u) => u.active).length;

  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/admin/tenants')}
          type="text"
          style={{ padding: 0, color: '#1a0e3a', marginBottom: 8 }}
        >
          Back to Organizations
        </Button>
        <Title level={4} style={{ margin: 0, color: '#2d1854' }}>{tenant.name}</Title>
      </div>
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Tenant info card */}
      <Card
        style={{ marginBottom: 24, borderRadius: 12, borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}
        extra={
          <Space>
            <Button icon={<EditOutlined />} onClick={openEdit}>
              Edit
            </Button>
            {tenant.tenantType !== 'PLATFORM' && (
              <Popconfirm
                title={`${tenant.active ? 'Deactivate' : 'Activate'} this organization?`}
                description={tenant.active
                  ? 'All users under this organization will lose access.'
                  : 'Users will regain access to this organization.'}
                onConfirm={handleToggleTenantActive}
                okText="Yes"
                cancelText="No"
                okButtonProps={{ danger: tenant.active }}
              >
                <Button danger={tenant.active} type={tenant.active ? 'default' : 'primary'}>
                  {tenant.active ? 'Deactivate' : 'Activate'}
                </Button>
              </Popconfirm>
            )}
            {isDevLogin && tenant.tenantType !== 'PLATFORM' && (
              <Popconfirm
                title="Delete this organization permanently?"
                description="All users, projects, mappings, and related data will be permanently deleted."
                onConfirm={handleDeleteTenant}
                okText="Delete"
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
              >
                <Button danger icon={<DeleteOutlined />}>Delete</Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Descriptions
          title={
            <Space size="middle">
              <Title level={4} style={{ margin: 0, color: '#2d1854' }}>{tenant.name}</Title>
              <Tag
                icon={tenant.active ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                color={tenant.active ? 'success' : 'error'}
              >
                {tenant.active ? 'Active' : 'Inactive'}
              </Tag>
            </Space>
          }
          column={{ xs: 1, sm: 2, md: 2 }}
        >
          <Descriptions.Item label="Slug">
            <Text code>{tenant.slug}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Type">
            <Tag style={tenant.tenantType === 'PLATFORM'
              ? { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' }
              : { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>
              {tenant.tenantType === 'PLATFORM' ? 'Platform' : 'Member'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {dayjs(tenant.createdAt).format('MMMM D, YYYY')}
          </Descriptions.Item>
          <Descriptions.Item label="Last Updated">
            {dayjs(tenant.lastModifiedAt).format('MMMM D, YYYY')}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Stats row */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 12, borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}>
            <Statistic
              title={<span style={{ color: 'rgba(0,0,0,0.65)' }}>Total Users</span>}
              value={users.length}
              prefix={<TeamOutlined style={{ color: '#2d1854' }} />}
              suffix={
                <Text style={{ fontSize: 14, color: 'rgba(0,0,0,0.65)' }}>
                  ({activeUserCount} active)
                </Text>
              }
            />
          </Card>
        </Col>
      </Row>

      {/* Tabs: Users / Activity */}
      <Card style={{ borderRadius: 12, borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}>
        <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        <Tabs
          items={[
            {
              key: 'users',
              label: (
                <span>
                  <TeamOutlined /> Users ({users.length})
                </span>
              ),
              children: (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                    <Button
                      type="primary"
                      icon={<UserAddOutlined />}
                      onClick={() => setInviteModalOpen(true)}
                      style={{ background: '#2d1854', borderColor: '#2d1854' }}
                    >
                      Invite User
                    </Button>
                  </div>
                  <Table<UserResponse>
                    dataSource={users}
                    rowKey="id"
                    columns={userColumns}
                    pagination={{
                      pageSize: 10,
                      showSizeChanger: false,
                      showTotal: (t) => `${t} users`,
                    }}
                    locale={{ emptyText: 'No users in this organization yet.' }}
                  />
                </>
              ),
            },
            ...(tenant.tenantType !== 'PLATFORM' ? [{
              key: 'coaches',
              label: (
                <span>
                  <TeamOutlined /> Coaches ({coaches.length})
                </span>
              ),
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '12px 16px', background: '#f3eeff', borderRadius: 8, border: '1px solid #e0d4f5' }}>
                    <div>
                      <Text strong>Open to all coaches</Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 13 }}>
                          When enabled, every current and future onboarding coach can view this organization's project — no explicit assignment needed.
                        </Text>
                      </div>
                    </div>
                    <Switch
                      checked={!!tenant.openToAllCoaches}
                      onChange={handleToggleOpenToAll}
                      checkedChildren="On"
                      unCheckedChildren="Off"
                      style={tenant.openToAllCoaches ? { backgroundColor: '#2d1854' } : {}}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16, gap: 8 }}>
                    {addCoachOpen ? (
                      <>
                        <Select
                          style={{ width: 320 }}
                          placeholder="Select a coach..."
                          value={selectedCoachId}
                          onChange={setSelectedCoachId}
                          showSearch
                          optionFilterProp="label"
                          options={availableCoaches
                            .filter((ac) => !coaches.some((c) => c.id === ac.id))
                            .map((c) => ({
                              value: c.id,
                              label: `${c.firstName} ${c.lastName} (${c.email})`,
                            }))}
                        />
                        <Button
                          type="primary"
                          onClick={handleAddCoach}
                          loading={addingCoach}
                          disabled={!selectedCoachId}
                          style={{ background: '#2d1854', borderColor: '#2d1854' }}
                        >
                          Add
                        </Button>
                        <Button onClick={() => { setAddCoachOpen(false); setSelectedCoachId(undefined); }}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="primary"
                        icon={<UserAddOutlined />}
                        onClick={() => { setAddCoachOpen(true); loadAvailableCoaches(); }}
                        style={{ background: '#2d1854', borderColor: '#2d1854' }}
                      >
                        Add Coach
                      </Button>
                    )}
                  </div>
                  <Table<CoachDto>
                    dataSource={coaches}
                    rowKey="id"
                    loading={loadingCoaches}
                    columns={coachColumns}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    locale={{ emptyText: 'No coaches assigned to this organization.' }}
                  />
                </div>
              ),
            }] : []),
            {
              key: 'activity',
              label: (
                <span>
                  <FileTextOutlined /> Activity
                </span>
              ),
              children: (
                <Table<AuditEvent>
                  dataSource={activity}
                  rowKey="id"
                  columns={activityColumns}
                  pagination={{
                    pageSize: 10,
                    showSizeChanger: false,
                    showTotal: (t) => `${t} events`,
                  }}
                  locale={{ emptyText: 'No activity recorded yet.' }}
                />
              ),
            },
            {
              key: 'schema',
              label: (
                <span>
                  <ImportOutlined /> Onboarding Schema
                </span>
              ),
              children: id ? <OnboardingSchemaTab tenantId={id} /> : null,
            },
            ...(tenant.tenantType !== 'PLATFORM' ? [{
              key: 'mappings',
              label: (
                <span>
                  <ApartmentOutlined /> Onboarding Mappings
                </span>
              ),
              children: id ? <CoachMappingsTab tenantId={id} /> : null,
            }, {
              key: 'pipeline',
              label: (
                <span>
                  <ThunderboltOutlined /> Data Pipeline
                </span>
              ),
              children: id ? <PipelineTab tenantId={id} /> : null,
            }, {
              key: 'metrics',
              label: (
                <span>
                  <ClockCircleOutlined /> Onboarding Metrics
                </span>
              ),
              children: id ? <OnboardingMetricsTab tenantId={id} /> : null,
            }] : []),
            ...(tenant.tenantType === 'PLATFORM' ? [{
              key: 'features',
              label: (
                <span>
                  <ControlOutlined /> Features
                </span>
              ),
              children: id ? <FeatureConfigTab tenantId={id} /> : null,
            }, {
              key: 'ai-providers',
              label: (
                <span>
                  <ThunderboltOutlined /> AI Providers
                </span>
              ),
              children: id ? <AiConfigTab tenantId={id} /> : null,
            }] : []),
          ]}
        />
        </ConfigProvider>
      </Card>

      {/* Edit Tenant Modal */}
      <Modal
        title="Edit Organization"
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        onOk={() => editForm.submit()}
        okText="Save Changes"
        confirmLoading={saving}
        okButtonProps={{ icon: <SaveOutlined />, style: { background: '#2d1854', borderColor: '#2d1854' } }}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit} style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Organization Name"
            rules={[{ required: true, message: 'Please enter an organization name' }]}
          >
            <Input size="large" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="Slug"
            extra="Lowercase letters, numbers, and hyphens only."
            rules={[
              { required: true, message: 'Please enter a slug' },
              { pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters, numbers, and hyphens only' },
            ]}
          >
            <Input size="large" />
          </Form.Item>
          <Form.Item
            name="brandName"
            label="Brand Name"
            extra="Displayed in the sidebar. Defaults to GrowthZone."
          >
            <Input size="large" placeholder="GrowthZone" />
          </Form.Item>
          <Form.Item label="Logo">
            <Space direction="vertical" style={{ width: '100%' }}>
              {tenant?.logoUrl && (
                <img src={tenant.logoUrl} alt="Current logo" style={{ maxHeight: 48, maxWidth: 200, objectFit: 'contain', marginBottom: 8 }} />
              )}
              <Upload
                beforeUpload={(file) => { handleLogoUpload(file as unknown as File); return false; }}
                showUploadList={false}
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
              >
                <Button icon={<UploadOutlined />}>Upload Logo</Button>
              </Upload>
              <Text type="secondary" style={{ fontSize: 12 }}>PNG, JPG, SVG, or WEBP. Max 2MB.</Text>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Invite User Modal */}
      <Modal
        title="Invite User"
        open={inviteModalOpen}
        onCancel={() => { setInviteModalOpen(false); inviteForm.resetFields(); }}
        onOk={() => inviteForm.submit()}
        okText="Send Invitation"
        confirmLoading={inviting}
        okButtonProps={{ icon: <MailOutlined />, style: { background: '#2d1854', borderColor: '#2d1854' } }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          The user will receive an email invitation to join <Text strong>{tenant.name}</Text>.
        </Text>
        <Form form={inviteForm} layout="vertical" onFinish={handleInvite}>
          <Form.Item
            name="email"
            label="Email Address"
            rules={[
              { required: true, message: 'Please enter an email address' },
              { type: 'email', message: 'Please enter a valid email address' },
            ]}
          >
            <Input placeholder="user@example.com" size="large" prefix={<MailOutlined />} />
          </Form.Item>
          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Please select a role' }]}
          >
            <Select
              size="large"
              placeholder="Select a role"
              options={[
                { value: 'TENANT_ADMIN', label: 'Member Admin' },
                { value: 'TENANT_USER', label: 'Member' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
    </div>
  );
}
