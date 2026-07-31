import React from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

interface SystemMessageProps {
  content: string;
}

export default function SystemMessage({ content }: SystemMessageProps) {
  return (
    <div style={{
      textAlign: 'center',
      margin: '16px 0',
      padding: '4px 16px',
    }}>
      <Text style={{
        fontSize: 12,
        color: '#8c8c8c',
        fontStyle: 'italic',
        background: '#fafafa',
        padding: '4px 12px',
        borderRadius: 12,
      }}>
        {content}
      </Text>
    </div>
  );
}
