import { useMemo, useRef, useState } from 'react';
import {
  Card, Select, Typography, Button, Space, Tag, Table, Tooltip, Collapse,
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

const CUSTOM_FIELD_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];

/** Build a unique mapping key for a target field */
function fieldKey(field: TargetField): string {
  return field.entity ? `${field.entity}.${field.name}` : field.name;
}

export default function MappingStep({ onboarding, onUpdate, onNext, onBack }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const sourceColumns: SourceColumn[] = onboarding.sourceColumns || [];
  const [targetFields, setTargetFields] = useState<TargetField[]>(
    () => onboarding.targetSchema || [],
  );
  const [customFieldModalOpen, setCustomFieldModalOpen] = useState(false);
  const [customFieldForm] = Form.useForm();

  // Set of keys for fields that came from the schema (not custom-added)
  const schemaFieldKeys = useMemo(() => {
    const keys = new Set<string>();
    (onboarding.targetSchema || []).forEach((f: TargetField) => keys.add(fieldKey(f)));
    return keys;
  }, [onboarding.targetSchema]);

  // Group fields by entity
  const grouped = useMemo(() => {
    const map = new Map<string, TargetField[]>();
    targetFields.forEach((f) => {
      const entity = f.entity || 'Other';
      if (!map.has(entity)) map.set(entity, []);
      map.get(entity)!.push(f);
    });
    return map;
  }, [targetFields]);

  const entityNames = useMemo(() => Array.from(grouped.keys()), [grouped]);

  // Initialize mappings from onboarding or empty
  // Mapping key is entity.fieldName (or just fieldName for legacy)
  const [mappings, setMappings] = useState<Record<string, { sourceField: string; transformation: string }>>(
    () => {
      const map: Record<string, { sourceField: string; transformation: string }> = {};
      (onboarding.mappings || []).forEach((m: any) => {
        const key = m.targetEntity ? `${m.targetEntity}.${m.targetField}` : m.targetField;
        map[key] = { sourceField: m.sourceField, transformation: m.transformation || '' };
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
      const key = fieldKey(target);
      const targetLower = target.name.toLowerCase();
      const match = sourceColumns.find(sc => {
        const sourceLower = sc.name.toLowerCase().replace(/[_\s-]/g, '');
        return sourceLower === targetLower ||
               sourceLower.includes(targetLower) ||
               targetLower.includes(sourceLower);
      });
      if (match && !newMappings[key]?.sourceField) {
        newMappings[key] = { sourceField: match.name, transformation: '' };
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
        .map(([key, v]) => {
          const dotIdx = key.indexOf('.');
          const targetEntity = dotIdx > 0 ? key.substring(0, dotIdx) : undefined;
          const targetField = dotIdx > 0 ? key.substring(dotIdx + 1) : key;
          return {
            id: `${Date.now()}-${key}`,
            sourceField: v.sourceField,
            targetEntity,
            targetField,
            transformation: v.transformation || undefined,
          };
        });

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

  const handleAddCustomField = async (values: { entity: string; name: string; type: string; description: string; required?: boolean }) => {
    const key = values.entity ? `${values.entity}.${values.name}` : values.name;
    if (targetFields.some((f) => fieldKey(f) === key)) {
      message.error(`Field "${key}" already exists`);
      return;
    }
    const newField: TargetField = {
      entity: values.entity || undefined,
      name: values.name,
      type: values.type,
      description: values.description,
      required: !!values.required,
    };
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

  const handleDeleteCustomField = async (field: TargetField) => {
    const key = fieldKey(field);
    const updated = targetFields.filter((f) => fieldKey(f) !== key);
    setTargetFields(updated);
    // Remove mapping for deleted field
    setMappings((prev) => {
      const copy = { ...prev };
      delete copy[key];
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
      .map(([key, v]) => {
        const dotIdx = key.indexOf('.');
        return {
          targetEntity: dotIdx > 0 ? key.substring(0, dotIdx) : undefined,
          targetField: dotIdx > 0 ? key.substring(dotIdx + 1) : key,
          sourceField: v.sourceField,
          transformation: v.transformation || undefined,
        };
      });

    const exportData = {
      version: 2,
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
            const key = m.targetEntity ? `${m.targetEntity}.${m.targetField}` : m.targetField;
            // Only apply if the source column exists in current file
            const sourceExists = sourceColumns.some((sc) => sc.name === m.sourceField);
            if (sourceExists) {
              newMappings[key] = {
                sourceField: m.sourceField,
                transformation: m.transformation || '',
              };
              matched++;
            }
          }
        }

        // Import custom target fields if present
        if (data.targetSchema && Array.isArray(data.targetSchema)) {
          const existing = new Set(targetFields.map((f) => fieldKey(f)));
          const newFields = data.targetSchema.filter(
            (f: TargetField) => !existing.has(fieldKey(f)),
          );
          if (newFields.length > 0) {
            setTargetFields((prev) => [...prev, ...newFields]);
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
      .filter((f) => f.required && !mappings[fieldKey(f)]?.sourceField)
      .map((f) => f.description || f.name);
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

  const buildColumns = () => [
    {
      title: 'GrowthZone Field',
      key: 'targetField',
      width: isMobile ? 140 : 180,
      render: (_: any, record: any) => (
        <Space direction={isMobile ? 'vertical' : 'horizontal'} size={2}>
          <Text strong style={isMobile ? { fontSize: 13 } : undefined}>{record.name}</Text>
          <Space size={2}>
            {record.required && <Tag color="red">Required</Tag>}
            {!schemaFieldKeys.has(record._key) && <Tag color="orange">Custom</Tag>}
          </Space>
        </Space>
      ),
    },
    // Description — desktop only
    ...(!isMobile ? [{
      title: 'Description',
      key: 'description',
      width: 200,
      render: (_: any, record: any) => <Text style={{ color: 'rgba(0,0,0,0.65)' }}>{record.description}</Text>,
    }] : []),
    {
      title: 'Source Column',
      key: 'sourceField',
      width: isMobile ? 160 : 220,
      render: (_: any, record: any) => (
        <Select
          style={{ width: '100%' }}
          placeholder={isMobile ? 'Select...' : 'Select source column'}
          aria-label={`Source column for ${record.description || record.name}`}
          allowClear
          value={mappings[record._key]?.sourceField || undefined}
          onChange={(val) => {
            setMappings(prev => ({
              ...prev,
              [record._key]: { ...prev[record._key], sourceField: val || '', transformation: prev[record._key]?.transformation || '' },
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
        const src = sourceColumns.find((s: SourceColumn) => s.name === mappings[record._key]?.sourceField);
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
          aria-label={`Transformation for ${record.description || record.name}`}
          value={mappings[record._key]?.transformation || ''}
          onChange={(val) => {
            setMappings(prev => ({
              ...prev,
              [record._key]: { ...prev[record._key], sourceField: prev[record._key]?.sourceField || '', transformation: val },
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
        if (schemaFieldKeys.has(record._key)) return null;
        return (
          <Popconfirm
            title="Remove custom field?"
            onConfirm={() => handleDeleteCustomField(record._field)}
            okText="Remove"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        );
      },
    },
  ];

  const columns = buildColumns();

  // Build collapse items for each entity
  const collapseItems = entityNames.map((entity) => {
    const fields = grouped.get(entity)!;
    const mappedCount = fields.filter((f) => mappings[fieldKey(f)]?.sourceField).length;
    const tableData = fields.map((f) => ({
      key: fieldKey(f),
      _key: fieldKey(f),
      _field: f,
      name: f.name,
      description: f.description,
      required: f.required,
    }));

    return {
      key: entity,
      label: (
        <Space>
          <Text strong>{entity}</Text>
          <Tag>{mappedCount}/{fields.length} mapped</Tag>
        </Space>
      ),
      children: (
        <Table
          columns={columns}
          dataSource={tableData}
          pagination={false}
          size={isMobile ? 'small' : 'middle'}
          scroll={{ x: 'max-content' }}
        />
      ),
    };
  });

  // Default open: entities that have required fields or existing mappings
  const defaultActive = entityNames.filter((entity) => {
    const fields = grouped.get(entity)!;
    return fields.some((f) => f.required || mappings[fieldKey(f)]?.sourceField);
  });

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
              Map your columns to GrowthZone fields.{!isMobile && ` ${sourceColumns.length} source columns across ${entityNames.length} entities.`}
            </Text>
          </div>
          <Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => { customFieldForm.resetFields(); customFieldForm.setFieldsValue({ entity: entityNames[0] || 'Contact', type: 'string' }); setCustomFieldModalOpen(true); }}>
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

        <Collapse
          defaultActiveKey={defaultActive.length > 0 ? defaultActive : [entityNames[0]]}
          items={collapseItems}
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
            name="entity"
            label="Entity"
            rules={[{ required: true, message: 'Please select an entity' }]}
          >
            <Select
              placeholder="e.g. Contact"
              showSearch
              options={entityNames.map((e) => ({ value: e, label: e }))}
            />
          </Form.Item>
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
