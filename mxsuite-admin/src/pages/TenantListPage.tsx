import { useCallback, useEffect, useState } from 'react';
import {
  Table, Button, Tag, Typography, Modal, Form, Input, ConfigProvider,
  Card, Switch, Tooltip, Popconfirm, message, Badge, Space, Divider, Select, Alert,
} from 'antd';
import {
  PlusOutlined, EyeOutlined, SearchOutlined,
  CheckCircleOutlined, CloseCircleOutlined, EditOutlined,
  UserOutlined, TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@mxsuite/shared';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { tenantApi, assignmentApi, type Tenant, type CoachDto } from '../services/api';

const { Title, Text } = Typography;

export default function TenantListPage() {
  usePageTitle('Organizations');
  /* ---- state ---- */
  const [tenants, setTenants] = useState<Tenant[]>([] as Tenant[]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const [availableCoaches, setAvailableCoaches] = useState<CoachDto[]>([]);
  const [loadingCoaches, setLoadingCoaches] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editing, setEditing] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const navigate = useNavigate();
  const isDevLogin = localStorage.getItem('mxsuite_dev_login') === 'true';

  /* ---- fetch ---- */
  const fetchTenants = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, size: pageSize };
      if (search.trim()) params.search = search.trim();
      const { data } = await tenantApi.list(params as any);
      if (!signal?.aborted) {
        setTenants(data.content || []);
        setTotal(data.totalElements ?? 0);
      }
    } catch {
      if (!signal?.aborted) message.error('Failed to load organizations');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    const ac = new AbortController();
    fetchTenants(ac.signal);
    return () => ac.abort();
  }, [fetchTenants]);

  /* ---- load coaches for dropdown ---- */
  const loadCoaches = async () => {
    setLoadingCoaches(true);
    try {
      const { data } = await assignmentApi.listAvailableCoaches();
      setAvailableCoaches(data);
    } catch {
      // non-critical — coaches field just stays empty
    } finally {
      setLoadingCoaches(false);
    }
  };

  /* ---- create ---- */
  const handleCreate = async (values: any) => {
    setCreating(true);
    try {
      const coachIds = values.coachIds ?? [];
      if (values.ownerEmail) {
        await tenantApi.createWithOwner({
          name: values.name,
          slug: values.slug,
          ownerEmail: values.ownerEmail,
          ownerFirstName: values.ownerFirstName,
          ownerLastName: values.ownerLastName,
          coachIds,
        });
        message.success(isDevLogin
          ? `Organization created — owner ${values.ownerEmail} ready (password: Admin123!)`
          : 'Organization created — invitation sent to ' + values.ownerEmail);
      } else {
        await tenantApi.create({ name: values.name, slug: values.slug, coachIds });
        message.success('Organization created');
      }
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchTenants();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to create organization';
      message.error(msg);
    } finally {
      setCreating(false);
    }
  };

  /* ---- auto-generate slug ---- */
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    createForm.setFieldsValue({ slug });
  };

  /* ---- edit ---- */
  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    editForm.setFieldsValue({ name: tenant.name, slug: tenant.slug, brandName: (tenant as any).brandName || '' });
    setEditModalOpen(true);
  };

  const handleEdit = async (values: { name: string; slug: string; brandName?: string }) => {
    if (!editingTenant) return;
    setEditing(true);
    try {
      await tenantApi.update(editingTenant.id, values);
      message.success('Organization updated');
      setEditModalOpen(false);
      editForm.resetFields();

      // If platform tenant was edited, push branding update to shell sidebar
      if (editingTenant.tenantType === 'PLATFORM') {
        localStorage.setItem('mxsuite_platform_branding',
          JSON.stringify({ brandName: values.brandName || '' }));
        window.dispatchEvent(new CustomEvent('platform-branding-updated'));
      }

      setEditingTenant(null);
      fetchTenants();
    } catch {
      message.error('Failed to update organization');
    } finally {
      setEditing(false);
    }
  };

  /* ---- toggle active ---- */
  const handleToggleActive = async (tenant: Tenant) => {
    try {
      await tenantApi.update(tenant.id, { active: !tenant.active });
      message.success(`${tenant.name} ${tenant.active ? 'deactivated' : 'activated'}`);
      fetchTenants();
    } catch {
      message.error('Failed to update status');
    }
  };

  /* ---- pagination ---- */
  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage((pagination.current ?? 1) - 1);
    setPageSize(pagination.pageSize ?? 20);
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  /* ---- columns ---- */
  const columns: ColumnsType<Tenant> = [
    {
      title: 'Organization',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record) => (
        <Space>
          <Text strong style={{ color: '#2d1854' }}>{name}</Text>
          {!record.active && <Badge status="error" />}
        </Space>
      ),
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
      render: (slug: string) => (
        <Text code style={{ fontSize: 13 }}>{slug}</Text>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'tenantType',
      key: 'tenantType',
      width: 120,
      render: (type: string) => (
        <Tag style={type === 'PLATFORM'
          ? { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' }
          : { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>
          {type === 'PLATFORM' ? 'Platform' : 'Member'}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      width: 130,
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
      width: 90,
      align: 'center',
      render: (_: unknown, record) => (
        record.tenantType === 'PLATFORM' ? (
          <Tooltip title="The platform organization cannot be deactivated">
            <Switch checked={record.active} disabled size="small" style={record.active ? { backgroundColor: '#2d1854' } : {}} />
          </Tooltip>
        ) : (
          <Popconfirm
            title={`${record.active ? 'Deactivate' : 'Activate'} ${record.name}?`}
            description={record.active
              ? 'All users under this organization will lose access.'
              : 'Users will regain access.'}
            onConfirm={() => handleToggleActive(record)}
            okText="Yes"
            cancelText="No"
            okButtonProps={{ danger: record.active }}
          >
            <Switch
              checked={record.active}
              size="small"
              style={record.active ? { backgroundColor: '#2d1854' } : { background: '#d9d9d9' }}
            />
          </Popconfirm>
        )
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_: unknown, record) => (
        <Space size="small">
          <Tooltip title="View details">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/admin/tenants/${record.id}`)}
            />
          </Tooltip>
          <Tooltip title="Edit organization">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  /* ---- render ---- */
  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <Title level={3} style={{ margin: 0, color: '#2d1854' }}>Organizations</Title>
          <Text style={{ color: '#6b4fa0' }}>Manage customer organizations on the platform</Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="large"
          onClick={() => { setCreateModalOpen(true); loadCoaches(); }}
          style={{ background: '#2d1854', borderColor: '#2d1854' }}
        >
          New Organization
        </Button>
      </div>
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Search + Table card */}
      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5', borderTopWidth: 3, borderTopColor: '#2d1854' }}
      >
        <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        <div style={{ marginBottom: 20 }}>
            <Input.Search
              placeholder="Search organizations by name or slug..."
              allowClear
              enterButton={<><SearchOutlined style={{ color: '#fff' }} /> Search</>}
              size="large"
              onSearch={handleSearch}
              style={{ maxWidth: 480 }}
            />
        </div>

        <Table<Tenant>
          columns={columns}
          dataSource={tenants}
          loading={loading}
          rowKey="id"
          onChange={handleTableChange}
          pagination={{
            current: page + 1,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} organizations`,
          }}
          locale={{
            emptyText: search
              ? 'No organizations match your search'
              : 'No organizations yet. Create your first one to get started.',
          }}
        />
        </ConfigProvider>
      </Card>

      {/* Create Organization Modal */}
      <Modal
        title="Create New Organization"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        okText="Create Organization"
        confirmLoading={creating}
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
        destroyOnClose
        width={560}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Organization Name"
            rules={[{ required: true, message: 'Please enter an organization name' }]}
          >
            <Input placeholder="e.g. Denver Chamber of Commerce" size="large" onChange={handleNameChange} />
          </Form.Item>
          <Form.Item
            name="slug"
            label="Slug"
            extra="Used in URLs. Lowercase letters, numbers, and hyphens only."
            rules={[
              { required: true, message: 'Please enter a slug' },
              { pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters, numbers, and hyphens only' },
            ]}
          >
            <Input placeholder="e.g. denver-chamber" size="large" />
          </Form.Item>

          <Form.Item
            name="coachIds"
            label={<Space><TeamOutlined /> Assign Coaches</Space>}
            extra="Coaches can view and edit this org's onboarding project. You can also manage this later."
          >
            <Select
              mode="multiple"
              placeholder="Select coaches..."
              loading={loadingCoaches}
              optionFilterProp="label"
              options={availableCoaches.map((c) => ({
                value: c.id,
                label: `${c.firstName} ${c.lastName} (${c.email})`,
              }))}
            />
          </Form.Item>

          <Divider style={{ borderColor: '#e0d4f5' }}><Space><UserOutlined /> Admin User (Owner)</Space></Divider>
          {isDevLogin ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16, background: '#f3eeff', borderColor: '#e0d4f5' }}
              message="Dev mode: Owner will be created directly with password Admin123! — no email sent."
            />
          ) : (
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              Invite an admin user to manage this organization. They will receive an email to set up their account. Leave blank to add users later.
            </Text>
          )}

          <Form.Item
            name="ownerEmail"
            label="Email"
            rules={[{ type: 'email', message: 'Please enter a valid email' }]}
          >
            <Input placeholder="admin@denverchamber.org" />
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="ownerFirstName" label="First Name" style={{ flex: 1 }}>
              <Input placeholder="John" />
            </Form.Item>
            <Form.Item name="ownerLastName" label="Last Name" style={{ flex: 1 }}>
              <Input placeholder="Smith" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Edit Organization Modal */}
      <Modal
        title={`Edit Organization: ${editingTenant?.name ?? ''}`}
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); setEditingTenant(null); }}
        onOk={() => editForm.submit()}
        okText="Save Changes"
        confirmLoading={editing}
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit} style={{ marginTop: 16 }}>
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
            extra="Used in URLs. Lowercase letters, numbers, and hyphens only."
            rules={[
              { required: true, message: 'Please enter a slug' },
              { pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters, numbers, and hyphens only' },
            ]}
          >
            <Input size="large" />
          </Form.Item>
          {editingTenant?.tenantType === 'PLATFORM' && (
            <Form.Item
              name="brandName"
              label="Brand Name"
              extra="Displayed in the sidebar for all users. This is the platform-wide product name."
            >
              <Input size="large" placeholder="GrowthZone MemberSuite" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
    </div>
  );
}
