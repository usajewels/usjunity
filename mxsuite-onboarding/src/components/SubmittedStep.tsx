import { useState } from 'react';
import { Result, Card, Button, Space, Popconfirm, message, Grid } from 'antd';
import { CheckCircleOutlined, EditOutlined, RedoOutlined } from '@ant-design/icons';
import type { Onboarding } from '@mxsuite/shared';
import { onboardingApi } from '../services/api';

interface Props {
  onboarding: Onboarding;
  onUpdate: (ob: Onboarding) => void;
  onReset: () => void;
}

export default function SubmittedStep({ onboarding, onUpdate, onReset }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const isCompleted = onboarding.status === 'COMPLETED';
  const [loading, setLoading] = useState<string | null>(null);

  const handleReopen = async () => {
    setLoading('reopen');
    try {
      const { data } = await onboardingApi.reopen(onboarding.id);
      onUpdate(data);
      message.success('Onboarding reopened — you can now edit your mappings.');
    } catch {
      message.error('Failed to reopen onboarding');
    } finally {
      setLoading(null);
    }
  };

  const handleReset = async () => {
    setLoading('reset');
    try {
      await onboardingApi.reset(onboarding.id);
      message.success('Onboarding reset — starting fresh.');
      onReset();
    } catch {
      message.error('Failed to reset onboarding');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ maxWidth: isMobile ? '100%' : 600, margin: isMobile ? '16px auto' : '40px auto' }}>
      <Card>
        <Result
          icon={<CheckCircleOutlined style={{ color: isCompleted ? '#52c41a' : '#1e3a5f' }} />}
          status={isCompleted ? 'success' : 'info'}
          title={isCompleted ? 'Onboarding Complete!' : 'Mappings Submitted'}
          subTitle={
            isCompleted
              ? 'Your data has been successfully onboarded into MemberSuite.'
              : 'Your column mappings have been submitted. Your GrowthZone representative will review and finalize the import.'
          }
          extra={
            !isCompleted && (
              <Space>
                <Button
                  icon={<EditOutlined />}
                  onClick={handleReopen}
                  loading={loading === 'reopen'}
                >
                  Edit Mappings
                </Button>
                <Popconfirm
                  title="Start over?"
                  description="This will delete your current onboarding including the uploaded file. You'll need to upload and map again."
                  onConfirm={handleReset}
                >
                  <Button
                    danger
                    icon={<RedoOutlined />}
                    loading={loading === 'reset'}
                  >
                    Start Over
                  </Button>
                </Popconfirm>
              </Space>
            )
          }
        />
      </Card>
    </div>
  );
}
