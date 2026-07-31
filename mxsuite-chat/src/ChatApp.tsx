import React from 'react';
import { AuthProvider, useAuth } from '@mxsuite/shared';
import CoachChatDashboard from './components/coach/CoachChatDashboard';
import ChatBubble from './components/member/ChatBubble';

function ChatAppInner() {
  const { isPlatformUser } = useAuth();

  if (isPlatformUser) {
    return <CoachChatDashboard />;
  }

  // Members get the floating ChatBubble (which contains ChatDrawer).
  // This avoids dual-instance conflicts — the same ChatBubble component
  // is used whether the member accesses /chat directly or via the shell floating button.
  return <ChatBubble />;
}

export default function ChatApp() {
  return (
    <AuthProvider>
      <ChatAppInner />
    </AuthProvider>
  );
}
