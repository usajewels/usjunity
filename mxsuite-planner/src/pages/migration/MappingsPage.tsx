import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Table, Tag, Typography, Progress, message, Space, Input, Select,
  Button, Tabs, Row, Col, Breadcrumb, Tooltip, Badge, Alert, Checkbox,
  Divider, List, Spin, Card, Radio,
} from 'antd';
import type { TableRowSelection } from 'antd/es/table/interface';
import {
  ArrowLeftOutlined, CheckCircleOutlined, ClockCircleOutlined, DownOutlined,
  ExclamationCircleOutlined, HistoryOutlined, PlusOutlined, ReloadOutlined, RightOutlined, SearchOutlined, StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FieldMappingEntryDto, MappingStatus, MappingStatsDto } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';
import { migrationApi } from '../../services/migrationApi';
import type { FieldChangeHistoryDto } from '@mxsuite/shared';
import MappingVersionHistory from '../../components/migration/MappingVersionHistory';

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

const { Text } = Typography;

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
  CFV_PROPOSAL: { style: STATUS_STYLE.medium,  icon: <ExclamationCircleOutlined />, label: 'Proposal' },
  REJECTED:     { style: STATUS_STYLE.muted,   icon: <StopOutlined />, label: 'Skipped' },
  UNMAPPED:     { style: STATUS_STYLE.light,   icon: null, label: 'Unmapped' },
};

const STATUS_SORT_ORDER: Record<string, number> = {
  NEEDS_REVIEW: 0, UNMAPPED: 1, CFV_PROPOSAL: 2, MAPPED: 3, REJECTED: 4,
};

const TARGET_FIELDS = [
  { entity: 'Contact', field: 'firstName', label: 'First Name' },
  { entity: 'Contact', field: 'lastName', label: 'Last Name' },
  { entity: 'Contact', field: 'email', label: 'Email' },
  { entity: 'Contact', field: 'phone', label: 'Phone' },
  { entity: 'Contact', field: 'company', label: 'Company' },
  { entity: 'Contact', field: 'title', label: 'Job Title' },
  { entity: 'Contact', field: 'address1', label: 'Address Line 1' },
  { entity: 'Contact', field: 'address2', label: 'Address Line 2' },
  { entity: 'Contact', field: 'city', label: 'City' },
  { entity: 'Contact', field: 'state', label: 'State / Province' },
  { entity: 'Contact', field: 'zip', label: 'Zip / Postal Code' },
  { entity: 'Contact', field: 'country', label: 'Country' },
  { entity: 'Membership', field: 'memberType', label: 'Member Type' },
  { entity: 'Membership', field: 'joinDate', label: 'Join Date' },
  { entity: 'Membership', field: 'expirationDate', label: 'Expiration Date' },
  { entity: 'Membership', field: 'notes', label: 'Notes' },
];

const TARGET_OPTIONS = [
  {
    label: 'Contact',
    options: TARGET_FIELDS.filter((t) => t.entity === 'Contact').map((t) => ({
      value: t.field, label: t.label,
    })),
  },
  {
    label: 'Membership',
    options: TARGET_FIELDS.filter((t) => t.entity === 'Membership').map((t) => ({
      value: t.field, label: t.label,
    })),
  },
  {
    label: 'Custom',
    options: [{ value: '__custom__', label: '✏ Enter custom field...' }],
  },
];

const POLL_INTERVAL_MS = 30_000;
const COACH_LAST_PROJECT_KEY = 'mxsuite_coach_last_project';
const COACH_LAST_MAPPING_KEY = 'mxsuite_coach_last_mapping';

/* Inject lightweight styles for resizable handles + selected row highlight */
if (typeof document !== 'undefined' && !document.getElementById('mappings-page-styles')) {
  const style = document.createElement('style');
  style.id = 'mappings-page-styles';
  style.textContent = `
    .mapping-row-active td { background: #f3eeff !important; }
    .react-resizable-handle { position: absolute; right: -5px; bottom: 0; top: 0; width: 10px; cursor: col-resize; z-index: 1; }
    .ant-input-data-count { color: rgba(0,0,0,0.65) !important; }
  `;
  document.head.appendChild(style);
}

const COACH_CUSTOM_TARGETS_KEY = 'mxsuite_coach_custom_targets';
function loadCustomTargets(): Array<{ entity: string; field: string }> {
  try { return JSON.parse(localStorage.getItem(COACH_CUSTOM_TARGETS_KEY) || '[]'); }
  catch { return []; }
}
function saveCustomTargets(fields: Array<{ entity: string; field: string }>) {
  localStorage.setItem(COACH_CUSTOM_TARGETS_KEY, JSON.stringify(fields));
}

export default function MappingsPage() {
  usePageTitle('Field Mappings');
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [mappings, setMappings] = useState<FieldMappingEntryDto[]>([]);
  const [stats, setStats] = useState<MappingStatsDto>({ all: 0, needsReview: 0, cfvProposals: 0, mapped: 0, rejected: 0, unmapped: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [targetFilter, setTargetFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [customEntity, setCustomEntity] = useState('Contact');
  const [customFieldName, setCustomFieldName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [customTargetFields, setCustomTargetFields] = useState<Array<{ entity: string; field: string }>>(loadCustomTargets);

  // Right-side detail panel state
  const [panelRecord, setPanelRecord] = useState<FieldMappingEntryDto | null>(null);
  const [panelTarget, setPanelTarget] = useState<string | null>(null);
  const [panelCustomEntity, setPanelCustomEntity] = useState('Contact');
  const [panelCustomField, setPanelCustomField] = useState('');
  const [panelComment, setPanelComment] = useState('');
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelHistory, setPanelHistory] = useState<FieldChangeHistoryDto[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);
  const [panelHistoryTotal, setPanelHistoryTotal] = useState(0);
  const [panelHistoryPage, setPanelHistoryPage] = useState(0);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = async (quiet = false) => {
    if (!projectId) return;
    if (!quiet) setLoading(true); else setRefreshing(true);
    try {
      const [projectRes, mappingsRes, statsRes] = await Promise.all([
        migrationApi.getProject(projectId),
        migrationApi.listMappings(projectId, { page: 0, size: 500 }),
        migrationApi.getMappingStats(projectId),
      ]);
      setProjectName(projectRes.data.name || '');
      setTenantName((projectRes.data as any).tenant?.name || '');
      setMappings(mappingsRes.data.content);
      setStats(statsRes.data);
      setLastRefreshed(new Date());
    } catch {
      if (!quiet) message.error('Failed to load mappings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (projectId) localStorage.setItem(COACH_LAST_PROJECT_KEY, projectId);
    loadAll();
    pollRef.current = setInterval(() => loadAll(true), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [projectId]);

  // Auto-select on initial load: last worked-on mapping → first needs-review → first row
  const initialSelectDone = useRef(false);
  useEffect(() => {
    if (initialSelectDone.current || loading || mappings.length === 0) return;
    initialSelectDone.current = true;

    const storageKey = `${COACH_LAST_MAPPING_KEY}_${projectId}`;
    const lastId = localStorage.getItem(storageKey);
    if (lastId) {
      const last = mappings.find((m) => m.id === lastId);
      if (last) { selectRecord(last); return; }
    }

    const needsReview = mappings.find(
      (m) => m.mappingStatus === 'NEEDS_REVIEW' || m.mappingStatus === 'CFV_PROPOSAL'
    );
    if (needsReview) { selectRecord(needsReview); return; }

    selectRecord(mappings[0]);
  }, [loading, mappings]);

  const usedTargets = new Set(mappings.filter((m) => m.targetField).map((m) => m.targetField!));

  // TARGET_OPTIONS + persisted custom fields, rebuilt whenever customTargetFields changes
  const dynamicTargetOptions = TARGET_OPTIONS.map((group) =>
    group.label === 'Custom'
      ? {
          ...group,
          options: [
            ...customTargetFields.map((f) => ({ value: f.field, label: `${f.entity} · ${f.field}` })),
            ...group.options, // keeps "✏ Enter custom field..." at bottom
          ],
        }
      : group
  );

  const statusFilterMap: Record<string, MappingStatus | undefined> = {
    all: undefined, needs_review: 'NEEDS_REVIEW', cfv: 'CFV_PROPOSAL',
    mapped: 'MAPPED', rejected: 'REJECTED', unmapped: 'UNMAPPED',
  };

  const filtered = mappings.filter((m) => {
    const statusVal = statusFilterMap[statusFilter];
    if (statusVal && m.mappingStatus !== statusVal) return false;
    if (targetFilter === 'Contact' && m.targetEntity !== 'Contact') return false;
    if (targetFilter === 'Membership' && m.targetEntity !== 'Membership') return false;
    if (targetFilter === 'Unassigned' && m.targetField) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!m.sourceField.toLowerCase().includes(q)
          && !(m.targetField || '').toLowerCase().includes(q)
          && !(m.sampleValue || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const selectedRecords = filtered.filter((m) => selectedRowKeys.includes(m.id));
  const bulkApprovable = selectedRecords.filter(
    (m) => m.targetField && (m.mappingStatus === 'NEEDS_REVIEW' || m.mappingStatus === 'CFV_PROPOSAL')
  );
  const bulkSkippable = selectedRecords.filter(
    (m) => m.mappingStatus !== 'MAPPED' && m.mappingStatus !== 'REJECTED'
  );

  const startEdit = (record: FieldMappingEntryDto) => {
    setEditingId(record.id);
    setEditingValue(record.targetField ?? null);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue(null);
    setCustomEntity('Contact');
    setCustomFieldName('');
  };

  const saveTarget = async (record: FieldMappingEntryDto, newField: string | null) => {
    if (!projectId) return;
    let targetField: string | undefined;
    let targetEntity: string | undefined;
    if (newField === '__custom__') {
      if (!customFieldName.trim()) return;
      targetField = customFieldName.trim();
      targetEntity = customEntity;
      // Persist for reuse in dropdown
      const exists = customTargetFields.some((f) => f.entity === targetEntity && f.field === targetField);
      if (!exists) {
        const updated = [...customTargetFields, { entity: targetEntity!, field: targetField }];
        setCustomTargetFields(updated);
        saveCustomTargets(updated);
      }
    } else if (newField) {
      const predefined = TARGET_FIELDS.find((t) => t.field === newField);
      if (predefined) {
        targetField = predefined.field;
        targetEntity = predefined.entity;
      } else {
        // Saved custom field — look up entity from customTargetFields
        const custom = customTargetFields.find((f) => f.field === newField);
        targetField = custom?.field ?? newField;
        targetEntity = custom?.entity ?? 'Contact';
      }
    }
    setSavingId(record.id);
    try {
      const { data } = await migrationApi.updateMapping(projectId, record.id, {
        targetField,
        targetEntity,
      });
      setMappings((prev) => prev.map((m) => m.id === data.id ? data : m));
      message.success(targetField ? `Mapped → ${targetField}` : 'Target cleared');
      cancelEdit();
    } catch {
      message.error('Failed to update mapping');
    } finally {
      setSavingId(null);
    }
  };

  const handleBulkApproveSelected = async () => {
    if (!projectId || !bulkApprovable.length) return;
    try {
      const results = await Promise.all(
        bulkApprovable.map((m) => migrationApi.approveMapping(projectId, m.id))
      );
      setMappings((prev) => prev.map((m) => {
        const updated = results.find((r) => r.data.id === m.id);
        return updated ? updated.data : m;
      }));
      migrationApi.getMappingStats(projectId).then(({ data: s }) => setStats(s));
      setSelectedRowKeys([]);
      message.success(`${bulkApprovable.length} mapping${bulkApprovable.length !== 1 ? 's' : ''} approved`);
    } catch {
      message.error('Some approvals failed');
    }
  };

  const handleBulkSkipSelected = async () => {
    if (!projectId || !bulkSkippable.length) return;
    try {
      const results = await Promise.all(
        bulkSkippable.map((m) => migrationApi.updateMapping(projectId, m.id, { mappingStatus: 'REJECTED' }))
      );
      setMappings((prev) => prev.map((m) => {
        const updated = results.find((r) => r.data.id === m.id);
        return updated ? updated.data : m;
      }));
      migrationApi.getMappingStats(projectId).then(({ data: s }) => setStats(s));
      setSelectedRowKeys([]);
      message.success(`${bulkSkippable.length} field${bulkSkippable.length !== 1 ? 's' : ''} skipped`);
    } catch {
      message.error('Some skips failed');
    }
  };

  const HISTORY_PAGE_SIZE = 20;

  const loadFieldHistory = (mappingId: string, page: number) => {
    if (!projectId) return;
    setPanelHistoryLoading(true);
    migrationApi.getFieldChangeHistory(projectId, mappingId, { page, size: HISTORY_PAGE_SIZE })
      .then(({ data }) => {
        setPanelHistory(data.content ?? []);
        setPanelHistoryTotal(data.totalElements ?? 0);
        setPanelHistoryPage(page);
      })
      .catch(() => {})
      .finally(() => setPanelHistoryLoading(false));
  };

  const selectRecord = (record: FieldMappingEntryDto) => {
    setPanelRecord(record);
    if (projectId) localStorage.setItem(`${COACH_LAST_MAPPING_KEY}_${projectId}`, record.id);
    setPanelTarget(record.targetField ?? null);
    setPanelComment(record.customerComment ?? '');
    setPanelCustomEntity('Contact');
    setPanelCustomField('');
    setPanelHistory([]);
    setPanelHistoryTotal(0);
    setPanelHistoryPage(0);
    setExpandedVersions(new Set());
    if (projectId) {
      loadFieldHistory(record.id, 0);
    }
  };

  const savePanel = async () => {
    if (!projectId || !panelRecord) return;
    setPanelSaving(true);
    try {
      let targetField: string | undefined;
      let targetEntity: string | undefined;
      if (panelTarget === '__custom__') {
        if (!panelCustomField.trim()) {
          message.warning('Enter a custom field name');
          setPanelSaving(false);
          return;
        }
        targetField = panelCustomField.trim();
        targetEntity = panelCustomEntity;
        const exists = customTargetFields.some((f) => f.entity === targetEntity && f.field === targetField);
        if (!exists) {
          const updated = [...customTargetFields, { entity: targetEntity!, field: targetField }];
          setCustomTargetFields(updated);
          saveCustomTargets(updated);
        }
      } else if (panelTarget) {
        const predefined = TARGET_FIELDS.find((t) => t.field === panelTarget);
        if (predefined) {
          targetField = predefined.field;
          targetEntity = predefined.entity;
        } else {
          const custom = customTargetFields.find((f) => f.field === panelTarget);
          targetField = custom?.field ?? panelTarget;
          targetEntity = custom?.entity ?? 'Contact';
        }
      }
      const { data } = await migrationApi.updateMapping(projectId, panelRecord.id, {
        targetField: targetField ?? undefined,
        targetEntity: targetEntity ?? undefined,
        customerComment: panelComment.trim() || undefined,
      });
      setMappings((prev) => prev.map((m) => m.id === data.id ? data : m));
      setPanelRecord(data);
      message.success('Mapping saved');
    } catch {
      message.error('Failed to save mapping');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelApprove = async () => {
    if (!projectId || !panelRecord) return;
    setPanelSaving(true);
    try {
      // Save comment first if changed
      if (panelComment !== (panelRecord.customerComment ?? '')) {
        await migrationApi.updateMapping(projectId, panelRecord.id, {
          customerComment: panelComment.trim() || undefined,
        });
      }
      const { data } = await migrationApi.approveMapping(projectId, panelRecord.id);
      setMappings((prev) => prev.map((m) => m.id === data.id ? data : m));
      setPanelRecord(data);
      migrationApi.getMappingStats(projectId).then(({ data: s }) => setStats(s));
      message.success('Mapping approved');
    } catch {
      message.error('Failed to approve');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelSkip = async () => {
    if (!projectId || !panelRecord) return;
    setPanelSaving(true);
    try {
      const { data } = await migrationApi.updateMapping(projectId, panelRecord.id, { mappingStatus: 'REJECTED' });
      setMappings((prev) => prev.map((m) => m.id === data.id ? data : m));
      setPanelRecord(data);
      migrationApi.getMappingStats(projectId).then(({ data: s }) => setStats(s));
      message.success(`"${panelRecord.sourceField}" skipped`);
    } catch {
      message.error('Failed to skip');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelRestore = async () => {
    if (!projectId || !panelRecord) return;
    setPanelSaving(true);
    try {
      const { data } = await migrationApi.updateMapping(projectId, panelRecord.id, { mappingStatus: 'UNMAPPED' });
      setMappings((prev) => prev.map((m) => m.id === data.id ? data : m));
      setPanelRecord(data);
      message.success(`"${panelRecord.sourceField}" restored`);
    } catch {
      message.error('Failed to restore');
    } finally {
      setPanelSaving(false);
    }
  };

  /* ---------- Resizable column widths ---------- */
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    sourceField: 160, sampleValue: 150, targetField: 250,
    confidence: 110, status: 130, customerComment: 180,
  });

  const handleColumnResize = useCallback(
    (key: string) => (_e: any, { size }: { size: { width: number } }) => {
      setColWidths((prev) => ({ ...prev, [key]: size.width }));
    },
    [],
  );

  const baseColumns: ColumnsType<FieldMappingEntryDto> = [
    {
      title: 'Source Field',
      dataIndex: 'sourceField',
      key: 'sourceField',
      width: colWidths.sourceField,
      sorter: (a, b) => a.sourceField.localeCompare(b.sourceField),
      render: (field: string) => <Text strong>{field}</Text>,
    },
    {
      title: 'Sample',
      dataIndex: 'sampleValue',
      key: 'sampleValue',
      width: colWidths.sampleValue,
      ellipsis: true,
      render: (v: string) => <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>{v || '—'}</Text>,
    },
    {
      title: 'Target Field',
      key: 'targetField',
      width: colWidths.targetField,
      sorter: (a, b) => {
        const aKey = `${a.targetEntity || ''}.${a.targetField || ''}`;
        const bKey = `${b.targetEntity || ''}.${b.targetField || ''}`;
        return aKey.localeCompare(bKey);
      },
      filters: [
        { text: 'Contact', value: 'Contact' },
        { text: 'Membership', value: 'Membership' },
        { text: 'Unassigned', value: 'Unassigned' },
      ],
      onFilter: (value, record) => {
        if (value === 'Unassigned') return !record.targetField;
        return record.targetEntity === value;
      },
      render: (_, record) => {
        const isEditing = editingId === record.id;
        if (isEditing) {
          if (editingValue === '__custom__') {
            return (
              <Space size={4} wrap>
                <Select
                  size="small"
                  style={{ width: 110 }}
                  value={customEntity}
                  onChange={setCustomEntity}
                  options={[
                    { value: 'Contact', label: 'Contact' },
                    { value: 'Membership', label: 'Membership' },
                    { value: 'Other', label: 'Other' },
                  ]}
                />
                <Input
                  size="small"
                  placeholder="field name"
                  value={customFieldName}
                  onChange={(e) => setCustomFieldName(e.target.value)}
                  style={{ width: 110 }}
                  autoFocus
                  onPressEnter={() => saveTarget(record, '__custom__')}
                />
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  loading={savingId === record.id}
                  disabled={!customFieldName.trim()}
                  onClick={() => saveTarget(record, '__custom__')}
                >
                  Save
                </Button>
                <Button size="small" onClick={cancelEdit}>✕</Button>
              </Space>
            );
          }
          return (
            <Space.Compact>
              <Select
                size="small"
                style={{ width: 160 }}
                placeholder="Select target..."
                value={editingValue}
                onChange={setEditingValue}
                showSearch
                optionFilterProp="label"
                allowClear
                autoFocus
                options={dynamicTargetOptions.map((group) => ({
                  ...group,
                  options: group.options.map((opt) => ({
                    ...opt,
                    disabled: usedTargets.has(opt.value) && opt.value !== record.targetField,
                  })),
                }))}
              />
              <Button
                size="small"
                type="primary"
                loading={savingId === record.id}
                disabled={editingValue === (record.targetField ?? null)}
                onClick={() => saveTarget(record, editingValue)}
              >
                Save
              </Button>
              <Button size="small" onClick={cancelEdit}>✕</Button>
            </Space.Compact>
          );
        }
        return record.targetField ? (
          <Tooltip title="Click to change">
            <Tag style={{ cursor: 'pointer', backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }} onClick={() => startEdit(record)}>
              {record.targetEntity ? `${record.targetEntity}.` : ''}{record.targetField}
            </Tag>
          </Tooltip>
        ) : (
          <Button size="small" type="dashed" onClick={() => startEdit(record)}>Assign</Button>
        );
      },
    },
    {
      title: 'Confidence',
      dataIndex: 'confidencePct',
      key: 'confidence',
      width: colWidths.confidence,
      align: 'center',
      sorter: (a, b) => (a.confidencePct ?? -1) - (b.confidencePct ?? -1),
      render: (pct: number) => pct != null ? (
        <Progress
          percent={pct}
          size="small"
          strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f'}
          style={{ width: 75 }}
        />
      ) : <Text style={{ color: 'rgba(0,0,0,0.65)' }}>—</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'mappingStatus',
      key: 'status',
      width: colWidths.status,
      sorter: (a, b) =>
        (STATUS_SORT_ORDER[a.mappingStatus] ?? 99) - (STATUS_SORT_ORDER[b.mappingStatus] ?? 99),
      render: (status: string) => {
        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.UNMAPPED;
        return <Tag icon={cfg.icon} style={cfg.style}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Customer Note',
      dataIndex: 'customerComment',
      key: 'customerComment',
      width: colWidths.customerComment,
      ellipsis: true,
      render: (v: string) => v
        ? <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }} title={v}>{v}</Text>
        : null,
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

  const tabs = [
    { key: 'all', label: `All (${stats.all})` },
    { key: 'needs_review', label: `Needs Review (${stats.needsReview})` },
    { key: 'mapped', label: `Approved (${stats.mapped})` },
    { key: 'unmapped', label: `Unmapped (${stats.unmapped})` },
    ...((stats.rejected ?? 0) > 0 ? [{ key: 'rejected', label: `Skipped (${stats.rejected})` }] : []),
  ];

  return (
    <div style={{ overflow: 'hidden' }}>
      {/* Page header with purple tint */}
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
      }}>
        <Breadcrumb
          style={{ marginBottom: 10 }}
          items={[
            {
              title: (
                <Button
                  type="link"
                  size="small"
                  icon={<ArrowLeftOutlined />}
                  style={{ padding: 0, color: '#1a0e3a' }}
                  onClick={() => navigate('/plans/onboarding-projects/projects')}
                >
                  Projects
                </Button>
              ),
            },
            { title: <span style={{ color: '#6b4fa0' }}>{projectName || '…'}</span> },
            { title: <span style={{ color: '#2d1854', fontWeight: 500 }}>Field Mappings</span> },
          ]}
        />
        <Row align="middle" justify="space-between">
          <Col>
            <Text strong style={{ fontSize: 20, color: '#2d1854' }}>{projectName}</Text>
            {tenantName && (
              <Text style={{ marginLeft: 12, fontSize: 13, color: '#6b4fa0' }}>
                {tenantName}
              </Text>
            )}
          </Col>
          <Col>
            <Space>
              {lastRefreshed && (
                <Text style={{ fontSize: 12, color: '#6b4fa0' }}>
                  Updated {lastRefreshed.toLocaleTimeString()}
                </Text>
              )}
              <Button
                icon={<HistoryOutlined />}
                size="small"
                onClick={() => setVersionHistoryOpen(true)}
                style={{ borderColor: '#6b4fa0', color: '#6b4fa0' }}
              >
                History
              </Button>
              <Tooltip title="Auto-refreshes every 30 seconds">
                <Badge dot={refreshing} offset={[-4, 4]}>
                  <Button
                    icon={<ReloadOutlined spin={refreshing} />}
                    size="small"
                    onClick={() => loadAll(true)}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </Badge>
              </Tooltip>
            </Space>
          </Col>
        </Row>
      </div>

      {/* Tabs + search toolbar */}
      <Row align="middle" style={{ marginBottom: 8, borderBottom: '2px solid #e0d4f5', paddingBottom: 0 }}>
        <Col flex="auto">
          <Tabs
            activeKey={statusFilter}
            onChange={(k) => { setStatusFilter(k); setSelectedRowKeys([]); cancelEdit(); }}
            items={tabs}
            size="small"
            style={{ marginBottom: 0 }}
          />
        </Col>
        <Col>
          <Space>
            <Input
              placeholder="Search fields..."
              prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
              allowClear
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedRowKeys([]); cancelEdit(); }}
              style={{ width: 180 }}
              size="small"
            />
            <Select
              placeholder="Target entity"
              allowClear
              value={targetFilter}
              onChange={(v) => { setTargetFilter(v); setSelectedRowKeys([]); cancelEdit(); }}
              style={{ width: 140 }}
              size="small"
              options={[
                { value: 'Contact', label: 'Contact' },
                { value: 'Membership', label: 'Membership' },
                { value: 'Unassigned', label: 'Unassigned' },
              ]}
            />
          </Space>
        </Col>
      </Row>

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
                    disabled={!bulkApprovable.length}
                    onClick={handleBulkApproveSelected}
                  >
                    Approve{bulkApprovable.length > 0 ? ` (${bulkApprovable.length})` : ''}
                  </Button>
                  <Button
                    size="small"
                    disabled={!bulkSkippable.length}
                    onClick={handleBulkSkipSelected}
                  >
                    Skip{bulkSkippable.length > 0 ? ` (${bulkSkippable.length})` : ''}
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
          <Table<FieldMappingEntryDto>
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              columnTitle: (
                <Checkbox
                  indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < filtered.length}
                  checked={filtered.length > 0 && selectedRowKeys.length === filtered.length}
                  onChange={(e) => {
                    setSelectedRowKeys(e.target.checked ? filtered.map((m) => m.id) : []);
                  }}
                >
                  <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                    Select all fields
                  </span>
                </Checkbox>
              ),
              renderCell: (checked, record: FieldMappingEntryDto) => (
                <Checkbox
                  checked={checked}
                  onChange={(e) => {
                    const newKeys = e.target.checked
                      ? [...(selectedRowKeys as string[]), record.id]
                      : (selectedRowKeys as string[]).filter((k) => k !== record.id);
                    setSelectedRowKeys(newKeys);
                  }}
                >
                  <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                    Select {record.sourceField}
                  </span>
                </Checkbox>
              ),
            } as TableRowSelection<FieldMappingEntryDto>}
            components={{ header: { cell: ResizableTitle } }}
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            size="small"
            loading={loading}
            scroll={{ x: panelRecord ? 900 : 1100 }}
            pagination={{ pageSize: 50, hideOnSinglePage: true, showTotal: (t) => `${t} fields` }}
            locale={{ emptyText: 'No mappings found.' }}
            rowClassName={(record) => record.id === panelRecord?.id ? 'mapping-row-active' : ''}
            onRow={(record) => ({
              onClick: () => { cancelEdit(); selectRecord(record); },
              style: { cursor: 'pointer' },
            })}
          />
        </div>

        {/* Right: detail panel */}
        <div style={{ width: 380, flexShrink: 0 }}>
          {!panelRecord ? (
            <Card
              size="small"
              style={{
                height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderColor: '#e0d4f5', borderTop: '3px solid #6b4fa0',
              }}
              styles={{ body: { textAlign: 'center' } }}
            >
              <Text style={{ fontSize: 13, color: '#6b4fa0' }}>
                Click a mapping row to review its details here.
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
                      const cfg = STATUS_CONFIG[panelRecord.mappingStatus] || STATUS_CONFIG.UNMAPPED;
                      return <Tag icon={cfg.icon} style={{ ...cfg.style, margin: 0 }}>{cfg.label}</Tag>;
                    })()}
                    <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600 }}>DECISION</Text>
                  </div>
                  <Text strong style={{ fontSize: 14, display: 'block', marginTop: 4, color: '#2d1854' }}>
                    {panelRecord.sourceEntity}.{panelRecord.sourceField}
                  </Text>
                </div>
              }
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {/* Sample value */}
                {panelRecord.sampleValue && (
                  <div style={{ padding: '6px 10px', background: '#f9f6ff', borderRadius: 4, border: '1px solid #e0d4f5' }}>
                    <Text style={{ fontSize: 12, color: '#6b4fa0' }}>Sample: </Text>
                    <Text style={{ fontSize: 12 }}>{panelRecord.sampleValue}</Text>
                  </div>
                )}

                {/* AI candidates as options */}
                {panelRecord.candidates && panelRecord.candidates.length > 0 && (
                  <div>
                    <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 6 }}>OPTIONS</Text>
                    <Radio.Group
                      value={panelTarget}
                      onChange={(e) => setPanelTarget(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        {panelRecord.candidates.map((c) => {
                          const isUsed = usedTargets.has(c.targetField) && c.targetField !== panelRecord.targetField;
                          return (
                            <div
                              key={c.id}
                              style={{
                                border: panelTarget === c.targetField ? '1.5px solid #6b4fa0' : '1px solid #e0d4f5',
                                borderRadius: 6,
                                padding: '8px 10px',
                                backgroundColor: panelTarget === c.targetField ? '#f3eeff' : '#fff',
                                opacity: isUsed ? 0.5 : 1,
                              }}
                            >
                              <Radio value={c.targetField} disabled={isUsed} style={{ width: '100%' }}>
                                <div>
                                  <Text strong style={{ fontSize: 13 }}>{c.targetField}</Text>
                                  <Progress
                                    percent={c.matchPct}
                                    size="small"
                                    strokeColor={c.matchPct >= 80 ? '#52c41a' : c.matchPct >= 50 ? '#fa8c16' : '#ff4d4f'}
                                    style={{ width: 100, display: 'inline-block', marginLeft: 8 }}
                                    format={(p) => `${p}%`}
                                  />
                                  {c.description && (
                                    <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', display: 'block' }}>{c.description}</Text>
                                  )}
                                </div>
                              </Radio>
                            </div>
                          );
                        })}
                      </Space>
                    </Radio.Group>
                  </div>
                )}

                {/* Target field dropdown (fallback / override) */}
                <div>
                  <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    {panelRecord.candidates?.length ? 'Or select manually' : 'PROPOSED TARGET'}
                  </Text>
                  <Select
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="Select target field..."
                    value={panelTarget}
                    onChange={setPanelTarget}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                    options={dynamicTargetOptions.map((group) => ({
                      ...group,
                      options: group.options.map((opt) => ({
                        ...opt,
                        disabled: usedTargets.has(opt.value) && opt.value !== panelRecord.targetField,
                      })),
                    }))}
                  />
                  {panelTarget === '__custom__' ? (
                    <Space style={{ marginTop: 6, width: '100%' }} direction="vertical" size={4}>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={panelCustomEntity}
                        onChange={setPanelCustomEntity}
                        options={[
                          { value: 'Contact', label: 'Contact' },
                          { value: 'Membership', label: 'Membership' },
                          { value: 'Other', label: 'Other' },
                        ]}
                      />
                      <Input
                        size="small"
                        placeholder="GrowthZone field name"
                        value={panelCustomField}
                        onChange={(e) => setPanelCustomField(e.target.value)}
                        autoFocus
                      />
                    </Space>
                  ) : (
                    <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', marginTop: 2, display: 'block' }}>
                      <a onClick={() => setPanelTarget('__custom__')} style={{ color: '#1a0e3a' }}>Add a custom field</a>
                    </Text>
                  )}
                </div>

                <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />

                {/* Customer comment */}
                <div style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>CUSTOMER COMMENT</Text>
                  <Input.TextArea
                    aria-label="Customer comment"
                    rows={2}
                    size="small"
                    placeholder="Add a note..."
                    value={panelComment}
                    onChange={(e) => setPanelComment(e.target.value)}
                    maxLength={500}
                    showCount
                  />
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {panelRecord.mappingStatus === 'REJECTED' ? (
                    <Button loading={panelSaving} onClick={handlePanelRestore} style={{ flex: 1 }}>Restore</Button>
                  ) : (
                    <>
                      {panelTarget && panelRecord.mappingStatus !== 'MAPPED' && (
                        <Button type="primary" loading={panelSaving} onClick={handlePanelApprove}
                          style={{ flex: 1, background: '#2d1854', borderColor: '#2d1854' }}>
                          Approve mapping
                        </Button>
                      )}
                      {panelRecord.mappingStatus !== 'MAPPED' && (
                        <Button danger loading={panelSaving} onClick={handlePanelSkip} style={{ color: '#a8071a', borderColor: '#cf1322' }}>
                          Reject
                        </Button>
                      )}
                    </>
                  )}
                  <Button loading={panelSaving} onClick={savePanel}>Save</Button>
                </div>

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
                                onClick={() => { if (panelRecord) loadFieldHistory(panelRecord.id, panelHistoryPage - 1); }}>
                                Prev
                              </Button>
                              <Text style={{ fontSize: 11 }}>{panelHistoryPage + 1}/{totalPages}</Text>
                              <Button size="small" disabled={panelHistoryPage >= totalPages - 1}
                                onClick={() => { if (panelRecord) loadFieldHistory(panelRecord.id, panelHistoryPage + 1); }}>
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

      {projectId && (
        <MappingVersionHistory
          open={versionHistoryOpen}
          onClose={() => setVersionHistoryOpen(false)}
          fetchVersions={(params) => migrationApi.listVersions(projectId, params)}
          fetchVersion={(versionId) => migrationApi.getVersion(projectId, versionId)}
          onRollback={async (targetVersion) => {
            await migrationApi.rollbackVersion(projectId, targetVersion);
          }}
          onRollbackComplete={() => loadAll(true)}
        />
      )}
    </div>
  );
}
