import React, { useState, useRef } from 'react';
import { Input, Button, Badge, Typography } from 'antd';
import { SendOutlined, PaperClipOutlined, CloseOutlined } from '@ant-design/icons';

const { Text } = Typography;

const ACCEPTED_FILE_TYPES = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt';

interface ChatInputProps {
  onSend: (content: string, file?: File) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  filesEnabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function ChatInput({ onSend, disabled, placeholder = 'Type a message...', filesEnabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = async () => {
    const trimmed = text.trim();
    if ((!trimmed && !selectedFile) || sending) return;
    setSending(true);
    try {
      await onSend(trimmed, selectedFile || undefined);
      setText('');
      setSelectedFile(null);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        // Reset input so user can retry
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
    }
    e.target.value = '';
  };

  return (
    <div style={{ borderTop: '1px solid #e0d4f5', background: '#fff' }}>
      {selectedFile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', background: '#f3eeff',
          fontSize: 12, color: '#2d1854',
        }}>
          <PaperClipOutlined />
          <Text ellipsis style={{ flex: 1, fontSize: 12 }}>{selectedFile.name}</Text>
          <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{formatFileSize(selectedFile.size)}</Text>
          <CloseOutlined
            style={{ fontSize: 10, cursor: 'pointer', color: '#8c8c8c' }}
            onClick={() => setSelectedFile(null)}
          />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px', alignItems: 'center' }}>
        {filesEnabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Button
              type="text"
              size="small"
              icon={<PaperClipOutlined />}
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || sending}
              style={{ color: '#6b4fa0', flexShrink: 0 }}
            />
          </>
        )}
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={handleSend}
          placeholder={placeholder}
          disabled={disabled || sending}
          style={{ borderRadius: 20 }}
        />
        <Button
          type="primary"
          shape="circle"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={disabled || sending || (!text.trim() && !selectedFile)}
          loading={sending}
          style={{
            background: '#2d1854',
            borderColor: '#2d1854',
            flexShrink: 0,
          }}
        />
      </div>
    </div>
  );
}
