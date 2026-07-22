import React, { useEffect, useState } from 'react';
import { Table, Button, Typography, Tag, Select, Space, Modal, Form, Input, message } from 'antd';
import { PlusOutlined, EditOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@mxsuite/shared';
import { planApi, projectApi } from '../services/api';

const { Title } = Typography;

export default function PlanListPage() {
  usePageTitle('Plans');
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  useEffect(() => {
    projectApi.list({ page: 0, size: 100 }).then(({ data }) => {
      const list = data.content || [];
      setProjects(list);
      if (list.length > 0) setSelectedProject(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    setLoading(true);
    planApi.listByProject(selectedProject, { page: 0, size: 50 })
      .then(({ data }) => setPlans(data.content || []))
      .finally(() => setLoading(false));
  }, [selectedProject]);

  const handleCreate = async (values: any) => {
    if (!selectedProject) return;
    await planApi.create(selectedProject, values);
    message.success('Plan created');
    setModalOpen(false);
    form.resetFields();
    const { data } = await planApi.listByProject(selectedProject, { page: 0, size: 50 });
    setPlans(data.content || []);
  };

  const statusColor: Record<string, string> = { DRAFT: 'default', PUBLISHED: 'green', ARCHIVED: 'orange' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>Plans</Title>
          <Select value={selectedProject} onChange={setSelectedProject} style={{ width: 300 }}
            placeholder="Select project" options={projects.map((p: any) => ({ value: p.id, label: p.name }))} />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)} disabled={!selectedProject}>
          New Plan
        </Button>
      </div>

      <Table columns={[
        { title: 'Name', dataIndex: 'name' },
        { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={statusColor[s]}>{s}</Tag> },
        { title: 'Version', dataIndex: 'version' },
        { title: 'Created', dataIndex: 'createdAt', render: (d: string) => new Date(d).toLocaleDateString() },
        { title: 'Actions', render: (_: any, r: any) => (
          <Space>
            <Button type="link" icon={<EditOutlined />} onClick={() => navigate(`/plans/${selectedProject}/plans/${r.id}`)}>Builder</Button>
            <Button type="link" icon={<PlayCircleOutlined />} onClick={() => navigate(`/plans/${selectedProject}/plans/${r.id}/runs`)}>Runs</Button>
          </Space>
        )},
      ]} dataSource={plans} loading={loading} rowKey="id" />

      <Modal title="Create Plan" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} okText="Create">
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Plan Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
