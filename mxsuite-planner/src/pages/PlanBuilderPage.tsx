import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Row, Col, Typography, Button, Space, Tag, Spin, Divider, message, Modal,
  Input, Select, List, Empty, Popconfirm } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, ThunderboltOutlined, LinkOutlined,
  DeleteOutlined, PlusOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import { planApi } from '../services/api';

const { Title, Text } = Typography;

interface FieldMapping {
  id: string;
  sourceField: string;
  targetField: string;
  transformation?: string;
}

export default function PlanBuilderPage() {
  usePageTitle('Plan Builder');
  const { projectId, planId } = useParams<{ projectId: string; planId: string }>();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [newMapping, setNewMapping] = useState({ sourceField: '', targetField: '', transformation: '' });

  useEffect(() => {
    if (!projectId || !planId) return;
    planApi.get(projectId, planId)
      .then(({ data }) => {
        setPlan(data);
        setMappings(data.definition?.mappings || []);
      })
      .finally(() => setLoading(false));
  }, [projectId, planId]);

  const addMapping = () => {
    if (!newMapping.sourceField || !newMapping.targetField) {
      message.warning('Source and target fields are required');
      return;
    }
    const mapping: FieldMapping = {
      id: Date.now().toString(),
      ...newMapping,
    };
    setMappings([...mappings, mapping]);
    setNewMapping({ sourceField: '', targetField: '', transformation: '' });
  };

  const removeMapping = (id: string) => {
    setMappings(mappings.filter(m => m.id !== id));
  };

  const savePlan = async () => {
    if (!projectId || !planId) return;
    try {
      await planApi.updateDefinition(projectId, planId, { mappings });
      message.success('Plan saved');
      const { data } = await planApi.get(projectId, planId);
      setPlan(data);
    } catch {
      message.error('Failed to save');
    }
  };

  const executePlan = async (runType: string) => {
    if (!projectId || !planId) return;
    try {
      await planApi.execute(projectId, planId, runType);
      message.success(`${runType === 'DRY_RUN' ? 'Dry run' : 'Full run'} queued`);
    } catch {
      message.error('Failed to execute');
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!plan) return <div>Plan not found</div>;

  const statusColor: Record<string, string> = { DRAFT: 'default', PUBLISHED: 'green', ARCHIVED: 'orange' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/plans')}>Back</Button>
          <Title level={4} style={{ margin: 0 }}>{plan.name}</Title>
          <Tag color={statusColor[plan.status]}>{plan.status}</Tag>
          <Text type="secondary">v{plan.version}</Text>
        </Space>
        <Space>
          <Button icon={<SaveOutlined />} onClick={savePlan}>Save</Button>
          <Button onClick={() => executePlan('DRY_RUN')}>Dry Run</Button>
          <Popconfirm title="Execute full run?" onConfirm={() => executePlan('FULL_RUN')}>
            <Button type="primary" icon={<ThunderboltOutlined />}>Full Run</Button>
          </Popconfirm>
        </Space>
      </div>

      <Divider>Field Mappings</Divider>

      {/* Add mapping form */}
      <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
        <Row gutter={12} align="middle">
          <Col span={7}>
            <Input placeholder="Source field (e.g., member_name)" value={newMapping.sourceField}
              onChange={e => setNewMapping({ ...newMapping, sourceField: e.target.value })} />
          </Col>
          <Col span={1} style={{ textAlign: 'center' }}><ArrowRightOutlined /></Col>
          <Col span={7}>
            <Input placeholder="Target field (e.g., fullName)" value={newMapping.targetField}
              onChange={e => setNewMapping({ ...newMapping, targetField: e.target.value })} />
          </Col>
          <Col span={6}>
            <Input placeholder="Transformation (optional)" value={newMapping.transformation}
              onChange={e => setNewMapping({ ...newMapping, transformation: e.target.value })} />
          </Col>
          <Col span={3}>
            <Button type="primary" icon={<PlusOutlined />} onClick={addMapping} block>Add</Button>
          </Col>
        </Row>
      </Card>

      {/* Mapping list */}
      {mappings.length === 0 ? (
        <Empty description="No mappings defined. Add source → target field mappings above." />
      ) : (
        <List
          dataSource={mappings}
          renderItem={(mapping) => (
            <List.Item
              actions={[
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeMapping(mapping.id)} />,
              ]}
            >
              <List.Item.Meta
                avatar={<LinkOutlined style={{ fontSize: 20, color: '#2d1854' }} />}
                title={
                  <Space>
                    <Tag color="blue">{mapping.sourceField}</Tag>
                    <ArrowRightOutlined />
                    <Tag color="green">{mapping.targetField}</Tag>
                  </Space>
                }
                description={mapping.transformation ? `Transform: ${mapping.transformation}` : 'Direct mapping'}
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
