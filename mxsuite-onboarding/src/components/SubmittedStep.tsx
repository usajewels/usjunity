import { useState, useEffect, useRef } from 'react';
import { Card, Button, Space, Popconfirm, message, Grid, Typography, Divider } from 'antd';
import { EditOutlined, RedoOutlined } from '@ant-design/icons';
import type { Onboarding, StagingStatusDto, PipelineStatusDto, DataHealthDto } from '@mxsuite/shared';
import { onboardingApi } from '../services/api';
import PipelineStatus from './PipelineStatus';

const { Title } = Typography;

interface Props {
  onboarding: Onboarding;
  onUpdate: (ob: Onboarding) => void;
  onReset: () => void;
}

export default function SubmittedStep({ onboarding, onUpdate, onReset }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState<string | null>(null);
  const [stagingStatus, setStagingStatus] = useState<StagingStatusDto | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatusDto | null>(null);
  const [dataHealth, setDataHealth] = useState<DataHealthDto | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll pipeline status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [staging, pipeline, health] = await Promise.allSettled([
          onboardingApi.stagingStatus(),
          onboardingApi.pipelineStatus(),
          onboardingApi.dataHealth(),
        ]);
        if (staging.status === 'fulfilled') setStagingStatus(staging.value.data);
        if (pipeline.status === 'fulfilled') setPipelineStatus(pipeline.value.data);
        if (health.status === 'fulfilled') setDataHealth(health.value.data);
      } catch {
        // silently ignore
      }
    };

    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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
    <div style={{ maxWidth: isMobile ? '100%' : 700, margin: isMobile ? '16px auto' : '40px auto' }}>
      <Card>
        <Title level={4} style={{ marginBottom: 4 }}>Onboarding Progress</Title>

        <PipelineStatus
          stagingStatus={stagingStatus}
          pipelineStatus={pipelineStatus}
          dataHealth={dataHealth}
          uploadFilename={onboarding.originalFilename}
          rowCount={onboarding.rowCount}
        />

        {onboarding.status !== 'COMPLETED' && (
          <>
            <Divider />
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
          </>
        )}
      </Card>
    </div>
  );
}
