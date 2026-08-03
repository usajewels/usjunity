import React, { useState, useEffect } from 'react';
import { Badge } from 'antd';
import { MessageOutlined, CloseOutlined } from '@ant-design/icons';
import { AuthProvider, useWebSocket } from '@mxsuite/shared';
import ChatDrawer from './ChatDrawer';
import { chatApi } from '../../services/chatApi';
import { playMessage } from '../../services/notificationSound';

function ChatBubbleInner() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const token = localStorage.getItem('mxsuite_token') || '';

  const { connected, subscribe } = useWebSocket({ url: '/ws', token });

  // Load initial unread count from server on mount
  useEffect(() => {
    chatApi.listConversations()
      .then(convos => {
        const total = convos.reduce((sum, c) => sum + (c.unreadMemberCount || 0), 0);
        setUnreadCount(total);
      })
      .catch(() => {});
  }, []);

  // Increment badge when a message arrives and the drawer is closed
  useEffect(() => {
    if (!connected) return;
    const unsub = subscribe('/user/queue/chat.messages', () => {
      if (!open) {
        setUnreadCount(prev => prev + 1);
        playMessage();
      }
    });
    return unsub;
  }, [connected, subscribe, open]);

  const handleOpen = () => {
    setOpen(true);
    setUnreadCount(0);
  };

  return (
    <>
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1002 }}>
        <Badge count={unreadCount} size="small" offset={[0, 4]}>
          <div
            onClick={() => open ? setOpen(false) : handleOpen()}
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: '#2d1854', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 22,
              boxShadow: '0 4px 12px rgba(45,24,84,0.4)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(45,24,84,0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(45,24,84,0.4)';
            }}
            title={open ? 'Close chat' : 'Chat'}
            role="button"
            aria-label={open ? 'Close chat' : 'Open chat'}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open ? setOpen(false) : handleOpen(); }}
          >
            {open ? <CloseOutlined /> : <MessageOutlined />}
          </div>
        </Badge>
      </div>
      <ChatDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default function ChatBubble() {
  return (
    <AuthProvider>
      <ChatBubbleInner />
    </AuthProvider>
  );
}
