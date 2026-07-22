import React from 'react';
import { Typography, Button, Card, Space, Grid } from 'antd';
import { RocketOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;

interface Props {
  onNext: () => void;
}

export default function WelcomeStep({ onNext }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  return (
    <div style={{ maxWidth: isMobile ? '100%' : 600, margin: isMobile ? '16px auto' : '40px auto', textAlign: 'center' }}>
      <Card>
        <RocketOutlined style={{ fontSize: 48, color: '#1e3a5f', marginBottom: 24 }} />
        <Title level={3}>Welcome to MemberSuite Onboarding</Title>
        <Paragraph type="secondary" style={{ fontSize: 16 }}>
          We'll guide you through importing your data into MemberSuite by GrowthZone.
          The process is simple:
        </Paragraph>
        <Space direction="vertical" style={{ textAlign: 'left', margin: '24px 0' }} size="small">
          <Paragraph><strong>1.</strong> Upload your data file (CSV format)</Paragraph>
          <Paragraph><strong>2.</strong> Map your columns to MemberSuite fields</Paragraph>
          <Paragraph><strong>3.</strong> Review and submit your mappings</Paragraph>
        </Space>
        <Paragraph type="secondary">
          Your GrowthZone representative may assist with the column mapping.
        </Paragraph>
        <Button type="primary" size="large" onClick={onNext} style={{ marginTop: 16 }}>
          Get Started
        </Button>
      </Card>
    </div>
  );
}
