import { useRef, useState } from 'react';
import {
  Card, Select, Typography, Button, Space, Tag, Table, Tooltip,
  Modal, Form, Input, Switch, Popconfirm, Dropdown, Grid, message,
} from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, ThunderboltOutlined,
  PlusOutlined, DeleteOutlined, DownloadOutlined, UploadOutlined,
  EllipsisOutlined,
} from '@ant-design/icons';
import type { Onboarding, SourceColumn, TargetField } from '@mxsuite/shared';
import { onboardingApi } from '../services/api';

const { Title, Text } = Typography;

// Accessibility: override Ant Design's low-contrast placeholder color
const a11yStyles = `
  .mapping-table .ant-select-selection-placeholder { color: rgba(0,0,0,0.55) !important; }
`;

// Default MemberSuite target fields — can be customized per tenant
const DEFAULT_TARGET_FIELDS = [
  { name: 'firstName', type: 'string', required: true, description: 'First name' },
  { name: 'lastName', type: 'string', required: true, description: 'Last name' },
  { name: 'email', type: 'string', required: true, description: 'Email address' },
  { name: 'phone', type: 'string', required: false, description: 'Phone number' },
  { name: 'company', type: 'string', required: false, description: 'Company / Organization' },
  { name: 'title', type: 'string', required: false, description: 'Job title' },
  { name: 'address1', type: 'string', required: false, description: 'Street address line 1' },
  { name: 'address2', type: 'string', required: false, description: 'Street address line 2' },
  { name: 'city', type: 'string', required: false, description: 'City' },
  { name: 'state', type: 'string', required: false, description: 'State / Province' },
  { name: 'zip', type: 'string', required: false, description: 'Zip / Postal code' },
  { name: 'country', type: 'string', required: false, description: 'Country' },
  { name: 'memberType', type: 'string', required: false, description: 'Membership type' },
  { name: 'joinDate', type: 'date', required: false, description: 'Join / Start date' },
  { name: 'expirationDate', type: 'date', required: false, description: 'Expiration date' },
  { name: 'notes', type: 'string', required: false, description: 'Notes / Comments' },
];

const TRANSFORMATIONS = [
  { value: '', label: 'None (direct copy)' },
  { value: 'UPPERCASE', label: 'UPPERCASE' },
  { value: 'LOWERCASE', label: 'lowercase' },
  { value: 'TRIM', label: 'Trim whitespace' },
  { value: 'DATE_FORMAT', label: 'Parse date' },
];

interface Props {
  onboarding: Onboarding;
  onUpdate: (ob: Onboarding) => void;
  onNext: () => void;
  onBack: () => void;
}

const DEFAULT_FIELD_NAMES = new Set(DEFAULT_TARGET_FIELDS.map((f) => f.name));

const CUSTOM_FIELD_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];

export default function MappingStep({ onboarding, onUpdate, onNext, onBack }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const sourceColumns: SourceColumn[] = onboarding.sourceColumns || [];
  const [targetFields, setTargetFields] = useState<TargetField[]>(
    () => onboarding.targetSchema || DEFAULT_TARGET_FIELDS,
  );
  const [customFieldModalOpen, setCustomFieldModalOpen] = useState(false);
  const [customFieldForm] = Form.useForm();

  // Initialize mappings from onboarding or empty
  const [mappings, setMappings] = useState<Record<string, { sourceField: string; transformation: string }>>(
    () => {
      const map: Record<string, { sourceField: string; transformation: string }> = {};
      (onboarding.mappings || []).forEach((m: any) => {
        map[m.targetField] = { sourceField: m.sourceField, transformation: m.transformation || '' };
      });
      return map;
    }
  );
  const [saving, setSaving] = useState(false);

  const sourceOptions = sourceColumns.map(col => ({
    value: col.name,
    label: col.name,
  }));

  const handleAutoMap = () => {
    const newMappings = { ...mappings };
    for (const target of targetFields) {
      const targetLower = target.name.toLowerCase();
      const match = sourceColumns.find(sc => {
        const sourceLower = sc.name.toLowerCase().replace(/[_\s-]/g, '');
        return sourceLower === targetLower ||
               sourceLower.includes(targetLower) ||
               targetLower.includes(sourceLower);
      });
      if (match && !newMappings[target.name]?.sourceField) {
        newMappings[target.name] = { sourceField: match.name, transformation: '' };
      }
    }
    setMappings(newMappings);
    message.info('Auto-mapped columns by name similarity');
  };

  const saveMappings = async () => {
    setSaving(true);
    try {
      const mappingList = Object.entries(mappings)
        .filter(([, v]) => v.sourceField)
        .map(([targetField, v]) => ({
          id: `${Date.now()}-${targetField}`,
          sourceField: v.sourceField,
          targetField,
          transformation: v.transformation || undefined,
        }));

      const { data } = await onboardingApi.update(onboarding.id, {
        mappings: mappingList,
        targetSchema: targetFields as any,
      });
      onUpdate(data);
      message.success('Mappings saved');
    } catch {
      message.error('Failed to save mappings');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomField = async (values: { name: string; type: string; description: string; required?: boolean }) => {
    if (targetFields.some((f) => f.name === values.name)) {
      message.error(`Field "${values.name}" already exists`);
      return;
    }
    const newField = { name: values.name, type: values.type, description: values.description, required: !!values.required };
    const updated = [...targetFields, newField];
    setTargetFields(updated);
    setCustomFieldModalOpen(false);
    customFieldForm.resetFields();

    // Persist immediately
    try {
      await onboardingApi.update(onboarding.id, { targetSchema: updated as any });
      message.success(`Custom field "${values.name}" added`);
    } catch {
      message.error('Failed to save custom field');
    }
  };

  const handleDeleteCustomField = async (fieldName: string) => {
    const updated = targetFields.filter((f) => f.name !== fieldName);
    setTargetFields(updated);
    // Remove mapping for deleted field
    setMappings((prev) => {
      const copy = { ...prev };
      delete copy[fieldName];
      return copy;
    });
    try {
      await onboardingApi.update(onboarding.id, { targetSchema: updated as any });
      message.success('Custom field removed');
    } catch {
      message.error('Failed to remove custom field');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportMapping = () => {
    const activeMappings = Object.entries(mappings)
      .filter(([, v]) => v.sourceField)
      .map(([targetField, v]) => ({
        targetField,
        sourceField: v.sourceField,
        transformation: v.transformation || undefined,
      }));

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      targetSchema: targetFields,
      mappings: activeMappings,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapping-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('Mapping exported');
  };

  const handleImportMapping = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data.mappings || !Array.isArray(data.mappings)) {
          message.error('Invalid mapping file: missing mappings array');
          return;
        }

        // Apply imported mappings
        const newMappings: Record<string, { sourceField: string; transformation: string }> = {};
        let matched = 0;
        for (const m of data.mappings) {
          if (m.targetField && m.sourceField) {
            // Only apply if the source column exists in current file
            const sourceExists = sourceColumns.some((sc) => sc.name === m.sourceField);
            if (sourceExists) {
              newMappings[m.targetField] = {
                sourceField: m.sourceField,
                transformation: m.transformation || '',
              };
              matched++;
            }
          }
        }

        // Import custom target fields if present
        if (data.targetSchema && Array.isArray(data.targetSchema)) {
          const customFields = data.targetSchema.filter(
            (f: TargetField) => !DEFAULT_FIELD_NAMES.has(f.name),
          );
          if (customFields.length > 0) {
            const existing = new Set(targetFields.map((f) => f.name));
            const newFields = customFields.filter((f: TargetField) => !existing.has(f.name));
            if (newFields.length > 0) {
              setTargetFields((prev) => [...prev, ...newFields]);
            }
          }
        }

        setMappings(newMappings);
        message.success(`Imported ${matched} mapping${matched !== 1 ? 's' : ''} (${data.mappings.length - matched} skipped — source column not found)`);
      } catch {
        message.error('Failed to parse mapping file');
      }
    };
    reader.readAsText(file);
  };

  const getUnmappedRequired = () => {
    return targetFields
      .filter((f: any) => f.required && !mappings[f.name]?.sourceField)
      .map((f: any) => f.description || f.name);
  };

  const handleNext = async () => {
    const missing = getUnmappedRequired();
    if (missing.length > 0) {
      message.error(`Please map all required fields: ${missing.join(', ')}`);
      return;
    }
    await saveMappings();
    onNext();
  };

  const tableData = targetFields.map((field: any) => ({
    key: field.name,
    targetField: field.name,
    description: field.description,
    required: field.required,
    sourceField: mappings[field.name]?.sourceField || '',
    transformation: mappings[field.name]?.transformation || '',
  }));

  const columns = [
    {
      title: 'MemberSuite Field',
      dataIndex: 'targetField',
      key: 'targetField',
      width: isMobile ? 140 : 180,
      render: (val: string, record: any) => (
        <Space direction={isMobile ? 'vertical' : 'horizontal'} size={2}>
          <Text strong style={isMobile ? { fontSize: 13 } : undefined}>{val}</Text>
          <Space size={2}>
            {record.required && <Tag color="red">Required</Tag>}
            {!DEFAULT_FIELD_NAMES.has(val) && <Tag color="orange">Custom</Tag>}
          </Space>
        </Space>
      ),
    },
    // Description — desktop only
    ...(!isMobile ? [{
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: 200,
      render: (val: string) => <Text style={{ color: 'rgba(0,0,0,0.65)' }}>{val}</Text>,
    }] : []),
    {
      title: 'Source Column',
      dataIndex: 'sourceField',
      key: 'sourceField',
      width: isMobile ? 160 : 220,
      render: (_: any, record: any) => (
        <Select
          style={{ width: '100%' }}
          placeholder={isMobile ? 'Select...' : 'Select source column'}
          aria-label={`Source column for ${record.description || record.targetField}`}
          allowClear
          value={mappings[record.targetField]?.sourceField || undefined}
          onChange={(val) => {
            setMappings(prev => ({
              ...prev,
              [record.targetField]: { ...prev[record.targetField], sourceField: val || '', transformation: prev[record.targetField]?.transformation || '' },
            }));
          }}
          options={sourceOptions}
        />
      ),
    },
    // Sample Values — desktop only
    ...(!isMobile ? [{
      title: 'Sample Values',
      key: 'samples',
      width: 200,
      render: (_: any, record: any) => {
        const src = sourceColumns.find((s: SourceColumn) => s.name === mappings[record.targetField]?.sourceField);
        if (!src) return <Text style={{ color: 'rgba(0,0,0,0.65)' }}>—</Text>;
        return (
          <Tooltip title={src.sampleValues.join(', ')}>
            <Text ellipsis style={{ maxWidth: 180, color: 'rgba(0,0,0,0.65)' }}>
              {src.sampleValues.slice(0, 3).join(', ')}
            </Text>
          </Tooltip>
        );
      },
    }] : []),
    {
      title: 'Transform',
      key: 'transformation',
      width: isMobile ? 130 : 160,
      render: (_: any, record: any) => (
        <Select
          style={{ width: '100%' }}
          aria-label={`Transformation for ${record.description || record.targetField}`}
          value={mappings[record.targetField]?.transformation || ''}
          onChange={(val) => {
            setMappings(prev => ({
              ...prev,
              [record.targetField]: { ...prev[record.targetField], sourceField: prev[record.targetField]?.sourceField || '', transformation: val },
            }));
          }}
          options={TRANSFORMATIONS}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 48,
      render: (_: any, record: any) => {
        if (DEFAULT_FIELD_NAMES.has(record.targetField)) return null;
        return (
          <Popconfirm
            title="Remove custom field?"
            onConfirm={() => handleDeleteCustomField(record.targetField)}
            okText="Remove"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div className="mapping-table">
      <style>{a11yStyles}</style>
      <Card>
        <div style={{
          display: 'flex', flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center',
          gap: isMobile ? 12 : 0, marginBottom: 16,
        }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>Column Mapping</Title>
            <Text style={{ color: 'rgba(0,0,0,0.65)' }}>
              Map your columns to MemberSuite fields.{!isMobile && ` ${sourceColumns.length} source columns detected.`}
            </Text>
          </div>
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => { customFieldForm.resetFields(); customFieldForm.setFieldsValue({ type: 'string' }); setCustomFieldModalOpen(true); }}>
              {isMobile ? 'Custom Field' : 'Add Custom Field'}
            </Button>
            <Button icon={<ThunderboltOutlined />} onClick={handleAutoMap}>Auto-Map</Button>
            <Dropdown menu={{
              items: [
                { key: 'export', icon: <DownloadOutlined />, label: 'Export Mapping' },
                { key: 'import', icon: <UploadOutlined />, label: 'Import Mapping' },
              ],
              onClick: ({ key }) => {
                if (key === 'export') handleExportMapping();
                else if (key === 'import') fileInputRef.current?.click();
              },
            }}>
              <Button icon={<EllipsisOutlined />} />
            </Dropdown>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportMapping(file);
                e.target.value = '';
              }}
            />
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={tableData}
          pagination={false}
          size={isMobile ? 'small' : 'middle'}
          scroll={{ x: 'max-content' }}
        />

      </Card>

      <div style={{
        position: 'sticky',
        bottom: 0,
        background: '#fff',
        borderTop: '1px solid #f0f0f0',
        padding: isMobile ? '8px 12px' : '12px 24px',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? 8 : 0,
        zIndex: 10,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
      }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack} block={isMobile}>Back</Button>
        <Space wrap style={isMobile ? { justifyContent: 'flex-end' } : undefined}>
          {getUnmappedRequired().length > 0 && (
            <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>
              {getUnmappedRequired().length} required unmapped
            </Text>
          )}
          <Button onClick={saveMappings} loading={saving}>Save</Button>
          <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleNext}>
            Next
          </Button>
        </Space>
      </div>

      <Modal
        title="Add Custom Field"
        open={customFieldModalOpen}
        onCancel={() => setCustomFieldModalOpen(false)}
        onOk={() => customFieldForm.submit()}
        okText="Add Field"
      >
        <Form form={customFieldForm} layout="vertical" onFinish={handleAddCustomField} style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Field Name"
            rules={[
              { required: true, message: 'Please enter a field name' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: 'Must start with a letter; letters, numbers, underscores only' },
            ]}
          >
            <Input placeholder="e.g. membershipLevel" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={CUSTOM_FIELD_TYPES} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input placeholder="e.g. Member's subscription level" />
          </Form.Item>
          <Form.Item name="required" label="Required" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
