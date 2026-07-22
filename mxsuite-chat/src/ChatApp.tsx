import React, { useState } from 'react';
import { Layout, Typography } from 'antd';
import ChatSidebar from './components/ChatSidebar';
import ChatWindow from './components/ChatWindow';
import AiAssistant from './components/AiAssistant';

const { Content } = Layout;

export type ChatView = 'conversations' | 'ai-assistant';

export default function ChatApp() {
  const [activeView, setActiveView] = useState<ChatView>('conversations');
  const [activeConversation, setActiveConversation] = useState<string | null>(null);

  return (
    <Layout style={{ height: 'calc(100vh - 160px)', background: '#fff' }}>
      <ChatSidebar
        activeView={activeView}
        onViewChange={setActiveView}
        activeConversation={activeConversation}
        onConversationSelect={setActiveConversation}
      />
      <Content style={{ display: 'flex', flexDirection: 'column' }}>
        {activeView === 'ai-assistant' ? (
          <AiAssistant />
        ) : (
          <ChatWindow conversationId={activeConversation} />
        )}
      </Content>
    </Layout>
  );
}
