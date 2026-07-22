import { useState } from 'react';
import { Upload, Button, Card, Table, Typography, Space, Modal, Radio, message, Alert, Grid } from 'antd';
import { InboxOutlined, ArrowLeftOutlined, ArrowRightOutlined, FileExcelOutlined } from '@ant-design/icons';
import type { Onboarding } from '@mxsuite/shared';
import { onboardingApi } from '../services/api';

const { Dragger } = Upload;
const { Title, Text } = Typography;

interface SheetInfo {
  index: number;
  name: string;
  rowCount: number;
}

interface Props {
  onboarding: Onboarding;
  onUpdate: (ob: Onboarding) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function UploadStep({ onboarding, onUpdate, onNext, onBack }: Props) {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [sheets, setSheets] = useState<SheetInfo[] | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<number>(0);
  const [selectingSheet, setSelectingSheet] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { data } = await onboardingApi.upload(onboarding.id, file);

      // Multi-sheet Excel: show sheet picker
      if (data.needsSheetSelection && data.sheets) {
        setSheets(data.sheets);
        setSelectedSheet(0);
        message.info(`${file.name} has ${data.sheets.length} sheets — please select one`);
        setUploading(false);
        return false;
      }

      message.success(`Uploaded ${file.name} — ${data.rowCount} rows detected`);

      // Fetch preview before updating parent so we stay on this step
      const previewRes = await onboardingApi.preview(data.id);
      setPreview({ headers: previewRes.data.headers, rows: previewRes.data.rows });

      // Keep user on Upload step to see preview — they click "Next" to proceed
      onUpdate({ ...data, currentStep: 1 });
    } catch {
      message.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
    return false; // prevent antd default upload
  };

  const handleSheetSelect = async () => {
    setSelectingSheet(true);
    try {
      const { data } = await onboardingApi.selectSheet(onboarding.id, selectedSheet);
      message.success(`Sheet selected — ${data.rowCount} rows detected`);

      const previewRes = await onboardingApi.preview(data.id);
      setPreview({ headers: previewRes.data.headers, rows: previewRes.data.rows });

      setSheets(null);
      onUpdate({ ...data, currentStep: 1 });
    } catch {
      message.error('Failed to select sheet');
    } finally {
      setSelectingSheet(false);
    }
  };

  const columns = preview?.headers.map((h, i) => ({
    title: h,
    dataIndex: i.toString(),
    key: i.toString(),
    ellipsis: true,
  })) || [];

  const dataSource = preview?.rows.map((row, ri) => {
    const obj: Record<string, string> = { key: ri.toString() };
    row.forEach((val, ci) => { obj[ci.toString()] = val; });
    return obj;
  }) || [];

  return (
    <div style={{ maxWidth: isMobile ? '100%' : 900, margin: '0 auto' }}>
      <Card>
        <Title level={4}>Upload Your Data</Title>
        <Text style={{ color: 'rgba(0,0,0,0.65)' }}>
          Upload a CSV or Excel file containing your data. We'll parse the column headers automatically.
        </Text>

        <div style={{ margin: '24px 0' }}>
          <Dragger
            accept=".csv,.xlsx,.xls"
            showUploadList={false}
            beforeUpload={handleUpload}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">Click or drag your file here</p>
            <p className="ant-upload-hint">Supports CSV and Excel (.xlsx, .xls) files up to 50MB</p>
          </Dragger>
        </div>

        {onboarding.originalFilename && (
          <Alert
            type="success"
            showIcon
            message={`File: ${onboarding.originalFilename} (${onboarding.rowCount} rows)`}
            style={{ marginBottom: 16 }}
          />
        )}

        {preview && preview.rows.length > 0 && (
          <>
            <Title level={5} style={{ marginTop: 24 }}>Data Preview</Title>
            <Table
              columns={columns}
              dataSource={dataSource}
              pagination={false}
              scroll={{ x: 'max-content' }}
              size="small"
            />
          </>
        )}

        <div style={{ marginTop: 24, display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', gap: isMobile ? 12 : 0 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack} block={isMobile}>Back</Button>
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            onClick={onNext}
            disabled={!onboarding.sourceColumns || onboarding.sourceColumns.length === 0}
            block={isMobile}
          >
            Next: Map Columns
          </Button>
        </div>
      </Card>

      <Modal
        title="Select a Sheet"
        open={sheets !== null}
        onOk={handleSheetSelect}
        onCancel={() => setSheets(null)}
        okText="Use This Sheet"
        confirmLoading={selectingSheet}
      >
        <Text style={{ display: 'block', marginBottom: 16, color: 'rgba(0,0,0,0.65)' }}>
          This Excel file contains multiple sheets. Select the one containing your data:
        </Text>
        <Radio.Group
          value={selectedSheet}
          onChange={(e) => setSelectedSheet(e.target.value)}
          style={{ width: '100%' }}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {sheets?.map((s) => (
              <Radio key={s.index} value={s.index} style={{ width: '100%' }}>
                <Space>
                  <FileExcelOutlined style={{ color: '#217346' }} />
                  <Text strong>{s.name}</Text>
                  <Text style={{ color: 'rgba(0,0,0,0.65)' }}>({s.rowCount} rows)</Text>
                </Space>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Modal>
    </div>
  );
}
