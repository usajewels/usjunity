import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Table, Button, Tag, Typography, Modal, Form, Input, Select, ConfigProvider,
  Card, Space, Switch, Tooltip, Popconfirm, message, Spin,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  CheckCircleOutlined, CloseCircleOutlined, UserOutlined,
  SafetyCertificateOutlined, TeamOutlined,
} from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { usePageTitle } from '@mxsuite/shared';
import { useSearchParams } from 'react-router-dom';
import { userApi, tenantApi, type UserResponse, type Tenant } from '../services/api';
import AlphaBar from '../components/AlphaBar';

const { Title, Text } = Typography;

const ROLE_STYLES: Record<string, React.CSSProperties> = {
  PLATFORM_ADMIN: { backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' },
  COACH_ADMIN: { backgroundColor: '#44336b', color: '#ffffff', borderColor: '#44336b' },
  PLATFORM_SUPPORT: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' },
  TENANT_ADMIN: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' },
  TENANT_USER: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' },
};

const ROLE_AVATAR_COLORS: Record<string, string> = {
  PLATFORM_ADMIN: '#2d1854',
  COACH_ADMIN: '#44336b',
  PLATFORM_SUPPORT: '#6b4fa0',
  TENANT_ADMIN: '#9b7fd4',
  TENANT_USER: '#a0a0a0',
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  COACH_ADMIN: 'Coach Admin',
  PLATFORM_SUPPORT: 'Onboarding Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

const ROLE_OPTIONS = [
  { value: 'PLATFORM_ADMIN', label: 'Platform Admin' },
  { value: 'COACH_ADMIN', label: 'Coach Admin' },
  { value: 'PLATFORM_SUPPORT', label: 'Onboarding Coach' },
  { value: 'TENANT_ADMIN', label: 'Member Admin' },
  { value: 'TENANT_USER', label: 'Member' },
];

export default function UserListPage() {
  usePageTitle('Users');
  const [searchParams, setSearchParams] = useSearchParams();
  /* ---- state ---- */
  const [users, setUsers] = useState<UserResponse[]>([] as UserResponse[]);
  const [tenants, setTenants] = useState<Tenant[]>([] as Tenant[]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [tenantFilter, setTenantFilter] = useState<string | undefined>(undefined);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(() => searchParams.get('role') || undefined);
  const [searchText, setSearchText] = useState('');
  const [letter, setLetter] = useState<string | null>(() => {
    return localStorage.getItem('mxsuite:users:letter') || null;
  });

  /* ---- create modal ---- */
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);
  const selectedRole: string | undefined = Form.useWatch('role', createForm);
  const isPlatformRole = ['PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT'].includes(selectedRole ?? '');

  /* ---- edit modal ---- */
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editing, setEditing] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);

  /* ---- toggle active ---- */
  const [togglingId, setTogglingId] = useState<string | null>(null);

  /* ---- fetch ---- */
  const fetchUsers = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, size: pageSize };
      if (tenantFilter) params.tenantId = tenantFilter;
      if (roleFilter) params.role = roleFilter;
      if (searchText.trim()) {
        params.search = searchText.trim();
      } else if (letter) {
        params.letter = letter;
      }
      const { data } = await userApi.list(params as any);
      if (!signal?.aborted) {
        setUsers((data.content ?? []) as UserResponse[]);
        setTotal(data.totalElements ?? 0);
      }
    } catch {
      if (!signal?.aborted) message.error('Failed to load users');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, pageSize, tenantFilter, roleFilter, searchText, letter]);

  const [tenantSearching, setTenantSearching] = useState(false);
  const tenantSearchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchTenants = useCallback(async (search?: string, signal?: AbortSignal) => {
    setTenantSearching(true);
    try {
      const params: Record<string, unknown> = { page: 0, size: 50 };
      if (search?.trim()) params.search = search.trim();
      const { data } = await tenantApi.list(params as any);
      if (!signal?.aborted) setTenants((data.content ?? []) as Tenant[]);
    } catch {
      /* silently fail */
    } finally {
      if (!signal?.aborted) setTenantSearching(false);
    }
  }, []);

  const handleTenantSearch = (value: string) => {
    clearTimeout(tenantSearchTimer.current);
    tenantSearchTimer.current = setTimeout(() => fetchTenants(value), 300);
  };

  useEffect(() => {
    const ac = new AbortController();
    fetchTenants(undefined, ac.signal);
    return () => ac.abort();
  }, [fetchTenants]);
  useEffect(() => {
    const ac = new AbortController();
    fetchUsers(ac.signal);
    return () => ac.abort();
  }, [fetchUsers]);

  /* ---- tenant lookup helper ---- */
  const tenantName = (tenantId: string) => {
    const t = tenants.find((tn) => tn.id === tenantId);
    return t ? t.name : tenantId.substring(0, 8);
  };

  /* ---- create user ---- */
  const handleCreate = async (values: any) => {
    setCreating(true);
    try {
      await userApi.create(values);
      message.success('User created successfully');
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchUsers();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to create user';
      message.error(msg);
    } finally {
      setCreating(false);
    }
  };

  /* ---- edit user ---- */
  const openEdit = (user: UserResponse) => {
    setEditingUser(user);
    editForm.setFieldsValue({
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    });
    setEditModalOpen(true);
  };

  const handleEdit = async (values: { firstName: string; lastName: string; role: string }) => {
    if (!editingUser) return;
    setEditing(true);
    try {
      await userApi.update(editingUser.id, values);
      message.success('User updated');
      setEditModalOpen(false);
      editForm.resetFields();
      setEditingUser(null);
      fetchUsers();
    } catch {
      message.error('Failed to update user');
    } finally {
      setEditing(false);
    }
  };

  /* ---- toggle active ---- */
  const handleToggleActive = async (user: UserResponse) => {
    setTogglingId(user.id);
    try {
      await userApi.update(user.id, { active: !user.active });
      message.success(`${user.firstName} ${user.lastName} ${user.active ? 'deactivated' : 'activated'}`);
      fetchUsers();
    } catch {
      message.error('Failed to update user status');
    } finally {
      setTogglingId(null);
    }
  };

  /* ---- delete ---- */
  const handleDelete = async (user: UserResponse) => {
    try {
      await userApi.delete(user.id);
      message.success(`${user.firstName} ${user.lastName} deleted`);
      fetchUsers();
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Failed to delete user');
    }
  };

  /* ---- pagination ---- */
  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage((pagination.current ?? 1) - 1);
    setPageSize(pagination.pageSize ?? 20);
  };

  const handleLetterChange = (l: string | null) => {
    setLetter(l);
    setPage(0);
    if (l) {
      localStorage.setItem('mxsuite:users:letter', l);
    } else {
      localStorage.removeItem('mxsuite:users:letter');
    }
  };

  /* ---- filter by tenant ---- */
  const handleTenantFilterChange = (value: string | undefined) => {
    setTenantFilter(value || undefined);
    setPage(0);
  };

  /* ---- filter by role ---- */
  const handleRoleFilterChange = (value: string | undefined) => {
    setRoleFilter(value || undefined);
    setPage(0);
    if (value) {
      searchParams.set('role', value);
    } else {
      searchParams.delete('role');
    }
    setSearchParams(searchParams, { replace: true });
  };

  const filteredUsers = users;

  /* ---- columns ---- */
  const columns: ColumnsType<UserResponse> = [
    {
      title: 'User',
      key: 'name',
      sorter: (a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      render: (_, r) => (
        <Space>
          <div
            style={{
              width: 36, height: 36, borderRadius: '50%', background: ROLE_AVATAR_COLORS[r.role] || '#2d1854',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 600, fontSize: 14, flexShrink: 0,
            }}
          >
            {r.avatarUrl && (r.avatarUrl.startsWith('https://') || r.avatarUrl.startsWith('/api/')) ? (
              <img
                src={r.avatarUrl}
                alt=""
                style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              `${r.firstName.charAt(0)}${r.lastName.charAt(0)}`
            )}
          </div>
          <div>
            <Text strong>{r.firstName} {r.lastName}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{r.email}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'Organization',
      dataIndex: 'tenantId',
      key: 'tenantId',
      width: 180,
      render: (tid: string) => <Text>{tenantName(tid)}</Text>,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 160,
      render: (role: string) => (
        <Tag style={ROLE_STYLES[role] || { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' }}>
          {ROLE_LABELS[role] || role}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      width: 110,
      filters: [
        { text: 'Active', value: true },
        { text: 'Inactive', value: false },
      ],
      onFilter: (value, record) => record.active === value,
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
            ? `${record.firstName} will lose access to the platform.`
            : `${record.firstName} will regain access.`}
          onConfirm={() => handleToggleActive(record)}
          okText="Yes"
          cancelText="No"
          okButtonProps={{ danger: record.active }}
        >
          <Switch
            checked={record.active}
            size="small"
            loading={togglingId === record.id}
            style={record.active ? { backgroundColor: '#2d1854' } : {}}
          />
        </Popconfirm>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Edit user">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this user?"
            description="This user and all their data will be permanently deleted. This cannot be undone."
            onConfirm={() => handleDelete(record)}
            okText="Delete"
            okButtonProps={{ danger: true }}
            cancelText="Cancel"
          >
            <Tooltip title="Delete user">
              <Button type="text" size="small" icon={<DeleteOutlined />} danger />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  /* ---- render ---- */
  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
        margin: '-24px -24px 24px -24px',
        padding: '28px 32px 20px 32px',
        borderBottom: '3px solid #6b4fa0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TeamOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Users</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Manage platform and tenant users</Text>
          </div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="large"
          onClick={() => setCreateModalOpen(true)}
          style={{ borderColor: '#fff', color: '#fff', background: 'transparent' }}
        >
          New User
        </Button>
      </div>
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Filters + Table */}
      <Card
        style={{}}
      >
        <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
          <Space wrap size="middle" style={{ marginBottom: 20, width: '100%' }}>
            <Input.Search
              placeholder="Search by name or email..."
              allowClear
              onSearch={(v) => { setSearchText(v); setPage(0); }}
              onChange={(e) => { if (!e.target.value) { setSearchText(''); setPage(0); } }}
              style={{ width: 320 }}
              prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
              size="large"
            />
            <Select
              placeholder="Filter by organization"
              allowClear
              style={{ minWidth: 240 }}
              size="large"
              value={tenantFilter}
              onChange={handleTenantFilterChange}
              showSearch
              filterOption={false}
              onSearch={handleTenantSearch}
              notFoundContent={tenantSearching ? <Spin size="small" /> : null}
              options={tenants.map((t) => ({ value: t.id, label: t.name }))}
              suffixIcon={<UserOutlined style={{ color: '#6b4fa0' }} />}
            />
            <Select
              placeholder="Filter by role"
              allowClear
              style={{ minWidth: 200 }}
              size="large"
              value={roleFilter}
              onChange={handleRoleFilterChange}
              options={ROLE_OPTIONS}
              suffixIcon={<SafetyCertificateOutlined style={{ color: '#6b4fa0' }} />}
            />
          </Space>

        <AlphaBar activeLetter={searchText ? null : letter} onChange={handleLetterChange} disabled={!!searchText} />

        <div style={{ margin: '8px 0', fontSize: 13, color: '#8c8c8c' }}>
          {total} user{total !== 1 ? 's' : ''}
          {letter && !searchText ? ` starting with "${letter}"` : ''}
          {searchText ? ` matching "${searchText}"` : ''}
        </div>

        <Table<UserResponse>
          columns={columns}
          dataSource={filteredUsers}
          loading={loading}
          rowKey="id"
          onChange={handleTableChange}
          onRow={(record) => ({
            onDoubleClick: () => openEdit(record),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            current: page + 1,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} users`,
          }}
          locale={{ emptyText: 'No users found.' }}
        />
        </ConfigProvider>
      </Card>

      {/* Create User Modal */}
      <Modal
        title="Create New User"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        okText="Create User"
        confirmLoading={creating}
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
        width={560}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Please enter an email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input placeholder="user@example.com" size="large" />
          </Form.Item>

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="firstName"
              label="First Name"
              rules={[{ required: true, message: 'Required' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Jane" size="large" />
            </Form.Item>
            <Form.Item
              name="lastName"
              label="Last Name"
              rules={[{ required: true, message: 'Required' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="Smith" size="large" />
            </Form.Item>
          </Space>

          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Please enter a password' },
              { min: 8, message: 'Password must be at least 8 characters' },
              {
                pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/,
                message: 'Must include uppercase, lowercase, number, and special character',
              },
            ]}
          >
            <Input.Password placeholder="Minimum 8 characters" size="large" />
          </Form.Item>

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="role"
              label="Role"
              rules={[{ required: true, message: 'Please select a role' }]}
              style={{ flex: 1 }}
            >
              <Select
                placeholder="Select role"
                options={ROLE_OPTIONS}
                size="large"
                onChange={(role: string) => {
                  const isPlatformRole = ['PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT'].includes(role);
                  if (isPlatformRole) {
                    const platformTenant = tenants.find((t) => t.tenantType === 'PLATFORM');
                    if (platformTenant) createForm.setFieldValue('tenantId', platformTenant.id);
                  }
                }}
              />
            </Form.Item>
            <Form.Item
              name="tenantId"
              label="Organization"
              rules={[{ required: true, message: 'Please select an organization' }]}
              style={{ flex: 1 }}
            >
              <Select
                placeholder="Select organization"
                showSearch
                filterOption={false}
                onSearch={handleTenantSearch}
                notFoundContent={tenantSearching ? <Spin size="small" /> : null}
                disabled={isPlatformRole}
                options={tenants
                  .filter((t) => !isPlatformRole || t.tenantType === 'PLATFORM')
                  .map((t) => ({ value: t.id, label: t.name }))}
                size="large"
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        title={editingUser ? `Edit: ${editingUser.firstName} ${editingUser.lastName}` : 'Edit User'}
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); setEditingUser(null); }}
        onOk={() => editForm.submit()}
        okText="Save Changes"
        confirmLoading={editing}
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
        width={480}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit} style={{ marginTop: 16 }}>
          {editingUser && (
            <div style={{ marginBottom: 16, padding: 12, background: '#f3eeff', borderRadius: 8, border: '1px solid #e0d4f5' }}>
              <Text type="secondary">Email: </Text>
              <Text strong>{editingUser.email}</Text>
            </div>
          )}

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="firstName"
              label="First Name"
              rules={[{ required: true, message: 'Required' }]}
              style={{ flex: 1 }}
            >
              <Input size="large" />
            </Form.Item>
            <Form.Item
              name="lastName"
              label="Last Name"
              rules={[{ required: true, message: 'Required' }]}
              style={{ flex: 1 }}
            >
              <Input size="large" />
            </Form.Item>
          </Space>

          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Please select a role' }]}
          >
            <Select options={ROLE_OPTIONS} size="large" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
    </div>
  );
}
