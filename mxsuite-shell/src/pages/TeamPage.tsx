import React, { useCallback, useEffect, useState } from 'react';
import {
  Table, Button, Tag, Typography, Modal, Form, Input, Select, ConfigProvider,
  Card, Space, Switch, Popconfirm, message,
} from 'antd';
import {
  SendOutlined, SearchOutlined, DeleteOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { api, usePageTitle } from '@mxsuite/shared';

const { Title, Text } = Typography;

interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  active: boolean;
  avatarUrl: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  tenantId: string;
  expiresAt: string;
  acceptedAt: string | null;
}

interface PaginatedResponse<T> {
  content: T[];
  totalElements: number;
  page: number;
  size: number;
}

const ROLE_STYLES: Record<string, React.CSSProperties> = {
  TENANT_ADMIN: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' },
  TENANT_USER: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' },
};

const ROLE_AVATAR_COLORS: Record<string, string> = {
  TENANT_ADMIN: '#9b7fd4',
  TENANT_USER: '#a0a0a0',
};

const ROLE_LABELS: Record<string, string> = {
  TENANT_ADMIN: 'Admin',
  TENANT_USER: 'Member',
};

const INVITE_ROLE_OPTIONS = [
  { value: 'TENANT_ADMIN', label: 'Admin' },
  { value: 'TENANT_USER', label: 'Member' },
];

export default function TeamPage() {
  usePageTitle('Team Members');

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [searchText, setSearchText] = useState('');

  // Pending invitations
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invLoading, setInvLoading] = useState(false);

  // Invite modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteForm] = Form.useForm();
  const [inviting, setInviting] = useState(false);

  // Toggle active
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchMembers = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<TeamMember>>('/team', {
        params: { page, size: pageSize },
        signal,
      });
      if (!signal?.aborted) {
        setMembers(data.content ?? []);
        setTotal(data.totalElements ?? 0);
      }
    } catch {
      if (!signal?.aborted) message.error('Failed to load team members');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, pageSize]);

  const fetchInvitations = useCallback(async (signal?: AbortSignal) => {
    setInvLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<Invitation>>('/invitations', {
        params: { page: 0, size: 50, status: 'PENDING' },
        signal,
      });
      if (!signal?.aborted) setInvitations(data.content ?? []);
    } catch {
      // Silently fail — invitations are supplemental
    } finally {
      if (!signal?.aborted) setInvLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchMembers(ac.signal);
    return () => ac.abort();
  }, [fetchMembers]);

  useEffect(() => {
    const ac = new AbortController();
    fetchInvitations(ac.signal);
    return () => ac.abort();
  }, [fetchInvitations]);

  // Invite user
  const handleInvite = async (values: { email: string; role: string }) => {
    setInviting(true);
    try {
      const { data } = await api.post<Invitation>('/invitations', values);
      const autoAccepted = data.status === 'ACCEPTED';
      message.success(autoAccepted
        ? `User ${values.email} created successfully`
        : `Invitation sent to ${values.email}`);
      setInviteModalOpen(false);
      inviteForm.resetFields();
      if (autoAccepted) fetchMembers();
      fetchInvitations();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to send invitation';
      message.error(msg);
    } finally {
      setInviting(false);
    }
  };

  // Cancel invitation
  const handleCancelInvite = async (id: string) => {
    try {
      await api.post(`/invitations/${id}/cancel`);
      message.success('Invitation cancelled');
      fetchInvitations();
    } catch {
      message.error('Failed to cancel invitation');
    }
  };

  // Resend invitation
  const handleResendInvite = async (id: string) => {
    try {
      await api.post(`/invitations/${id}/resend`);
      message.success('Invitation resent');
      fetchInvitations();
    } catch {
      message.error('Failed to resend invitation');
    }
  };

  // Toggle active
  const handleToggleActive = async (member: TeamMember) => {
    setTogglingId(member.id);
    try {
      await api.put(`/team/${member.id}/active`, { active: !member.active });
      message.success(`${member.firstName} ${member.lastName} ${member.active ? 'deactivated' : 'activated'}`);
      fetchMembers();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to update user status';
      message.error(msg);
    } finally {
      setTogglingId(null);
    }
  };

  // Remove member
  const handleRemove = async (member: TeamMember) => {
    try {
      await api.delete(`/team/${member.id}`);
      message.success(`${member.firstName} ${member.lastName} removed`);
      fetchMembers();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to remove user';
      message.error(msg);
    }
  };

  // Pagination
  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage((pagination.current ?? 1) - 1);
    setPageSize(pagination.pageSize ?? 20);
  };

  // Client-side search
  const filteredMembers = searchText.trim()
    ? members.filter((m) => {
        const term = searchText.toLowerCase();
        return (
          m.firstName.toLowerCase().includes(term) ||
          m.lastName.toLowerCase().includes(term) ||
          m.email.toLowerCase().includes(term)
        );
      })
    : members;

  // Columns
  const columns: ColumnsType<TeamMember> = [
    {
      title: 'Member',
      key: 'name',
      sorter: (a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      render: (_, r) => (
        <Space>
          <div
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: ROLE_AVATAR_COLORS[r.role] || '#a0a0a0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 600, fontSize: 14, flexShrink: 0,
            }}
          >
            {r.avatarUrl && (r.avatarUrl.startsWith('https://') || r.avatarUrl.startsWith('/api/')) ? (
              <img src={r.avatarUrl} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
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
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 120,
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
      title: '',
      key: 'actions',
      width: 80,
      align: 'center',
      render: (_, record) => (
        <Popconfirm
          title="Remove this member?"
          description={`${record.firstName} ${record.lastName} will be permanently removed.`}
          onConfirm={() => handleRemove(record)}
          okText="Remove"
          cancelText="No"
          okButtonProps={{ danger: true }}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />}>
            Remove
          </Button>
        </Popconfirm>
      ),
    },
  ];

  // Invitation columns
  const invitationColumns: ColumnsType<Invitation> = [
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (role: string) => (
        <Tag style={ROLE_STYLES[role] || {}}>{ROLE_LABELS[role] || role}</Tag>
      ),
    },
    {
      title: 'Expires',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 160,
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleResendInvite(record.id)}>
            Resend
          </Button>
          <Popconfirm
            title="Cancel this invitation?"
            onConfirm={() => handleCancelInvite(record.id)}
            okText="Yes"
            cancelText="No"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger>Cancel</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

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
          <Title level={3} style={{ margin: 0, color: '#2d1854' }}>Team Members</Title>
          <Text style={{ color: '#6b4fa0' }}>Manage your organization's users</Text>
        </div>
        <Button
          type="primary"
          icon={<SendOutlined />}
          size="large"
          onClick={() => setInviteModalOpen(true)}
          style={{ background: '#2d1854', borderColor: '#2d1854' }}
        >
          Invite Member
        </Button>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Members Table */}
        <Card
          style={{
            borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            border: '1px solid #e0d4f5', borderTopWidth: 3, borderTopColor: '#2d1854',
          }}
        >
          <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
            <Space wrap size="middle" style={{ marginBottom: 20, width: '100%' }}>
              <Input.Search
                placeholder="Search by name or email..."
                allowClear
                onSearch={setSearchText}
                onChange={(e) => { if (!e.target.value) setSearchText(''); }}
                style={{ width: 320 }}
                prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
                size="large"
              />
            </Space>

            <Table<TeamMember>
              columns={columns}
              dataSource={filteredMembers}
              loading={loading}
              rowKey="id"
              onChange={handleTableChange}
              pagination={{
                current: page + 1,
                pageSize,
                total: searchText.trim() ? filteredMembers.length : total,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50'],
                showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} members`,
              }}
              locale={{ emptyText: 'No team members found.' }}
            />
          </ConfigProvider>
        </Card>

        {/* Pending Invitations */}
        {invitations.length > 0 && (
          <Card
            title={<Text strong style={{ color: '#2d1854' }}>Pending Invitations ({invitations.length})</Text>}
            style={{
              marginTop: 20, borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              border: '1px solid #e0d4f5',
            }}
          >
            <Table<Invitation>
              columns={invitationColumns}
              dataSource={invitations}
              loading={invLoading}
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: 'No pending invitations.' }}
            />
          </Card>
        )}
      </div>

      {/* Invite Modal */}
      <Modal
        title="Invite Team Member"
        open={inviteModalOpen}
        onCancel={() => { setInviteModalOpen(false); inviteForm.resetFields(); }}
        onOk={() => inviteForm.submit()}
        okText="Send Invitation"
        confirmLoading={inviting}
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
        width={480}
      >
        <Form form={inviteForm} layout="vertical" onFinish={handleInvite} style={{ marginTop: 16 }}>
          <Form.Item
            name="email"
            label="Email Address"
            rules={[
              { required: true, message: 'Please enter an email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input placeholder="user@example.com" size="large" />
          </Form.Item>
          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Please select a role' }]}
            initialValue="TENANT_USER"
          >
            <Select options={INVITE_ROLE_OPTIONS} size="large" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
