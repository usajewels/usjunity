import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Typography, Upload, Button, Table, Modal, Radio, Space, Tag, Spin, Progress, message,
} from 'antd';
import {
  InboxOutlined, FileExcelOutlined, ArrowRightOutlined,
  ExclamationCircleOutlined, LoadingOutlined, CloudUploadOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import type { UploadResultDto, UploadPreviewDto, ImportStatusDto } from '@mxsuite/shared';
import { usePageTitle, useWebSocket } from '@mxsuite/shared';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';
import { isLargeFile, isCsvFile, extractCsvPreview } from '../../utils/csvPreview';
import { chunkedUpload, type ChunkProgress } from '../../utils/chunkedUpload';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const LARGE_FILE_THRESHOLD_MB = 50;

export default function TenantUploadPage() {
  usePageTitle('Data Upload');
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResultDto | null>(null);
  const [preview, setPreview] = useState<UploadPreviewDto | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);

  // Sheet selection state
  const [sheetModalOpen, setSheetModalOpen] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<number>(0);
  const [selectingSheet, setSelectingSheet] = useState(false);

  // Re-upload confirmation state
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Import state
  const [importStatus, setImportStatus] = useState<ImportStatusDto | null>(null);
  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null);
  const [importing, setImporting] = useState(false);
  const largeFileRef = useRef<File | null>(null);

  // WebSocket for real-time import progress
  const wsToken = localStorage.getItem('mxsuite_token') ?? undefined;
  const { subscribe } = useWebSocket({ token: wsToken });

  // Load existing preview + import status on mount
  useEffect(() => {
    setLoadingPreview(true);
    Promise.all([
      tenantOnboardingApi.getUploadPreview().catch(() => null),
      tenantOnboardingApi.getImportStatus().catch(() => null),
    ]).then(([previewRes, statusRes]) => {
      if (previewRes?.data) setPreview(previewRes.data);
      if (statusRes?.data) {
        setImportStatus(statusRes.data);
        setIsPreviewOnly(statusRes.data.isPreviewOnly);
      }
    }).finally(() => setLoadingPreview(false));
  }, []);

  // Subscribe to import progress via WebSocket
  useEffect(() => {
    const unsub = subscribe('/user/queue/import-progress', (msg: unknown) => {
      setImportStatus(msg as ImportStatusDto);
    });
    return unsub;
  }, [subscribe]);

  /** After upload or sheet-select, check if we need user confirmation or can proceed. */
  const handleUploadResponse = async (data: UploadResultDto, previewOnly?: boolean) => {
    setUploadResult(data);

    if (data.needsSheetSelection && data.sheets && data.sheets.length > 1) {
      setSheetModalOpen(true);
      return;
    }

    if (data.hasExistingMappings) {
      setConfirmModalOpen(true);
      return;
    }

    // No existing mappings — already processed, load preview
    const { data: prev } = await tenantOnboardingApi.getUploadPreview();
    setPreview(prev);
    if (previewOnly) {
      setIsPreviewOnly(true);
      message.success(`Preview extracted: ${data.originalFilename} (${data.rowCount.toLocaleString()} rows). Proceed to mappings, then start full import.`);
    } else {
      message.success(`File uploaded: ${data.originalFilename} (${data.rowCount.toLocaleString()} rows)`);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      // Large CSV files: extract preview client-side instead of uploading the whole file
      if (isCsvFile(file) && isLargeFile(file, LARGE_FILE_THRESHOLD_MB)) {
        largeFileRef.current = file;
        const csvText = await extractCsvPreview(file, 1000);
        const { data } = await tenantOnboardingApi.uploadPreview(csvText, file.name, file.size);
        await handleUploadResponse(data, true);
      } else {
        // Normal upload for small files and Excel
        const { data } = await tenantOnboardingApi.upload(file);
        setIsPreviewOnly(false);
        await handleUploadResponse(data);
      }
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

  /** Start full import: chunked upload → start async processing */
  const handleStartImport = async () => {
    const file = largeFileRef.current;
    if (!file) {
      message.error('No file selected. Please re-upload the file.');
      return;
    }

    setImporting(true);
    setChunkProgress(null);
    try {
      // Phase 1: Upload file in chunks
      await chunkedUpload(file, (progress) => {
        setChunkProgress(progress);
      });

      // Phase 2: Start async batch processing
      const { data } = await tenantOnboardingApi.startImport();
      setImportStatus(data);
      setChunkProgress(null);
      message.success('Full import started. You can monitor progress below.');
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to start import');
    } finally {
      setImporting(false);
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

  const isImportActive = importStatus?.status === 'PROCESSING';
  const isImportComplete = importStatus?.status === 'COMPLETED';
  const isImportFailed = importStatus?.status === 'FAILED';
  const showImportSection = isPreviewOnly || isImportActive || isImportComplete || isImportFailed;

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
          disabled={uploading || importing}
          style={{ padding: '20px 0', borderColor: '#e0d4f5' }}
        >
          {uploading ? (
            <>
              <p className="ant-upload-drag-icon">
                <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: '#2d1854' }} spin />} />
              </p>
              <p className="ant-upload-text" style={{ color: '#2d1854', fontWeight: 600 }}>
                Uploading and processing your file...
              </p>
              <p className="ant-upload-hint" style={{ color: '#6b4fa0' }}>
                This may take a moment for large files. Please do not close this page.
              </p>
            </>
          ) : (
            <>
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ fontSize: 48, color: '#2d1854' }} />
              </p>
              <p className="ant-upload-text" style={{ color: '#2d1854' }}>
                Click or drag file to upload
              </p>
              <p className="ant-upload-hint" style={{ color: '#6b4fa0' }}>
                Supports CSV, Excel (.xlsx, .xls). Large CSV files ({'>'}50 MB) will extract a preview automatically.
              </p>
            </>
          )}
        </Dragger>
      </Card>

      {/* Import progress section — shown for preview-only uploads */}
      {showImportSection && (
        <Card
          style={{ marginBottom: 24, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}
          title={<Text strong style={{ color: '#2d1854' }}>Full Data Import</Text>}
        >
          {/* Not yet started */}
          {isPreviewOnly && !isImportActive && !isImportComplete && !isImportFailed && !importing && !chunkProgress && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <CloudUploadOutlined style={{ fontSize: 36, color: '#6b4fa0', marginBottom: 8 }} />
              <Paragraph type="secondary">
                A preview of your data has been uploaded for mapping. After reviewing and approving your mappings,
                start the full import to process all rows.
              </Paragraph>
              <Button
                type="primary"
                size="large"
                icon={<CloudUploadOutlined />}
                onClick={handleStartImport}
                style={{ background: '#2d1854', borderColor: '#2d1854' }}
              >
                Start Full Import
              </Button>
            </div>
          )}

          {/* Chunked upload in progress */}
          {chunkProgress && (
            <div style={{ padding: '8px 0' }}>
              <Text strong style={{ color: '#2d1854' }}>
                Uploading file... ({chunkProgress.chunkIndex + 1} / {chunkProgress.totalChunks} chunks)
              </Text>
              <Progress
                percent={chunkProgress.pct}
                strokeColor="#2d1854"
                status="active"
                style={{ marginTop: 8 }}
              />
            </div>
          )}

          {/* Processing in progress */}
          {isImportActive && (
            <div style={{ padding: '8px 0' }}>
              <Space style={{ marginBottom: 8 }}>
                <Spin indicator={<LoadingOutlined style={{ color: '#2d1854' }} spin />} />
                <Text strong style={{ color: '#2d1854' }}>
                  Processing... {importStatus.importedRowCount.toLocaleString()} / {importStatus.totalRowCount.toLocaleString()} rows
                </Text>
              </Space>
              <Progress
                percent={importStatus.progressPct}
                strokeColor="#2d1854"
                status="active"
              />
            </div>
          )}

          {/* Complete */}
          {isImportComplete && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <CheckCircleOutlined style={{ fontSize: 36, color: '#52c41a', marginBottom: 8 }} />
              <Paragraph>
                <Text strong style={{ color: '#52c41a' }}>Import complete!</Text>
              </Paragraph>
              <Text type="secondary">
                {importStatus!.importedRowCount.toLocaleString()} rows imported successfully.
              </Text>
            </div>
          )}

          {/* Failed */}
          {isImportFailed && (
            <div style={{ padding: '8px 0' }}>
              <Text type="danger" strong>Import failed</Text>
              {importStatus!.error && (
                <Paragraph type="secondary" style={{ marginTop: 4 }}>
                  {importStatus!.error}
                </Paragraph>
              )}
              <div style={{ marginTop: 12 }}>
                <Button
                  type="primary"
                  danger
                  onClick={handleStartImport}
                >
                  Retry Import
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Preview */}
      {preview && preview.headers.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <Title level={5} style={{ marginBottom: 0, color: '#2d1854' }}>Data Preview</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {preview.totalRows.toLocaleString()} rows detected · {preview.headers.length} columns
                {isPreviewOnly && ' (preview only)'}
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
