import { useEffect, useState } from 'react';
import {
  Button, ColorPicker, Form, Slider, Space, Spin, Typography, Card, Row, Col, Popconfirm, message,
} from 'antd';
import { SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { tenantApi } from '../services/api';

const { Text } = Typography;

interface ThemeConfig {
  colorPrimary?: string;
  colorSuccess?: string;
  colorWarning?: string;
  colorError?: string;
  borderRadius?: number;
  siderBg?: string;
  headerBg?: string;
}

const DEFAULTS: ThemeConfig = {
  colorPrimary: '#2ecda7',
  colorSuccess: '#52c41a',
  colorWarning: '#faad14',
  colorError: '#ff4d4f',
  borderRadius: 6,
  siderBg: '#1a0e3a',
  headerBg: '#ffffff',
};

interface Props {
  tenantId: string;
}

export default function ThemeConfigTab({ tenantId }: Props) {
  const [config, setConfig] = useState<ThemeConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    tenantApi.get(tenantId)
      .then(({ data }) => {
        if (data.themeConfig) {
          setConfig({ ...DEFAULTS, ...data.themeConfig });
        }
      })
      .catch(() => message.error('Failed to load theme'))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await tenantApi.update(tenantId, { themeConfig: config } as any);
      message.success('Theme saved. Users will see changes on next login.');
    } catch {
      message.error('Failed to save theme');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setConfig(DEFAULTS);
    setSaving(true);
    try {
      await tenantApi.update(tenantId, { themeConfig: DEFAULTS } as any);
      message.success('Theme reset to defaults');
    } catch {
      message.error('Failed to reset theme');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading theme..." />
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Text style={{ color: 'rgba(0,0,0,0.65)' }}>
          Customize the tenant's UI theme. Changes apply on next user login.
        </Text>
        <Space>
          <Popconfirm title="Reset to default theme?" onConfirm={handleReset} okText="Reset">
            <Button icon={<UndoOutlined />}>Reset to Defaults</Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}
          >
            Save Theme
          </Button>
        </Space>
      </div>

      <Row gutter={24}>
        <Col xs={24} md={12}>
          <Card title="Colors" size="small" style={{ marginBottom: 16 }}>
            <Form layout="vertical">
              <Form.Item label="Primary Color">
                <ColorPicker
                  value={config.colorPrimary}
                  onChange={(_, hex) => setConfig((c) => ({ ...c, colorPrimary: hex }))}
                  showText
                />
              </Form.Item>
              <Form.Item label="Sidebar Background">
                <ColorPicker
                  value={config.siderBg}
                  onChange={(_, hex) => setConfig((c) => ({ ...c, siderBg: hex }))}
                  showText
                />
              </Form.Item>
              <Form.Item label="Success Color">
                <ColorPicker
                  value={config.colorSuccess}
                  onChange={(_, hex) => setConfig((c) => ({ ...c, colorSuccess: hex }))}
                  showText
                />
              </Form.Item>
              <Form.Item label="Warning Color">
                <ColorPicker
                  value={config.colorWarning}
                  onChange={(_, hex) => setConfig((c) => ({ ...c, colorWarning: hex }))}
                  showText
                />
              </Form.Item>
              <Form.Item label="Error Color">
                <ColorPicker
                  value={config.colorError}
                  onChange={(_, hex) => setConfig((c) => ({ ...c, colorError: hex }))}
                  showText
                />
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="Layout" size="small" style={{ marginBottom: 16 }}>
            <Form layout="vertical">
              <Form.Item label={`Border Radius: ${config.borderRadius}px`}>
                <Slider
                  min={0}
                  max={16}
                  value={config.borderRadius}
                  onChange={(v) => setConfig((c) => ({ ...c, borderRadius: v }))}
                />
              </Form.Item>
            </Form>
          </Card>

          <Card title="Preview" size="small">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{
                width: 48, height: 48, borderRadius: config.borderRadius,
                background: config.colorPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10 }}>Primary</Text>
              </div>
              <div style={{
                width: 48, height: 48, borderRadius: config.borderRadius,
                background: config.siderBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10 }}>Sidebar</Text>
              </div>
              <div style={{
                width: 48, height: 48, borderRadius: config.borderRadius,
                background: config.colorSuccess, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10 }}>Success</Text>
              </div>
              <div style={{
                width: 48, height: 48, borderRadius: config.borderRadius,
                background: config.colorWarning, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10 }}>Warn</Text>
              </div>
              <div style={{
                width: 48, height: 48, borderRadius: config.borderRadius,
                background: config.colorError, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10 }}>Error</Text>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}
