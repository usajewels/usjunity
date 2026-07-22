import React, { useState } from 'react';
import { Card, Table, Typography, Button, Space, Tag, Alert, Grid, Popconfirm } from 'antd';
import { ArrowLeftOutlined, CheckOutlined } from '@ant-design/icons';
import type { Onboarding } from '@mxsuite/shared';
import { onboardingApi } from '../services/api';

const { Title, Text } = Typography;

interface Props {
  onboarding: Onboarding;
  onUpdate: (ob: Onboarding) => void;
  onBack: () => void;
}

export default function ReviewStep({ onboarding, onUpdate, onBack }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const mappings = onboarding.mappings || [];

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { data } = await onboardingApi.submit(onboarding.id);
      onUpdate(data);
    } catch {
      // error handled by interceptor
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: 'Source Column',
      dataIndex: 'sourceField',
      key: 'sourceField',
      render: (val: string) => <Tag color="blue">{val}</Tag>,
    },
    ...(!isMobile ? [{
      title: '',
      key: 'arrow',
      width: 40,
      render: () => <Text type="secondary">&rarr;</Text>,
    }] : []),
    {
      title: 'GrowthZone Field',
      dataIndex: 'targetField',
      key: 'targetField',
      render: (val: string) => <Tag color="green">{val}</Tag>,
    },
    ...(!isMobile ? [{
      title: 'Transformation',
      dataIndex: 'transformation',
      key: 'transformation',
      render: (val: string) => val ? <Tag>{val}</Tag> : <Text type="secondary">Direct copy</Text>,
    }] : []),
  ];

  return (
    <div style={{ maxWidth: isMobile ? '100%' : 800, margin: '0 auto' }}>
      <Card>
        <Title level={4}>Review Your Mappings</Title>
        <Text type="secondary">
          Please review the column mappings below before submitting. You can go back to make changes.
        </Text>

        {mappings.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="No mappings defined"
            description="Go back to the mapping step and map at least one column."
            style={{ margin: '24px 0' }}
          />
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message={`${mappings.length} column mapping${mappings.length !== 1 ? 's' : ''} configured`}
              description={`Source file: ${onboarding.originalFilename} (${onboarding.rowCount} rows)`}
              style={{ margin: '24px 0' }}
            />

            <Table
              columns={columns}
              dataSource={mappings.map((m: any, i: number) => ({ ...m, key: i }))}
              pagination={false}
              size={isMobile ? 'small' : 'middle'}
              scroll={isMobile ? { x: 300 } : undefined}
            />
          </>
        )}

        <div style={{ marginTop: 24, display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', gap: isMobile ? 12 : 0 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack} block={isMobile}>Back to Mapping</Button>
          <Popconfirm
            title="Submit mappings?"
            description="This will submit your column mappings for processing."
            onConfirm={handleSubmit}
            disabled={mappings.length === 0}
          >
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={submitting}
              disabled={mappings.length === 0}
              size="large"
              block={isMobile}
            >
              Submit Mappings
            </Button>
          </Popconfirm>
        </div>
      </Card>
    </div>
  );
}
