import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { message } from 'antd';
import { useAuth, useWebSocket } from '@mxsuite/shared';
import ChatHeader from './ChatHeader';
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';
import { chatApi } from '../../services/chatApi';
import type { ConversationDto, ChatMessageDto, ChatMode, ChatEvent, PresenceDetail, TypingEvent } from '../../types/chat';

/** Read user from localStorage (fallback when AuthProvider context is empty due to MFE isolation) */
function readStoredUser(): { id: string; email: string; role: string } | null {
  try {
    const raw = localStorage.getItem('mxsuite_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && typeof parsed.email === 'string') return parsed;
    return null;
  } catch { return null; }
}

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function ChatDrawer({ open, onClose }: ChatDrawerProps) {
  const auth = useAuth();
  const storedUser = useMemo(() => readStoredUser(), []);
  const user = auth.user ?? storedUser;
  const token = localStorage.getItem('mxsuite_token') || '';

  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('AI');
  const [coachName, setCoachName] = useState<string | null>(null);
  const [coachAvatarUrl, setCoachAvatarUrl] = useState<string | null>(null);
  const [helpRequested, setHelpRequested] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [coachPresence, setCoachPresence] = useState<PresenceDetail | null>(null);

  const { connected, subscribe, sendMessage: wsSend } = useWebSocket({
    url: '/ws',
    token,
  });

  // Typing indicator state
  const [typingName, setTypingName] = useState<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTypingRef = useRef(0);

  // De-dup helper: only add message if id not already present
  const addMessage = useCallback((msg: ChatMessageDto) => {
    setMessages((prev) => {
      if (msg.id && prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  // Load or create conversation on open
  useEffect(() => {
    if (!open) return;
    if (!user) {
      console.warn('[ChatDrawer] user is null — cannot load conversation');
      return;
    }
    setLoading(true);
    chatApi.listConversations()
      .then((convos) => {
        if (convos.length > 0) {
          const active = convos.find(c => c.status === 'ACTIVE') || convos[0];
          setConversation(active);
          setMode(active.mode);
          setCoachName(active.controllingCoachName || active.assignedCoachName);
          setHelpRequested(active.helpRequested);
          return chatApi.getMessages(active.id);
        } else {
          return chatApi.createConversation('Onboarding Chat')
            .catch(() => {
              // 409 = conversation already exists (race condition) — re-fetch
              return chatApi.listConversations().then(c => c.find(x => x.status === 'ACTIVE') || c[0]);
            })
            .then((conv) => {
              if (!conv) return undefined;
              setConversation(conv);
              setMode(conv.mode);
              setCoachName(conv.controllingCoachName || conv.assignedCoachName || null);
              setHelpRequested(conv.helpRequested);
              return chatApi.getMessages(conv.id);
            });
        }
      })
      .then((page) => {
        if (page) {
          // Merge with any WebSocket messages that arrived during load
          setMessages(prev => {
            const loaded = page.content as ChatMessageDto[];
            const loadedIds = new Set(loaded.map(m => m.id));
            const wsOnly = prev.filter(m => !loadedIds.has(m.id));
            return [...loaded, ...wsOnly];
          });
        }
      })
      .catch((err) => {
        console.error('[ChatDrawer] Failed to load chat:', err);
        message.error('Failed to load chat');
      })
      .finally(() => setLoading(false));

  }, [open, user]);

  // Subscribe to incoming messages and events via personal queues only.
  // The /topic/chat.{id} subscription is NOT needed for the member —
  // the backend sends messages to the member via /user/queue/chat.messages.
  // Removing it prevents duplicate messages.
  useEffect(() => {
    if (!connected || !conversation) return;

    const unsub1 = subscribe(`/user/queue/chat.messages`, (msg: unknown) => {
      const chatMsg = msg as ChatMessageDto;
      if (chatMsg.conversationId === conversation.id) {
        addMessage(chatMsg);
      }
    });

    const unsub2 = subscribe(`/user/queue/chat.events`, (evt: unknown) => {
      const event = evt as ChatEvent;
      // Coach initiated a new conversation — reload to pick it up
      if (event.type === 'COACH_INITIATED' && event.conversationId) {
        chatApi.listConversations().then((convos) => {
          const active = convos.find(c => c.id === event.conversationId) || convos.find(c => c.status === 'ACTIVE') || convos[0];
          if (active) {
            setConversation(active);
            setMode(active.mode);
            setCoachName(active.controllingCoachName || active.assignedCoachName);
            setCoachAvatarUrl(null);
            setHelpRequested(active.helpRequested);
            chatApi.getMessages(active.id).then((page) => {
              setMessages(page.content as ChatMessageDto[]);
            }).catch(() => {});
            if (active.controllingCoachId) {
              chatApi.getPresenceDetail([active.controllingCoachId])
                .then(details => setCoachPresence(details[active.controllingCoachId!] ?? null))
                .catch(() => {});
            }
          }
        }).catch(() => {});
        return;
      }
      if (event.conversationId === conversation.id && event.type === 'MODE_CHANGE') {
        setMode(event.mode || 'AI');
        setCoachName(event.coachName || null);
        if (event.mode === 'HUMAN') {
          setHelpRequested(false);
          setCoachAvatarUrl((event.coachAvatarUrl as string) || null);
          // Update conversation so controllingCoachId is current (needed for presence filtering)
          setConversation(prev => prev ? {
            ...prev,
            mode: 'HUMAN',
            controllingCoachId: event.coachId || null,
            controllingCoachName: event.coachName || null,
          } : prev);
          // Fetch coach's presence immediately
          if (event.coachId) {
            chatApi.getPresenceDetail([event.coachId])
              .then(details => setCoachPresence(details[event.coachId!] ?? null))
              .catch(() => {});
          }
        } else {
          // Back to AI — clear coach state
          setConversation(prev => prev ? {
            ...prev,
            mode: 'AI',
            controllingCoachId: null,
            controllingCoachName: null,
          } : prev);
          setCoachAvatarUrl(null);
          setCoachPresence(null);
        }
      }
    });

    // Subscribe to real-time coach presence/availability updates
    const unsub3 = subscribe(`/user/queue/presence`, (evt: unknown) => {
      const data = evt as {
        userId: string; status: string;
        availabilityStatus?: string; statusMessage?: string;
      };
      const coachId = conversation.controllingCoachId || conversation.assignedCoachId;
      if (coachId && data.userId === coachId) {
        setCoachPresence({
          online: data.status === 'ONLINE',
          availabilityStatus: (data.availabilityStatus ?? 'ONLINE') as PresenceDetail['availabilityStatus'],
          statusMessage: data.statusMessage ?? null,
        });
      }
    });

    // Subscribe to typing indicator — member only cares about coach (isPlatformUser) typing
    const unsub4 = subscribe(`/topic/chat.${conversation.id}.typing`, (data: unknown) => {
      const evt = data as TypingEvent;
      if (evt.isPlatformUser) {
        setTypingName(evt.name);
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setTypingName(null), 4000);
      }
    });

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); clearTimeout(typingTimerRef.current); setTypingName(null); };
  }, [connected, conversation, subscribe, addMessage]);

  // Mark as read when opening
  useEffect(() => {
    if (open && conversation) {
      chatApi.markRead(conversation.id).catch(() => {});
    }
  }, [open, conversation]);

  // Fetch coach presence detail (includes availability status)
  useEffect(() => {
    const coachId = conversation?.controllingCoachId || conversation?.assignedCoachId;
    if (!coachId) { setCoachPresence(null); return; }
    chatApi.getPresenceDetail([coachId])
      .then(details => setCoachPresence(details[coachId] ?? null))
      .catch(() => {});
  }, [conversation?.controllingCoachId, conversation?.assignedCoachId]);

  const handleTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingRef.current < 3000 || !conversation) return;
    lastTypingRef.current = now;
    wsSend('/app/chat.typing', { conversationId: conversation.id });
  }, [wsSend, conversation]);

  const handleSend = useCallback(async (content: string, file?: File) => {
    if (!conversation) return;
    try {
      const msg = file
        ? await chatApi.sendFileMessage(conversation.id, file, content)
        : await chatApi.sendMessage(conversation.id, content);
      // The member's own message won't come back via /user/queue (backend only
      // sends to coach/spectators), so we append from REST response with de-dup.
      addMessage(msg);
    } catch {
      message.error('Failed to send message');
    }
  }, [conversation, addMessage]);

  const handleRequestHelp = useCallback(async () => {
    if (!conversation || actionLoading) return;
    setActionLoading(true);
    try {
      const updated = await chatApi.requestHelp(conversation.id);
      setHelpRequested(true);
      setConversation(updated);
    } catch {
      message.error('Failed to request help. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }, [conversation, actionLoading]);

  const filesEnabled = conversation?.chatFilesEnabled !== false;

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 84,
      right: 24,
      width: 400,
      height: 520,
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(45, 24, 84, 0.25)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 1001,
      background: '#fff',
      border: '1px solid #e0d4f5',
    }}>
      <ChatHeader
        mode={mode}
        coachName={coachName}
        coachAvatarUrl={coachAvatarUrl}
        presenceDetail={coachPresence}
        onClose={onClose}
        onRequestHelp={handleRequestHelp}
        onExport={conversation ? () => chatApi.exportPdf(conversation.id) : undefined}
        helpRequested={helpRequested}
        loading={loading || actionLoading}
      />
      <ChatMessageList
        messages={messages}
        currentUserId={user?.id || ''}
        loading={loading}
      />
      {typingName && (
        <div style={{ padding: '4px 16px', fontSize: 12, color: '#888', fontStyle: 'italic' }}>
          {typingName} is typing...
        </div>
      )}
      <ChatInput
        onSend={handleSend}
        onTyping={handleTyping}
        filesEnabled={filesEnabled}
        mentions={coachName ? [{ value: coachName.split(' ')[0], label: coachName + ' (Coach)' }] : undefined}
      />
    </div>
  );
}
