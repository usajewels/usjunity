import React from 'react';
import { Avatar, Typography, Button, Tag } from 'antd';
import { RobotOutlined, CloseOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { ChatMode } from '../../types/chat';

const { Text } = Typography;

interface ChatHeaderProps {
  mode: ChatMode;
  coachName?: string | null;
  coachAvatarUrl?: string | null;
  coachOnline?: boolean;
  onClose: () => void;
  onRequestHelp: () => void;
  helpRequested: boolean;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

export default function ChatHeader({ mode, coachName, coachAvatarUrl, coachOnline, onClose, onRequestHelp, helpRequested }: ChatHeaderProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px',
      background: '#2d1854',
      color: '#fff',
      borderRadius: '12px 12px 0 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          {mode === 'AI' ? (
            <Avatar
              size={36}
              icon={<RobotOutlined />}
              style={{ background: '#f3eeff', color: '#6b4fa0' }}
            />
          ) : coachAvatarUrl ? (
            <Avatar size={36} src={coachAvatarUrl} />
          ) : (
            <Avatar size={36} style={{ background: '#6b4fa0', color: '#fff', fontSize: 14 }}>
              {getInitials(coachName)}
            </Avatar>
          )}
          {/* Presence dot — only show for human coach */}
          {mode === 'HUMAN' && (
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 10, height: 10, borderRadius: '50%',
              background: coachOnline ? '#52c41a' : '#8c8c8c',
              border: '2px solid #2d1854',
            }} />
          )}
        </div>
        <div>
          <Text strong style={{ color: '#fff', fontSize: 14, display: 'block' }}>
            {mode === 'AI' ? 'AI Assistant' : coachName || 'Coach'}
          </Text>
          <Tag
            color={mode === 'AI' ? '#6b4fa0' : '#237804'}
            style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}
          >
            {mode === 'AI' ? 'AI' : 'Live'}
          </Tag>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {mode === 'AI' && !helpRequested && (
          <Button
            size="small"
            icon={<QuestionCircleOutlined />}
            onClick={onRequestHelp}
            style={{
              background: 'transparent', color: '#e0d4f5',
              borderColor: '#e0d4f5', fontSize: 12,
            }}
          >
            Talk to a Coach
          </Button>
        )}
        {helpRequested && mode === 'AI' && (
          <Tag color="#f59e0b" style={{ margin: 0, lineHeight: '24px' }}>
            Coach requested
          </Tag>
        )}
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{ color: '#e0d4f5' }}
        />
      </div>
    </div>
  );
}
