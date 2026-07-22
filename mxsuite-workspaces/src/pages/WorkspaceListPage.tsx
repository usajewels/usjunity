import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Button, Typography, Modal, Form, Input, Empty, Space, Tag, Table, Popconfirm, message } from 'antd';
import { PlusOutlined, FolderOpenOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ViewToggle, useViewMode } from '@mxsuite/shared';
import { workspaceApi } from '../services/api';

const { Title, Text } = Typography;

export default function WorkspaceListPage() {
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<any>(null);
  const [viewMode, setViewMode] = useViewMode('workspaces', 'cards');
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();

  const fetchWorkspaces = async () => {
    setLoading(true);
    try {
      const { data } = await workspaceApi.list({ page: 0, size: 50 });
      setWorkspaces(data.content || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWorkspaces(); }, []);

  const handleCreate = async (values: any) => {
    await workspaceApi.create(values);
    setModalOpen(false);
    form.resetFields();
    fetchWorkspaces();
  };

  const handleEdit = (ws: any) => {
    setEditingWorkspace(ws);
    editForm.setFieldsValue({ name: ws.name, description: ws.description || '' });
  };

  const handleUpdate = async (values: any) => {
    try {
      await workspaceApi.update(editingWorkspace.id, values);
      message.success('Workspace updated');
      setEditingWorkspace(null);
      editForm.resetFields();
      fetchWorkspaces();
    } catch {
      message.error('Failed to update workspace');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await workspaceApi.delete(id);
      message.success('Workspace deleted');
      fetchWorkspaces();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        message.error('Cannot delete workspace that has projects');
      } else {
        message.error('Failed to delete workspace');
      }
    }
  };

  const tableColumns = [
    { title: 'Name', dataIndex: 'name', sorter: (a: any, b: any) => a.name.localeCompare(b.name) },
    { title: 'Description', dataIndex: 'description', ellipsis: true, render: (d: string) => d || 'No description' },
    { title: 'Projects', dataIndex: 'projects', render: (_: any, r: any) => r.projects?.length || 0, width: 100 },
    { title: '', dataIndex: 'crossTenant', render: (ct: boolean) => ct ? <Tag color="blue">Cross-Tenant</Tag> : null, width: 120 },
    {
      title: 'Actions', width: 160, render: (_: any, record: any) => (
        <Space>
          <Button type="link" size="small" icon={<FolderOpenOutlined />}>Open</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm title="Delete workspace?" description="This cannot be undone." onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Workspaces</Title>
        <Space>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            New Workspace
          </Button>
        </Space>
      </div>

      {workspaces.length === 0 && !loading ? (
        <Empty description="No workspaces yet. Create one to organize your projects." />
      ) : viewMode === 'cards' ? (
        <Row gutter={[16, 16]}>
          {workspaces.map((ws) => (
            <Col xs={24} sm={12} lg={8} key={ws.id}>
              <Card hoverable
                actions={[
                  <span key="open"><FolderOpenOutlined /> Open</span>,
                  <span key="edit" onClick={() => handleEdit(ws)}><EditOutlined /> Edit</span>,
                  <Popconfirm key="delete" title="Delete workspace?" description="This cannot be undone." onConfirm={() => handleDelete(ws.id)}>
                    <span><DeleteOutlined /> Delete</span>
                  </Popconfirm>,
                ]}
              >
                <Card.Meta
                  title={<Space>{ws.name}{ws.crossTenant && <Tag color="blue">Cross-Tenant</Tag>}</Space>}
                  description={ws.description || 'No description'}
                />
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary">{ws.projects?.length || 0} projects</Text>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Table dataSource={workspaces} columns={tableColumns} rowKey="id" loading={loading} />
      )}

      {/* Create Modal */}
      <Modal title="Create Workspace" open={modalOpen} onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()} okText="Create">
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Workspace Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal title="Edit Workspace" open={editingWorkspace !== null} onCancel={() => setEditingWorkspace(null)}
        onOk={() => editForm.submit()} okText="Save">
        <Form form={editForm} layout="vertical" onFinish={handleUpdate}>
          <Form.Item name="name" label="Workspace Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
