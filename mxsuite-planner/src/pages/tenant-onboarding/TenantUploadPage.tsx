import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Typography, Upload, Button, Table, Modal, Radio, Space, Tag, message,
} from 'antd';
import {
  InboxOutlined, FileExcelOutlined, ArrowRightOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { UploadResultDto, UploadPreviewDto } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

export default function TenantUploadPage() {
  usePageTitle('Data Upload');
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResultDto | null>(null);
  const [preview, setPreview] = useState<UploadPreviewDto | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Sheet selection state
  const [sheetModalOpen, setSheetModalOpen] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<number>(0);
  const [selectingSheet, setSelectingSheet] = useState(false);

  // Re-upload confirmation state
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Load existing preview on mount
  useEffect(() => {
    setLoadingPreview(true);
    tenantOnboardingApi.getUploadPreview()
      .then(({ data }) => setPreview(data))
      .catch(() => { /* no upload yet */ })
      .finally(() => setLoadingPreview(false));
  }, []);

  /** After upload or sheet-select, check if we need user confirmation or can proceed. */
  const handleUploadResponse = async (data: UploadResultDto) => {
    setUploadResult(data);

    if (data.needsSheetSelection && data.sheets && data.sheets.length > 1) {
      setSheetModalOpen(true);
      return;
    }

    if (data.hasExistingMappings) {
      // Needs confirmation — file is stored but mappings not processed yet
      setConfirmModalOpen(true);
      return;
    }

    // No existing mappings — already processed, load preview
    const { data: prev } = await tenantOnboardingApi.getUploadPreview();
    setPreview(prev);
    message.success(`File uploaded: ${data.originalFilename} (${data.rowCount.toLocaleString()} rows)`);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { data } = await tenantOnboardingApi.upload(file);
      await handleUploadResponse(data);
    } catch {
      message.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
    return false; // prevent antd auto-upload
  };

  const handleSheetSelect = async () => {
    setSelectingSheet(true);
    try {
      const { data } = await tenantOnboardingApi.selectSheet(selectedSheet);
      setSheetModalOpen(false);
      await handleUploadResponse(data);
    } catch {
      message.error('Failed to select sheet');
    } finally {
      setSelectingSheet(false);
    }
  };

  /** Confirm re-upload: preserveApproved=true keeps user's mapping work. */
  const handleConfirmUpload = async (preserveApproved: boolean) => {
    setConfirming(true);
    try {
      await tenantOnboardingApi.confirmUpload(preserveApproved);
      setConfirmModalOpen(false);

      const { data: prev } = await tenantOnboardingApi.getUploadPreview();
      setPreview(prev);

      if (preserveApproved) {
        message.success('File uploaded — your approved mappings have been preserved.');
      } else {
        message.success('File uploaded — all mappings have been reset.');
      }
    } catch {
      message.error('Failed to process upload');
    } finally {
      setConfirming(false);
    }
  };

  const previewColumns = preview?.headers.map((h, i) => ({
    title: h,
    dataIndex: i.toString(),
    key: i.toString(),
    ellipsis: true,
    width: 150,
  })) || [];

  const previewData = preview?.rows.map((row, idx) => {
    const obj: Record<string, string> = { key: idx.toString() };
    row.forEach((val, col) => { obj[col.toString()] = val; });
    return obj;
  }) || [];

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Upload Data</Title>
        <Text style={{ color: '#6b4fa0' }}>
          Upload your data file (CSV or Excel). We'll detect the columns and help you map them.
        </Text>
      </div>
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* Upload area */}
      <Card style={{ marginTop: 16, marginBottom: 24, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
        <Dragger
          beforeUpload={(file) => handleUpload(file as unknown as File)}
          showUploadList={false}
          accept=".csv,.xlsx,.xls"
          disabled={uploading}
          style={{ padding: '20px 0', borderColor: '#e0d4f5' }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ fontSize: 48, color: '#2d1854' }} />
          </p>
          <p className="ant-upload-text" style={{ color: '#2d1854' }}>
            {uploading ? 'Uploading...' : 'Click or drag file to upload'}
          </p>
          <p className="ant-upload-hint" style={{ color: '#6b4fa0' }}>
            Supports CSV, Excel (.xlsx, .xls). Max 50 MB.
          </p>
        </Dragger>
      </Card>

      {/* Preview */}
      {preview && preview.headers.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <Title level={5} style={{ marginBottom: 0, color: '#2d1854' }}>Data Preview</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {preview.totalRows.toLocaleString()} rows detected · {preview.headers.length} columns
              </Text>
            </div>
            <Button
              type="primary"
              icon={<ArrowRightOutlined />}
              onClick={() => navigate('/plans/my-onboarding/mappings')}
              style={{ background: '#2d1854', borderColor: '#2d1854' }}
            >
              Proceed to Mappings
            </Button>
          </div>

          <Card size="small" style={{ marginBottom: 16, borderColor: '#e0d4f5' }}>
            <Space wrap>
              {preview.headers.map((h) => (
                <Tag key={h} style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>{h}</Tag>
              ))}
            </Space>
          </Card>

          <Table
            columns={previewColumns}
            dataSource={previewData}
            pagination={false}
            size="small"
            scroll={{ x: 'max-content' }}
            bordered
          />
        </>
      )}

      {/* Sheet selection modal */}
      <Modal
        title="Select Sheet"
        open={sheetModalOpen}
        onOk={handleSheetSelect}
        onCancel={() => setSheetModalOpen(false)}
        confirmLoading={selectingSheet}
        okText="Use This Sheet"
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
      >
        <Paragraph type="secondary">
          Your Excel file has multiple sheets. Select the one containing your data:
        </Paragraph>
        <Radio.Group
          value={selectedSheet}
          onChange={(e) => setSelectedSheet(e.target.value)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {uploadResult?.sheets?.map((sheet) => (
            <Radio key={sheet.name} value={sheet.rowCount}>
              <Space>
                <FileExcelOutlined style={{ color: '#52c41a' }} />
                <Text strong>{sheet.name}</Text>
                <Text type="secondary">({sheet.rowCount.toLocaleString()} rows)</Text>
              </Space>
            </Radio>
          )) ?? null}
        </Radio.Group>
      </Modal>

      {/* Re-upload confirmation modal */}
      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: '#faad14' }} />
            Existing Mappings Detected
          </Space>
        }
        open={confirmModalOpen}
        onCancel={() => setConfirmModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setConfirmModalOpen(false)} disabled={confirming}>
            Cancel
          </Button>,
          <Button
            key="fresh"
            danger
            onClick={() => handleConfirmUpload(false)}
            loading={confirming}
          >
            Start Fresh
          </Button>,
          <Button
            key="keep"
            type="primary"
            onClick={() => handleConfirmUpload(true)}
            loading={confirming}
            style={{ background: '#2d1854', borderColor: '#2d1854' }}
          >
            Keep Approved Mappings
          </Button>,
        ]}
        closable={!confirming}
        maskClosable={false}
      >
        <Paragraph>
          You have <Text strong>{uploadResult?.existingMappedCount ?? 0} finalized mapping{(uploadResult?.existingMappedCount ?? 0) !== 1 ? 's' : ''}</Text> from
          your previous upload.
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          <Text strong>Keep Approved Mappings</Text> — preserves fields you already approved or
          skipped and only re-maps unchanged fields.
        </Paragraph>
        <Paragraph type="secondary">
          <Text strong>Start Fresh</Text> — removes all existing mappings and auto-maps
          everything from scratch.
        </Paragraph>
      </Modal>
    </div>
    </div>
  );
}
