import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { message } from 'antd';
import { useAuth, useWebSocket } from '@mxsuite/shared';
import ChatHeader from './ChatHeader';
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';
import { chatApi } from '../../services/chatApi';
import type { ConversationDto, ChatMessageDto, ChatMode, ChatEvent } from '../../types/chat';

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
  const [helpRequested, setHelpRequested] = useState(false);

  const { connected, subscribe } = useWebSocket({
    url: '/ws',
    token,
  });

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
        if (page) setMessages(page.content);
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
      if (event.conversationId === conversation.id && event.type === 'MODE_CHANGE') {
        setMode(event.mode || 'AI');
        setCoachName(event.coachName || null);
        if (event.mode === 'HUMAN') setHelpRequested(false);
      }
    });

    return () => { unsub1(); unsub2(); };
  }, [connected, conversation, subscribe, addMessage]);

  // Mark as read when opening
  useEffect(() => {
    if (open && conversation) {
      chatApi.markRead(conversation.id).catch(() => {});
    }
  }, [open, conversation]);

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
    if (!conversation) {
      message.warning('Chat is still loading. Please try again in a moment.');
      return;
    }
    try {
      const updated = await chatApi.requestHelp(conversation.id);
      setHelpRequested(true);
      setConversation(updated);
    } catch {
      message.error('Failed to request help');
    }
  }, [conversation]);

  // Check feature flag for file sharing
  const filesEnabled = (() => {
    try {
      const raw = localStorage.getItem('mxsuite_feature_config');
      if (!raw || !user?.role) return false;
      const config = JSON.parse(raw) as Record<string, string[]>;
      return config[user.role]?.includes('chat-files') ?? false;
    } catch { return false; }
  })();

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
        onClose={onClose}
        onRequestHelp={handleRequestHelp}
        helpRequested={helpRequested}
      />
      <ChatMessageList
        messages={messages}
        currentUserId={user?.id || ''}
        loading={loading}
      />
      <ChatInput onSend={handleSend} filesEnabled={filesEnabled} />
    </div>
  );
}
