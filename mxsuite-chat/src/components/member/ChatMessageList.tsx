import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Spin, Empty } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import MessageBubble from '../shared/MessageBubble';
import type { ChatMessageDto } from '../../types/chat';

const GAP_MS = 60 * 60 * 1000; // 1 hour

/** Find the index of the last time-gap boundary (>= 1 hour between consecutive messages). */
function findPreviousBoundary(msgs: ChatMessageDto[]): number {
  let lastGapIdx = -1;
  for (let i = 1; i < msgs.length; i++) {
    const prev = new Date(msgs[i - 1].createdAt).getTime();
    const curr = new Date(msgs[i].createdAt).getTime();
    if (curr - prev >= GAP_MS) lastGapIdx = i;
  }
  return lastGapIdx;
}

function formatBoundaryDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Earlier today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

interface ChatMessageListProps {
  messages: ChatMessageDto[];
  currentUserId: string;
  loading?: boolean;
}

export default function ChatMessageList({ messages, currentUserId, loading }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showPrevious, setShowPrevious] = useState(false);

  const boundary = useMemo(() => findPreviousBoundary(messages), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Collapse previous messages when new boundary appears
  useEffect(() => { setShowPrevious(false); }, [boundary]);

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

  const hasPrevious = boundary > 0;
  const previousMessages = hasPrevious ? messages.slice(0, boundary) : [];
  const currentMessages = hasPrevious ? messages.slice(boundary) : messages;

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '16px',
      display: 'flex', flexDirection: 'column',
    }}>
      {hasPrevious && (
        <>
          <div
            onClick={() => setShowPrevious(!showPrevious)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowPrevious(!showPrevious); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', margin: '4px 0 12px',
              userSelect: 'none',
            }}
          >
            <div style={{ flex: 1, height: 1, background: '#e0d4f5' }} />
            <span style={{
              fontSize: 12, color: '#6b4fa0', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 4,
              whiteSpace: 'nowrap',
            }}>
              {showPrevious ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
              Previous conversation
              <span style={{ color: '#8c8c8c', fontWeight: 400 }}>
                ({previousMessages.length} messages &middot; {formatBoundaryDate(previousMessages[previousMessages.length - 1].createdAt)})
              </span>
            </span>
            <div style={{ flex: 1, height: 1, background: '#e0d4f5' }} />
          </div>
          {showPrevious && previousMessages.map((msg) => (
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
        </>
      )}
      {currentMessages.map((msg) => (
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
