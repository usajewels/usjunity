import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Typography, Upload, Button, Table, Modal, Radio, Space, Tag, Spin, Progress, message,
  Checkbox, Input, Alert, Tabs,
} from 'antd';
import {
  InboxOutlined, FileExcelOutlined, ArrowRightOutlined,
  ExclamationCircleOutlined, LoadingOutlined, CloudUploadOutlined,
  CheckCircleOutlined, DatabaseOutlined, FolderOpenOutlined,
  TableOutlined,
} from '@ant-design/icons';
import type { UploadResultDto, UploadPreviewDto, ImportStatusDto } from '@mxsuite/shared';
import { usePageTitle, useWebSocket } from '@mxsuite/shared';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';
import { isLargeFile, isCsvFile, extractCsvPreview } from '../../utils/csvPreview';
import { chunkedUpload, type ChunkProgress } from '../../utils/chunkedUpload';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const LARGE_FILE_THRESHOLD_MB = 50;

/** Per-table data preview with column tag cloud for .bak files */
function BakTablePreview({ grouped, tblNames, rowCounts }: {
  grouped: Record<string, { name: string; sampleValues: string[]; tableName?: string; dataType?: string }[]>;
  tblNames: string[];
  rowCounts: Record<string, number>;
}) {
  // Track selected column index per table
  const [selectedCol, setSelectedCol] = useState<Record<string, number>>({});
  const tableRef = useRef<HTMLDivElement>(null);
  // How many columns to show around the selected one in the data table
  const WINDOW = 7;

  return (
    <Card style={{ marginBottom: 80, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
      <Title level={5} style={{ marginBottom: 12, color: '#2d1854' }}>
        <DatabaseOutlined style={{ marginRight: 8 }} />
        Data Preview
      </Title>
      <Tabs
        type="card"
        items={tblNames.map(tbl => {
          const allCols = grouped[tbl];
          const rc = rowCounts[tbl] ?? 0;
          const sel = selectedCol[tbl] ?? -1;

          // Determine visible columns: window around selected, or first WINDOW if none selected
          let visibleStart: number;
          let visibleEnd: number;
          if (sel >= 0) {
            const half = Math.floor(WINDOW / 2);
            visibleStart = Math.max(0, sel - half);
            visibleEnd = Math.min(allCols.length, visibleStart + WINDOW);
            // Adjust start if we hit the end
            if (visibleEnd === allCols.length) {
              visibleStart = Math.max(0, visibleEnd - WINDOW);
            }
          } else {
            visibleStart = 0;
            visibleEnd = Math.min(allCols.length, WINDOW);
          }
          const visibleCols = allCols.slice(visibleStart, visibleEnd);

          // Transpose sampleValues to rows for visible columns
          const maxRows = Math.max(...visibleCols.map(c => c.sampleValues?.length ?? 0), 0);
          const tableColumns = visibleCols.map((col, ci) => {
            const globalIdx = visibleStart + ci;
            const colName = col.name?.includes('.') ? col.name.split('.').pop() : col.name;
            const isSelected = globalIdx === sel;
            return {
              title: (
                <span style={{
                  fontWeight: isSelected ? 700 : 400,
                  color: isSelected ? '#531dab' : undefined,
                }}>
                  {colName}
                </span>
              ),
              dataIndex: ci.toString(),
              key: `${globalIdx}`,
              ellipsis: true,
              width: 160,
              onHeaderCell: () => ({
                style: isSelected ? { background: '#f3e8ff', borderBottom: '2px solid #722ed1' } : {},
              }),
              onCell: () => ({
                style: isSelected ? { background: '#faf5ff' } : {},
              }),
            };
          });
          const tableData = Array.from({ length: maxRows }, (_, ri) => {
            const row: Record<string, string> = { key: ri.toString() };
            visibleCols.forEach((col, ci) => {
              row[ci.toString()] = col.sampleValues?.[ri] ?? '';
            });
            return row;
          });

          return {
            key: tbl,
            label: (
              <span>
                <TableOutlined style={{ marginRight: 4 }} />
                {tbl}
                {rc > 0 && <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>({rc.toLocaleString()} rows)</Text>}
              </span>
            ),
            children: (
              <div>
                {/* Column tag cloud */}
                <div style={{
                  maxHeight: 140, overflowY: 'auto', marginBottom: 12,
                  padding: '8px 4px', background: '#fafafa', borderRadius: 6,
                  border: '1px solid #f0f0f0',
                }}>
                  {allCols.map((col, idx) => {
                    const colName = col.name?.includes('.') ? col.name.split('.').pop() : col.name;
                    const isSelected = idx === sel;
                    return (
                      <Tag
                        key={idx}
                        color={isSelected ? 'purple' : undefined}
                        style={{
                          cursor: 'pointer',
                          marginBottom: 4,
                          fontWeight: isSelected ? 600 : 400,
                          borderColor: isSelected ? '#722ed1' : undefined,
                        }}
                        onClick={() => {
                          setSelectedCol(prev => ({ ...prev, [tbl]: idx }));
                        }}
                      >
                        {colName}
                      </Tag>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {sel >= 0
                      ? `Showing columns ${visibleStart + 1}–${visibleEnd} of ${allCols.length} (centered on selected)`
                      : `Showing first ${visibleEnd} of ${allCols.length} columns — click a column above to navigate`
                    }
                  </Text>
                </div>

                <div ref={tableRef}>
                  <Table
                    dataSource={tableData}
                    columns={tableColumns}
                    pagination={false}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    bordered
                  />
                </div>
                <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                  Showing {maxRows} sample row{maxRows !== 1 ? 's' : ''}
                  {rc > 0 && ` of ${rc.toLocaleString()} total`}
                </Text>
              </div>
            ),
          };
        })}
      />
    </Card>
  );
}

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

  // Table selection state (for .bak files)
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [selectingTables, setSelectingTables] = useState(false);

  // Backup file path state
  const [backupPathMode, setBackupPathMode] = useState(false);
  const [backupPath, setBackupPath] = useState('');
  const [loadingBackupPath, setLoadingBackupPath] = useState(false);

  // SQL Server unavailable state
  const [sqlServerError, setSqlServerError] = useState<string | null>(null);
  const [reExtracting, setReExtracting] = useState(false);

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

  // Load existing preview + import status + current upload on mount
  useEffect(() => {
    setLoadingPreview(true);
    Promise.all([
      tenantOnboardingApi.getUploadPreview().catch(() => null),
      tenantOnboardingApi.getImportStatus().catch(() => null),
      tenantOnboardingApi.getCurrentUpload().catch(() => null),
    ]).then(([previewRes, statusRes, uploadRes]) => {
      if (previewRes?.data) setPreview(previewRes.data);
      if (statusRes?.data) {
        setImportStatus(statusRes.data);
        setIsPreviewOnly(statusRes.data.isPreviewOnly);
      }
      if (uploadRes?.data) setUploadResult(uploadRes.data);
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

    if (data.needsTableSelection && data.tables && data.tables.length > 0) {
      setSelectedTables(data.tables.map(t => t.name));
      setTableModalOpen(true);
      return;
    }

    if (data.hasExistingMappings) {
      setConfirmModalOpen(true);
      return;
    }

    // No existing mappings — already processed, load preview
    if (!data.originalFilename?.toLowerCase().endsWith('.bak')) {
      const { data: prev } = await tenantOnboardingApi.getUploadPreview();
      setPreview(prev);
    }
    if (previewOnly) {
      setIsPreviewOnly(true);
      message.success(`Preview extracted: ${data.originalFilename} (${data.rowCount.toLocaleString()} rows). Proceed to mappings, then start full import.`);
    } else {
      const unit = data.originalFilename?.toLowerCase().endsWith('.bak') ? 'tables' : 'rows';
      message.success(`File uploaded: ${data.originalFilename} (${data.rowCount.toLocaleString()} ${unit})`);
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
        // Check for SQL Server unavailable response (.bak stored but not parsed)
        const anyData = data as unknown as Record<string, unknown>;
        if (anyData.sqlServerError) {
          setSqlServerError(anyData.sqlServerError as string);
          message.warning('Backup file stored, but SQL Server is not available for schema extraction.');
          return;
        }
        setIsPreviewOnly(false);
        setSqlServerError(null);
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

  /** Handle table selection from .bak backup */
  const handleTableSelect = async () => {
    if (selectedTables.length === 0) {
      message.warning('Please select at least one table');
      return;
    }
    setSelectingTables(true);
    try {
      const { data } = await tenantOnboardingApi.selectTables(selectedTables);
      setTableModalOpen(false);
      setUploadResult(data);
      message.success(`${selectedTables.length} table${selectedTables.length !== 1 ? 's' : ''} mapped. Review the extracted schema below.`);
    } catch {
      message.error('Failed to process selected tables');
    } finally {
      setSelectingTables(false);
    }
  };

  /** Handle backup file path submission (for large files on network shares) */
  const handleBackupPathSubmit = async () => {
    if (!backupPath.trim()) {
      message.warning('Please enter a file path');
      return;
    }
    setLoadingBackupPath(true);
    try {
      const { data } = await tenantOnboardingApi.uploadBackupPath(backupPath.trim());
      const anyData = data as unknown as Record<string, unknown>;
      if (anyData.sqlServerError) {
        setSqlServerError(anyData.sqlServerError as string);
        message.warning('Backup file stored, but SQL Server is not available for schema extraction.');
        return;
      }
      setIsPreviewOnly(false);
      setSqlServerError(null);
      await handleUploadResponse(data);
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : 'Failed to process backup file';
      message.error(msg || 'Failed to process backup file');
    } finally {
      setLoadingBackupPath(false);
    }
  };

  /** Re-extract schema from stored .bak file (retry after SQL Server becomes available) */
  const handleReExtract = async () => {
    setReExtracting(true);
    try {
      const { data } = await tenantOnboardingApi.reExtractSchema();
      setSqlServerError(null);
      setIsPreviewOnly(false);
      await handleUploadResponse(data);
      message.success('Schema extracted successfully!');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : 'Schema extraction failed';
      message.error(msg || 'Schema extraction failed. Is SQL Server running?');
    } finally {
      setReExtracting(false);
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
          Upload your data file (CSV, Excel, or SQL Server backup). We'll detect the columns and help you map them.
        </Text>
      </div>
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* Upload area */}
      <Card style={{ marginTop: 16, marginBottom: 24, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
        <Dragger
          beforeUpload={(file) => handleUpload(file as unknown as File)}
          showUploadList={false}
          accept=".csv,.xlsx,.xls,.bak"
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
                Supports CSV, Excel (.xlsx, .xls), and SQL Server Backup (.bak).
                Large CSV files ({'>'}50 MB) will extract a preview automatically.
              </p>
            </>
          )}
        </Dragger>
      </Card>

      {/* Backup file path option — for large .bak files on network shares */}
      <Card
        size="small"
        style={{ marginBottom: 24, borderColor: '#e0d4f5' }}
      >
        <Space align="center" style={{ marginBottom: backupPathMode ? 12 : 0 }}>
          <DatabaseOutlined style={{ color: '#6b4fa0' }} />
          <Text type="secondary">
            Have a large SQL Server backup on a network share?
          </Text>
          <Button
            type="link"
            size="small"
            onClick={() => setBackupPathMode(!backupPathMode)}
            style={{ color: '#2d1854', padding: 0 }}
          >
            {backupPathMode ? 'Hide' : 'Provide file path instead'}
          </Button>
        </Space>
        {backupPathMode && (
          <div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                prefix={<FolderOpenOutlined />}
                placeholder="\\server\share\backup.bak or /mnt/data/backup.bak"
                value={backupPath}
                onChange={(e) => setBackupPath(e.target.value)}
                onPressEnter={handleBackupPathSubmit}
                disabled={loadingBackupPath}
              />
              <Button
                type="primary"
                onClick={handleBackupPathSubmit}
                loading={loadingBackupPath}
                style={{ background: '#2d1854', borderColor: '#2d1854' }}
              >
                Load Backup
              </Button>
            </Space.Compact>
            <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              Enter a path accessible from the server. No file size limit — the backup is read directly.
            </Text>
          </div>
        )}
      </Card>

      {/* SQL Server unavailable — .bak stored but not parsed */}
      {sqlServerError && (
        <Alert
          type="warning"
          showIcon
          icon={<DatabaseOutlined />}
          message="SQL Server Not Available"
          description={
            <div>
              <Paragraph style={{ marginBottom: 8 }}>{sqlServerError}</Paragraph>
              <Button
                type="primary"
                icon={<DatabaseOutlined />}
                onClick={handleReExtract}
                loading={reExtracting}
                style={{ background: '#2d1854', borderColor: '#2d1854' }}
              >
                Re-extract Schema
              </Button>
            </div>
          }
          style={{ marginBottom: 24 }}
        />
      )}

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

      {/* (Schema summary card removed — tabbed data preview below replaces it) */}

      {/* Tabbed data preview per table — shown when .bak sourceColumns have sampleValues */}
      {uploadResult && !tableModalOpen && !confirmModalOpen
        && uploadResult.originalFilename?.toLowerCase().endsWith('.bak')
        && uploadResult.sourceColumns && uploadResult.sourceColumns.length > 0
        && uploadResult.sourceColumns.some(c => c.sampleValues && c.sampleValues.length > 0) && (() => {
        // Group columns by table
        const grouped: Record<string, typeof uploadResult.sourceColumns> = {};
        for (const col of uploadResult.sourceColumns) {
          const tbl = col.tableName || 'Unknown';
          if (!grouped[tbl]) grouped[tbl] = [];
          grouped[tbl].push(col);
        }
        const tblNames = Object.keys(grouped);
        // Get row counts from tables metadata, fallback to tableRowCount from sourceColumns
        const rowCounts: Record<string, number> = {};
        if (uploadResult.tables && uploadResult.tables.length > 0) {
          for (const t of uploadResult.tables) {
            rowCounts[t.name] = t.rowCount ?? 0;
          }
        } else {
          // Fallback: use tableRowCount stored per column in sourceColumns
          for (const col of uploadResult.sourceColumns) {
            const tbl = col.tableName || 'Unknown';
            if (col.tableRowCount && !rowCounts[tbl]) {
              rowCounts[tbl] = col.tableRowCount;
            }
          }
        }

        return (
          <BakTablePreview
            grouped={grouped}
            tblNames={tblNames}
            rowCounts={rowCounts}
          />
        );
      })()}

      {/* Preview — CSV/Excel only (not .bak, which uses the tabbed preview above) */}
      {preview && preview.headers.length > 0
        && !uploadResult?.originalFilename?.toLowerCase().endsWith('.bak') && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Title level={5} style={{ marginBottom: 0, color: '#2d1854' }}>Data Preview</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {preview.totalRows.toLocaleString()} rows detected · {preview.headers.length} columns
              {isPreviewOnly && ' (preview only)'}
            </Text>
          </div>

          <Table
            columns={previewColumns}
            dataSource={previewData}
            pagination={false}
            size="small"
            scroll={{ x: 'max-content' }}
            bordered
            style={{ marginBottom: 60 }}
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

      {/* Table selection modal (for .bak backups) */}
      <Modal
        title={
          <Space>
            <DatabaseOutlined style={{ color: '#2d1854' }} />
            Select Tables to Map
          </Space>
        }
        open={tableModalOpen}
        onOk={handleTableSelect}
        onCancel={() => setTableModalOpen(false)}
        confirmLoading={selectingTables}
        okText={`Map ${selectedTables.length} Table${selectedTables.length !== 1 ? 's' : ''}`}
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' }, disabled: selectedTables.length === 0 }}
        width={600}
      >
        <Alert
          type="info"
          message={`Database backup contains ${uploadResult?.tables?.length ?? 0} tables. Select the ones you want to map to the target schema.`}
          style={{ marginBottom: 16 }}
          showIcon
        />
        <div style={{ marginBottom: 12 }}>
          <Space>
            <Button
              size="small"
              onClick={() => setSelectedTables(uploadResult?.tables?.map(t => t.name) ?? [])}
            >
              Select All
            </Button>
            <Button size="small" onClick={() => setSelectedTables([])}>
              Deselect All
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {selectedTables.length} of {uploadResult?.tables?.length ?? 0} selected
            </Text>
          </Space>
        </div>
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          <Checkbox.Group
            value={selectedTables}
            onChange={(vals) => setSelectedTables(vals as string[])}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {uploadResult?.tables?.map((table) => (
              <Checkbox key={table.name} value={table.name}>
                <Space>
                  <DatabaseOutlined style={{ color: '#6b4fa0' }} />
                  <Text strong>{table.schema}.{table.name}</Text>
                  <Text type="secondary">
                    ({table.columnCount} columns{table.rowCount ? `, ${table.rowCount.toLocaleString()} rows` : ''})
                  </Text>
                </Space>
              </Checkbox>
            )) ?? null}
          </Checkbox.Group>
        </div>
      </Modal>

      {/* Floating bottom bar — Proceed to Mappings (for .bak and CSV/Excel) */}
      {((uploadResult && !tableModalOpen && !confirmModalOpen
        && uploadResult.originalFilename?.toLowerCase().endsWith('.bak')
        && uploadResult.sourceColumns && uploadResult.sourceColumns.length > 0 && !preview)
        || (preview && preview.headers.length > 0)) && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#fff',
          borderTop: '2px solid #2d1854',
          padding: '12px 32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 100,
          boxShadow: '0 -4px 12px rgba(0,0,0,0.08)',
        }}>
          <Space size="large">
            <CheckCircleOutlined style={{ fontSize: 20, color: '#52c41a' }} />
            <div>
              <Text strong style={{ color: '#2d1854' }}>
                {uploadResult?.originalFilename}
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {uploadResult?.originalFilename?.toLowerCase().endsWith('.bak')
                  ? `${uploadResult.sourceColumns?.length ?? 0} columns across ${uploadResult.tables?.length ?? uploadResult.rowCount} tables`
                  : `${preview?.totalRows.toLocaleString() ?? uploadResult?.rowCount.toLocaleString()} rows · ${preview?.headers.length ?? uploadResult?.sourceColumns?.length ?? 0} columns`
                }
                {' — ready for field mapping'}
              </Text>
            </div>
          </Space>
          <Button
            type="primary"
            size="large"
            icon={<ArrowRightOutlined />}
            onClick={() => navigate('/plans/my-onboarding/mappings')}
            style={{ background: '#2d1854', borderColor: '#2d1854', height: 44, paddingInline: 32, fontWeight: 600 }}
          >
            Proceed to Mappings
          </Button>
        </div>
      )}

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
