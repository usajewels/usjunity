import { useEffect, useState } from 'react';
import {
  Button, Checkbox, Space, Spin, Typography, Card, Popconfirm, message, Table,
} from 'antd';
import { SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { tenantApi } from '../services/api';

const { Text } = Typography;

const ROLES = ['PLATFORM_ADMIN', 'COACH_ADMIN', 'PLATFORM_SUPPORT', 'TENANT_ADMIN', 'TENANT_USER'] as const;
const FEATURES = ['onboarding', 'projects', 'migration', 'my-onboarding'] as const;

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: 'Platform Admin',
  COACH_ADMIN: 'Coach Admin',
  PLATFORM_SUPPORT: 'Onboarding Coach',
  TENANT_ADMIN: 'Member Admin',
  TENANT_USER: 'Member',
};

type FeatureConfig = Record<string, string[]>;

const DEFAULTS: FeatureConfig = {
  PLATFORM_ADMIN: ['projects', 'migration'],
  COACH_ADMIN: ['projects', 'migration'],
  PLATFORM_SUPPORT: ['projects', 'migration'],
  TENANT_ADMIN: ['my-onboarding'],
  TENANT_USER: ['my-onboarding'],
};

interface Props {
  tenantId: string;
}

export default function FeatureConfigTab({ tenantId }: Props) {
  const [config, setConfig] = useState<FeatureConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    tenantApi.get(tenantId)
      .then(({ data }) => {
        if (data.featureConfig) {
          // Merge with defaults to ensure all roles exist
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
      await tenantApi.update(tenantId, { featureConfig: config });
      message.success('Feature visibility saved. Users will see changes on next login.');
      // Notify shell to refresh feature config
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
      await tenantApi.update(tenantId, { featureConfig: DEFAULTS });
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Text style={{ color: 'rgba(0,0,0,0.65)' }}>
          Control which features are visible for each role. Changes apply on next user login.
        </Text>
        <Space>
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
        </Space>
      </div>

      <Card size="small">
        <Table
          columns={columns}
          dataSource={dataSource}
          pagination={false}
          size="middle"
        />
      </Card>
    </>
  );
}
