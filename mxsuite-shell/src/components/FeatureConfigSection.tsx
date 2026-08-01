import { useEffect, useState } from 'react';
import {
  Button, Checkbox, Space, Spin, Typography, Card, Popconfirm, message, Table,
} from 'antd';
import { SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { platformApi } from '../services/platformApi';

const { Text } = Typography;

const ROLES = ['PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT', 'TENANT_ADMIN', 'TENANT_USER'] as const;
const FEATURES = ['onboarding', 'projects', 'migration', 'my-onboarding', 'chat-files'] as const;

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  COACH_ADMIN: 'Coach Admin',
  PLATFORM_SUPPORT: 'Onboarding Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

type FeatureConfig = Record<string, string[]>;

const DEFAULTS: FeatureConfig = {
  PLATFORM_ADMIN: ['projects', 'migration', 'chat-files'],
  COACH_ADMIN: ['projects', 'migration', 'chat-files'],
  PLATFORM_SUPPORT: ['projects', 'migration', 'chat-files'],
  TENANT_ADMIN: ['my-onboarding', 'chat-files'],
  TENANT_USER: ['my-onboarding', 'chat-files'],
};

interface Props {
  tenantId: string;
}

export default function FeatureConfigSection({ tenantId }: Props) {
  const [config, setConfig] = useState<FeatureConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    platformApi.getTenant(tenantId)
      .then(({ data }) => {
        if (data.featureConfig) {
          const merged: FeatureConfig = {};
          for (const role of ROLES) {
            merged[role] = (data.featureConfig as FeatureConfig)[role] || DEFAULTS[role] || [];
          }
          setConfig(merged);
        }
      })
      .catch(() => message.error('Failed to load feature configuration'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const handleToggle = (role: string, feature: string, checked: boolean) => {
    setConfig(prev => {
      const current = prev[role] || [];
      const updated = checked
        ? [...current, feature]
        : current.filter(f => f !== feature);
      return { ...prev, [role]: updated };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await platformApi.updateTenant(tenantId, { featureConfig: config });
      message.success('Feature visibility saved. Users will see changes on next login.');
      localStorage.setItem('mxsuite_feature_config', JSON.stringify(config));
      window.dispatchEvent(new CustomEvent('feature-config-updated'));
    } catch {
      message.error('Failed to save feature configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setConfig(DEFAULTS);
    setSaving(true);
    try {
      await platformApi.updateTenant(tenantId, { featureConfig: DEFAULTS });
      message.success('Feature visibility reset to defaults');
      localStorage.setItem('mxsuite_feature_config', JSON.stringify(DEFAULTS));
      window.dispatchEvent(new CustomEvent('feature-config-updated'));
    } catch {
      message.error('Failed to reset feature configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading feature configuration..." />
      </div>
    );
  }

  const columns = [
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => <Text strong>{ROLE_LABELS[role] || role}</Text>,
    },
    ...FEATURES.map(feature => ({
      title: feature.charAt(0).toUpperCase() + feature.slice(1),
      dataIndex: feature,
      key: feature,
      align: 'center' as const,
      render: (_: unknown, record: { role: string }) => (
        <Checkbox
          checked={(config[record.role] || []).includes(feature)}
          onChange={e => handleToggle(record.role, feature, e.target.checked)}
        />
      ),
    })),
  ];

  const dataSource = ROLES.map(role => ({ key: role, role }));

  return (
    <>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
        Control which features are visible for each role. Changes apply on next user login.
      </Text>

      <Table
        columns={columns}
        dataSource={dataSource}
        pagination={false}
        size="middle"
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Popconfirm title="Reset to default feature visibility?" onConfirm={handleReset} okText="Reset">
          <Button icon={<UndoOutlined />}>Reset to Defaults</Button>
        </Popconfirm>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          style={{ background: '#2d1854', borderColor: '#2d1854' }}
        >
          Save Features
        </Button>
      </div>
    </>
  );
}
