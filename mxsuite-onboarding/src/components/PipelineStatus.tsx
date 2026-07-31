import { Steps, Typography, Result } from 'antd';
import {
  CloudUploadOutlined, DatabaseOutlined, AuditOutlined,
  SafetyCertificateOutlined, ExportOutlined,
} from '@ant-design/icons';
import type { StagingStatusDto, PipelineStatusDto, DataHealthDto } from '@mxsuite/shared';

const { Text } = Typography;

interface Props {
  stagingStatus: StagingStatusDto | null;
  pipelineStatus: PipelineStatusDto | null;
  dataHealth: DataHealthDto | null;
  uploadFilename?: string;
  rowCount?: number;
}

type StepStatus = 'finish' | 'process' | 'wait' | 'error';

export default function PipelineStatus({ stagingStatus, pipelineStatus, dataHealth, uploadFilename, rowCount }: Props) {
  // Compute step statuses
  const uploadStatus: StepStatus = uploadFilename ? 'finish' : 'wait';

  let stagingStep: StepStatus = 'wait';
  let stagingDesc = 'Waiting for upload';
  if (stagingStatus) {
    switch (stagingStatus.stagingStatus) {
      case 'STAGING':
        stagingStep = 'process';
        stagingDesc = 'Staging data into the validation engine...';
        break;
      case 'STAGED':
        stagingStep = 'finish';
        stagingDesc = `${rowCount ?? 0} rows staged successfully`;
        break;
      case 'FAILED':
        stagingStep = 'error';
        stagingDesc = stagingStatus.stagingError || 'Staging failed';
        break;
    }
  }

  let reviewStep: StepStatus = 'wait';
  let reviewDesc = 'Waiting for staging';
  if (stagingStatus?.stagingStatus === 'STAGED') {
    if (pipelineStatus?.signedOff) {
      reviewStep = 'finish';
      reviewDesc = 'Mappings reviewed and approved';
    } else {
      reviewStep = 'process';
      reviewDesc = 'Your coach is reviewing your mappings';
    }
  }

  let validationStep: StepStatus = 'wait';
  let validationDesc = 'Waiting for review';
  if (dataHealth && dataHealth.status === 'COMPLETED') {
    validationStep = 'finish';
    validationDesc = `${dataHealth.qualityPct}% quality — ${dataHealth.errorRows} errors, ${dataHealth.warningRows} warnings`;
  } else if (pipelineStatus?.signedOff) {
    validationStep = 'finish';
    validationDesc = pipelineStatus.signerName
      ? `Signed off by ${pipelineStatus.signerName}`
      : 'Validated and signed off';
  } else if (reviewStep === 'process') {
    validationStep = 'wait';
    validationDesc = 'Pending coach review';
  }

  let exportStep: StepStatus = 'wait';
  let exportDesc = 'Pending sign-off';
  if (pipelineStatus?.signedOff) {
    exportStep = 'finish';
    exportDesc = 'Data exported successfully';
  }

  const allDone = exportStep === 'finish';

  if (allDone) {
    return (
      <Result
        status="success"
        title="Your data has been exported successfully!"
        subTitle={pipelineStatus?.signerName
          ? `Signed off by ${pipelineStatus.signerName}. Your data is now in the GrowthZone system.`
          : 'Your data is now in the GrowthZone system.'}
      />
    );
  }

  return (
    <div style={{ padding: '16px 0' }}>
      <Steps
        direction="vertical"
        size="small"
        items={[
          {
            title: 'Upload',
            description: uploadFilename ? `${uploadFilename} (${rowCount ?? 0} rows)` : 'No file uploaded',
            status: uploadStatus,
            icon: <CloudUploadOutlined />,
          },
          {
            title: 'Data Staging',
            description: stagingDesc,
            status: stagingStep,
            icon: <DatabaseOutlined />,
          },
          {
            title: 'Mapping Review',
            description: reviewDesc,
            status: reviewStep,
            icon: <AuditOutlined />,
          },
          {
            title: 'Validation & Sign-Off',
            description: validationDesc,
            status: validationStep,
            icon: <SafetyCertificateOutlined />,
          },
          {
            title: 'Data Export',
            description: exportDesc,
            status: exportStep,
            icon: <ExportOutlined />,
          },
        ]}
      />
      <div style={{ marginTop: 24, padding: '12px 16px', background: '#f9f7ff', borderRadius: 8, border: '1px solid #e0d4f5' }}>
        <Text style={{ color: '#6b4fa0' }}>
          {reviewStep === 'process'
            ? 'Your GrowthZone coach will review your mappings, run validation, and sign off when everything looks good. You\'ll see progress updates here.'
            : stagingStep === 'process'
            ? 'Your data is being staged into the validation engine. This may take a few minutes for large files.'
            : 'Your onboarding is in progress. Check back for status updates.'}
        </Text>
      </div>
    </div>
  );
}
