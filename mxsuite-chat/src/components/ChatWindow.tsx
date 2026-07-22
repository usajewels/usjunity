import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, Typography, Avatar, Space, Empty, Tag } from 'antd';
import { SendOutlined, UserOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Message {
  id: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isOwn: boolean;
  isPlatformUser?: boolean;
}

interface ChatWindowProps {
  conversationId: string | null;
}

export default function ChatWindow({ conversationId }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1', sender: 'system', senderName: 'MemberSuite', content: 'Welcome to MemberSuite Chat! You can message your team or ask the AI assistant for help.',
      timestamp: new Date().toISOString(), isOwn: false,
    },
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!conversationId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="Select a conversation to start chatting" />
      </div>
    );
  }

  const sendMessage = () => {
    if (!input.trim()) return;
    const msg: Message = {
      id: Date.now().toString(),
      sender: 'me',
      senderName: 'You',
      content: input,
      timestamp: new Date().toISOString(),
      isOwn: true,
    };
    setMessages([...messages, msg]);
    setInput('');
    // TODO: Send via WebSocket STOMP
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #e0d4f5', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar style={{ backgroundColor: '#2d1854' }} icon={<UserOutlined />} />
        <Text strong>Support Team</Text>
        <Tag color="green" style={{ marginLeft: 'auto' }}>Online</Tag>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: 'flex', justifyContent: msg.isOwn ? 'flex-end' : 'flex-start', marginBottom: 12,
          }}>
            <div style={{
              maxWidth: '70%', padding: '10px 16px', borderRadius: 12,
              background: msg.isOwn ? '#2d1854' : '#f0f0f0',
              color: msg.isOwn ? '#fff' : '#000',
            }}>
              {!msg.isOwn && (
                <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4, color: '#2d1854' }}>
                  {msg.senderName}
                  {msg.isPlatformUser && <Tag style={{ marginLeft: 4, fontSize: 10, backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>Support</Tag>}
                </Text>
              )}
              <div>{msg.content}</div>
              <Text style={{ fontSize: 10, opacity: 0.7, color: msg.isOwn ? '#ccc' : '#999' }}>
                {new Date(msg.timestamp).toLocaleTimeString()}
              </Text>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #e0d4f5', display: 'flex', gap: 8 }}>
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={sendMessage}
          placeholder="Type a message..."
          size="large"
        />
        <Button type="primary" icon={<SendOutlined />} size="large" onClick={sendMessage}
          style={{ background: '#2d1854', borderColor: '#2d1854' }} />
      </div>
    </div>
  );
}
