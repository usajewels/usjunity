import React, { useState } from 'react';
import { MessageOutlined, CloseOutlined } from '@ant-design/icons';
import { AuthProvider } from '@mxsuite/shared';
import ChatDrawer from './ChatDrawer';

export default function ChatBubble() {
  const [open, setOpen] = useState(false);

  return (
    <AuthProvider>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 48, height: 48, borderRadius: '50%',
          background: '#2d1854', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 22,
          boxShadow: '0 4px 12px rgba(45,24,84,0.4)',
          transition: 'transform 0.2s, box-shadow 0.2s',
          zIndex: 1002,
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
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpen(v => !v); }}
      >
        {open ? <CloseOutlined /> : <MessageOutlined />}
      </div>
      <ChatDrawer open={open} onClose={() => setOpen(false)} />
    </AuthProvider>
  );
}
