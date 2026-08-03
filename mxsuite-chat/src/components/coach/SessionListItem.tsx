import React from 'react';
import { Avatar, Tag, Badge, Typography } from 'antd';
import { AlertOutlined } from '@ant-design/icons';
import type { ConversationDto, PresenceDetail } from '../../types/chat';

const { Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  ONLINE: '#52c41a',
  BUSY: '#c4314b',
  DO_NOT_DISTURB: '#c4314b',
  BE_RIGHT_BACK: '#faad14',
  AWAY: '#faad14',
  APPEAR_OFFLINE: '#8c8c8c',
};

interface SessionListItemProps {
  conversation: ConversationDto;
  active: boolean;
  /** Replaces the old online boolean — includes availability status. */
  presenceDetail?: PresenceDetail | null;
  onClick: () => void;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
  return `${Math.floor(diff / 86400_000)}d`;
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

export default function SessionListItem({ conversation: c, active, presenceDetail, onClick }: SessionListItemProps) {
  const online = presenceDetail?.online ?? false;
  const dotColor = online
    ? (STATUS_COLORS[presenceDetail?.availabilityStatus ?? 'ONLINE'] ?? '#52c41a')
    : '#d9d9d9';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        cursor: 'pointer',
        background: active ? '#ede5f9' : 'transparent',
        borderLeft: active ? '3px solid #6b4fa0' : '3px solid transparent',
        borderBottom: '1px solid #ece7f3',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Member avatar with presence/availability dot */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {c.memberAvatarUrl ? (
              <Avatar size={28} src={c.memberAvatarUrl} />
            ) : (
              <Avatar size={28} style={{ background: '#2d1854', color: '#fff', fontSize: 11 }}>
                {getInitials(c.memberName)}
              </Avatar>
            )}
            <div style={{
              position: 'absolute', bottom: -1, right: -1,
              width: 10, height: 10, borderRadius: '50%',
              background: dotColor,
              border: '2px solid #faf9fc',
            }} />
          </div>
          <Text strong style={{ fontSize: 13 }}>{c.memberName || 'Member'}</Text>
          {c.helpRequested && (
            <AlertOutlined style={{ color: '#ff4d4f', fontSize: 12, animation: 'pulse 1.5s infinite' }} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tag
            color={c.mode === 'AI' ? 'blue' : 'green'}
            style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}
          >
            {c.mode === 'AI' ? 'AI' : 'Live'}
          </Tag>
          {c.unreadCoachCount > 0 && (
            <Badge count={c.unreadCoachCount} size="small" />
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Text
          ellipsis
          style={{ fontSize: 12, color: '#8c8c8c', maxWidth: '70%' }}
        >
          {c.lastMessagePreview || 'No messages yet'}
        </Text>
        <Text style={{ fontSize: 11, color: '#bfbfbf' }}>
          {timeAgo(c.lastMessageAt)}
        </Text>
      </div>
    </div>
  );
}
