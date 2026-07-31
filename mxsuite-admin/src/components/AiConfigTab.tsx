import { useEffect, useState } from 'react';
import {
  Button, Card, Input, Modal, Select, Space, Spin, Table, Tag, Typography, Popconfirm, message,
} from 'antd';
import {
  SaveOutlined, UndoOutlined, CheckCircleOutlined, CloseCircleOutlined,
  KeyOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { tenantApi, aiConfigApi, type AiProviderInfo } from '../services/api';

const { Text } = Typography;

const TASKS = [
  { key: 'mapping', label: 'Field Mapping & Auto-Map', description: 'AI-powered source\u2192target field mapping (upload + Auto-Map button)' },
  { key: 'decisions', label: 'Decision Generation', description: 'Auto-generate decisions from validation results' },
  { key: 'entity-detection', label: 'Entity Detection', description: 'Detect relevant entities from uploaded data' },
  { key: 'chat', label: 'Chat', description: 'AI chat assistant for coaches and members' },
];

const KEY_SOURCE_TAG: Record<string, { color: string; label: string }> = {
  db: { color: 'purple', label: 'DB Key' },
  env: { color: 'blue', label: 'ENV Key' },
  none: { color: 'red', label: 'No Key' },
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Props {
  tenantId: string;
}

export default function AiConfigTab({ tenantId }: Props) {
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Key modal state
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [keyModalProvider, setKeyModalProvider] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [settingKey, setSettingKey] = useState(false);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const { data } = await aiConfigApi.getStatus();
      setProviders(data.providers);
      setAssignments(data.taskAssignments);
      setDefaults(data.yamlDefaults);
    } catch {
      message.error('Failed to load AI configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const availableProviders = providers.filter(p => p.available);
  const providerOptions = availableProviders.map(p => ({
    value: p.name,
    label: capitalize(p.name),
  }));

  const handleTaskChange = (task: string, provider: string) => {
    setAssignments(prev => ({ ...prev, [task]: provider }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await tenantApi.update(tenantId, { aiConfig: { tasks: assignments } });
      message.success('AI provider assignments saved. Changes take effect immediately.');
    } catch {
      message.error('Failed to save AI configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await tenantApi.update(tenantId, { aiConfig: {} });
      setAssignments({ ...defaults });
      message.success('AI provider assignments reset to defaults');
    } catch {
      message.error('Failed to reset AI configuration');
    } finally {
      setSaving(false);
    }
  };

  const openKeyModal = (providerName: string) => {
    setKeyModalProvider(providerName);
    setKeyValue('');
    setKeyModalOpen(true);
  };

  const handleSetKey = async () => {
    if (!keyValue.trim()) return;
    setSettingKey(true);
    try {
      await aiConfigApi.setKey(keyModalProvider, keyValue.trim());
      message.success(`API key saved for ${capitalize(keyModalProvider)}. Provider is now active.`);
      setKeyModalOpen(false);
      setKeyValue('');
      await loadStatus();
    } catch {
      message.error('Failed to save API key');
    } finally {
      setSettingKey(false);
    }
  };

  const handleRemoveKey = async (providerName: string) => {
    try {
      await aiConfigApi.removeKey(providerName);
      message.success(`DB key removed for ${capitalize(providerName)}. Reverted to environment variable.`);
      await loadStatus();
    } catch {
      message.error('Failed to remove API key');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading AI configuration..." />
      </div>
    );
  }

  const taskColumns = [
    {
      title: 'Task',
      dataIndex: 'label',
      key: 'label',
      render: (label: string, record: typeof TASKS[number]) => (
        <div>
          <Text strong>{label}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>{record.description}</Text>
        </div>
      ),
    },
    {
      title: 'Provider',
      dataIndex: 'key',
      key: 'provider',
      width: 200,
      render: (task: string) => (
        <Select
          value={assignments[task]}
          options={providerOptions}
          onChange={(value) => handleTaskChange(task, value)}
          style={{ width: '100%' }}
          placeholder="Select provider"
        />
      ),
    },
    {
      title: 'Default',
      dataIndex: 'key',
      key: 'default',
      width: 120,
      render: (task: string) => {
        const def = defaults[task];
        return def ? (
          <Text type="secondary" style={{ fontSize: 12 }}>{capitalize(def)}</Text>
        ) : <Text type="secondary" style={{ fontSize: 12 }}>&mdash;</Text>;
      },
    },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Text style={{ color: 'rgba(0,0,0,0.65)' }}>
          Configure which AI provider handles each task. Changes take effect immediately.
        </Text>
        <Space>
          <Popconfirm title="Reset to YAML default assignments?" onConfirm={handleReset} okText="Reset">
            <Button icon={<UndoOutlined />}>Reset to Defaults</Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={saving}
            style={{ background: '#2d1854', borderColor: '#2d1854', color: '#fff' }}
          >
            Save Assignments
          </Button>
        </Space>
      </div>

      {/* Provider cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        {providers.map(p => {
          const source = KEY_SOURCE_TAG[p.keySource] || KEY_SOURCE_TAG.none;
          return (
            <Card
              key={p.name}
              size="small"
              style={{
                minWidth: 220,
                borderColor: p.available ? '#b7eb8f' : '#ffa39e',
                background: p.available ? '#f6ffed' : '#fff2f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                {p.available
                  ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                }
                <Text strong>{capitalize(p.name)}</Text>
                <Tag color={source.color} style={{ marginLeft: 'auto' }}>
                  {source.label}
                </Tag>
              </div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {p.model || 'No model configured'}
              </Text>
              <Space size={4}>
                <Button
                  size="small"
                  icon={<KeyOutlined />}
                  onClick={() => openKeyModal(p.name)}
                >
                  {p.keySource === 'none' ? 'Set Key' : 'Update Key'}
                </Button>
                {p.keySource === 'db' && (
                  <Popconfirm
                    title="Remove DB key and revert to environment variable?"
                    onConfirm={() => handleRemoveKey(p.name)}
                    okText="Remove"
                  >
                    <Button size="small" icon={<DeleteOutlined />} danger>
                      Remove
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </Card>
          );
        })}
      </div>

      {/* Task assignment table */}
      <Card size="small">
        <Table
          columns={taskColumns}
          dataSource={TASKS.map(t => ({ ...t, key: t.key }))}
          pagination={false}
          size="middle"
        />
      </Card>

      {/* Set API Key Modal */}
      <Modal
        title={`Set API Key \u2014 ${capitalize(keyModalProvider)}`}
        open={keyModalOpen}
        onCancel={() => { setKeyModalOpen(false); setKeyValue(''); }}
        onOk={handleSetKey}
        okText="Save Key"
        confirmLoading={settingKey}
        okButtonProps={{
          disabled: !keyValue.trim(),
          icon: <KeyOutlined />,
        }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          The key will be encrypted (AES-256) before storage. It will never be displayed again.
        </Text>
        <Input.Password
          placeholder="sk-... or paste your API key"
          value={keyValue}
          onChange={e => setKeyValue(e.target.value)}
          size="large"
          autoFocus
        />
      </Modal>
    </>
  );
}
