import React from 'react';
import { Avatar, Typography, Button, Tag } from 'antd';
import { RobotOutlined, CloseOutlined, QuestionCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ChatMode, PresenceDetail } from '../../types/chat';

const { Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  ONLINE: '#52c41a',
  BUSY: '#c4314b',
  DO_NOT_DISTURB: '#c4314b',
  BE_RIGHT_BACK: '#faad14',
  AWAY: '#faad14',
  APPEAR_OFFLINE: '#8c8c8c',
};

const STATUS_LABELS: Record<string, string> = {
  ONLINE: 'Available',
  BUSY: 'Busy',
  DO_NOT_DISTURB: 'Do not disturb',
  BE_RIGHT_BACK: 'Be right back',
  AWAY: 'Away',
  APPEAR_OFFLINE: 'Offline',
};

interface ChatHeaderProps {
  mode: ChatMode;
  coachName?: string | null;
  coachAvatarUrl?: string | null;
  /** Replaces the old coachOnline boolean — includes status and message. */
  presenceDetail?: PresenceDetail | null;
  onClose: () => void;
  onRequestHelp: () => void;
  onExport?: () => void;
  helpRequested: boolean;
  loading?: boolean;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

export default function ChatHeader({ mode, coachName, coachAvatarUrl, presenceDetail, onClose, onRequestHelp, onExport, helpRequested, loading }: ChatHeaderProps) {
  const coachOnline = presenceDetail?.online ?? false;
  const availStatus = presenceDetail?.availabilityStatus ?? 'ONLINE';
  const dotColor = coachOnline ? (STATUS_COLORS[availStatus] ?? '#52c41a') : '#8c8c8c';
  const statusLabel = coachOnline ? (STATUS_LABELS[availStatus] ?? 'Online') : 'Offline';

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
          {/* Presence/availability dot — only show for human coach */}
          {mode === 'HUMAN' && (
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 10, height: 10, borderRadius: '50%',
              background: dotColor,
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
          {/* Status text: show for HUMAN mode, and for AI mode when coach is online */}
          {mode === 'HUMAN' && presenceDetail && (
            <Text style={{ fontSize: 10, color: dotColor, display: 'block', marginTop: 1 }}>
              ● {statusLabel}
              {presenceDetail.statusMessage && ` — ${presenceDetail.statusMessage}`}
            </Text>
          )}
          {mode === 'AI' && coachOnline && (
            <Text style={{ fontSize: 10, color: dotColor, display: 'block', marginTop: 1 }}>
              ● Coach {statusLabel.toLowerCase()}
            </Text>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {mode === 'AI' && !helpRequested && (
          <Button
            size="small"
            icon={<QuestionCircleOutlined />}
            onClick={onRequestHelp}
            loading={loading}
            disabled={loading}
            style={{
              background: 'transparent', color: '#e0d4f5',
              borderColor: '#e0d4f5', fontSize: 12,
            }}
          >
            {loading ? 'Loading...' : 'Talk to a Coach'}
          </Button>
        )}
        {helpRequested && mode === 'AI' && (
          <Tag color="#f59e0b" style={{ margin: 0, lineHeight: '24px' }}>
            Coach requested
          </Tag>
        )}
        {onExport && (
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            onClick={onExport}
            style={{ color: '#e0d4f5' }}
            title="Export chat"
          />
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
