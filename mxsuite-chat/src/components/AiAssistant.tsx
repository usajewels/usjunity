import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, Typography, Avatar, Space, Tag } from 'antd';
import { SendOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export default function AiAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0', role: 'assistant',
      content: 'Hello! I\'m your MemberSuite AI Assistant. I can help you with:\n\n• Understanding your data mappings\n• Troubleshooting plan execution errors\n• Navigating the platform\n• Answering questions about the onboarding process\n\nHow can I help you today?',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(), role: 'user',
      content: input, timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // TODO: Call RAG-powered AI endpoint
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: 'Thank you for your question. The AI assistant backend is being set up. Once connected, I\'ll be able to answer questions about your data, plans, and the MemberSuite platform using RAG-powered responses.',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, aiMsg]);
      setLoading(false);
    }, 1000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #e0d4f5', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar style={{ backgroundColor: '#6b4fa0' }} icon={<RobotOutlined />} />
        <Space>
          <Text strong>AI Assistant</Text>
          <Tag color="green">Online</Tag>
        </Space>
        <Text type="secondary" style={{ marginLeft: 'auto', fontSize: 12 }}>
          Powered by RAG
        </Text>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 16,
          }}>
            {msg.role === 'assistant' && (
              <Avatar size="small" style={{ backgroundColor: '#6b4fa0', marginRight: 8, marginTop: 4 }}
                icon={<RobotOutlined />} />
            )}
            <div style={{
              maxWidth: '75%', padding: '12px 16px', borderRadius: 12,
              background: msg.role === 'user' ? '#2d1854' : '#f3eeff',
              color: msg.role === 'user' ? '#fff' : '#000',
              border: msg.role === 'assistant' ? '1px solid #e0d4f5' : 'none',
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
              <div style={{ marginTop: 4 }}>
                <Text style={{ fontSize: 10, opacity: 0.6, color: msg.role === 'user' ? '#ccc' : '#999' }}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </Text>
              </div>
            </div>
            {msg.role === 'user' && (
              <Avatar size="small" style={{ backgroundColor: '#2d1854', marginLeft: 8, marginTop: 4 }}
                icon={<UserOutlined />} />
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <Avatar size="small" style={{ backgroundColor: '#6b4fa0' }} icon={<RobotOutlined />} />
            <div style={{ padding: '12px 16px', background: '#f3eeff', borderRadius: 12, border: '1px solid #e0d4f5' }}>
              <Text type="secondary">Thinking...</Text>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #e0d4f5', display: 'flex', gap: 8 }}>
        <Input value={input} onChange={e => setInput(e.target.value)}
          onPressEnter={sendMessage} placeholder="Ask the AI assistant anything..."
          size="large" disabled={loading} />
        <Button type="primary" icon={<SendOutlined />} size="large" onClick={sendMessage}
          loading={loading} style={{ backgroundColor: '#2d1854', borderColor: '#2d1854' }} />
      </div>
    </div>
  );
}
