import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Tag, Typography, Tabs, Button, Select, FloatButton,
  Space, message, Row, Col, Card, Collapse, Tooltip, Modal, Form, Input, Switch, Alert, Checkbox,
  Divider, Progress, List, Spin,
} from 'antd';
import type { TableRowSelection } from 'antd/es/table/interface';
import {
  ApartmentOutlined, CheckCircleOutlined, ClockCircleOutlined, DownOutlined, ExclamationCircleOutlined,
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

/** Convert a camelCase name to a human-readable label */
function toLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

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
    .tenant-mapping-row-active td { background: #e8ddf5 !important; }
    .tenant-mapping-row-active td:first-child { border-left: 3px solid #6b4fa0; }
    .ant-table-tbody > tr:not(.tenant-mapping-row-active):not(.tenant-mapping-entity-header):hover > td { background: #f9f6ff !important; }
    .tenant-mapping-entity-header td { padding: 6px 12px !important; }
    .tenant-mapping-entity-header .ant-checkbox-wrapper { display: none; }
    .react-resizable-handle { position: absolute; right: -5px; bottom: 0; top: 0; width: 10px; cursor: col-resize; z-index: 1; }
    .ant-input-data-count { color: rgba(0,0,0,0.65) !important; }
  `;
  document.head.appendChild(style);
}

export default function TenantMappingsPage() {
  usePageTitle('Data Mappings');
  const navigate = useNavigate();
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [autoMapping, setAutoMapping] = useState(false);
  const [schemaFields, setSchemaFields] = useState<GzField[]>([]);
  const [entityFilter, setEntityFilter] = useState<string>('all');
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
  const COLLAPSED_KEY = 'mxsuite_collapsed_entities';
  const [collapsedEntities, setCollapsedEntities] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [collapsedInitialized, setCollapsedInitialized] = useState(false);

  const toggleEntity = (entity: string) => {
    setCollapsedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(entity)) next.delete(entity); else next.add(entity);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const gzFields: GzField[] = [...schemaFields, ...customFields];
  const allGzFieldNames = new Set(gzFields.map((f) => f.name));

  const entityOptions = useMemo(() => {
    const entities = new Set(gzFields.map((f) => f.entity).filter(Boolean));
    return [
      { value: 'all', label: 'All entities' },
      ...Array.from(entities).sort().map((e) => ({ value: e, label: e })),
    ];
  }, [gzFields]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Check if tenant has uploaded data — redirect to upload if not
      const { data: onboarding } = await tenantOnboardingApi.getMyOnboarding();
      if (onboarding.uploadStatus === 'NONE') {
        message.info('Please upload your data before reviewing mappings.');
        navigate('/plans/my-onboarding/upload', { replace: true });
        return;
      }

      const [mappingsRes, schemaRes] = await Promise.all([
        tenantOnboardingApi.listMappings({ page: 0, size: 200 }),
        tenantOnboardingApi.getSchema(),
      ]);
      setMappings((mappingsRes.data.content || mappingsRes.data) as MappingEntry[]);
      const loaded = (schemaRes.data.targetSchema || []).map((f: any) => ({
        entity: f.entity || 'Other',
        name: f.name,
        label: toLabel(f.name),
        required: !!f.required,
        description: f.description || '',
      }));
      setSchemaFields(loaded);
    } catch {
      message.error('Failed to load mappings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // Smart collapse defaults: collapse all except entities with needs-review or required unmapped
  useEffect(() => {
    if (collapsedInitialized || loading || gzFields.length === 0) return;
    setCollapsedInitialized(true);

    // If user has a saved state, respect it
    if (localStorage.getItem(COLLAPSED_KEY)) return;

    const entities = [...new Set(gzFields.map((f) => f.entity))];
    const mappingByTgt: Record<string, MappingEntry> = {};
    for (const m of mappings) {
      if (m.targetField) mappingByTgt[m.targetField] = m;
    }

    const collapseAll = new Set(entities);
    for (const entity of entities) {
      const entityFields = gzFields.filter((f) => f.entity === entity);
      const hasWork = entityFields.some((f) => {
        const st = mappingByTgt[f.name]?.mappingStatus;
        return st === 'NEEDS_REVIEW' || st === 'CFV_PROPOSAL' || (f.required && !mappingByTgt[f.name]);
      });
      if (hasWork) collapseAll.delete(entity);
    }
    setCollapsedEntities(collapseAll);
  }, [loading, gzFields, mappings]);

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

  // Per-entity coverage for summary bar
  const entityCoverage = useMemo(() => {
    const entities = [...new Set(gzFields.map((f) => f.entity))].sort();
    return entities.map((entity) => {
      const fields = gzFields.filter((f) => f.entity === entity);
      const mapped = fields.filter((f) => mappingByTarget[f.name]).length;
      const req = fields.filter((f) => f.required);
      const reqMapped = req.filter((f) => mappingByTarget[f.name]).length;
      return { entity, total: fields.length, mapped, required: req.length, reqMapped };
    });
  }, [gzFields, mappingByTarget]);

  // Unmapped required fields for warning alert
  const unmappedRequired = requiredFields.filter((f) => !mappingByTarget[f.name]);

  // ---- Handlers ----

  const handleSourceChange = async (gzField: GzField, newEntryId: string | null) => {
    setSavingId(gzField.name);
    try {
      if (newEntryId) {
        const entry = mappings.find((m) => m.id === newEntryId);
        const isAlreadyMapped = entry?.targetField && entry.targetField !== gzField.name;
        if (isAlreadyMapped) {
          // Source is already mapped to another target — clone instead of moving
          await tenantOnboardingApi.cloneMapping(newEntryId, {
            targetField: gzField.name,
            targetEntity: gzField.entity,
          });
        } else {
          await tenantOnboardingApi.updateMapping(newEntryId, {
            targetField: gzField.name,
            targetEntity: gzField.entity,
          });
        }
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
        const entry = mappings.find((m) => m.id === newEntryId);
        const isAlreadyMapped = entry?.targetField && entry.targetField !== panelField.name;
        if (isAlreadyMapped) {
          await tenantOnboardingApi.cloneMapping(newEntryId, {
            targetField: panelField.name,
            targetEntity: panelField.entity,
          });
        } else {
          await tenantOnboardingApi.updateMapping(newEntryId, {
            targetField: panelField.name,
            targetEntity: panelField.entity,
          });
        }
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

  // Build display rows with entity section headers (collapsible)
  type DisplayRow = GzField & { _entityHeader?: string; _entityMapped?: number; _entityTotal?: number; _entityRequired?: number; _entityRequiredMapped?: number };
  const displayRows: DisplayRow[] = useMemo(() => {
    if (entityFilter !== 'all') return filteredGzFields;
    const rows: DisplayRow[] = [];
    let lastEntity = '';
    for (const f of filteredGzFields) {
      if (f.entity !== lastEntity) {
        lastEntity = f.entity;
        const entityFields = filteredGzFields.filter((g) => g.entity === f.entity);
        const mappedCount = entityFields.filter((g) => mappingByTarget[g.name]).length;
        const requiredFields = entityFields.filter((g) => g.required);
        const requiredMappedCount = requiredFields.filter((g) => mappingByTarget[g.name]).length;
        rows.push({
          name: `__hdr__${f.entity}`, entity: f.entity, label: '', required: false, description: '',
          _entityHeader: f.entity, _entityMapped: mappedCount, _entityTotal: entityFields.length,
          _entityRequired: requiredFields.length, _entityRequiredMapped: requiredMappedCount,
        });
      }
      // Skip fields of collapsed entities
      if (!collapsedEntities.has(f.entity)) {
        rows.push(f);
      }
    }
    return rows;
  }, [filteredGzFields, entityFilter, mappingByTarget, collapsedEntities]);

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

  const isHeaderRow = (f: DisplayRow) => !!f._entityHeader;

  const baseColumns: ColumnsType<DisplayRow> = [
    {
      title: 'GrowthZone Field',
      key: 'field',
      width: colWidths.field,
      onCell: (f: DisplayRow) => isHeaderRow(f)
        ? { colSpan: 5, style: { background: 'linear-gradient(135deg, #f3eeff, #ece4fc)', padding: '8px 12px', borderBottom: '2px solid #d9d6fe', cursor: 'pointer' } }
        : {},
      render: (_, f: DisplayRow) => {
        if (isHeaderRow(f)) {
          const collapsed = collapsedEntities.has(f._entityHeader!);
          return (
            <Space size={8} align="center">
              {collapsed ? <RightOutlined style={{ color: '#6b4fa0', fontSize: 12 }} /> : <DownOutlined style={{ color: '#6b4fa0', fontSize: 12 }} />}
              <Text strong style={{ color: '#2d1854', fontSize: 14 }}>{f._entityHeader}</Text>
              <Tag style={{ background: '#e0d4f5', color: '#2d1854', border: 'none', fontSize: 11 }}>
                {f._entityMapped} / {f._entityTotal} mapped
              </Tag>
              {(f._entityRequired ?? 0) > 0 && (
                <Tag style={{
                  background: f._entityRequiredMapped === f._entityRequired ? '#f6ffed' : '#fff1f0',
                  color: f._entityRequiredMapped === f._entityRequired ? '#237804' : '#d32029',
                  border: 'none', fontSize: 11,
                }}>
                  {f._entityRequiredMapped} / {f._entityRequired} required
                </Tag>
              )}
            </Space>
          );
        }
        return (
          <Space direction="vertical" size={0}>
            <Space size={4} align="center">
              <Text strong>{f.label}</Text>
              {f.required && <Tag color="red" style={{ fontSize: 10, lineHeight: '16px' }}>Required</Tag>}
              {f.custom && <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px' }}>Custom</Tag>}
            </Space>
            <Text style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>{f.description}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Your Data Column',
      key: 'source',
      width: colWidths.source,
      onCell: (f: DisplayRow) => isHeaderRow(f) ? { colSpan: 0 } : {},
      render: (_, f: DisplayRow) => {
        if (isHeaderRow(f)) return null;
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
            options={sourceOptions}
          />
        );
      },
    },
    {
      title: 'Sample Value',
      key: 'sample',
      width: colWidths.sample,
      ellipsis: true,
      onCell: (f: DisplayRow) => isHeaderRow(f) ? { colSpan: 0 } : {},
      render: (_, f: DisplayRow) => {
        if (isHeaderRow(f)) return null;
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
      onCell: (f: DisplayRow) => isHeaderRow(f) ? { colSpan: 0 } : {},
      render: (_, f: DisplayRow) => {
        if (isHeaderRow(f)) return null;
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
      onCell: (f: DisplayRow) => isHeaderRow(f) ? { colSpan: 0 } : {},
      render: (_, f: DisplayRow) => {
        if (isHeaderRow(f)) return null;
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
    <div>
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

      {/* Schema coverage summary bar */}
      {gzFields.length > 0 && (
        <Card size="small" style={{ marginBottom: unmappedRequired.length > 0 ? 8 : 16, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
          <Row align="middle" gutter={[8, 6]} wrap>
            <Col>
              <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600 }}>PROGRESS</Text>
            </Col>
            {entityCoverage.map((ec) => {
              const complete = ec.mapped === ec.total;
              const hasReqGap = ec.reqMapped < ec.required;
              return (
                <Col key={ec.entity}>
                  <Tag style={{
                    fontSize: 11,
                    backgroundColor: complete ? '#f6ffed' : hasReqGap ? '#fff1f0' : '#f3eeff',
                    color: complete ? '#237804' : hasReqGap ? '#d32029' : '#2d1854',
                    borderColor: complete ? '#b7eb8f' : hasReqGap ? '#ffa39e' : '#e0d4f5',
                  }}>
                    {ec.entity} {ec.mapped}/{ec.total}
                  </Tag>
                </Col>
              );
            })}
            <Col style={{ marginLeft: 'auto' }}>
              <Space size={16}>
                <span>
                  <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>Required: </Text>
                  <Text strong style={{ fontSize: 12, color: requiredMapped === requiredTotal ? '#237804' : '#d32029' }}>
                    {requiredMapped}/{requiredTotal}
                  </Text>
                </span>
                <span>
                  <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>Approved: </Text>
                  <Text strong style={{ fontSize: 12, color: '#237804' }}>{approvedCount}</Text>
                </span>
                <span>
                  <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>Needs Review: </Text>
                  <Text strong style={{ fontSize: 12, color: '#6b4fa0' }}>{needsReviewCount}</Text>
                </span>
              </Space>
            </Col>
          </Row>
          <Row align="middle" style={{ marginTop: 8 }}>
            <Col flex="auto" />
            <Col>
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
      )}

      {/* Unmapped required fields alert */}
      {unmappedRequired.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              <Text strong>{unmappedRequired.length} required field{unmappedRequired.length !== 1 ? 's' : ''} still need a data column: </Text>
              {unmappedRequired.map((f, i) => (
                <span key={f.name}>
                  {i > 0 && ', '}
                  <a
                    onClick={() => {
                      // Expand entity, reset filters, select the field, and scroll into view
                      setCollapsedEntities((prev) => {
                        if (prev.has(f.entity)) {
                          const next = new Set(prev);
                          next.delete(f.entity);
                          localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
                          return next;
                        }
                        return prev;
                      });
                      setEntityFilter('all');
                      setStatusFilter('all');
                      selectField(f);
                      // Scroll after React re-renders the expanded entity rows
                      setTimeout(() => {
                        const row = document.querySelector(`tr[data-row-key="${f.name}"]`);
                        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }}
                    style={{ color: '#d32029', fontWeight: 500, cursor: 'pointer' }}
                  >
                    {f.entity}.{f.label}
                  </a>
                </span>
              ))}
            </span>
          }
        />
      )}

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
            options={entityOptions}
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

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left: mapping table */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Table<DisplayRow>
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              getCheckboxProps: (record: DisplayRow) => ({
                disabled: isHeaderRow(record),
                style: isHeaderRow(record) ? { display: 'none' } : {},
              }),
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
              renderCell: (checked, record: DisplayRow) => {
                if (isHeaderRow(record)) return null;
                return (
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
                );
              },
            } as TableRowSelection<DisplayRow>}
            components={{ header: { cell: ResizableTitle } }}
            columns={columns}
            dataSource={displayRows}
            rowKey="name"
            size="small"
            loading={loading}
            pagination={false}
            scroll={{ x: panelField ? 700 : 900 }}
            rowClassName={(f) => {
              if (isHeaderRow(f)) return 'tenant-mapping-entity-header';
              return f.name === panelField?.name ? 'tenant-mapping-row-active' : '';
            }}
            onRow={(f) => ({
              onClick: () => {
                if (isHeaderRow(f)) toggleEntity(f._entityHeader!);
                else selectField(f);
              },
              style: {
                cursor: 'pointer',
                ...(isHeaderRow(f) ? {} : f.required && !mappingByTarget[f.name] ? { backgroundColor: '#fff7f7' } : {}),
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
        <div style={{ width: 380, flexShrink: 0, position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
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
              style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}
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
                    options={sourceOptions}
                  />
                </div>

                {/* No suggestions hint */}
                {!panelMapping && (
                  <div style={{ padding: '8px 10px', background: '#fffbe6', borderRadius: 4, border: '1px solid #ffe58f' }}>
                    <Text style={{ fontSize: 12, color: '#ad6800' }}>
                      No matching data column was found automatically. Use the dropdown above to manually select a column from your uploaded data.
                    </Text>
                  </div>
                )}

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
      <FloatButton.BackTop visibilityHeight={300} />
    </div>
  );
}
