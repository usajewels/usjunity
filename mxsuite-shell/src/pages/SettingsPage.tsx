import { useEffect, useState } from 'react';
import {
  Card, Switch, Typography, Space, Spin, Grid, Select, Divider, message,
} from 'antd';
import {
  BulbOutlined, BellOutlined, LayoutOutlined,
} from '@ant-design/icons';
import { api, usePageTitle } from '@mxsuite/shared';

const { Title, Text } = Typography;

interface Preferences {
  theme?: 'light' | 'dark';
  emailNotifications?: boolean;
  inAppNotifications?: boolean;
  weeklyDigest?: boolean;
  compactMode?: boolean;
  rememberLastPage?: boolean;
  dateFormat?: string;
}

const DATE_FORMAT_OPTIONS = [
  { value: 'MMM D, YYYY', label: 'Jan 15, 2026' },
  { value: 'MM/DD/YYYY', label: '01/15/2026' },
  { value: 'DD/MM/YYYY', label: '15/01/2026' },
  { value: 'YYYY-MM-DD', label: '2026-01-15' },
];

export default function SettingsPage() {
  usePageTitle('Settings');
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [prefs, setPrefs] = useState<Preferences>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Preferences>('/profile/preferences')
      .then(({ data }) => {
        const p = data || {};
        setPrefs(p);
        // Sync rememberLastPage to localStorage for LoginPage
        localStorage.setItem('mxsuite_remember_last_page', String(!!p.rememberLastPage));
      })
      .catch(() => message.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const savePreferences = async (updated: Preferences) => {
    setSaving(true);
    try {
      await api.put('/profile/preferences', updated);
      setPrefs(updated);
      // Sync rememberLastPage to localStorage so LoginPage can read it before API call
      localStorage.setItem('mxsuite_remember_last_page', String(!!updated.rememberLastPage));
    } catch {
      message.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (key: keyof Preferences, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    savePreferences(updated);
  };

  const handleSelect = (key: keyof Preferences, value: string) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    savePreferences(updated);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" tip="Loading settings..." />
      </div>
    );
  }

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={3} style={{ margin: 0, color: '#2d1854' }}>Settings</Title>
      </div>
    <div style={{ maxWidth: isMobile ? '100%' : 700, margin: '0 auto' }}>
      {/* Appearance */}
      <Card
        title={<Space><BulbOutlined /> Appearance</Space>}
        style={{ marginBottom: 16 }}
      >
        <SettingRow
          title="Dark Mode"
          description="Use dark theme for the interface"
          action={
            <Switch
              checked={prefs.theme === 'dark'}
              onChange={(v) => handleToggle('theme', v ? 'dark' as any : 'light' as any)}
              loading={saving}
            />
          }
        />
        <Divider style={{ margin: '12px 0' }} />
        <SettingRow
          title="Compact Mode"
          description="Reduce spacing for a denser layout"
          action={
            <Switch
              checked={!!prefs.compactMode}
              onChange={(v) => handleToggle('compactMode', v)}
              loading={saving}
            />
          }
        />
      </Card>

      {/* Notifications */}
      <Card
        title={<Space><BellOutlined /> Notifications</Space>}
        style={{ marginBottom: 16 }}
      >
        <SettingRow
          title="Email Notifications"
          description="Receive updates and alerts via email"
          action={
            <Switch
              checked={prefs.emailNotifications !== false}
              onChange={(v) => handleToggle('emailNotifications', v)}
              loading={saving}
            />
          }
        />
        <Divider style={{ margin: '12px 0' }} />
        <SettingRow
          title="In-App Notifications"
          description="Show notification badges and alerts in the app"
          action={
            <Switch
              checked={prefs.inAppNotifications !== false}
              onChange={(v) => handleToggle('inAppNotifications', v)}
              loading={saving}
            />
          }
        />
        <Divider style={{ margin: '12px 0' }} />
        <SettingRow
          title="Weekly Digest"
          description="Receive a weekly summary email of activity"
          action={
            <Switch
              checked={!!prefs.weeklyDigest}
              onChange={(v) => handleToggle('weeklyDigest', v)}
              loading={saving}
            />
          }
        />
      </Card>

      {/* Display */}
      <Card
        title={<Space><LayoutOutlined /> Display</Space>}
        style={{ marginBottom: 16 }}
      >
        <SettingRow
          title="Date Format"
          description="How dates are displayed throughout the app"
          action={
            <Select
              value={prefs.dateFormat || 'MMM D, YYYY'}
              onChange={(v) => handleSelect('dateFormat', v)}
              options={DATE_FORMAT_OPTIONS}
              style={{ width: 160 }}
            />
          }
        />
        <Divider style={{ margin: '12px 0' }} />
        <SettingRow
          title="Remember Last Page"
          description="Return to your last visited page after signing in"
          action={
            <Switch
              checked={!!prefs.rememberLastPage}
              onChange={(v) => handleToggle('rememberLastPage', v)}
              loading={saving}
            />
          }
        />
      </Card>

    </div>
    </div>
  );
}

function SettingRow({ title, description, action }: { title: string; description: string; action: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <Text strong>{title}</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 13 }}>{description}</Text>
      </div>
      {action}
    </div>
  );
}
