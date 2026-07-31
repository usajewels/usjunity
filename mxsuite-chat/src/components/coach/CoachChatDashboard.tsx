import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Layout, Typography, Card, Statistic, Row, Col, Button, message, Empty, Spin } from 'antd';
import { MessageOutlined, AlertOutlined, WarningOutlined } from '@ant-design/icons';
import { useAuth, useWebSocket } from '@mxsuite/shared';
import SessionList from './SessionList';
import MessageBubble from '../shared/MessageBubble';
import ChatInput from '../member/ChatInput';
import { chatApi } from '../../services/chatApi';
import type { ConversationDto, ChatMessageDto, DashboardStats } from '../../types/chat';

const { Content, Sider } = Layout;
const { Text } = Typography;

export default function CoachChatDashboard() {
  const { user } = useAuth();
  const token = localStorage.getItem('mxsuite_token') || '';

  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ activeChats: 0, helpRequests: 0, sentimentAlerts: 0 });
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  const { connected, subscribe } = useWebSocket({ url: '/ws', token });

  const activeConv = conversations.find(c => c.id === activeConvId) || null;
  // Fix: use controllingCoachId (not assignedCoachId) for the "is controlling" check
  const isControlling = activeConv?.mode === 'HUMAN' &&
    activeConv?.controllingCoachId === user?.id;

  // Load conversations and stats
  useEffect(() => {
    Promise.all([
      chatApi.coachListConversations(),
      chatApi.getDashboardStats(),
    ])
      .then(([convos, s]) => {
        setConversations(convos);
        setStats(s);
        // Load initial presence for all member IDs
        const memberIds = [...new Set(convos.map(c => c.memberId))];
        if (memberIds.length > 0) {
          chatApi.getPresence(memberIds).then(presenceMap => {
            const online = new Set<string>();
            for (const [uid, isOnline] of Object.entries(presenceMap)) {
              if (isOnline) online.add(uid);
            }
            setOnlineUserIds(online);
          }).catch(() => {});
        }
      })
      .catch(() => message.error('Failed to load chat dashboard'))
      .finally(() => setLoading(false));
  }, []);

  // Load messages when selecting a conversation
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    setMsgLoading(true);
    chatApi.coachGetMessages(activeConvId)
      .then((page) => setMessages(page.content))
      .catch(() => message.error('Failed to load messages'))
      .finally(() => setMsgLoading(false));

    chatApi.coachMarkRead(activeConvId).catch(() => {});
  }, [activeConvId]);

  // Subscribe to dashboard updates using ALL visible tenant IDs (not just
  // tenants with existing conversations). This ensures the dashboard receives
  // notifications for brand-new conversations from any visible tenant.
  useEffect(() => {
    if (!connected) return;
    const tenantIds = stats.visibleTenantIds && stats.visibleTenantIds.length > 0
      ? stats.visibleTenantIds
      : [...new Set(conversations.map(c => c.tenantId))];
    if (tenantIds.length === 0) return;
    const unsubs = tenantIds.map(tid =>
      subscribe(`/topic/chat.dashboard.${tid}`, () => {
        chatApi.coachListConversations().then(setConversations).catch(() => {});
        chatApi.getDashboardStats().then(setStats).catch(() => {});
      })
    );
    return () => unsubs.forEach(u => u());
  }, [connected, subscribe, stats.visibleTenantIds]);

  // Subscribe to presence changes (per-tenant)
  useEffect(() => {
    if (!connected) return;
    const tenantIds = stats.visibleTenantIds && stats.visibleTenantIds.length > 0
      ? stats.visibleTenantIds
      : [...new Set(conversations.map(c => c.tenantId))];
    if (tenantIds.length === 0) return;
    const unsubs = tenantIds.map(tid =>
      subscribe(`/topic/presence.${tid}`, (evt: unknown) => {
        const data = evt as { userId: string; status: string };
        if (data.userId && data.status) {
          setOnlineUserIds(prev => {
            const next = new Set(prev);
            if (data.status === 'ONLINE') next.add(data.userId);
            else next.delete(data.userId);
            return next;
          });
        }
      })
    );
    return () => unsubs.forEach(u => u());
  }, [connected, subscribe, stats.visibleTenantIds]);

  // Subscribe to active conversation messages via topic
  useEffect(() => {
    if (!connected || !activeConvId) return;
    const unsub = subscribe(`/topic/chat.${activeConvId}`, (msg: unknown) => {
      const data = msg as ChatMessageDto & { type?: string };
      // Only process actual messages (not mode change events)
      if (data.senderType && data.content && data.id) {
        setMessages((prev) => {
          // De-dup by id to prevent duplicate messages
          if (prev.some(m => m.id === data.id)) return prev;
          return [...prev, data];
        });
      }
      // Handle mode change events — refresh the conversation
      if (data.type === 'MODE_CHANGE') {
        chatApi.coachListConversations().then(setConversations).catch(() => {});
      }
    });
    return unsub;
  }, [connected, activeConvId, subscribe]);

  const handleTakeover = useCallback(async () => {
    if (!activeConvId) return;
    try {
      const updated = await chatApi.takeover(activeConvId);
      setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch (e: any) {
      message.error(e.message || 'Failed to take over');
    }
  }, [activeConvId]);

  const handleRelease = useCallback(async () => {
    if (!activeConvId) return;
    try {
      const updated = await chatApi.release(activeConvId);
      setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch (e: any) {
      message.error(e.message || 'Failed to release');
    }
  }, [activeConvId]);

  const handleSendReply = useCallback(async (content: string, file?: File) => {
    if (!activeConvId) return;
    try {
      const msg = file
        ? await chatApi.coachSendFileMessage(activeConvId, file, content)
        : await chatApi.coachSendMessage(activeConvId, content);
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
    } catch {
      message.error('Failed to send message');
    }
  }, [activeConvId]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Check feature flag for file sharing
  const filesEnabled = (() => {
    try {
      const raw = localStorage.getItem('mxsuite_feature_config');
      if (!raw || !user?.role) return false;
      const config = JSON.parse(raw) as Record<string, string[]>;
      return config[user.role]?.includes('chat-files') ?? false;
    } catch { return false; }
  })();

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  return (
    <div style={{ height: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column' }}>
      {/* Stats bar */}
      <Row gutter={16} style={{ padding: '0 0 16px 0' }}>
        <Col span={8}>
          <Card size="small" style={{ borderColor: '#e0d4f5' }}>
            <Statistic title="Active Chats" value={stats.activeChats}
              prefix={<MessageOutlined style={{ color: '#6b4fa0' }} />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ borderColor: stats.helpRequests > 0 ? '#ff4d4f' : '#e0d4f5' }}>
            <Statistic title="Help Requests" value={stats.helpRequests}
              prefix={<AlertOutlined style={{ color: stats.helpRequests > 0 ? '#ff4d4f' : '#8c8c8c' }} />}
              valueStyle={stats.helpRequests > 0 ? { color: '#ff4d4f' } : undefined} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ borderColor: stats.sentimentAlerts > 0 ? '#fa8c16' : '#e0d4f5' }}>
            <Statistic title="Sentiment Alerts" value={stats.sentimentAlerts}
              prefix={<WarningOutlined style={{ color: stats.sentimentAlerts > 0 ? '#fa8c16' : '#8c8c8c' }} />}
              valueStyle={stats.sentimentAlerts > 0 ? { color: '#fa8c16' } : undefined} />
          </Card>
        </Col>
      </Row>

      {/* Main two-pane layout */}
      <Layout style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid #e0d4f5' }}>
        <Sider width={300} style={{ background: '#fff' }}>
          <SessionList
            conversations={conversations}
            activeId={activeConvId}
            onlineUserIds={onlineUserIds}
            onSelect={setActiveConvId}
          />
        </Sider>
        <Content style={{ display: 'flex', flexDirection: 'column', background: '#fff' }}>
          {!activeConvId ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="Select a conversation" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <>
              {/* Conversation header with controls */}
              <div style={{
                padding: '10px 16px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: '#fafafa',
              }}>
                <div>
                  <Text strong>{activeConv?.memberName || 'Member'}</Text>
                  {activeConv?.sentimentLabel && (
                    <Text style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 8 }}>
                      Sentiment: {activeConv.sentimentLabel}
                    </Text>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {activeConv?.mode === 'AI' ? (
                    <Button type="primary" size="small" onClick={handleTakeover}
                      style={{ background: '#6b4fa0', borderColor: '#6b4fa0' }}>
                      Take Over
                    </Button>
                  ) : isControlling ? (
                    <Button size="small" onClick={handleRelease}>
                      Release to AI
                    </Button>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#8c8c8c' }}>
                      Controlled by {activeConv?.controllingCoachName || 'another coach'}
                    </Text>
                  )}
                </div>
              </div>

              {/* Message stream */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {msgLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin /></div>
                ) : (
                  messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      content={msg.content}
                      senderType={msg.senderType}
                      senderName={msg.senderName}
                      senderAvatarUrl={msg.senderAvatarUrl}
                      metadata={msg.metadata}
                      createdAt={msg.createdAt}
                      isOwn={msg.senderId === user?.id}
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* Reply input — only when controlling */}
              {isControlling && (
                <ChatInput
                  onSend={handleSendReply}
                  placeholder="Type a reply..."
                  filesEnabled={filesEnabled}
                />
              )}
            </>
          )}
        </Content>
      </Layout>
    </div>
  );
}
