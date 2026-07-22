import React, { useEffect, useState } from 'react';
import { Layout, Menu, List, Avatar, Badge, Typography, Button, Input, Divider, ConfigProvider } from 'antd';
import { MessageOutlined, RobotOutlined, PlusOutlined, SearchOutlined, TeamOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ChatView } from '../ChatApp';

const { Sider } = Layout;
const { Text } = Typography;

interface ChatSidebarProps {
  activeView: ChatView;
  onViewChange: (view: ChatView) => void;
  activeConversation: string | null;
  onConversationSelect: (id: string | null) => void;
}

interface Conversation {
  id: string;
  name: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  isGroup: boolean;
}

export default function ChatSidebar({ activeView, onViewChange, activeConversation, onConversationSelect }: ChatSidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: '1', name: 'Support Team', lastMessage: 'Welcome to MemberSuite!', timestamp: 'Just now', unread: 1, isGroup: true },
  ]);
  const [search, setSearch] = useState('');

  return (
    <Sider width={300} style={{ background: '#fff', borderRight: '1px solid #e0d4f5' }}>
      <div style={{ padding: '16px' }}>
        <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
          <Menu
            mode="horizontal"
            selectedKeys={[activeView]}
            onClick={({ key }) => onViewChange(key as ChatView)}
            style={{ marginBottom: 12 }}
            items={[
              { key: 'conversations', icon: <MessageOutlined />, label: 'Chats' },
              { key: 'ai-assistant', icon: <RobotOutlined />, label: 'AI Assistant' },
            ]}
          />
        </ConfigProvider>

        {activeView === 'conversations' && (
          <>
            <Input prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />} placeholder="Search conversations..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ marginBottom: 12 }} />
            <Button type="dashed" icon={<PlusOutlined />} block style={{ marginBottom: 12, borderColor: '#2d1854', color: '#2d1854' }}
              onClick={() => {
                const id = Date.now().toString();
                const conv: Conversation = { id, name: `Conversation ${conversations.length + 1}`, lastMessage: '', timestamp: 'Just now', unread: 0, isGroup: false };
                setConversations(prev => [conv, ...prev]);
                onConversationSelect(id);
              }}
            >
              New Conversation
            </Button>

            <List
              dataSource={conversations}
              renderItem={(conv) => (
                <List.Item
                  onClick={() => onConversationSelect(conv.id)}
                  style={{
                    cursor: 'pointer', padding: '8px 12px', borderRadius: 6,
                    background: activeConversation === conv.id ? '#f3eeff' : 'transparent',
                  }}
                  extra={
                    <DeleteOutlined
                      style={{ color: '#999', fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConversations(prev => prev.filter(c => c.id !== conv.id));
                        if (activeConversation === conv.id) onConversationSelect(null);
                      }}
                    />
                  }
                >
                  <List.Item.Meta
                    avatar={
                      <Badge count={conv.unread} size="small">
                        <Avatar icon={conv.isGroup ? <TeamOutlined /> : <MessageOutlined />}
                          style={{ backgroundColor: '#2d1854' }} />
                      </Badge>
                    }
                    title={conv.name}
                    description={
                      <div>
                        <Text type="secondary" ellipsis style={{ fontSize: 12 }}>{conv.lastMessage}</Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 11 }}>{conv.timestamp}</Text>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </div>
    </Sider>
  );
}
