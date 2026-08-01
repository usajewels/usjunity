import { useEffect, useState, useMemo } from 'react';
import {
  Card, Switch, Typography, Space, Spin, Grid, Select, Divider, Tabs, message,
} from 'antd';
import {
  BulbOutlined, BellOutlined, LayoutOutlined, ThunderboltOutlined,
  ControlOutlined, ImportOutlined, AppstoreOutlined, UserOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { api, usePageTitle } from '@mxsuite/shared';
import { useAuth } from '../store/AuthContext';
import AiConfigSection from '../components/AiConfigSection';
import FeatureConfigSection from '../components/FeatureConfigSection';
import BrandingSection from '../components/BrandingSection';
import OnboardingSchemaSection from '../components/OnboardingSchemaSection';
import SimulatorSection from '../components/SimulatorSection';

const { Title, Text } = Typography;

const PLATFORM_TAB_STYLES = `
.settings-platform-tabs .ant-tabs-tab {
  padding: 12px 20px !important;
  margin: 0 !important;
  border-radius: 0 !important;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}
.settings-platform-tabs .ant-tabs-tab:hover {
  background: rgba(45,24,84,0.04);
}
.settings-platform-tabs .ant-tabs-tab-active {
  background: rgba(45,24,84,0.07) !important;
  border-left: 3px solid #2d1854 !important;
}
.settings-platform-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
  color: #2d1854 !important;
  font-weight: 600;
}
.settings-platform-tabs .ant-tabs-ink-bar {
  display: none;
}
`;

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
  const { isPlatformAdmin, isDevLogin, tenant } = useAuth();
  const [prefs, setPrefs] = useState<Preferences>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Preferences>('/profile/preferences')
      .then(({ data }) => {
        const p = data || {};
        setPrefs(p);
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

  /* ---- Preferences content (shared across views) ---- */
  const sectionCardStyle: React.CSSProperties = {
    marginBottom: 16,
  };

  const preferencesContent = (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <Card
        title={<Space><BulbOutlined /> Appearance</Space>}
        style={sectionCardStyle}
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

      <Card
        title={<Space><BellOutlined /> Notifications</Space>}
        style={sectionCardStyle}
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

      <Card
        title={<Space><LayoutOutlined /> Display</Space>}
        style={sectionCardStyle}
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
  );

  /* ---- Platform admin: tabbed layout ---- */
  if (isPlatformAdmin && tenant) {
    const SECTION_META: Record<string, { title: string; description: string }> = {
      'ai-providers': { title: 'AI Providers', description: 'Configure which AI provider handles each task and manage API keys.' },
      'features': { title: 'Feature Flags', description: 'Control which features are visible for each role across the platform.' },
      'schema': { title: 'Onboarding Schema', description: 'Define and customize the data schema used during member onboarding.' },
      'branding': { title: 'Branding', description: 'Set the platform name and logo displayed to all users.' },
      'simulator': { title: 'Simulator', description: 'Generate test organizations, users, and invitations for development. Reset demo data.' },
    };

    const wrapContent = (key: string, node: React.ReactNode) => {
      const meta = SECTION_META[key];
      return (
        <div style={{ padding: '24px 28px' }}>
          {meta && (
            <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #f0e8fa' }}>
              <Title level={5} style={{ margin: 0, color: '#2d1854' }}>{meta.title}</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>{meta.description}</Text>
            </div>
          )}
          {node}
        </div>
      );
    };

    const platformSubItems = [
      {
        key: 'ai-providers',
        label: <span><ThunderboltOutlined /> AI Providers</span>,
        children: wrapContent('ai-providers', <AiConfigSection tenantId={tenant.id} />),
      },
      {
        key: 'features',
        label: <span><ControlOutlined /> Feature Flags</span>,
        children: wrapContent('features', <FeatureConfigSection tenantId={tenant.id} />),
      },
      {
        key: 'schema',
        label: <span><ImportOutlined /> Onboarding Schema</span>,
        children: wrapContent('schema', <OnboardingSchemaSection tenantId={tenant.id} />),
      },
      {
        key: 'branding',
        label: <span><BulbOutlined /> Branding</span>,
        children: wrapContent('branding', <BrandingSection tenantId={tenant.id} />),
      },
      ...(isDevLogin ? [{
        key: 'simulator',
        label: <span><ExperimentOutlined /> Simulator</span>,
        children: wrapContent('simulator', <SimulatorSection />),
      }] : []),
    ];

    const tabItems = [
      {
        key: 'platform',
        label: <span><AppstoreOutlined /> Platform</span>,
        children: (
          <>
            <style>{PLATFORM_TAB_STYLES}</style>
            <div
              className="settings-platform-tabs"
              style={{
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: '0 2px 12px rgba(45,24,84,0.10), 0 1px 3px rgba(0,0,0,0.06)',
                border: '1px solid #e8e0f2',
                background: '#fff',
              }}
            >
              <Tabs
                tabPosition={isMobile ? 'top' : 'left'}
                defaultActiveKey="ai-providers"
                items={platformSubItems}
                style={{ minHeight: 480 }}
                tabBarStyle={{
                  width: isMobile ? undefined : 210,
                  background: isMobile ? undefined : 'linear-gradient(180deg, #f9f6ff 0%, #f3eeff 100%)',
                  borderRight: isMobile ? undefined : '1px solid #e8e0f2',
                  padding: isMobile ? 0 : '16px 0',
                  margin: 0,
                }}
                tabBarGutter={0}
              />
            </div>
          </>
        ),
      },
      {
        key: 'preferences',
        label: <span><UserOutlined /> Preferences</span>,
        children: preferencesContent,
      },
    ];

    return <SettingsTabLayout tabItems={tabItems} />;
  }

  /* ---- Regular user: simple layout ---- */
  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
        margin: '-24px -24px 24px -24px',
        padding: '28px 32px 20px 32px',
        borderBottom: '3px solid #6b4fa0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ControlOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <Title level={3} style={{ margin: 0, color: '#fff' }}>Settings</Title>
        </div>
      </div>
      {preferencesContent}
    </div>
  );
}

function SettingsTabLayout({ tabItems }: { tabItems: { key: string; label: React.ReactNode; children: React.ReactNode }[] }) {
  const [activeKey, setActiveKey] = useState(tabItems[0]?.key || 'platform');

  const activeContent = useMemo(
    () => tabItems.find((t) => t.key === activeKey)?.children,
    [tabItems, activeKey],
  );

  // Tab bar items without children (rendered separately below)
  const barItems = tabItems.map(({ key, label }) => ({ key, label, children: null as unknown as React.ReactNode }));

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
        margin: '-24px -24px 0 -24px',
        padding: '28px 32px 0 32px',
        borderBottom: '3px solid #6b4fa0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ControlOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <Title level={3} style={{ margin: 0, color: '#fff' }}>Settings</Title>
        </div>
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          items={barItems}
          style={{ marginTop: 12 }}
          tabBarStyle={{ marginBottom: 0 }}
          className="dark-banner-tabs"
        />
      </div>
      <div style={{ padding: '24px 0 0 0' }}>
        {activeContent}
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
