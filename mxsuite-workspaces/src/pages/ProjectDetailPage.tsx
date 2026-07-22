import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Tabs, Table, Button, Upload, message, Tag, Spin, Empty, Space, Modal, Form, Input } from 'antd';
import { ArrowLeftOutlined, UploadOutlined, FileTextOutlined, PlayCircleOutlined, DownloadOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { projectApi, assetApi, planApi } from '../services/api';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchData = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      projectApi.get(id),
      assetApi.list(id, { page: 0, size: 50 }),
      planApi.list(id, { page: 0, size: 50 }),
    ]).then(([p, a, pl]) => {
      setProject(p.data);
      setAssets(a.data.content || []);
      setPlans(pl.data.content || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [id]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!project) return <div>Project not found</div>;

  const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.json', '.xml', '.txt', '.zip'];
  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  const handleUpload = async (file: File) => {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      message.error(`File type not allowed. Accepted types: ${ALLOWED_EXTENSIONS.join(', ')}`);
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error('File size exceeds the 50 MB limit.');
      return false;
    }
    try {
      await assetApi.upload(id!, file);
      message.success('File uploaded');
      const { data } = await assetApi.list(id!, { page: 0, size: 50 });
      setAssets(data.content || []);
    } catch {
      message.error('Upload failed');
    }
    return false;
  };

  const handleDownload = async (asset: any) => {
    try {
      const response = await assetApi.download(id!, asset.id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', asset.filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('Download failed');
    }
  };

  const handleDeleteAsset = (asset: any) => {
    Modal.confirm({
      title: 'Delete file?',
      content: `Are you sure you want to delete "${asset.filename}"?`,
      onOk: async () => {
        try {
          await assetApi.delete(id!, asset.id);
          message.success('File deleted');
          const { data } = await assetApi.list(id!, { page: 0, size: 50 });
          setAssets(data.content || []);
        } catch {
          message.error('Delete failed');
        }
      },
    });
  };

  const handleCreatePlan = async (values: any) => {
    try {
      await planApi.create(id!, values);
      message.success('Plan created');
      setPlanModalOpen(false);
      form.resetFields();
      const { data } = await planApi.list(id!, { page: 0, size: 50 });
      setPlans(data.content || []);
    } catch {
      message.error('Failed to create plan');
    }
  };

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/workspaces/projects')} style={{ marginBottom: 16 }}>
        Back
      </Button>

      <Card style={{ marginBottom: 24 }}>
        <Descriptions title={project.name} bordered>
          <Descriptions.Item label="Description">{project.description || 'N/A'}</Descriptions.Item>
          <Descriptions.Item label="Created">{new Date(project.createdAt).toLocaleDateString()}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Tabs items={[
        {
          key: 'plans', label: <span><FileTextOutlined /> Plans ({plans.length})</span>,
          children: (
            <div>
              <div style={{ marginBottom: 16 }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setPlanModalOpen(true)}>
                  New Plan
                </Button>
              </div>
              {plans.length === 0 ? (
                <Empty description="No plans yet. Create one to get started." />
              ) : (
                <Table dataSource={plans} rowKey="id" columns={[
                  { title: 'Name', dataIndex: 'name' },
                  { title: 'Status', dataIndex: 'status', render: (s: string) => {
                    const color = s === 'DRAFT' ? 'default' : s === 'PUBLISHED' ? 'green' : 'orange';
                    return <Tag color={color}>{s}</Tag>;
                  }},
                  { title: 'Version', dataIndex: 'version', width: 80 },
                  { title: 'Actions', width: 120, render: (_: any, r: any) => (
                    <Button
                      type="link"
                      icon={<PlayCircleOutlined />}
                      onClick={() => navigate(`/plans/${id}/plans/${r.id}`)}
                    >
                      Open
                    </Button>
                  )},
                ]} />
              )}
            </div>
          ),
        },
        {
          key: 'assets', label: <span><UploadOutlined /> Files ({assets.length})</span>,
          children: (
            <div>
              <Upload beforeUpload={handleUpload} showUploadList={false}>
                <Button icon={<UploadOutlined />} style={{ marginBottom: 16 }}>Upload File</Button>
              </Upload>
              <Table dataSource={assets} rowKey="id" columns={[
                { title: 'Filename', dataIndex: 'filename' },
                { title: 'Type', dataIndex: 'assetType', render: (t: string) => <Tag>{t}</Tag> },
                { title: 'Size', dataIndex: 'fileSize', render: (s: number) => s ? `${(s / 1024).toFixed(1)} KB` : 'N/A' },
                { title: 'Uploaded', dataIndex: 'createdAt', render: (d: string) => new Date(d).toLocaleDateString() },
                { title: 'Actions', width: 200, render: (_: any, r: any) => (
                  <Space>
                    <Button type="link" icon={<DownloadOutlined />} onClick={() => handleDownload(r)}>Download</Button>
                    <Button type="link" danger icon={<DeleteOutlined />} onClick={() => handleDeleteAsset(r)}>Delete</Button>
                  </Space>
                )},
              ]} />
            </div>
          ),
        },
      ]} />

      <Modal title="Create Plan" open={planModalOpen} onCancel={() => setPlanModalOpen(false)}
        onOk={() => form.submit()} okText="Create">
        <Form form={form} layout="vertical" onFinish={handleCreatePlan}>
          <Form.Item name="name" label="Plan Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
