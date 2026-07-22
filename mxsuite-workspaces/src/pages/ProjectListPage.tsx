import React, { useEffect, useState } from 'react';
import { Table, Button, Typography, Modal, Form, Input, Space, message, Card, Row, Col } from 'antd';
import { PlusOutlined, EyeOutlined, DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ViewToggle, useViewMode } from '@mxsuite/shared';
import { projectApi } from '../services/api';

const { Title, Text } = Typography;

export default function ProjectListPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewMode, setViewMode] = useViewMode('projects', 'cards');
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const { data } = await projectApi.list({ page: 0, size: 50 });
      setProjects(data.content || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProjects(); }, []);

  const handleCreate = async (values: any) => {
    await projectApi.create(values);
    message.success('Project created');
    setModalOpen(false);
    form.resetFields();
    fetchProjects();
  };

  const handleDelete = (project: any) => {
    Modal.confirm({
      title: 'Delete project?', content: 'This cannot be undone.',
      onOk: async () => { await projectApi.delete(project.id); fetchProjects(); },
    });
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', sorter: (a: any, b: any) => a.name.localeCompare(b.name) },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    { title: 'Created', dataIndex: 'createdAt', render: (d: string) => new Date(d).toLocaleDateString() },
    { title: 'Actions', render: (_: any, r: any) => (
      <Space>
        <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/workspaces/projects/${r.id}`)}>View</Button>
        <Button type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>Delete</Button>
      </Space>
    )},
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Projects</Title>
        <Space>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>New Project</Button>
        </Space>
      </div>

      {viewMode === 'table' ? (
        <Table columns={columns} dataSource={projects} loading={loading} rowKey="id" />
      ) : (
        <Row gutter={[16, 16]}>
          {projects.map((p) => (
            <Col xs={24} sm={12} lg={8} key={p.id}>
              <Card
                hoverable
                onClick={() => navigate(`/workspaces/projects/${p.id}`)}
                actions={[
                  <span key="open"><FolderOpenOutlined /> Open</span>,
                  <span key="delete" onClick={(e) => { e.stopPropagation(); handleDelete(p); }}>
                    <DeleteOutlined /> Delete
                  </span>,
                ]}
              >
                <Card.Meta
                  title={p.name}
                  description={p.description || 'No description'}
                />
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">
                    Created {new Date(p.createdAt).toLocaleDateString()}
                  </Text>
                </div>
              </Card>
            </Col>
          ))}
          {projects.length === 0 && !loading && (
            <Col span={24}>
              <Card style={{ textAlign: 'center', padding: 40 }}>
                <Text type="secondary">No projects yet. Create one to get started.</Text>
              </Card>
            </Col>
          )}
        </Row>
      )}

      <Modal title="Create Project" open={modalOpen} onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()} okText="Create">
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Project Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
