import { useEffect, useMemo, useState } from 'react';
import {
  Button, Checkbox, Collapse, Space, Tag, Popconfirm, Spin, Typography, message,
  Modal, Form, Input, Select, Switch, Row, Col,
} from 'antd';
import {
  PlusOutlined, UndoOutlined, ApartmentOutlined,
  CheckCircleOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import { onboardingSchemaApi, type TargetField } from '../services/api';

const { Text } = Typography;

const TYPE_OPTIONS = [
  { value: 'string', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
];

interface Props {
  tenantId: string;
}

export default function OnboardingSchemaTab({ tenantId }: Props) {
  const [defaultFields, setDefaultFields] = useState<TargetField[]>([]);
  const [enabledKeys, setEnabledKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasCustomSchema, setHasCustomSchema] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fieldKey = (f: TargetField) => `${f.entity || 'Other'}.${f.name}`;

  // Load both default schema and tenant's custom schema
  const fetchData = async () => {
    setLoading(true);
    try {
      const [v2Res, tenantRes] = await Promise.all([
        onboardingSchemaApi.getSchemaV2(tenantId),
        onboardingSchemaApi.getSchema(tenantId),
      ]);

      const allFields = flattenV2Schema(v2Res.data);
      setDefaultFields(allFields);

      const tenantSchema: TargetField[] = tenantRes.data.targetSchema || [];
      if (tenantSchema.length > 0 && tenantSchema.length !== allFields.length) {
        // Tenant has a custom schema — mark only those fields as enabled
        setHasCustomSchema(true);
        const tenantKeys = new Set(tenantSchema.map(fieldKey));
        setEnabledKeys(tenantKeys);
      } else {
        // No custom schema — all fields enabled
        setHasCustomSchema(tenantSchema.length > 0);
        setEnabledKeys(new Set(allFields.map(fieldKey)));
      }
    } catch {
      message.error('Failed to load schema');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [tenantId]);

  // Save enabled fields to the tenant's onboarding
  const saveSchema = async (keys: Set<string>) => {
    setSaving(true);
    try {
      const enabled = defaultFields.filter((f) => keys.has(fieldKey(f)));
      await onboardingSchemaApi.updateSchema(tenantId, enabled);
      setEnabledKeys(keys);
      setHasCustomSchema(true);
      message.success(`Schema saved — ${enabled.length} fields enabled`);
    } catch {
      message.error('Failed to save schema');
    } finally {
      setSaving(false);
    }
  };

  // Toggle a single field
  const toggleField = (key: string, checked: boolean) => {
    const next = new Set(enabledKeys);
    if (checked) next.add(key); else next.delete(key);
    setEnabledKeys(next);
  };

  // Toggle all fields in an entity
  const toggleEntity = (entity: string, checked: boolean) => {
    const next = new Set(enabledKeys);
    const entityFields = defaultFields.filter((f) => (f.entity || 'Other') === entity);
    for (const f of entityFields) {
      const k = fieldKey(f);
      if (checked) next.add(k); else if (!f.required) next.delete(k);
    }
    setEnabledKeys(next);
  };

  // Reset to all fields enabled
  const handleReset = async () => {
    const allKeys = new Set(defaultFields.map(fieldKey));
    await saveSchema(allKeys);
  };

  // Add custom field
  const handleAddField = async (values: TargetField) => {
    const key = fieldKey(values);
    if (defaultFields.some((f) => fieldKey(f) === key)) {
      message.error(`Field "${values.entity}.${values.name}" already exists`);
      return;
    }
    const updated = [...defaultFields, values];
    setDefaultFields(updated);
    const next = new Set(enabledKeys);
    next.add(key);
    setEnabledKeys(next);

    // Save with new field included
    setSaving(true);
    try {
      const enabled = updated.filter((f) => next.has(fieldKey(f)));
      await onboardingSchemaApi.updateSchema(tenantId, enabled);
      setHasCustomSchema(true);
      message.success(`Added "${values.name}" to ${values.entity}`);
    } catch {
      message.error('Failed to save');
    } finally {
      setSaving(false);
    }
    setModalOpen(false);
  };

  // Check if current state differs from saved
  const isDirty = useMemo(() => {
    // We track dirty state by comparing current enabledKeys count vs what was loaded
    // but the simplest approach: just show the save button always
    return true;
  }, [enabledKeys]);

  // Group fields by entity
  const grouped = useMemo(() => {
    const map = new Map<string, TargetField[]>();
    for (const f of defaultFields) {
      const entity = f.entity || 'Other';
      if (!map.has(entity)) map.set(entity, []);
      map.get(entity)!.push(f);
    }
    return map;
  }, [defaultFields]);

  const entityNames = useMemo(() => Array.from(grouped.keys()), [grouped]);

  const totalEnabled = enabledKeys.size;
  const totalFields = defaultFields.length;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin tip="Loading schema..." />
      </div>
    );
  }

  const collapseItems = entityNames.map((entity) => {
    const entityFields = grouped.get(entity)!;
    const enabledCount = entityFields.filter((f) => enabledKeys.has(fieldKey(f))).length;
    const requiredCount = entityFields.filter((f) => f.required).length;
    const allChecked = enabledCount === entityFields.length;
    const someChecked = enabledCount > 0 && !allChecked;

    return {
      key: entity,
      label: (
        <Row align="middle" style={{ width: '100%' }} onClick={(e) => e.stopPropagation()}>
          <Col>
            <Space size={8}>
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={(e) => { e.stopPropagation(); toggleEntity(entity, e.target.checked); }}
              />
              <ApartmentOutlined style={{ color: '#6b4fa0' }} />
              <Text strong style={{ color: '#2d1854' }}>{entity}</Text>
              <Tag style={{ background: '#e0d4f5', color: '#2d1854', border: 'none', fontSize: 11 }}>
                {enabledCount} / {entityFields.length} enabled
              </Tag>
              {requiredCount > 0 && (
                <Tag style={{ background: '#fff1f0', color: '#d32029', border: 'none', fontSize: 11 }}>
                  {requiredCount} required
                </Tag>
              )}
            </Space>
          </Col>
        </Row>
      ),
      children: (
        <div style={{ padding: '4px 0 4px 28px' }}>
          {entityFields.map((f) => {
            const key = fieldKey(f);
            const checked = enabledKeys.has(key);
            return (
              <div
                key={key}
                style={{
                  padding: '6px 8px',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  opacity: checked ? 1 : 0.5,
                }}
              >
                <Checkbox
                  checked={checked}
                  disabled={f.required}
                  onChange={(e) => toggleField(key, e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <Space size={4}>
                    <Text strong style={{ fontSize: 13 }}>{f.name}</Text>
                    <Tag style={{ fontSize: 10 }}>{f.type}</Tag>
                    {f.required && <Tag color="red" style={{ fontSize: 10 }}>Required</Tag>}
                  </Space>
                  {f.description && (
                    <div>
                      <Text style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{f.description}</Text>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ),
    };
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Text style={{ color: 'rgba(0,0,0,0.65)' }}>
            {totalEnabled} / {totalFields} fields enabled across {entityNames.length} entities.
          </Text>
          {hasCustomSchema ? (
            <Tag icon={<CheckCircleOutlined />} color="purple">Custom schema</Tag>
          ) : (
            <Tag icon={<MinusCircleOutlined />} color="default">Using defaults</Tag>
          )}
        </Space>
        <Space>
          <Popconfirm
            title="Reset to all fields?"
            description="This will enable all fields from the GrowthZone schema."
            onConfirm={handleReset}
            okText="Reset"
          >
            <Button icon={<UndoOutlined />} loading={saving}>Reset to All</Button>
          </Popconfirm>
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ entity: entityNames[0] || 'Contact', type: 'string', required: false });
              setModalOpen(true);
            }}
            style={{ borderColor: '#2d1854', color: '#2d1854' }}
          >
            Add Custom Field
          </Button>
          <Button
            type="primary"
            loading={saving}
            onClick={() => saveSchema(enabledKeys)}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}
          >
            Save Schema
          </Button>
        </Space>
      </div>

      <Collapse
        defaultActiveKey={entityNames.slice(0, 2)}
        items={collapseItems}
      />

      <Modal
        title="Add Custom Field"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText="Add"
        confirmLoading={saving}
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
      >
        <Form form={form} layout="vertical" onFinish={handleAddField} style={{ marginTop: 16 }}>
          <Form.Item
            name="entity"
            label="Entity"
            rules={[{ required: true, message: 'Select an entity' }]}
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
              { required: true, message: 'Enter a field name' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: 'Must start with a letter; letters, numbers, underscores only' },
            ]}
          >
            <Input placeholder="e.g. customMemberLevel" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="required" label="Required" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description"
            rules={[{ required: true, message: 'Enter a description' }]}
          >
            <Input placeholder="e.g. Custom membership level field" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/**
 * Flatten the v2 hierarchical schema into a flat array of TargetField objects.
 */
function flattenV2Schema(schema: Record<string, unknown>): TargetField[] {
  const result: TargetField[] = [];
  const entities = schema.entities as Record<string, any> | undefined;
  if (!entities) return result;

  for (const [entityName, entityDef] of Object.entries(entities)) {
    flattenEntity(entityName, entityDef, result);
  }
  return result;
}

function flattenEntity(entityName: string, entityDef: any, result: TargetField[]) {
  const refs = entityDef.references as Record<string, any> | undefined;
  if (refs) {
    for (const [refName, refDef] of Object.entries(refs)) {
      result.push({
        entity: entityName,
        name: refName,
        type: 'string',
        required: !!refDef.required,
        description: refDef.description || `Reference to ${refDef.entity}`,
      });
    }
  }

  const fields = entityDef.fields as Record<string, any> | undefined;
  if (fields) {
    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      result.push({
        entity: entityName,
        name: fieldName,
        type: fieldDef.type || 'string',
        required: !!fieldDef.required,
        description: fieldDef.description || '',
      });
    }
  }

  const children = entityDef.children as Record<string, any> | undefined;
  if (children) {
    for (const [childName, childDef] of Object.entries(children)) {
      const parentKey = childDef.parentKey as string | undefined;
      if (parentKey) {
        result.push({
          entity: childName,
          name: parentKey,
          type: 'string',
          required: true,
          description: `Source ID of the parent ${entityName.toLowerCase()}`,
        });
      }
      flattenEntity(childName, childDef, result);
    }
  }
}
