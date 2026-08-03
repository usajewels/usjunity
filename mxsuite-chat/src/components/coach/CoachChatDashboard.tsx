import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Layout, Typography, Card, Statistic, Row, Col, Button, message, Empty, Spin, notification } from 'antd';
import { MessageOutlined, AlertOutlined, WarningOutlined, BellOutlined, ThunderboltOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useAuth, useWebSocket } from '@mxsuite/shared';
import SessionList from './SessionList';
import MessageBubble from '../shared/MessageBubble';
import ChatInput from '../member/ChatInput';
import { chatApi } from '../../services/chatApi';
import { playUrgent, playMessage } from '../../services/notificationSound';
import CannedResponsePanel from './CannedResponsePanel';
import MemberSearchModal from './MemberSearchModal';
import type { ConversationDto, ChatMessageDto, DashboardStats, PresenceDetail, TypingEvent } from '../../types/chat';

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
  const [actionLoading, setActionLoading] = useState(false);
  const [presenceDetails, setPresenceDetails] = useState<Map<string, PresenceDetail>>(new Map());
  const [typingName, setTypingName] = useState<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingRef = useRef(0);
  const [showCannedResponses, setShowCannedResponses] = useState(false);
  const [cannedText, setCannedText] = useState<string | undefined>(undefined);
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);

  const { connected, subscribe, sendMessage: wsSend } = useWebSocket({ url: '/ws', token });

  const activeConv = conversations.find(c => c.id === activeConvId) || null;
  // Fix: use controllingCoachId (not assignedCoachId) for the "is controlling" check
  const isControlling = activeConv?.mode === 'HUMAN' &&
    activeConv?.controllingCoachId === user?.id;

  // Stable tenant ID list — re-computed only when the set of tenants changes,
  // not on every conversation update (prevents subscription churn).
  const tenantIdKey = useMemo(() => {
    if (stats.visibleTenantIds && stats.visibleTenantIds.length > 0) {
      return stats.visibleTenantIds.slice().sort().join(',');
    }
    return [...new Set(conversations.map(c => c.tenantId))].sort().join(',');
  }, [stats.visibleTenantIds, conversations]);

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
          chatApi.getPresenceDetail(memberIds).then(detailMap => {
            const details = new Map<string, PresenceDetail>();
            for (const [uid, detail] of Object.entries(detailMap)) {
              details.set(uid, detail);
            }
            setPresenceDetails(details);
          }).catch(() => {});
        }
      })
      .catch(() => message.error('Failed to load chat dashboard'))
      .finally(() => setLoading(false));
  }, []);

  // Load messages when selecting a conversation
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    let stale = false;
    setMsgLoading(true);
    chatApi.coachGetMessages(activeConvId)
      .then((page) => { if (!stale) setMessages(page.content); })
      .catch(() => { if (!stale) message.error('Failed to load messages'); })
      .finally(() => { if (!stale) setMsgLoading(false); });

    chatApi.coachMarkRead(activeConvId).catch(() => {});
    return () => { stale = true; };
  }, [activeConvId]);

  // Subscribe to dashboard updates using ALL visible tenant IDs (not just
  // tenants with existing conversations). This ensures the dashboard receives
  // notifications for brand-new conversations from any visible tenant.
  useEffect(() => {
    if (!connected || !tenantIdKey) return;
    const tenantIds = tenantIdKey.split(',');
    const unsubs = tenantIds.map(tid =>
      subscribe(`/topic/chat.dashboard.${tid}`, (evt: unknown) => {
        const data = evt as { type?: string; conversationId?: string };
        chatApi.coachListConversations().then(updatedConvos => {
          setConversations(updatedConvos);
          if (data.type === 'HELP_REQUEST' && data.conversationId) {
            playUrgent();
            const conv = updatedConvos.find(c => c.id === data.conversationId);
            notification.warning({
              key: `help-${data.conversationId}`,
              message: 'Live Support Requested',
              description: `${conv?.memberName || 'A member'} is asking for a live coach.`,
              placement: 'topRight',
              duration: 10,
              icon: <BellOutlined style={{ color: '#fa8c16' }} />,
              btn: (
                <Button
                  size="small"
                  type="primary"
                  style={{ background: '#6b4fa0', borderColor: '#6b4fa0' }}
                  onClick={() => {
                    setActiveConvId(data.conversationId!);
                    notification.destroy(`help-${data.conversationId}`);
                  }}
                >
                  Open Chat
                </Button>
              ),
            });
          }
        }).catch(() => {});
        chatApi.getDashboardStats().then(setStats).catch(() => {});
      })
    );
    return () => unsubs.forEach(u => u());
  }, [connected, subscribe, tenantIdKey]);

  // Subscribe to presence changes (per-tenant)
  useEffect(() => {
    if (!connected || !tenantIdKey) return;
    const tenantIds = tenantIdKey.split(',');
    const unsubs = tenantIds.map(tid =>
      subscribe(`/topic/presence.${tid}`, (evt: unknown) => {
        const data = evt as {
          userId: string; status: string;
          availabilityStatus?: string; statusMessage?: string;
        };
        if (data.userId && data.status) {
          setPresenceDetails(prev => {
            const next = new Map(prev);
            next.set(data.userId, {
              online: data.status === 'ONLINE',
              availabilityStatus: (data.availabilityStatus ?? 'ONLINE') as PresenceDetail['availabilityStatus'],
              statusMessage: data.statusMessage ?? null,
            });
            return next;
          });
        }
      })
    );
    return () => unsubs.forEach(u => u());
  }, [connected, subscribe, tenantIdKey]);

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
          // Play sound for incoming member messages
          if (data.senderType === 'MEMBER') playMessage();
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

  // Subscribe to typing indicator for active conversation — coach cares about member typing
  useEffect(() => {
    if (!connected || !activeConvId) return;
    const unsub = subscribe(`/topic/chat.${activeConvId}.typing`, (data: unknown) => {
      const evt = data as TypingEvent;
      if (!evt.isPlatformUser) {
        setTypingName(evt.name);
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setTypingName(null), 4000);
      }
    });
    return () => { unsub(); clearTimeout(typingTimerRef.current); setTypingName(null); };
  }, [connected, activeConvId, subscribe]);

  const handleTakeover = useCallback(async () => {
    if (!activeConvId || actionLoading) return;
    setActionLoading(true);
    try {
      const updated = await chatApi.takeover(activeConvId);
      setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch (e: any) {
      message.error(e.message || 'Failed to take over');
    } finally {
      setActionLoading(false);
    }
  }, [activeConvId, actionLoading]);

  const handleRelease = useCallback(async () => {
    if (!activeConvId || actionLoading) return;
    setActionLoading(true);
    try {
      const updated = await chatApi.release(activeConvId);
      setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
    } catch (e: any) {
      message.error(e.message || 'Failed to release');
    } finally {
      setActionLoading(false);
    }
  }, [activeConvId, actionLoading]);

  const handleTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingRef.current < 3000 || !activeConvId) return;
    lastTypingRef.current = now;
    wsSend('/app/chat.typing', { conversationId: activeConvId });
  }, [wsSend, activeConvId]);

  const handleInitiateConversation = useCallback(async (memberId: string) => {
    try {
      const conv = await chatApi.coachInitiateConversation(memberId);
      setMemberSearchOpen(false);
      setActiveConvId(conv.id);
      // Refresh conversation list to include the new one
      chatApi.coachListConversations().then(setConversations).catch(() => {});
      chatApi.getDashboardStats().then(setStats).catch(() => {});
    } catch (e: any) {
      message.error(e.message || 'Failed to start conversation');
    }
  }, []);

  const handleCannedSelect = useCallback((content: string) => {
    setCannedText(content);
    setShowCannedResponses(false);
  }, []);

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

  const filesEnabled = activeConv?.chatFilesEnabled !== false;

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spin size="large" /></div>;
  }

  return (
    <div style={{ height: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header with New Conversation button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button
          icon={<PlusOutlined />}
          onClick={() => setMemberSearchOpen(true)}
          style={{ background: '#6b4fa0', borderColor: '#6b4fa0', color: '#fff' }}
        >
          New Conversation
        </Button>
      </div>

      {/* Stats bar */}
      <Row gutter={16} style={{ padding: '0 0 16px 0' }}>
        <Col span={8}>
          <Card size="small" style={{
            borderLeft: '3px solid #6b4fa0', background: '#f9f7fd',
            boxShadow: '0 1px 4px rgba(107,79,160,0.08)',
          }}>
            <Statistic title="Active Chats" value={stats.activeChats}
              prefix={<MessageOutlined style={{ color: '#6b4fa0' }} />}
              valueStyle={{ color: '#2d1854', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{
            borderLeft: stats.helpRequests > 0 ? '3px solid #ff4d4f' : '3px solid #d9d9d9',
            background: stats.helpRequests > 0 ? '#fff1f0' : '#fafafa',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <Statistic title="Help Requests" value={stats.helpRequests}
              prefix={<AlertOutlined style={{ color: stats.helpRequests > 0 ? '#ff4d4f' : '#8c8c8c' }} />}
              valueStyle={stats.helpRequests > 0 ? { color: '#ff4d4f', fontWeight: 700 } : { fontWeight: 700 }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{
            borderLeft: stats.sentimentAlerts > 0 ? '3px solid #fa8c16' : '3px solid #d9d9d9',
            background: stats.sentimentAlerts > 0 ? '#fff7e6' : '#fafafa',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <Statistic title="Sentiment Alerts" value={stats.sentimentAlerts}
              prefix={<WarningOutlined style={{ color: stats.sentimentAlerts > 0 ? '#fa8c16' : '#8c8c8c' }} />}
              valueStyle={stats.sentimentAlerts > 0 ? { color: '#fa8c16', fontWeight: 700 } : { fontWeight: 700 }} />
          </Card>
        </Col>
      </Row>

      {/* Main two-pane layout */}
      <Layout style={{
        flex: 1, borderRadius: 8, overflow: 'hidden',
        border: '1px solid #d9d0e8',
        boxShadow: '0 2px 8px rgba(107,79,160,0.10)',
      }}>
        <Sider width={300} style={{ background: '#faf9fc' }}>
          <SessionList
            conversations={conversations}
            activeId={activeConvId}
            presenceDetails={presenceDetails}
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
                padding: '12px 16px',
                borderBottom: '1px solid #e0d4f5',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: '#2d1854',
                color: '#fff',
              }}>
                <div>
                  <Text strong style={{ color: '#fff', fontSize: 14 }}>
                    {activeConv?.memberName || 'Member'}
                  </Text>
                  {activeConv?.sentimentLabel && (
                    <Text style={{ fontSize: 12, color: '#c4b5d9', marginLeft: 8 }}>
                      Sentiment: {activeConv.sentimentLabel}
                    </Text>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    type="text"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => activeConvId && chatApi.coachExportPdf(activeConvId)}
                    title="Export chat"
                    style={{ color: '#e0d4f5' }}
                  />
                  {activeConv?.mode === 'AI' ? (
                    <Button size="small" onClick={handleTakeover}
                      loading={actionLoading} disabled={actionLoading}
                      style={{ background: '#fff', color: '#6b4fa0', borderColor: '#fff', fontWeight: 600 }}>
                      Take Over
                    </Button>
                  ) : isControlling ? (
                    <Button size="small" onClick={handleRelease}
                      loading={actionLoading} disabled={actionLoading}
                      style={{ background: 'transparent', color: '#e0d4f5', borderColor: '#e0d4f5' }}>
                      Release to AI
                    </Button>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#c4b5d9' }}>
                      Controlled by {activeConv?.controllingCoachName || 'another coach'}
                    </Text>
                  )}
                </div>
              </div>

              {/* Message stream */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#f8f7fa' }}>
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
                <>
                  {typingName && (
                    <div style={{ padding: '4px 16px', fontSize: 12, color: '#888', fontStyle: 'italic' }}>
                      {typingName} is typing...
                    </div>
                  )}
                  <CannedResponsePanel
                    visible={showCannedResponses}
                    onSelect={handleCannedSelect}
                  />
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Button
                      type="text"
                      size="small"
                      icon={<ThunderboltOutlined />}
                      onClick={() => setShowCannedResponses(prev => !prev)}
                      style={{ color: '#6b4fa0', margin: '0 0 0 8px', flexShrink: 0 }}
                      title="Quick Replies"
                    />
                    <div style={{ flex: 1 }}>
                      <ChatInput
                        onSend={handleSendReply}
                        onTyping={handleTyping}
                        defaultValue={cannedText}
                        placeholder="Type a reply..."
                        filesEnabled={filesEnabled}
                        mentions={activeConv?.memberName
                          ? [{ value: activeConv.memberName.split(' ')[0], label: activeConv.memberName + ' (Member)' }]
                          : undefined}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </Content>
      </Layout>

      <MemberSearchModal
        open={memberSearchOpen}
        onClose={() => setMemberSearchOpen(false)}
        onSelect={handleInitiateConversation}
      />
    </div>
  );
}
