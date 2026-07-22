import { useEffect, useState } from 'react';
import { Steps, Spin, Typography, Grid, message, Alert } from 'antd';
import type { Onboarding } from '@mxsuite/shared';
import { onboardingApi } from '../services/api';
import WelcomeStep from '../components/WelcomeStep';
import UploadStep from '../components/UploadStep';
import MappingStep from '../components/MappingStep';
import ReviewStep from '../components/ReviewStep';
import SubmittedStep from '../components/SubmittedStep';

const { Title } = Typography;

const STEP_LABELS = ['Welcome', 'Upload Data', 'Map Columns', 'Review', 'Done'];

export default function OnboardingWizard() {
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  useEffect(() => {
    loadOnboarding();
  }, []);

  const loadOnboarding = async () => {
    try {
      const { data } = await onboardingApi.get();
      setOnboarding(data);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        // No onboarding yet — create one
        try {
          const { data } = await onboardingApi.create();
          setOnboarding(data);
        } catch {
          message.error('Failed to create onboarding');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const updateStep = async (step: number, status: string) => {
    if (!onboarding) return;
    try {
      const { data } = await onboardingApi.update(onboarding.id, {
        currentStep: step,
        status,
      });
      setOnboarding(data);
    } catch {
      message.error('Failed to update progress');
    }
  };

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (!onboarding) {
    return <Title level={4} style={{ textAlign: 'center', marginTop: 100 }}>Unable to load onboarding</Title>;
  }

  const currentStep = onboarding.currentStep;
  const isSubmitted = onboarding.status === 'SUBMITTED' || onboarding.status === 'COMPLETED';

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div>
      <Steps
        current={isSubmitted ? 4 : currentStep}
        items={STEP_LABELS.map(label => ({ title: label }))}
        direction={isMobile ? 'vertical' : 'horizontal'}
        size={isMobile ? 'small' : 'default'}
        style={{ marginBottom: 16 }}
      />

      {onboarding.lastModifiedByName && currentStep > 0 && !isSubmitted && (
        <Alert
          type="info"
          showIcon
          message={`Last updated by ${onboarding.lastModifiedByName} on ${formatDate(onboarding.lastModifiedAt)}`}
          style={{ marginBottom: 16 }}
        />
      )}

      {isSubmitted ? (
        <SubmittedStep onboarding={onboarding} onUpdate={setOnboarding} onReset={loadOnboarding} />
      ) : currentStep === 0 ? (
        <WelcomeStep onNext={() => updateStep(1, 'UPLOAD')} />
      ) : currentStep === 1 ? (
        <UploadStep
          onboarding={onboarding}
          onUpdate={setOnboarding}
          onNext={() => updateStep(2, 'MAPPING')}
          onBack={() => updateStep(0, 'WELCOME')}
        />
      ) : currentStep === 2 ? (
        <MappingStep
          onboarding={onboarding}
          onUpdate={setOnboarding}
          onNext={() => updateStep(3, 'REVIEW')}
          onBack={() => updateStep(1, 'UPLOAD')}
        />
      ) : currentStep === 3 ? (
        <ReviewStep
          onboarding={onboarding}
          onUpdate={setOnboarding}
          onBack={() => updateStep(2, 'MAPPING')}
        />
      ) : null}
    </div>
  );
}
