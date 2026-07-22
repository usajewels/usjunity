import { useEffect, useState } from 'react';
import {
  Card, Form, Input, Button, Avatar, Upload, Typography, Descriptions,
  Row, Col, Space, Spin, Grid, Divider, message,
} from 'antd';
import {
  UserOutlined, SaveOutlined, CameraOutlined, LockOutlined,
} from '@ant-design/icons';
import { api, usePageTitle } from '@mxsuite/shared';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  tenantName: string;
  avatarUrl?: string;
  title?: string;
  bio?: string;
  createdAt?: string;
  lastLoginAt?: string;
}

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  PLATFORM_SUPPORT: 'Onboarding Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

export default function ProfilePage() {
  usePageTitle('Profile');
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  useEffect(() => {
    api.get<Profile>('/profile')
      .then(({ data }) => {
        setProfile(data);
        profileForm.setFieldsValue({
          firstName: data.firstName,
          lastName: data.lastName,
          title: data.title || '',
          bio: data.bio || '',
        });
      })
      .catch(() => message.error('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  const handleSaveProfile = async (values: { firstName: string; lastName: string; title: string; bio: string }) => {
    setSaving(true);
    try {
      const { data } = await api.put<Profile>('/profile', values);
      setProfile(data);
      message.success('Profile updated');
    } catch {
      message.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (values: { currentPassword: string; newPassword: string }) => {
    setChangingPassword(true);
    try {
      await api.put('/profile/password', values);
      message.success('Password changed successfully');
      passwordForm.resetFields();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to change password';
      message.error(msg);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const { data } = await api.post<{ avatarUrl: string }>('/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfile((prev) => prev ? { ...prev, avatarUrl: data.avatarUrl } : prev);
      message.success('Avatar updated');
    } catch {
      message.error('Failed to upload avatar');
    }
    return false;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" tip="Loading profile..." />
      </div>
    );
  }

  if (!profile) return null;

  const memberSince = profile.createdAt
    ? dayjs(profile.createdAt).format('MMMM D, YYYY')
    : 'Unknown';

  const memberDuration = profile.createdAt
    ? dayjs().diff(dayjs(profile.createdAt), 'month')
    : 0;

  const lastLogin = profile.lastLoginAt
    ? dayjs(profile.lastLoginAt).format('MMM D, YYYY h:mm A')
    : 'Never';

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={3} style={{ margin: 0, color: '#2d1854' }}>My Profile</Title>
      </div>
    <div style={{ maxWidth: isMobile ? '100%' : 900, margin: '0 auto' }}>
      <Row gutter={isMobile ? [0, 16] : [24, 24]}>
        {/* Left column: Avatar + info */}
        <Col xs={24} md={8}>
          <Card style={{ textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <Avatar
                size={96}
                src={profile.avatarUrl}
                icon={<UserOutlined />}
                style={{ backgroundColor: '#2d1854' }}
              />
              <Upload
                beforeUpload={(file) => handleAvatarUpload(file as unknown as File)}
                showUploadList={false}
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
              >
                <Button
                  shape="circle"
                  size="small"
                  icon={<CameraOutlined />}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    border: '2px solid #fff',
                  }}
                />
              </Upload>
            </div>
            <Title level={4} style={{ margin: '12px 0 4px' }}>
              {profile.firstName} {profile.lastName}
            </Title>
            {profile.title && <Text type="secondary">{profile.title}</Text>}

            <Divider />

            <Descriptions column={1} size="small" style={{ textAlign: 'left' }}>
              <Descriptions.Item label="Email">{profile.email}</Descriptions.Item>
              <Descriptions.Item label="Role">{ROLE_LABELS[profile.role] || profile.role}</Descriptions.Item>
              <Descriptions.Item label="Organization">{profile.tenantName}</Descriptions.Item>
              <Descriptions.Item label="Member Since">
                {memberSince} ({memberDuration} months)
              </Descriptions.Item>
              <Descriptions.Item label="Last Login">{lastLogin}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        {/* Right column: Edit form + password */}
        <Col xs={24} md={16}>
          <Card title="Edit Profile" style={{ marginBottom: 16 }}>
            <Form
              form={profileForm}
              layout="vertical"
              onFinish={handleSaveProfile}
            >
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="firstName"
                    label="First Name"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <Input size="large" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="lastName"
                    label="Last Name"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <Input size="large" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="title" label="Job Title">
                <Input size="large" placeholder="e.g. Membership Director" />
              </Form.Item>
              <Form.Item name="bio" label="Bio">
                <Input.TextArea rows={3} placeholder="Tell us a bit about yourself..." maxLength={500} showCount />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saving}
              >
                Save Changes
              </Button>
            </Form>
          </Card>

          <Card title="Change Password">
            <Form
              form={passwordForm}
              layout="vertical"
              onFinish={handleChangePassword}
            >
              <Form.Item
                name="currentPassword"
                label="Current Password"
                rules={[{ required: true, message: 'Enter your current password' }]}
              >
                <Input.Password size="large" prefix={<LockOutlined />} />
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="New Password"
                rules={[
                  { required: true, message: 'Enter a new password' },
                  { min: 8, message: 'Password must be at least 8 characters' },
                ]}
              >
                <Input.Password size="large" prefix={<LockOutlined />} />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="Confirm New Password"
                dependencies={['newPassword']}
                rules={[
                  { required: true, message: 'Confirm your new password' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('newPassword') === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('Passwords do not match'));
                    },
                  }),
                ]}
              >
                <Input.Password size="large" prefix={<LockOutlined />} />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<LockOutlined />}
                loading={changingPassword}
                danger
              >
                Change Password
              </Button>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
    </div>
  );
}
