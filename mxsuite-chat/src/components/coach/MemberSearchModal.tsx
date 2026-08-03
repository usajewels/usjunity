import React, { useState, useCallback, useRef } from 'react';
import { Modal, Input, List, Avatar, Typography, Spin, Empty } from 'antd';
import { SearchOutlined, UserOutlined } from '@ant-design/icons';
import { apiClient } from '@mxsuite/shared';

const { Text } = Typography;

interface MemberUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  active: boolean;
}

interface MemberSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (memberId: string) => void;
}

export default function MemberSearchModal({ open, onClose, onSelect }: MemberSearchModalProps) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<MemberUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    apiClient.get<{ content: MemberUser[] }>(
      `/admin/users?search=${encodeURIComponent(query.trim())}&size=20&sort=lastName,asc`
    ).then((page) => {
      setResults((page.content || []).filter(u => u.active));
    }).catch(() => {
      setResults([]);
    }).finally(() => setLoading(false));
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }, [doSearch]);

  const handleClose = useCallback(() => {
    setSearch('');
    setResults([]);
    setSearched(false);
    onClose();
  }, [onClose]);

  const handleSelect = useCallback((memberId: string) => {
    onSelect(memberId);
    setSearch('');
    setResults([]);
    setSearched(false);
  }, [onSelect]);

  return (
    <Modal
      open={open}
      title="Start a Conversation"
      onCancel={handleClose}
      footer={null}
      width={480}
      destroyOnClose
    >
      <Input
        prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
        placeholder="Search members by name or email..."
        value={search}
        onChange={handleSearchChange}
        autoFocus
        allowClear
        style={{ marginBottom: 16 }}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : results.length > 0 ? (
        <List
          dataSource={results}
          style={{ maxHeight: 360, overflowY: 'auto' }}
          renderItem={(member) => (
            <List.Item
              key={member.id}
              onClick={() => handleSelect(member.id)}
              style={{
                cursor: 'pointer',
                padding: '10px 12px',
                borderRadius: 6,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f3eeff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <List.Item.Meta
                avatar={
                  member.avatarUrl
                    ? <Avatar src={member.avatarUrl} />
                    : <Avatar icon={<UserOutlined />} style={{ background: '#6b4fa0' }} />
                }
                title={
                  <Text strong>
                    {member.firstName} {member.lastName}
                  </Text>
                }
                description={
                  <Text style={{ fontSize: 12, color: '#8c8c8c' }}>
                    {member.email}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      ) : searched ? (
        <Empty description="No members found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: '#8c8c8c' }}>
          <UserOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
          <Text type="secondary">Type a name or email to search</Text>
        </div>
      )}
    </Modal>
  );
}
