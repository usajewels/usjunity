import React, { useState, useEffect, useCallback } from 'react';
import { Input, Button, List, Typography, Collapse, Form, message, Space, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { chatApi } from '../../services/chatApi';
import type { CannedResponseDto } from '../../types/chat';

const { Text } = Typography;

interface CannedResponsePanelProps {
  onSelect: (content: string) => void;
  visible: boolean;
}

export default function CannedResponsePanel({ onSelect, visible }: CannedResponsePanelProps) {
  const [responses, setResponses] = useState<CannedResponseDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    chatApi.getCannedResponses()
      .then(res => setResponses(res))
      .catch(() => message.error('Failed to load quick replies'))
      .finally(() => setLoading(false));
  }, [visible]);

  const handleCreate = useCallback(async (values: { title: string; content: string; category?: string }) => {
    try {
      const res = await chatApi.createCannedResponse({
        title: values.title,
        content: values.content,
        category: values.category || undefined,
        sortOrder: responses.length,
      });
      setResponses(prev => [...prev, res]);
      form.resetFields();
      setShowForm(false);
      message.success('Quick reply added');
    } catch {
      message.error('Failed to create quick reply');
    }
  }, [responses.length, form]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await chatApi.deleteCannedResponse(id);
      setResponses(prev => prev.filter(r => r.id !== id));
    } catch {
      message.error('Failed to delete quick reply');
    }
  }, []);

  if (!visible) return null;

  const filtered = search
    ? responses.filter(r =>
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.content.toLowerCase().includes(search.toLowerCase()) ||
        (r.category?.toLowerCase().includes(search.toLowerCase()) ?? false))
    : responses;

  // Group by category
  const categories = new Map<string, CannedResponseDto[]>();
  const uncategorized: CannedResponseDto[] = [];
  filtered.forEach(r => {
    if (r.category) {
      const list = categories.get(r.category) || [];
      list.push(r);
      categories.set(r.category, list);
    } else {
      uncategorized.push(r);
    }
  });

  return (
    <div style={{
      borderTop: '1px solid #e0d4f5',
      background: '#faf8ff',
      maxHeight: 240,
      overflowY: 'auto',
      padding: '8px 12px',
    }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <Input
          size="small"
          placeholder="Search quick replies..."
          prefix={<SearchOutlined style={{ color: '#bbb' }} />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          allowClear
          style={{ flex: 1 }}
        />
        <Button size="small" icon={<PlusOutlined />} onClick={() => setShowForm(!showForm)}>
          Add
        </Button>
      </div>

      {showForm && (
        <Form form={form} size="small" onFinish={handleCreate} layout="vertical"
          style={{ background: '#fff', padding: 8, borderRadius: 6, marginBottom: 8, border: '1px solid #e0d4f5' }}>
          <Form.Item name="title" rules={[{ required: true, message: 'Title required' }]} style={{ marginBottom: 4 }}>
            <Input placeholder="Title (e.g. Greeting)" />
          </Form.Item>
          <Form.Item name="content" rules={[{ required: true, message: 'Content required' }]} style={{ marginBottom: 4 }}>
            <Input.TextArea placeholder="Message content" rows={2} />
          </Form.Item>
          <Form.Item name="category" style={{ marginBottom: 4 }}>
            <Input placeholder="Category (optional)" />
          </Form.Item>
          <Space>
            <Button size="small" type="primary" htmlType="submit" style={{ background: '#6b4fa0', borderColor: '#6b4fa0' }}>
              Save
            </Button>
            <Button size="small" onClick={() => { setShowForm(false); form.resetFields(); }}>Cancel</Button>
          </Space>
        </Form>
      )}

      {loading ? (
        <Text style={{ color: '#8c8c8c', fontSize: 12 }}>Loading...</Text>
      ) : filtered.length === 0 ? (
        <Text style={{ color: '#8c8c8c', fontSize: 12 }}>
          {responses.length === 0 ? 'No quick replies yet. Click "Add" to create one.' : 'No matches.'}
        </Text>
      ) : (
        <>
          {categories.size > 0 && (
            <Collapse size="small" ghost
              items={[...categories.entries()].map(([cat, items]) => ({
                key: cat,
                label: <Text strong style={{ fontSize: 12 }}>{cat}</Text>,
                children: (
                  <List size="small" dataSource={items} renderItem={r => (
                    <List.Item
                      style={{ cursor: 'pointer', padding: '4px 0' }}
                      onClick={() => onSelect(r.content)}
                      actions={[
                        <Popconfirm key="del" title="Delete this reply?" onConfirm={() => handleDelete(r.id)} okText="Yes" cancelText="No">
                          <DeleteOutlined style={{ color: '#ff4d4f', fontSize: 12 }} onClick={e => e.stopPropagation()} />
                        </Popconfirm>,
                      ]}
                    >
                      <div>
                        <Text strong style={{ fontSize: 12 }}>{r.title}</Text>
                        <br />
                        <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{r.content.substring(0, 80)}{r.content.length > 80 ? '...' : ''}</Text>
                      </div>
                    </List.Item>
                  )} />
                ),
              }))}
            />
          )}
          {uncategorized.length > 0 && (
            <List size="small" dataSource={uncategorized} renderItem={r => (
              <List.Item
                style={{ cursor: 'pointer', padding: '4px 0' }}
                onClick={() => onSelect(r.content)}
                actions={[
                  <Popconfirm key="del" title="Delete this reply?" onConfirm={() => handleDelete(r.id)} okText="Yes" cancelText="No">
                    <DeleteOutlined style={{ color: '#ff4d4f', fontSize: 12 }} onClick={e => e.stopPropagation()} />
                  </Popconfirm>,
                ]}
              >
                <div>
                  <Text strong style={{ fontSize: 12 }}>{r.title}</Text>
                  <br />
                  <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{r.content.substring(0, 80)}{r.content.length > 80 ? '...' : ''}</Text>
                </div>
              </List.Item>
            )} />
          )}
        </>
      )}
    </div>
  );
}
