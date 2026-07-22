import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Table, Tag, Typography, Tabs, Button, Select,
  Space, message, Row, Col, Card, Collapse, Tooltip, Modal, Form, Input, Switch, Alert, Checkbox,
  Divider, Progress, List, Spin,
} from 'antd';
import type { TableRowSelection } from 'antd/es/table/interface';
import {
  CheckCircleOutlined, ClockCircleOutlined, DownOutlined, ExclamationCircleOutlined,
  RightOutlined, StopOutlined, ThunderboltOutlined, CheckOutlined, PlusOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';
import { usePageTitle } from '@mxsuite/shared';
import { tenantOnboardingApi } from '../../services/tenantOnboardingApi';
import type { FieldChangeHistoryDto } from '@mxsuite/shared';
import MappingVersionHistory from '../../components/migration/MappingVersionHistory';

const { Title, Text } = Typography;

/* ---------- Resizable column header ---------- */
function ResizableTitle(props: any) {
  const { onResize, width, ...restProps } = props;
  if (!width) return <th {...restProps} />;
  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          style={{ position: 'absolute', right: -5, bottom: 0, top: 0, width: 10, cursor: 'col-resize', zIndex: 1 }}
          onClick={(e) => e.stopPropagation()}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  );
}

interface MappingEntry {
  id: string;
  sourceField: string;
  sampleValue?: string;
  targetEntity?: string;
  targetField?: string;
  confidencePct?: number;
  mappingStatus: string;
  customerComment?: string;
  candidates?: Array<{ id: string; targetField: string; matchPct: number; description?: string }>;
}

interface GzField {
  entity: string;
  name: string;
  label: string;
  required: boolean;
  description: string;
  custom?: boolean;
}

const DEFAULT_GZ_FIELDS: GzField[] = [
  { entity: 'Contact', name: 'firstName', label: 'First Name', required: true, description: 'Contact first name' },
  { entity: 'Contact', name: 'lastName', label: 'Last Name', required: true, description: 'Contact last name' },
  { entity: 'Contact', name: 'email', label: 'Email', required: true, description: 'Email address' },
  { entity: 'Contact', name: 'phone', label: 'Phone', required: false, description: 'Phone number' },
  { entity: 'Contact', name: 'company', label: 'Company', required: false, description: 'Company / Organization' },
  { entity: 'Contact', name: 'title', label: 'Job Title', required: false, description: 'Job title' },
  { entity: 'Contact', name: 'address1', label: 'Address Line 1', required: false, description: 'Street address line 1' },
  { entity: 'Contact', name: 'address2', label: 'Address Line 2', required: false, description: 'Street address line 2' },
  { entity: 'Contact', name: 'city', label: 'City', required: false, description: 'City' },
  { entity: 'Contact', name: 'state', label: 'State / Province', required: false, description: 'State / Province' },
  { entity: 'Contact', name: 'zip', label: 'Zip Code', required: false, description: 'Zip / Postal code' },
  { entity: 'Contact', name: 'country', label: 'Country', required: false, description: 'Country' },
  { entity: 'Membership', name: 'memberType', label: 'Member Type', required: false, description: 'Membership type' },
  { entity: 'Membership', name: 'joinDate', label: 'Join Date', required: false, description: 'Join / Start date' },
  { entity: 'Membership', name: 'expirationDate', label: 'Expiration Date', required: false, description: 'Expiration date' },
  { entity: 'Membership', name: 'notes', label: 'Notes', required: false, description: 'Notes / Comments' },
];

const STATUS_STYLE = {
  outline: { backgroundColor: '#ffffff', color: '#6b4fa0', borderColor: '#6b4fa0' } as React.CSSProperties,
  medium:  { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' } as React.CSSProperties,
  light:   { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' } as React.CSSProperties,
  muted:   { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' } as React.CSSProperties,
  success: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' } as React.CSSProperties,
};
const STATUS_CONFIG: Record<string, { style: React.CSSProperties; icon: React.ReactNode; label: string }> = {
  MAPPED:       { style: STATUS_STYLE.success, icon: <CheckCircleOutlined />, label: 'Approved' },
  NEEDS_REVIEW: { style: STATUS_STYLE.outline, icon: <ClockCircleOutlined />, label: 'Needs Review' },
  CFV_PROPOSAL: { style: STATUS_STYLE.medium,  icon: <ExclamationCircleOutlined />, label: 'AI Proposal' },
  REJECTED:     { style: STATUS_STYLE.muted,   icon: <StopOutlined />, label: 'Skipped' },
  UNMAPPED:     { style: STATUS_STYLE.light,   icon: null, label: 'Unmapped' },
};

const CUSTOM_FIELD_TYPES = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];

const STORAGE_KEY = 'mxsuite_custom_gz_fields';
const LAST_SELECTED_KEY = 'mxsuite_tenant_last_mapping_field';

function loadCustomFields(): GzField[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCustomFields(fields: GzField[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
}

/* Inject styles for resizable handles + selected row highlight */
if (typeof document !== 'undefined' && !document.getElementById('tenant-mappings-styles')) {
  const style = document.createElement('style');
  style.id = 'tenant-mappings-styles';
  style.textContent = `
    .tenant-mapping-row-active td { background: #f3eeff !important; }
    .react-resizable-handle { position: absolute; right: -5px; bottom: 0; top: 0; width: 10px; cursor: col-resize; z-index: 1; }
    .ant-input-data-count { color: rgba(0,0,0,0.65) !important; }
  `;
  document.head.appendChild(style);
}

export default function TenantMappingsPage() {
  usePageTitle('Data Mappings');
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [autoMapping, setAutoMapping] = useState(false);
  const [entityFilter, setEntityFilter] = useState<'all' | 'Contact' | 'Membership'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [customFields, setCustomFields] = useState<GzField[]>(loadCustomFields);
  const [customFieldModalOpen, setCustomFieldModalOpen] = useState(false);
  const [customFieldForm] = Form.useForm();

  // Right-side detail panel state
  const [panelField, setPanelField] = useState<GzField | null>(null);
  const [panelSourceId, setPanelSourceId] = useState<string | null>(null);
  const [panelComment, setPanelComment] = useState('');
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelHistory, setPanelHistory] = useState<FieldChangeHistoryDto[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);
  const [panelHistoryTotal, setPanelHistoryTotal] = useState(0);
  const [panelHistoryPage, setPanelHistoryPage] = useState(0);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const gzFields: GzField[] = [...DEFAULT_GZ_FIELDS, ...customFields];
  const allGzFieldNames = new Set(gzFields.map((f) => f.name));

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await tenantOnboardingApi.listMappings({ page: 0, size: 200 });
      setMappings((res.data.content || res.data) as MappingEntry[]);
    } catch {
      message.error('Failed to load mappings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Auto-select on initial load: last worked-on field → first needs-review → first field
  const initialSelectDone = useRef(false);
  useEffect(() => {
    if (initialSelectDone.current || loading || mappings.length === 0) return;
    initialSelectDone.current = true;

    // Build mappingByTarget locally (can't use the one below since it's computed after this)
    const mbt: Record<string, MappingEntry> = {};
    for (const m of mappings) {
      if (m.targetField && allGzFieldNames.has(m.targetField)) mbt[m.targetField] = m;
    }

    // Try last selected
    const lastKey = localStorage.getItem(LAST_SELECTED_KEY);
    if (lastKey) {
      const lastField = gzFields.find((f) => f.name === lastKey);
      if (lastField) { selectField(lastField); return; }
    }

    // First needs-review field
    const needsReview = gzFields.find((f) => {
      const st = mbt[f.name]?.mappingStatus;
      return st === 'NEEDS_REVIEW' || st === 'CFV_PROPOSAL';
    });
    if (needsReview) { selectField(needsReview); return; }

    // Fall back to first field
    if (gzFields.length > 0) selectField(gzFields[0]);
  }, [loading, mappings]);

  // When mappings reload, refresh panel state if a field is selected
  useEffect(() => {
    if (panelField) {
      const current = mappings.find((m) => m.targetField === panelField.name);
      setPanelSourceId(current?.id ?? null);
      setPanelComment(current?.customerComment ?? '');
    }
  }, [mappings, panelField]);

  // ---- Derived data ----

  const mappingByTarget: Record<string, MappingEntry> = {};
  const unmappedEntries: MappingEntry[] = [];
  const nonStandardEntries: MappingEntry[] = [];

  for (const m of mappings) {
    if (!m.targetField) {
      if (m.mappingStatus !== 'REJECTED') unmappedEntries.push(m);
    } else if (!allGzFieldNames.has(m.targetField)) {
      nonStandardEntries.push(m);
    } else {
      mappingByTarget[m.targetField] = m;
    }
  }

  const alreadyMappedIds = new Set(
    mappings.filter((m) => m.targetField).map((m) => m.id)
  );

  const sourceOptions = mappings.map((m) => ({
    value: m.id,
    label: m.sourceField,
  }));

  // Stats
  const requiredFields = gzFields.filter((f) => f.required);
  const approvedCount = Object.values(mappingByTarget).filter((m) => m.mappingStatus === 'MAPPED').length;
  const needsReviewCount = Object.values(mappingByTarget).filter(
    (m) => m.mappingStatus === 'NEEDS_REVIEW' || m.mappingStatus === 'CFV_PROPOSAL'
  ).length;
  const requiredMapped = requiredFields.filter(
    (f) => mappingByTarget[f.name]?.mappingStatus === 'MAPPED'
  ).length;
  const requiredTotal = requiredFields.length;

  // ---- Handlers ----

  const handleSourceChange = async (gzField: GzField, newEntryId: string | null) => {
    setSavingId(gzField.name);
    try {
      if (newEntryId) {
        await tenantOnboardingApi.updateMapping(newEntryId, {
          targetField: gzField.name,
          targetEntity: gzField.entity,
        });
      } else {
        const current = mappingByTarget[gzField.name];
        if (current) {
          await tenantOnboardingApi.updateMapping(current.id, { targetField: null });
        }
      }
      await fetchData();
    } catch {
      message.error('Failed to update mapping');
    } finally {
      setSavingId(null);
    }
  };

  const handleAutoMap = async () => {
    setAutoMapping(true);
    try {
      const tasks: Array<{ entryId: string; gzField: GzField }> = [];
      for (const gzField of gzFields) {
        if (mappingByTarget[gzField.name]) continue;
        const match = unmappedEntries.find((e) => {
          const src = e.sourceField.toLowerCase().replace(/[_\s-]/g, '');
          const tgt = gzField.name.toLowerCase();
          return src === tgt || src.includes(tgt) || tgt.includes(src);
        });
        if (match) tasks.push({ entryId: match.id, gzField });
      }
      if (!tasks.length) {
        message.info('No additional auto-mappings found');
        return;
      }
      for (const { entryId, gzField } of tasks) {
        await tenantOnboardingApi.updateMapping(entryId, {
          targetField: gzField.name,
          targetEntity: gzField.entity,
        });
      }
      await fetchData();
      message.success(`Auto-mapped ${tasks.length} field${tasks.length !== 1 ? 's' : ''}`);
    } catch {
      message.error('Auto-map failed');
    } finally {
      setAutoMapping(false);
    }
  };

  const handleBulkApprove = async () => {
    const toApprove = Object.values(mappingByTarget).filter(
      (m) => m.mappingStatus === 'NEEDS_REVIEW' || m.mappingStatus === 'CFV_PROPOSAL'
    );
    if (!toApprove.length) return;
    try {
      await Promise.all(toApprove.map((m) => tenantOnboardingApi.approveMapping(m.id)));
      await fetchData();
      message.success(`${toApprove.length} mapping${toApprove.length !== 1 ? 's' : ''} approved`);
    } catch {
      message.error('Some approvals failed');
    }
  };

  const handleBulkApproveSelected = async () => {
    if (!bulkApprovable.length) return;
    try {
      await Promise.all(bulkApprovable.map((f) => tenantOnboardingApi.approveMapping(mappingByTarget[f.name].id)));
      await fetchData();
      setSelectedRowKeys([]);
      message.success(`${bulkApprovable.length} mapping${bulkApprovable.length !== 1 ? 's' : ''} approved`);
    } catch {
      message.error('Some approvals failed');
    }
  };

  const handleBulkSkipSelected = async () => {
    if (!bulkSkippable.length) return;
    try {
      await Promise.all(bulkSkippable.map((f) => tenantOnboardingApi.updateMapping(mappingByTarget[f.name].id, { skip: true })));
      await fetchData();
      setSelectedRowKeys([]);
      message.success(`${bulkSkippable.length} field${bulkSkippable.length !== 1 ? 's' : ''} skipped`);
    } catch {
      message.error('Some skips failed');
    }
  };

  const handleAddCustomField = (values: { name: string; type: string; description?: string; required?: boolean }) => {
    if (allGzFieldNames.has(values.name)) {
      message.error(`Field "${values.name}" already exists`);
      return;
    }
    const newField: GzField = {
      entity: 'Contact',
      name: values.name,
      label: values.name,
      description: values.description || '',
      required: !!values.required,
      custom: true,
    };
    const updated = [...customFields, newField];
    setCustomFields(updated);
    saveCustomFields(updated);
    setCustomFieldModalOpen(false);
    customFieldForm.resetFields();
    message.success(`Custom field "${values.name}" added`);
  };

  const handleRemoveCustomField = (fieldName: string) => {
    const updated = customFields.filter((f) => f.name !== fieldName);
    setCustomFields(updated);
    saveCustomFields(updated);
    if (panelField?.name === fieldName) setPanelField(null);
  };

  // ---- Panel handlers ----

  const HISTORY_PAGE_SIZE = 20;

  const loadFieldHistory = (mappingId: string, page: number) => {
    setPanelHistoryLoading(true);
    tenantOnboardingApi.getFieldChangeHistory(mappingId, { page, size: HISTORY_PAGE_SIZE })
      .then(({ data }) => {
        setPanelHistory(data.content ?? []);
        setPanelHistoryTotal(data.totalElements ?? 0);
        setPanelHistoryPage(page);
      })
      .catch(() => {})
      .finally(() => setPanelHistoryLoading(false));
  };

  const selectField = (f: GzField) => {
    setPanelField(f);
    localStorage.setItem(LAST_SELECTED_KEY, f.name);
    const current = mappingByTarget[f.name];
    setPanelSourceId(current?.id ?? null);
    setPanelComment(current?.customerComment ?? '');
    setPanelHistory([]);
    setPanelHistoryTotal(0);
    setPanelHistoryPage(0);
    setExpandedVersions(new Set());
    if (current) {
      loadFieldHistory(current.id, 0);
    }
  };

  const handlePanelSourceChange = async (newEntryId: string | null) => {
    if (!panelField) return;
    setPanelSaving(true);
    try {
      if (newEntryId) {
        await tenantOnboardingApi.updateMapping(newEntryId, {
          targetField: panelField.name,
          targetEntity: panelField.entity,
        });
      } else {
        const current = mappingByTarget[panelField.name];
        if (current) {
          await tenantOnboardingApi.updateMapping(current.id, { targetField: null });
        }
      }
      await fetchData();
    } catch {
      message.error('Failed to update mapping');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelApprove = async () => {
    if (!panelField) return;
    const current = mappingByTarget[panelField.name];
    if (!current) return;
    setPanelSaving(true);
    try {
      // Save comment first if changed
      if (panelComment !== (current.customerComment ?? '')) {
        await tenantOnboardingApi.updateMapping(current.id, {
          customerComment: panelComment.trim() || undefined,
        });
      }
      await tenantOnboardingApi.approveMapping(current.id);
      await fetchData();
      message.success(`"${panelField.label}" approved`);
    } catch {
      message.error('Failed to approve');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelSkip = async () => {
    if (!panelField) return;
    const current = mappingByTarget[panelField.name];
    if (!current) return;
    setPanelSaving(true);
    try {
      await tenantOnboardingApi.updateMapping(current.id, { skip: true });
      await fetchData();
      message.success(`"${panelField.label}" skipped`);
    } catch {
      message.error('Failed to skip');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelRestore = async () => {
    if (!panelField) return;
    const current = mappingByTarget[panelField.name];
    if (!current) return;
    setPanelSaving(true);
    try {
      await tenantOnboardingApi.updateMapping(current.id, { unskip: true });
      await fetchData();
      message.success(`"${panelField.label}" restored`);
    } catch {
      message.error('Failed to restore');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelSaveComment = async () => {
    if (!panelField) return;
    const current = mappingByTarget[panelField.name];
    if (!current) return;
    setPanelSaving(true);
    try {
      await tenantOnboardingApi.updateMapping(current.id, {
        customerComment: panelComment.trim() || undefined,
      });
      await fetchData();
      message.success('Comment saved');
    } catch {
      message.error('Failed to save comment');
    } finally {
      setPanelSaving(false);
    }
  };

  // ---- Table ----

  const filteredGzFields = gzFields.filter((f) => {
    if (entityFilter !== 'all' && f.entity !== entityFilter) return false;
    const m = mappingByTarget[f.name];
    const st = m?.mappingStatus;
    if (statusFilter === 'needs_review') return st === 'NEEDS_REVIEW' || st === 'CFV_PROPOSAL';
    if (statusFilter === 'approved') return st === 'MAPPED';
    if (statusFilter === 'unmapped') return !m;
    return true;
  });

  const selectedGzFields = gzFields.filter((f) => selectedRowKeys.includes(f.name));
  const bulkApprovable = selectedGzFields.filter((f) => {
    const m = mappingByTarget[f.name];
    return m && (m.mappingStatus === 'NEEDS_REVIEW' || m.mappingStatus === 'CFV_PROPOSAL');
  });
  const bulkSkippable = selectedGzFields.filter((f) => {
    const m = mappingByTarget[f.name];
    return m && m.mappingStatus !== 'MAPPED' && m.mappingStatus !== 'REJECTED';
  });

  /* ---------- Resizable column widths ---------- */
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    field: 200, source: 230, sample: 160, confidence: 100, status: 130,
  });

  const handleColumnResize = useCallback(
    (key: string) => (_e: any, { size }: { size: { width: number } }) => {
      setColWidths((prev) => ({ ...prev, [key]: size.width }));
    },
    [],
  );

  const baseColumns: ColumnsType<GzField> = [
    {
      title: 'GrowthZone Field',
      key: 'field',
      width: colWidths.field,
      render: (_, f) => (
        <Space direction="vertical" size={0}>
          <Space size={4} align="center">
            <Text strong>{f.label}</Text>
            {f.required && <Tag color="red" style={{ fontSize: 10, lineHeight: '16px' }}>Required</Tag>}
            {f.custom && <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px' }}>Custom</Tag>}
          </Space>
          <Text style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>{f.description}</Text>
        </Space>
      ),
    },
    {
      title: 'Your Data Column',
      key: 'source',
      width: colWidths.source,
      render: (_, f) => {
        const current = mappingByTarget[f.name];
        return (
          <Select
            style={{ width: '100%' }}
            size="small"
            placeholder="Select your column..."
            aria-label={`Source column for ${f.label}`}
            allowClear
            loading={savingId === f.name}
            value={current?.id ?? undefined}
            onChange={(val) => handleSourceChange(f, val ?? null)}
            showSearch
            optionFilterProp="label"
            options={sourceOptions.map((o) => ({
              ...o,
              disabled: alreadyMappedIds.has(o.value) && o.value !== current?.id,
            }))}
          />
        );
      },
    },
    {
      title: 'Sample Value',
      key: 'sample',
      width: colWidths.sample,
      ellipsis: true,
      render: (_, f) => {
        const current = mappingByTarget[f.name];
        return current?.sampleValue
          ? <Text style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>{current.sampleValue}</Text>
          : <Text style={{ color: 'rgba(0,0,0,0.65)' }}>—</Text>;
      },
    },
    {
      title: 'AI Match',
      key: 'confidence',
      width: colWidths.confidence,
      align: 'center',
      render: (_, f) => {
        const current = mappingByTarget[f.name];
        if (!current?.confidencePct) return <Text style={{ color: 'rgba(0,0,0,0.65)' }}>—</Text>;
        const pct = current.confidencePct;
        const barColor = pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f';
        return (
          <Tooltip title={`${pct}% confidence`}>
            <Progress
              percent={pct}
              size="small"
              strokeColor={barColor}
              style={{ width: 70 }}
              format={(p) => `${p}%`}
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      width: colWidths.status,
      render: (_, f) => {
        const current = mappingByTarget[f.name];
        if (!current) {
          return f.required
            ? <Tag style={{ backgroundColor: '#fff1f0', color: '#d32029', borderColor: '#ffa39e' }}>Unmapped</Tag>
            : <Tag style={{ backgroundColor: '#f5f5f5', color: '#595959', borderColor: '#d9d9d9' }}>Unmapped</Tag>;
        }
        const cfg = STATUS_CONFIG[current.mappingStatus] || STATUS_CONFIG.UNMAPPED;
        return <Tag icon={cfg.icon} style={cfg.style}>{cfg.label}</Tag>;
      },
    },
  ];

  // Attach onHeaderCell for resizable handles
  const columns = baseColumns.map((col: any) => ({
    ...col,
    onHeaderCell: (column: any) => ({
      width: column.width,
      onResize: handleColumnResize(column.key as string),
    }),
  }));

  // Panel derived data
  const panelMapping = panelField ? mappingByTarget[panelField.name] : null;
  const panelStatus = panelMapping?.mappingStatus;

  return (
    <div style={{ overflow: 'hidden' }}>
      {/* Page header with purple tint */}
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>Field Mappings</Title>
        <Text style={{ color: '#6b4fa0' }}>
          Match your data columns to GrowthZone fields. Required fields must be mapped before we can import your data.
        </Text>
      </div>

      {/* Stats bar */}
      <Card size="small" style={{ marginBottom: 16, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
        <Row align="middle" gutter={[16, 8]}>
          <Col>
            <Text style={{ color: 'rgba(0,0,0,0.65)' }}>Required: </Text>
            <Text strong style={{ color: requiredMapped === requiredTotal ? '#237804' : '#d32029' }}>
              {requiredMapped} / {requiredTotal}
            </Text>
          </Col>
          <Col>
            <Text style={{ color: 'rgba(0,0,0,0.65)' }}>Approved: </Text>
            <Text strong style={{ color: '#237804' }}>{approvedCount}</Text>
          </Col>
          <Col>
            <Text style={{ color: 'rgba(0,0,0,0.65)' }}>Needs Review: </Text>
            <Text strong style={{ color: '#6b4fa0' }}>{needsReviewCount}</Text>
          </Col>
          <Col>
            <Text style={{ color: 'rgba(0,0,0,0.65)' }}>Unmatched columns: </Text>
            <Text strong>{unmappedEntries.length}</Text>
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space wrap>
              <Button
                size="small"
                icon={<HistoryOutlined />}
                onClick={() => setVersionHistoryOpen(true)}
                style={{ borderColor: '#6b4fa0', color: '#6b4fa0' }}
              >
                History
              </Button>
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => { customFieldForm.resetFields(); customFieldForm.setFieldsValue({ type: 'string' }); setCustomFieldModalOpen(true); }}
                style={{ borderColor: '#2d1854', color: '#2d1854' }}
              >
                Add GZ Field
              </Button>
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={autoMapping}
                onClick={handleAutoMap}
                style={{ borderColor: '#2d1854', color: '#2d1854' }}
              >
                Auto-Map
              </Button>
              {needsReviewCount > 0 && (
                <Button
                  type="primary"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={handleBulkApprove}
                  style={{ background: '#2d1854', borderColor: '#2d1854' }}
                >
                  Approve All ({needsReviewCount})
                </Button>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Status tabs + entity filter */}
      <Row align="middle" style={{ marginBottom: 8, borderBottom: '2px solid #e0d4f5', paddingBottom: 0 }}>
        <Col flex="auto">
          <Tabs
            activeKey={statusFilter}
            onChange={(k) => { setStatusFilter(k); setSelectedRowKeys([]); }}
            size="small"
            style={{ marginBottom: 0 }}
            items={[
              { key: 'all', label: `All (${gzFields.length})` },
              { key: 'needs_review', label: `Needs Review (${needsReviewCount})` },
              { key: 'approved', label: `Approved (${approvedCount})` },
              { key: 'unmapped', label: `Unmapped (${gzFields.filter((f) => !mappingByTarget[f.name]).length})` },
            ]}
          />
        </Col>
        <Col>
          <Select
            value={entityFilter}
            onChange={(v) => { setEntityFilter(v); setSelectedRowKeys([]); }}
            size="small"
            style={{ width: 130 }}
            aria-label="Filter by entity"
            options={[
              { value: 'all', label: 'All entities' },
              { value: 'Contact', label: 'Contact' },
              { value: 'Membership', label: 'Membership' },
            ]}
          />
        </Col>
      </Row>

      {/* Bulk action bar */}
      {selectedRowKeys.length > 0 && (
        <Alert
          style={{ marginBottom: 8 }}
          type="info"
          showIcon={false}
          message={
            <Row align="middle" justify="space-between">
              <Col>
                <Text strong>{selectedRowKeys.length} field{selectedRowKeys.length !== 1 ? 's' : ''} selected</Text>
              </Col>
              <Col>
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    disabled={!bulkApprovable.length}
                    onClick={handleBulkApproveSelected}
                    style={{ background: '#2d1854', borderColor: '#2d1854' }}
                  >
                    Approve {bulkApprovable.length > 0 ? `(${bulkApprovable.length})` : ''}
                  </Button>
                  <Button
                    size="small"
                    disabled={!bulkSkippable.length}
                    onClick={handleBulkSkipSelected}
                  >
                    Skip {bulkSkippable.length > 0 ? `(${bulkSkippable.length})` : ''}
                  </Button>
                  <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>Clear</Button>
                </Space>
              </Col>
            </Row>
          }
        />
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Left: mapping table */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          <Table<GzField>
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              columnTitle: (
                <Checkbox
                  indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < filteredGzFields.length}
                  checked={filteredGzFields.length > 0 && selectedRowKeys.length === filteredGzFields.length}
                  onChange={(e) => {
                    setSelectedRowKeys(e.target.checked ? filteredGzFields.map((f) => f.name) : []);
                  }}
                >
                  <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                    Select all fields
                  </span>
                </Checkbox>
              ),
              renderCell: (checked, record: GzField) => (
                <Checkbox
                  checked={checked}
                  onChange={(e) => {
                    const key = record.name;
                    const newKeys = e.target.checked
                      ? [...(selectedRowKeys as string[]), key]
                      : (selectedRowKeys as string[]).filter((k) => k !== key);
                    setSelectedRowKeys(newKeys);
                  }}
                >
                  <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                    Select {record.label}
                  </span>
                </Checkbox>
              ),
            } as TableRowSelection<GzField>}
            components={{ header: { cell: ResizableTitle } }}
            columns={columns}
            dataSource={filteredGzFields}
            rowKey="name"
            size="small"
            loading={loading}
            pagination={false}
            scroll={{ x: panelField ? 700 : 900 }}
            rowClassName={(f) => f.name === panelField?.name ? 'tenant-mapping-row-active' : ''}
            onRow={(f) => ({
              onClick: () => selectField(f),
              style: {
                cursor: 'pointer',
                ...(f.required && !mappingByTarget[f.name] ? { backgroundColor: '#fff7f7' } : {}),
              },
            })}
            locale={{ emptyText: 'No fields to display.' }}
          />

          {/* Unmatched source columns */}
          {(unmappedEntries.length > 0 || nonStandardEntries.length > 0) && (
            <Collapse
              ghost
              style={{ marginTop: 16 }}
              items={[
                {
                  key: '1',
                  label: (
                    <Text style={{ color: 'rgba(0,0,0,0.65)' }}>
                      {unmappedEntries.length + nonStandardEntries.length} column{unmappedEntries.length + nonStandardEntries.length !== 1 ? 's' : ''} from your data not mapped to a GrowthZone field
                    </Text>
                  ),
                  children: (
                    <Space wrap style={{ padding: '4px 0' }}>
                      {unmappedEntries.map((e) => (
                        <Tooltip key={e.id} title={e.sampleValue ? `Sample: ${e.sampleValue}` : undefined}>
                          <Tag>{e.sourceField}</Tag>
                        </Tooltip>
                      ))}
                      {nonStandardEntries.map((e) => (
                        <Tooltip key={e.id} title={`Mapped to custom field: ${e.targetField}`}>
                          <Tag color="orange">{e.sourceField} → {e.targetField}</Tag>
                        </Tooltip>
                      ))}
                    </Space>
                  ),
                },
              ]}
            />
          )}
        </div>

        {/* Right: detail panel */}
        <div style={{ width: 380, flexShrink: 0 }}>
          {!panelField ? (
            <Card
              size="small"
              style={{
                height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderColor: '#e0d4f5', borderTop: '3px solid #6b4fa0',
              }}
              styles={{ body: { textAlign: 'center' } }}
            >
              <Text style={{ fontSize: 13, color: '#6b4fa0' }}>
                Click a GrowthZone field to review its mapping here.
              </Text>
            </Card>
          ) : (
            <Card
              size="small"
              style={{ position: 'sticky', top: 80, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}
              styles={{
                header: { background: '#f3eeff', borderBottom: '1px solid #e0d4f5', padding: '14px 16px' },
                body: { padding: '16px', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' },
              }}
              title={
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {(() => {
                      if (!panelMapping) {
                        return panelField.required
                          ? <Tag style={{ backgroundColor: '#fff1f0', color: '#d32029', borderColor: '#ffa39e', margin: 0 }}>Unmapped</Tag>
                          : <Tag style={{ backgroundColor: '#f5f5f5', color: '#595959', borderColor: '#d9d9d9', margin: 0 }}>Unmapped</Tag>;
                      }
                      const cfg = STATUS_CONFIG[panelMapping.mappingStatus] || STATUS_CONFIG.UNMAPPED;
                      return <Tag icon={cfg.icon} style={{ ...cfg.style, margin: 0 }}>{cfg.label}</Tag>;
                    })()}
                    {panelField.required && <Tag color="red" style={{ fontSize: 10, margin: 0 }}>Required</Tag>}
                    {panelField.custom && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>Custom</Tag>}
                  </div>
                  <Text strong style={{ fontSize: 14, display: 'block', marginTop: 4, color: '#2d1854' }}>
                    {panelField.label}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#6b4fa0' }}>{panelField.description}</Text>
                </div>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {/* Sample value */}
                {panelMapping?.sampleValue && (
                  <div style={{ padding: '6px 10px', background: '#f9f6ff', borderRadius: 4, border: '1px solid #e0d4f5' }}>
                    <Text style={{ fontSize: 12, color: '#6b4fa0' }}>Sample: </Text>
                    <Text style={{ fontSize: 12 }}>{panelMapping.sampleValue}</Text>
                  </div>
                )}

                {/* Source column selector */}
                <div>
                  <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>YOUR DATA COLUMN</Text>
                  <Select
                    style={{ width: '100%' }}
                    size="small"
                    placeholder="Select your column..."
                    allowClear
                    loading={panelSaving}
                    value={panelSourceId ?? undefined}
                    onChange={(val) => handlePanelSourceChange(val ?? null)}
                    showSearch
                    optionFilterProp="label"
                    options={sourceOptions.map((o) => ({
                      ...o,
                      disabled: alreadyMappedIds.has(o.value) && o.value !== panelMapping?.id,
                    }))}
                  />
                </div>

                {/* AI confidence */}
                {panelMapping?.confidencePct != null && (
                  <div>
                    <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>AI CONFIDENCE</Text>
                    <Progress
                      percent={panelMapping.confidencePct}
                      size="small"
                      strokeColor={
                        panelMapping.confidencePct >= 80 ? '#52c41a'
                        : panelMapping.confidencePct >= 50 ? '#fa8c16'
                        : '#ff4d4f'
                      }
                      style={{ maxWidth: 200 }}
                    />
                  </div>
                )}

                <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />

                {/* Customer comment */}
                <div style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>YOUR NOTES</Text>
                  <Input.TextArea
                    aria-label="Your notes"
                    rows={2}
                    size="small"
                    placeholder="Add a note for your coach..."
                    value={panelComment}
                    onChange={(e) => setPanelComment(e.target.value)}
                    maxLength={500}
                    showCount
                    disabled={!panelMapping}
                  />
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {panelMapping && panelStatus === 'REJECTED' ? (
                    <Button loading={panelSaving} onClick={handlePanelRestore} style={{ flex: 1 }}>Restore</Button>
                  ) : panelMapping ? (
                    <>
                      {panelStatus !== 'MAPPED' && (
                        <Button type="primary" loading={panelSaving} onClick={handlePanelApprove}
                          style={{ flex: 1, background: '#2d1854', borderColor: '#2d1854' }}>
                          Approve mapping
                        </Button>
                      )}
                      {panelStatus !== 'MAPPED' && (
                        <Button danger loading={panelSaving} onClick={handlePanelSkip} style={{ color: '#a8071a', borderColor: '#cf1322' }}>
                          Reject
                        </Button>
                      )}
                      <Button loading={panelSaving} onClick={handlePanelSaveComment}>Save</Button>
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>
                      Select a data column above to enable actions.
                    </Text>
                  )}
                </div>

                {/* Custom field remove */}
                {panelField.custom && (
                  <>
                    <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />
                    <Button
                      type="link"
                      danger
                      size="small"
                      onClick={() => handleRemoveCustomField(panelField.name)}
                      style={{ padding: 0 }}
                    >
                      Remove custom field
                    </Button>
                  </>
                )}

                <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />

                {/* Field change history — flat timeline */}
                <div>
                  <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>CHANGE HISTORY</Text>
                  {panelHistoryLoading ? (
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                      <Spin size="small" />
                    </div>
                  ) : panelHistory.length === 0 ? (
                    <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>No changes recorded yet.</Text>
                  ) : (() => {
                    const CHANGE_LABELS: Record<string, string> = {
                      TARGET_CHANGED: 'Target changed',
                      STATUS_CHANGED: 'Status changed',
                      COMMENT_CHANGED: 'Comment updated',
                      COERCION_CHANGED: 'Coercion changed',
                      SKIPPED: 'Skipped',
                      UNSKIPPED: 'Unskipped',
                      APPROVED: 'Approved',
                      RESTORED: 'Restored',
                    };
                    const FRIENDLY: Record<string, string> = {
                      MAPPED: 'Approved', NEEDS_REVIEW: 'Needs Review', CFV_PROPOSAL: 'Proposal',
                      REJECTED: 'Skipped', UNMAPPED: 'Unmapped',
                    };
                    const friendly = (v: string | null) => (v && FRIENDLY[v]) || v || '';

                    // Group changes by version
                    const grouped: { vn: number; source: string; byName: string; at: string; changes: typeof panelHistory }[] = [];
                    for (const ch of panelHistory) {
                      const last = grouped[grouped.length - 1];
                      if (last && last.vn === ch.versionNumber) {
                        last.changes.push(ch);
                      } else {
                        grouped.push({ vn: ch.versionNumber, source: ch.source, byName: ch.createdByName, at: ch.createdAt, changes: [ch] });
                      }
                    }
                    const totalPages = Math.ceil(panelHistoryTotal / HISTORY_PAGE_SIZE);
                    const toggleVersion = (vn: number) => {
                      setExpandedVersions((prev) => {
                        const next = new Set(prev);
                        if (next.has(vn)) next.delete(vn); else next.add(vn);
                        return next;
                      });
                    };
                    return (
                      <>
                        {grouped.map((g) => {
                          const autoExpand = g.changes.length <= 3;
                          const isExpanded = autoExpand || expandedVersions.has(g.vn);
                          return (
                            <div key={g.vn} style={{ marginBottom: 8, borderBottom: '1px solid #f0ecf5', paddingBottom: 6 }}>
                              <div
                                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: autoExpand ? 'default' : 'pointer', marginBottom: 4 }}
                                onClick={autoExpand ? undefined : () => toggleVersion(g.vn)}
                              >
                                {!autoExpand && (
                                  isExpanded
                                    ? <DownOutlined style={{ fontSize: 9, color: '#6b4fa0' }} />
                                    : <RightOutlined style={{ fontSize: 9, color: '#6b4fa0' }} />
                                )}
                                <Tag style={{ fontSize: 9, backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5', margin: 0 }}>
                                  v{g.vn}
                                </Tag>
                                <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>
                                  {g.byName} &middot; {new Date(g.at).toLocaleString()}
                                </Text>
                                {!autoExpand && !isExpanded && (
                                  <Text type="secondary" style={{ fontSize: 10 }}>{g.changes.length} changes</Text>
                                )}
                              </div>
                              {isExpanded && g.changes.map((ch) => (
                                <div key={ch.id} style={{ padding: '3px 0 3px 12px', borderLeft: '2px solid #e0d4f5', fontSize: 12, marginBottom: 2 }}>
                                  <span style={{ fontWeight: 500, color: '#2d1854' }}>{CHANGE_LABELS[ch.changeType] ?? ch.changeType}</span>
                                  {(ch.oldValue || ch.newValue) && ch.changeType !== 'APPROVED' && (
                                    <div>
                                      {ch.oldValue && <Text type="secondary" style={{ fontSize: 11 }}>{friendly(ch.oldValue)}</Text>}
                                      {ch.oldValue && ch.newValue && <span style={{ margin: '0 4px', color: '#6b4fa0', fontSize: 11 }}>&rarr;</span>}
                                      {ch.newValue && <Text style={{ fontSize: 11, color: '#237804', fontWeight: 500 }}>{friendly(ch.newValue)}</Text>}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {totalPages > 1 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>{panelHistoryTotal} total changes</Text>
                            <Space size={4}>
                              <Button size="small" disabled={panelHistoryPage === 0}
                                onClick={() => { const m = mappingByTarget[panelField!.name]; if (m) loadFieldHistory(m.id, panelHistoryPage - 1); }}>
                                Prev
                              </Button>
                              <Text style={{ fontSize: 11 }}>{panelHistoryPage + 1}/{totalPages}</Text>
                              <Button size="small" disabled={panelHistoryPage >= totalPages - 1}
                                onClick={() => { const m = mappingByTarget[panelField!.name]; if (m) loadFieldHistory(m.id, panelHistoryPage + 1); }}>
                                Next
                              </Button>
                            </Space>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </Space>
            </Card>
          )}
        </div>
      </div>

      {/* Add Custom GZ Field modal */}
      <Modal
        title="Add Custom GrowthZone Field"
        open={customFieldModalOpen}
        onCancel={() => setCustomFieldModalOpen(false)}
        onOk={() => customFieldForm.submit()}
        okText="Add Field"
        okButtonProps={{ style: { background: '#2d1854', borderColor: '#2d1854' } }}
        destroyOnHidden
      >
        <Form
          form={customFieldForm}
          layout="vertical"
          onFinish={handleAddCustomField}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="name"
            label="Field Name"
            rules={[
              { required: true, message: 'Please enter a field name' },
              { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: 'Must start with a letter; letters, numbers, underscores only' },
            ]}
          >
            <Input placeholder="e.g. membershipLevel" />
          </Form.Item>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={CUSTOM_FIELD_TYPES} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input placeholder="e.g. Member's subscription tier" />
          </Form.Item>
          <Form.Item name="required" label="Required" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <MappingVersionHistory
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
        fetchVersions={(params) => tenantOnboardingApi.listVersions(params)}
        fetchVersion={(versionId) => tenantOnboardingApi.getVersion(versionId)}
        onRollback={async (targetVersion) => {
          await tenantOnboardingApi.rollbackVersion(targetVersion);
        }}
        onRollbackComplete={fetchData}
      />
    </div>
  );
}
