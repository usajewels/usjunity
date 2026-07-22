import { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Typography, Alert, Space, List, Avatar, Tag, Divider, ConfigProvider } from 'antd';
import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import { useAuth } from '../store/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const { Title, Text } = Typography;

const ROLE_STYLES: Record<string, React.CSSProperties> = {
  PLATFORM_ADMIN: { backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' },
  PLATFORM_SUPPORT: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' },
  TENANT_ADMIN: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' },
  TENANT_USER: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' },
};

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  PLATFORM_SUPPORT: 'Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

const ROLE_AVATAR_COLORS: Record<string, string> = {
  PLATFORM_ADMIN: '#2d1854',
  PLATFORM_SUPPORT: '#6b4fa0',
  TENANT_ADMIN: '#9b7fd4',
  TENANT_USER: '#d9d9d9',
};

interface DevUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantName: string | null;
}

function getRedirectPath(): string {
  const remember = localStorage.getItem('mxsuite_remember_last_page');
  if (remember === 'true') {
    const lastPath = localStorage.getItem('mxsuite_last_path');
    if (lastPath && lastPath !== '/login') return lastPath;
  }
  return '/';
}

export default function LoginPage() {
  usePageTitle('Sign In');
  const { login, devLogin } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devUsers, setDevUsers] = useState<DevUser[]>([]);
  const [devMode, setDevMode] = useState(false);
  const [brandName, setBrandName] = useState('GrowthZone MemberSuite');

  useEffect(() => {
    axios.get<{ brandName?: string; logoUrl?: string }>('/api/auth/platform/branding')
      .then(({ data }) => { if (data.brandName) setBrandName(data.brandName); })
      .catch(() => {});

    if (import.meta.env.DEV) {
      axios.get<DevUser[]>('/api/auth/dev/users')
        .then(({ data }) => {
          setDevUsers(data);
          setDevMode(true);
        })
        .catch(() => {});
    }
  }, []);

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(getRedirectPath());
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async (email: string) => {
    setLoading(true);
    setError(null);
    try {
      await devLogin(email);
      navigate(getRedirectPath());
    } catch {
      setError('Dev login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0e0826 0%, #1a0e3a 40%, #2d1854 100%)',
    }}>
      <Card
        style={{ width: devMode ? 500 : 420, borderRadius: 12, boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}
        bodyStyle={{ padding: '40px 32px' }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%', textAlign: 'center' }}>
          <div>
            <Title level={2} style={{ color: '#2d1854', margin: 0, fontWeight: 700 }}>
              {brandName}
            </Title>
            <Text style={{ color: '#6b4fa0' }}>Onboarding Platform</Text>
          </div>

          {error && <Alert message={error} type="error" showIcon closable onClose={() => setError(null)} />}

          {devMode && devUsers.length > 0 && (
            <>
              <div style={{ textAlign: 'left' }}>
                <Text strong style={{ fontSize: 14, color: '#2d1854' }}>Quick Login (Dev Mode)</Text>
                <List
                  size="small"
                  style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto' }}
                  dataSource={devUsers}
                  renderItem={(u) => (
                    <List.Item
                      style={{ cursor: 'pointer', padding: '8px 12px', borderRadius: 6 }}
                      onClick={() => handleDevLogin(u.email)}
                      className="dev-user-item"
                    >
                      <List.Item.Meta
                        avatar={<Avatar icon={<UserOutlined />} size="small" style={{ backgroundColor: ROLE_AVATAR_COLORS[u.role] || '#d9d9d9' }} />}
                        title={
                          <span>
                            {u.firstName} {u.lastName}{' '}
                            <Tag style={{ ...ROLE_STYLES[u.role], fontSize: 10 }}>{ROLE_LABELS[u.role] || u.role}</Tag>
                          </span>
                        }
                        description={<span style={{ fontSize: 12 }}>{u.email}{u.tenantName ? ` — ${u.tenantName}` : ''}</span>}
                      />
                    </List.Item>
                  )}
                />
              </div>
              <Divider style={{ margin: '8px 0', borderColor: '#e0d4f5', color: '#6b4fa0' }}>or sign in manually</Divider>
            </>
          )}

          <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
            <Form layout="vertical" onFinish={onFinish} size="large">
              <Form.Item name="email" rules={[{ required: true, type: 'email', message: 'Please enter a valid email' }]}>
                <Input prefix={<MailOutlined style={{ color: '#6b4fa0' }} />} placeholder="Email address" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: 'Please enter your password' }]}>
                <Input.Password prefix={<LockOutlined style={{ color: '#6b4fa0' }} />} placeholder="Password" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={loading} block
                  style={{ height: 44, fontSize: 16, borderRadius: 8, background: '#2d1854', borderColor: '#2d1854' }}>
                  Sign In
                </Button>
              </Form.Item>
            </Form>
          </ConfigProvider>
        </Space>
      </Card>
    </div>
  );
}
