import { useCallback, useEffect, useState } from 'react';
import {
  Table, Button, Tag, Typography, Modal, Form, Input, Select,
  Card, Space, Tabs, Tooltip, Popconfirm, message, notification, Alert,
} from 'antd';
import {
  MailOutlined, SendOutlined, StopOutlined, ReloadOutlined,
  ClockCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { invitationApi, type Invitation } from '../services/api';

dayjs.extend(relativeTime);

const { Title, Text } = Typography;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ROLE_COLORS: Record<string, string> = {
  PLATFORM_ADMIN: 'red',
  COACH_ADMIN: 'volcano',
  PLATFORM_SUPPORT: 'orange',
  TENANT_ADMIN: 'blue',
  TENANT_USER: 'green',
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

interface StatusConfig {
  color: string;
  icon: React.ReactNode;
  label: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  PENDING: {
    color: 'processing',
    icon: <ClockCircleOutlined />,
    label: 'Pending',
  },
  ACCEPTED: {
    color: 'success',
    icon: <CheckCircleOutlined />,
    label: 'Accepted',
  },
  CANCELLED: {
    color: 'default',
    icon: <CloseCircleOutlined />,
    label: 'Cancelled',
  },
  EXPIRED: {
    color: 'warning',
    icon: <ExclamationCircleOutlined />,
    label: 'Expired',
  },
};

const STATUS_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'EXPIRED', label: 'Expired' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InvitationListPage() {
  usePageTitle('Invitations');
  const isDevLogin = localStorage.getItem('mxsuite_dev_login') === 'true';

  /* ---- state ---- */
  const [invitations, setInvitations] = useState<Invitation[]>([] as Invitation[]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [counts, setCounts] = useState<Record<string, number>>({});

  /* ---- send invitation modal ---- */
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendForm] = Form.useForm();
  const [sending, setSending] = useState(false);

  /* ---- action loading states ---- */
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  /* ---- fetch ---- */
  const fetchInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, size: pageSize };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const { data } = await invitationApi.list(params as any);
      setInvitations((data.content ?? []) as Invitation[]);
      setTotal(data.totalElements ?? 0);
    } catch {
      message.error('Failed to load invitations');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter]);

  const fetchCounts = useCallback(async () => {
    try {
      const { data } = await invitationApi.counts();
      setCounts(data);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchInvitations(); fetchCounts(); }, [fetchInvitations, fetchCounts]);

  /* ---- send invitation ---- */
  const handleSend = async (values: { email: string; role: string }) => {
    setSending(true);
    try {
      await invitationApi.create(values);
      notification.success({
        message: isDevLogin ? 'User Created' : 'Invitation Sent',
        description: isDevLogin
          ? `${values.email} created with password Admin123! — ready to use in dev login.`
          : `An invitation has been sent to ${values.email}.`,
        icon: <MailOutlined style={{ color: '#52c41a' }} />,
      });
      setSendModalOpen(false);
      sendForm.resetFields();
      fetchInvitations();
      fetchCounts();
    } catch {
      message.error('Failed to send invitation');
    } finally {
      setSending(false);
    }
  };

  /* ---- cancel invitation ---- */
  const handleCancel = async (invitation: Invitation) => {
    setCancellingId(invitation.id);
    try {
      await invitationApi.cancel(invitation.id);
      message.success(`Invitation to ${invitation.email} cancelled`);
      fetchInvitations();
      fetchCounts();
    } catch {
      message.error('Failed to cancel invitation');
    } finally {
      setCancellingId(null);
    }
  };

  /* ---- resend invitation ---- */
  const handleResend = async (invitation: Invitation) => {
    setResendingId(invitation.id);
    try {
      await invitationApi.resend(invitation.id);
      notification.success({
        message: 'Invitation Resent',
        description: `The invitation to ${invitation.email} has been resent.`,
        icon: <MailOutlined style={{ color: '#2d1854' }} />,
      });
      fetchInvitations();
      fetchCounts();
    } catch {
      message.error('Failed to resend invitation');
    } finally {
      setResendingId(null);
    }
  };

  /* ---- pagination ---- */
  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage((pagination.current ?? 1) - 1);
    setPageSize(pagination.pageSize ?? 20);
  };

  /* ---- status tab change ---- */
  const handleStatusChange = (key: string) => {
    setStatusFilter(key);
    setPage(0);
  };

  /* ---- helper: is invitation expired or nearly expired ---- */
  const isExpiringSoon = (expiresAt: string) => {
    const diff = dayjs(expiresAt).diff(dayjs(), 'hour');
    return diff > 0 && diff < 24;
  };

  /* ---- columns ---- */
  const columns: ColumnsType<Invitation> = [
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      sorter: (a, b) => a.email.localeCompare(b.email),
      render: (email: string) => (
        <Text strong copyable={{ tooltips: ['Copy email', 'Copied'] }}>
          {email}
        </Text>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 160,
      filters: ROLE_OPTIONS.map((r) => ({ text: r.label, value: r.value })),
      onFilter: (value, record) => record.role === value,
      render: (role: string) => (
        <Tag color={ROLE_COLORS[role] || 'default'}>
          {ROLE_LABELS[role] || role}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: string) => {
        const config = STATUS_CONFIG[status] || {
          color: 'default',
          icon: null,
          label: status,
        };
        return (
          <Tag icon={config.icon} color={config.color}>
            {config.label}
          </Tag>
        );
      },
    },
    {
      title: 'Invited By',
      dataIndex: 'invitedByName',
      key: 'invitedByName',
      width: 160,
      render: (name: string) => <Text type="secondary">{name || 'System'}</Text>,
    },
    {
      title: 'Sent',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      sorter: (a, b) => dayjs(a.createdAt).unix() - dayjs(b.createdAt).unix(),
      defaultSortOrder: 'descend',
      render: (date: string) => (
        <Tooltip title={dayjs(date).format('MMMM D, YYYY h:mm A')}>
          <Text type="secondary">{dayjs(date).fromNow()}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Expires',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 160,
      render: (date: string, record) => {
        if (record.status !== 'PENDING') {
          return <Text type="secondary">--</Text>;
        }
        const expired = dayjs(date).isBefore(dayjs());
        const expiringSoon = !expired && isExpiringSoon(date);
        return (
          <Tooltip title={dayjs(date).format('MMMM D, YYYY h:mm A')}>
            <Text
              type={expired ? 'danger' : expiringSoon ? 'warning' : 'secondary'}
              strong={expired || expiringSoon}
            >
              {expired ? 'Expired' : dayjs(date).fromNow()}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      align: 'center',
      render: (_, record) => {
        if (record.status !== 'PENDING') {
          return <Text type="secondary">--</Text>;
        }
        return (
          <Space size="small">
            <Tooltip title="Resend invitation email">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                loading={resendingId === record.id}
                onClick={() => handleResend(record)}
              >
                Resend
              </Button>
            </Tooltip>
            <Popconfirm
              title="Cancel this invitation?"
              description={`The invitation to ${record.email} will be revoked.`}
              onConfirm={() => handleCancel(record)}
              okText="Yes, Cancel It"
              cancelText="No"
              okButtonProps={{ danger: true }}
              icon={<ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />}
            >
              <Tooltip title="Cancel invitation">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  loading={cancellingId === record.id}
                >
                  Cancel
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
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
          <Title level={3} style={{ margin: 0, color: '#2d1854' }}>Invitations</Title>
          <Text style={{ color: '#6b4fa0' }}>Send and manage user invitations</Text>
        </div>
        <Button
          type="primary"
          icon={<SendOutlined />}
          size="large"
          onClick={() => setSendModalOpen(true)}
          style={{ background: '#2d1854', borderColor: '#2d1854' }}
        >
          Send Invitation
        </Button>
      </div>
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Status filter tabs + Table */}
      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      >
        <Tabs
          activeKey={statusFilter}
          onChange={handleStatusChange}
          items={STATUS_TABS.map((tab) => {
            const count = tab.key === 'ALL' ? counts.total : counts[tab.key.toLowerCase()];
            return {
              key: tab.key,
              label: (
                <span>
                  {tab.key !== 'ALL' && STATUS_CONFIG[tab.key] && (
                    <span style={{ marginRight: 6 }}>{STATUS_CONFIG[tab.key].icon}</span>
                  )}
                  {tab.label}{count != null ? ` (${count})` : ''}
                </span>
              ),
            };
          })}
          style={{ marginBottom: 8 }}
        />

        <Table<Invitation>
          columns={columns}
          dataSource={invitations}
          loading={loading}
          rowKey="id"
          onChange={handleTableChange}
          pagination={{
            current: page + 1,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} invitations`,
          }}
          locale={{
            emptyText:
              statusFilter === 'ALL'
                ? 'No invitations yet. Send your first invitation to get started.'
                : `No ${statusFilter.toLowerCase()} invitations.`,
          }}
        />
      </Card>

      {/* Send Invitation Modal */}
      <Modal
        title={
          <Space>
            <MailOutlined style={{ color: '#2d1854' }} />
            <span>Send Invitation</span>
          </Space>
        }
        open={sendModalOpen}
        onCancel={() => { setSendModalOpen(false); sendForm.resetFields(); }}
        onOk={() => sendForm.submit()}
        okText="Send Invitation"
        confirmLoading={sending}
        okButtonProps={{
          icon: <SendOutlined />,
          style: { background: '#2d1854', borderColor: '#2d1854' },
        }}
      >
        {isDevLogin ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 20 }}
            message="Dev mode: User will be created directly with password Admin123! — no email sent."
          />
        ) : (
          <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
            The user will receive an email with a link to create their account and join the platform.
          </Text>
        )}

        <Form form={sendForm} layout="vertical" onFinish={handleSend}>
          <Form.Item
            name="email"
            label="Email Address"
            rules={[
              { required: true, message: 'Please enter an email address' },
              { type: 'email', message: 'Please enter a valid email address' },
            ]}
          >
            <Input
              placeholder="user@example.com"
              size="large"
              prefix={<MailOutlined style={{ color: '#bfbfbf' }} />}
            />
          </Form.Item>

          <Form.Item
            name="role"
            label="Role"
            extra="This determines what the user can do after they accept the invitation."
            rules={[{ required: true, message: 'Please select a role' }]}
          >
            <Select
              placeholder="Select a role for the new user"
              size="large"
              options={ROLE_OPTIONS}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
    </div>
  );
}
