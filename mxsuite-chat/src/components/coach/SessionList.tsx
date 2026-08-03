import React from 'react';
import { Input, Empty } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import SessionListItem from './SessionListItem';
import type { ConversationDto, PresenceDetail } from '../../types/chat';

interface SessionListProps {
  conversations: ConversationDto[];
  activeId: string | null;
  presenceDetails?: Map<string, PresenceDetail>;
  onSelect: (id: string) => void;
}

export default function SessionList({ conversations, activeId, presenceDetails, onSelect }: SessionListProps) {
  const [search, setSearch] = React.useState('');

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.memberName?.toLowerCase().includes(q)) ||
      (c.lastMessagePreview?.toLowerCase().includes(q));
  });

  // Sort: help requests first, then by sentiment (worst first), then by last message
  const sorted = [...filtered].sort((a, b) => {
    if (a.helpRequested !== b.helpRequested) return a.helpRequested ? -1 : 1;
    const sa = a.sentimentScore ?? 0.5;
    const sb = b.sentimentScore ?? 0.5;
    if (Math.abs(sa - sb) > 0.1) return sa - sb;
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });

  return (
    <div style={{
      width: 300, borderRight: '1px solid #d9d0e8',
      display: 'flex', flexDirection: 'column', background: '#faf9fc',
    }}>
      <div style={{ padding: '12px', borderBottom: '1px solid #e0d4f5', background: '#f3eeff' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
          placeholder="Search conversations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          allowClear
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <Empty description="No conversations" image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 40 }} />
        ) : (
          sorted.map((c) => (
            <SessionListItem
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              presenceDetail={presenceDetails?.get(c.memberId) ?? null}
              onClick={() => onSelect(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
