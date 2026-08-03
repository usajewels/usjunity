import React from 'react';
import { Avatar, Button, Typography } from 'antd';
import {
  RobotOutlined, FilePdfOutlined, FileWordOutlined,
  FileExcelOutlined, FileTextOutlined, FileImageOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type { MessageSender, FileAttachment } from '../../types/chat';

const { Text } = Typography;

interface MessageBubbleProps {
  content: string;
  senderType: MessageSender;
  senderName: string | null;
  senderAvatarUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  isOwn: boolean;
}

const AVATAR_BG: Record<MessageSender, string> = {
  MEMBER: '#2d1854',
  COACH: '#6b4fa0',
  AI: '#f3eeff',
  SYSTEM: '#f5f5f5',
};

/** Renders message text with @mention tokens highlighted as chips. */
function renderContent(text: string, isOwn: boolean): React.ReactNode {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) =>
    /^@\w+$/.test(part) ? (
      <span key={i} style={{
        display: 'inline-block',
        background: isOwn ? 'rgba(255,255,255,0.25)' : '#e0d4f5',
        color: isOwn ? '#fff' : '#2d1854',
        borderRadius: 4,
        padding: '0 4px',
        fontWeight: 600,
        fontSize: 13,
      }}>{part}</span>
    ) : part
  );
}

function getInitials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(contentType: string) {
  if (contentType.startsWith('image/')) return <FileImageOutlined />;
  if (contentType === 'application/pdf') return <FilePdfOutlined />;
  if (contentType.includes('wordprocessingml')) return <FileWordOutlined />;
  if (contentType.includes('spreadsheetml')) return <FileExcelOutlined />;
  return <FileTextOutlined />;
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

function FileAttachmentCard({ attachment, isOwn }: { attachment: FileAttachment; isOwn: boolean }) {
  const downloadUrl = `/api${attachment.url}`;

  if (isImageType(attachment.contentType)) {
    return (
      <div style={{ marginBottom: 4 }}>
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={downloadUrl}
            alt={attachment.filename}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            style={{
              maxWidth: 220,
              maxHeight: 180,
              borderRadius: 8,
              display: 'block',
            }}
          />
        </a>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
      borderRadius: 8,
      background: isOwn ? 'rgba(255,255,255,0.15)' : 'rgba(45,24,84,0.06)',
      marginBottom: 4,
      minWidth: 180,
    }}>
      <span style={{ fontSize: 20, color: isOwn ? '#d4c5f0' : '#6b4fa0' }}>
        {getFileIcon(attachment.contentType)}
      </span>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Text ellipsis style={{
          fontSize: 13, display: 'block',
          color: isOwn ? '#fff' : '#1a1a1a', fontWeight: 500,
        }}>
          {attachment.filename}
        </Text>
        <Text style={{ fontSize: 11, color: isOwn ? '#ccc' : '#8c8c8c' }}>
          {formatFileSize(attachment.fileSize)}
        </Text>
      </div>
      <a href={downloadUrl} download>
        <Button
          type="text" size="small"
          icon={<DownloadOutlined />}
          style={{ color: isOwn ? '#d4c5f0' : '#6b4fa0' }}
        />
      </a>
    </div>
  );
}

export default function MessageBubble({ content, senderType, senderName, senderAvatarUrl, metadata, createdAt, isOwn }: MessageBubbleProps) {
  if (senderType === 'SYSTEM') {
    return (
      <div style={{ textAlign: 'center', margin: '12px 0' }}>
        <Text style={{ fontSize: 12, color: '#8c8c8c', fontStyle: 'italic' }}>{content}</Text>
      </div>
    );
  }

  const isAI = senderType === 'AI';
  const bg = AVATAR_BG[senderType];
  const fileAttachment = (metadata?.fileAttachment as FileAttachment) || null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: isOwn ? 'row-reverse' : 'row',
      alignItems: 'flex-end',
      gap: 8,
      marginBottom: 12,
    }}>
      {isAI ? (
        <Avatar
          size={32}
          icon={<RobotOutlined />}
          style={{ background: bg, color: '#6b4fa0', flexShrink: 0 }}
        />
      ) : senderAvatarUrl ? (
        <Avatar size={32} src={senderAvatarUrl} style={{ flexShrink: 0 }} />
      ) : (
        <Avatar
          size={32}
          style={{ background: bg, color: '#fff', flexShrink: 0, fontSize: 13 }}
        >
          {getInitials(senderName)}
        </Avatar>
      )}
      <div style={{ maxWidth: '70%' }}>
        {!isOwn && senderName && (
          <Text style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 2, display: 'block' }}>
            {senderName}
          </Text>
        )}
        <div style={{
          padding: '8px 12px',
          borderRadius: isOwn ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          background: isOwn ? '#2d1854' : '#f3eeff',
          color: isOwn ? '#fff' : '#1a1a1a',
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {fileAttachment && <FileAttachmentCard attachment={fileAttachment} isOwn={isOwn} />}
          {content && !(fileAttachment && content === fileAttachment.filename) && renderContent(content, isOwn)}
        </div>
        <Text style={{
          fontSize: 10, color: '#bbb',
          display: 'block',
          textAlign: isOwn ? 'right' : 'left',
          marginTop: 2,
        }}>
          {formatTime(createdAt)}
        </Text>
      </div>
    </div>
  );
}
