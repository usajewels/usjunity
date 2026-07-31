import React, { useEffect, useRef } from 'react';
import { Spin, Empty } from 'antd';
import MessageBubble from '../shared/MessageBubble';
import type { ChatMessageDto } from '../../types/chat';

interface ChatMessageListProps {
  messages: ChatMessageDto[];
  currentUserId: string;
  loading?: boolean;
}

export default function ChatMessageList({ messages, currentUserId, loading }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="Start a conversation" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '16px',
      display: 'flex', flexDirection: 'column',
    }}>
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          content={msg.content}
          senderType={msg.senderType}
          senderName={msg.senderName}
          senderAvatarUrl={msg.senderAvatarUrl}
          metadata={msg.metadata}
          createdAt={msg.createdAt}
          isOwn={msg.senderId === currentUserId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
