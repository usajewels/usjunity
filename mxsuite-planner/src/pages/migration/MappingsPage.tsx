import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Table, Tag, Typography, Progress, message, Space, Input, Select, FloatButton,
  Button, Tabs, Row, Col, Breadcrumb, Tooltip, Badge, Alert, Checkbox,
  Divider, List, Spin, Card, Radio, Collapse, Modal, Upload,
} from 'antd';
import type { TableRowSelection } from 'antd/es/table/interface';
import {
  ApartmentOutlined, ArrowLeftOutlined, CheckCircleOutlined, ClockCircleOutlined, DownOutlined,
  ExclamationCircleOutlined, ExportOutlined, HistoryOutlined, ImportOutlined,
  PlusOutlined, ReloadOutlined,
  RightOutlined, SearchOutlined, StopOutlined, SwapOutlined, WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FieldMappingEntryDto, MappingStatus, MappingStatsDto, EntityCoverageEntry } from '@mxsuite/shared';
import { usePageTitle } from '@mxsuite/shared';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';
import { migrationApi } from '../../services/migrationApi';
import type { FieldChangeHistoryDto } from '@mxsuite/shared';
import MappingVersionHistory from '../../components/migration/MappingVersionHistory';
import EntityCoveragePanel from '../../components/migration/EntityCoveragePanel';

const { Text } = Typography;

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

/* ---------- Types ---------- */

interface GzField {
  entity: string;
  name: string;
  label: string;
  required: boolean;
  description: string;
}

/** Convert camelCase to human-readable label */
function toLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

type ViewMode = 'source-target' | 'target-source';

/* ---------- Constants ---------- */

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

const STATUS_SORT_ORDER: Record<string, number> = {
  NEEDS_REVIEW: 0, UNMAPPED: 1, CFV_PROPOSAL: 2, MAPPED: 3, REJECTED: 4,
};

const POLL_INTERVAL_MS = 30_000;
const COACH_LAST_PROJECT_KEY = 'mxsuite_coach_last_project';
const COACH_LAST_MAPPING_KEY = 'mxsuite_coach_last_mapping';
const COACH_VIEW_MODE_KEY = 'mxsuite_coach_view_mode';
const COLLAPSED_KEY = 'mxsuite_coach_collapsed_entities';
const COACH_LAST_GZ_FIELD_KEY = 'mxsuite_coach_last_gz_field';

const COACH_CUSTOM_TARGETS_KEY = 'mxsuite_coach_custom_targets';
function loadCustomTargets(): Array<{ entity: string; field: string }> {
  try { return JSON.parse(localStorage.getItem(COACH_CUSTOM_TARGETS_KEY) || '[]'); }
  catch { return []; }
}
function saveCustomTargets(fields: Array<{ entity: string; field: string }>) {
  localStorage.setItem(COACH_CUSTOM_TARGETS_KEY, JSON.stringify(fields));
}

/* Inject styles for resizable handles + selected row highlight */
if (typeof document !== 'undefined' && !document.getElementById('mappings-page-styles')) {
  const style = document.createElement('style');
  style.id = 'mappings-page-styles';
  style.textContent = `
    .mapping-row-active td { background: #e8ddf5 !important; }
    .mapping-row-active td:first-child { border-left: 3px solid #6b4fa0; }
    .ant-table-tbody > tr:not(.mapping-row-active):not(.coach-mapping-entity-header):hover > td { background: #f9f6ff !important; }
    .coach-mapping-entity-header td { padding: 6px 12px !important; }
    .coach-mapping-entity-header .ant-checkbox-wrapper { display: none; }
    .react-resizable-handle { position: absolute; right: -5px; bottom: 0; top: 0; width: 10px; cursor: col-resize; z-index: 1; }
    .ant-input-data-count { color: rgba(0,0,0,0.65) !important; }
    .coverage-field-row:hover { background-color: #f9f6ff !important; }
    .coverage-field-row.coverage-field-highlighted { background-color: #fff7e6 !important; border-left: 3px solid #fa8c16 !important; }
    .coverage-field-row.coverage-field-highlighted:hover { background-color: #fff1cc !important; }
  `;
  document.head.appendChild(style);
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

  // Dynamic target schema (loaded from API)
  const [schemaFields, setSchemaFields] = useState<GzField[]>([]);

  // View mode toggle
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(COACH_VIEW_MODE_KEY);
    return stored === 'source-target' ? 'source-target' : 'target-source';
  });

  const [statusFilter, setStatusFilter] = useState('all');
  const [targetFilter, setTargetFilter] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Source → Target inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [customEntity, setCustomEntity] = useState('Contact');
  const [customFieldName, setCustomFieldName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [stCollapsedSources, setStCollapsedSources] = useState<Set<string>>(new Set());
  const [addTargetField, setAddTargetField] = useState<string | null>(null);
  const [customTargetFields, setCustomTargetFields] = useState<Array<{ entity: string; field: string }>>(loadCustomTargets);

  // Right panel tab state
  const [panelTab, setPanelTab] = useState<'detail' | 'coverage'>('detail');
  const [highlightedCoverageField, setHighlightedCoverageField] = useState<string | null>(null);

  // Right-side detail panel state (Source → Target)
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
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Entity scope detection
  const [entityScope, setEntityScope] = useState<EntityCoverageEntry[]>([]);

  // Right-side detail panel state (Target → Source)
  const [panelField, setPanelField] = useState<GzField | null>(null);
  const [panelSourceId, setPanelSourceId] = useState<string | null>(null);

  // Entity collapse (Target → Source view)
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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---------- Data loading ---------- */

  const loadAll = async (quiet = false) => {
    if (!projectId) return;
    if (!quiet) setLoading(true); else setRefreshing(true);
    try {
      const [projectRes, mappingsRes, statsRes, schemaRes, coverageRes] = await Promise.all([
        migrationApi.getProject(projectId),
        migrationApi.listMappings(projectId, { page: 0, size: 500 }),
        migrationApi.getMappingStats(projectId),
        migrationApi.getTargetSchema(projectId),
        migrationApi.getEntityCoverage(projectId).catch(() => ({ data: [] as EntityCoverageEntry[] })),
      ]);
      setProjectName(projectRes.data.name || '');
      setTenantName((projectRes.data as any).tenant?.name || '');
      setMappings(mappingsRes.data.content);
      setStats(statsRes.data);
      setEntityScope(coverageRes.data || []);
      const loaded = (schemaRes.data.targetSchema || []).map((f: any) => ({
        entity: f.entity || 'Other',
        name: f.name,
        label: toLabel(f.name),
        required: !!f.required,
        description: f.description || '',
      }));
      setSchemaFields(loaded);
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

  /* ---------- Entity scope toggle ---------- */

  const handleEntityScopeToggle = useCallback(async (entity: string, active: boolean) => {
    if (!projectId) return;
    try {
      const res = await migrationApi.updateEntityCoverage(projectId, [{ entity, active }]);
      setEntityScope(res.data || []);
    } catch {
      message.error('Failed to update entity scope');
    }
  }, [projectId]);

  // Active entities from detection (empty set = no filtering = all active)
  const activeEntities = useMemo(() => {
    if (entityScope.length === 0) return new Set<string>();
    return new Set(entityScope.filter(e => e.active).map(e => e.entity));
  }, [entityScope]);

  // Filter schema fields by active entities
  const filteredSchemaFields = useMemo(() => {
    if (activeEntities.size === 0) return schemaFields;
    return schemaFields.filter(f => activeEntities.has(f.entity));
  }, [schemaFields, activeEntities]);

  /* ---------- Derived data (shared) ---------- */

  const allGzFieldNames = new Set(filteredSchemaFields.map((f) => f.name));

  // Build mappingByTarget for Target→Source view
  const mappingByTarget: Record<string, FieldMappingEntryDto> = {};
  const unmappedEntries: FieldMappingEntryDto[] = [];
  const nonStandardEntries: FieldMappingEntryDto[] = [];

  for (const m of mappings) {
    if (!m.targetField) {
      if (m.mappingStatus !== 'REJECTED') unmappedEntries.push(m);
    } else if (!allGzFieldNames.has(m.targetField)) {
      nonStandardEntries.push(m);
    } else {
      mappingByTarget[m.targetField] = m;
    }
  }

  const usedTargets = new Set(mappings.filter((m) => m.targetField).map((m) => m.targetField!));

  const sourceOptions = mappings.map((m) => ({
    value: m.id,
    label: m.sourceField,
  }));

  // Build target dropdown options grouped by entity from schema
  const targetOptions = useMemo(() => {
    const entityMap: Record<string, Array<{ value: string; label: string }>> = {};
    for (const f of filteredSchemaFields) {
      if (!entityMap[f.entity]) entityMap[f.entity] = [];
      entityMap[f.entity].push({ value: f.name, label: f.label });
    }
    const groups = Object.entries(entityMap).sort(([a], [b]) => a.localeCompare(b)).map(([entity, options]) => ({
      label: entity,
      options,
    }));
    // Add custom fields group
    groups.push({
      label: 'Custom',
      options: [
        ...customTargetFields.map((f) => ({ value: f.field, label: `${f.entity} · ${f.field}` })),
        { value: '__custom__', label: '✏ Enter custom field...' },
      ],
    });
    return groups;
  }, [filteredSchemaFields, customTargetFields]);

  const entityOptions = useMemo(() => {
    const entities = new Set(filteredSchemaFields.map((f) => f.entity).filter(Boolean));
    return [
      { value: 'all', label: 'All entities' },
      ...Array.from(entities).sort().map((e) => ({ value: e, label: e })),
    ];
  }, [filteredSchemaFields]);

  // Stats for Target→Source view
  const requiredFields = filteredSchemaFields.filter((f) => f.required);
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
    const entities = [...new Set(filteredSchemaFields.map((f) => f.entity))].sort();
    return entities.map((entity) => {
      const fields = filteredSchemaFields.filter((f) => f.entity === entity);
      const mapped = fields.filter((f) => mappingByTarget[f.name]).length;
      const req = fields.filter((f) => f.required);
      const reqMapped = req.filter((f) => mappingByTarget[f.name]).length;
      return { entity, total: fields.length, mapped, required: req.length, reqMapped };
    });
  }, [filteredSchemaFields, mappingByTarget]);

  // Unmapped required fields for warning alert
  const unmappedRequired = requiredFields.filter((f) => !mappingByTarget[f.name]);

  // Schema sidebar collapse state (for empty-panel coverage tree)
  const [schemaSidebarCollapsed, setSchemaSidebarCollapsed] = useState<Set<string>>(() => {
    // Default: collapse entities with no unmapped required fields
    return new Set<string>();
  });

  const toggleSidebarEntity = (entity: string) => {
    setSchemaSidebarCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(entity)) next.delete(entity); else next.add(entity);
      return next;
    });
  };

  // Initialize sidebar collapse: expand entities with unmapped required, collapse others
  useEffect(() => {
    if (filteredSchemaFields.length === 0) return;
    const entities = [...new Set(filteredSchemaFields.map((f) => f.entity))];
    const collapse = new Set<string>();
    for (const entity of entities) {
      const hasUnmappedReq = filteredSchemaFields.some(
        (f) => f.entity === entity && f.required && !mappingByTarget[f.name]
      );
      if (!hasUnmappedReq) collapse.add(entity);
    }
    setSchemaSidebarCollapsed(collapse);
  }, [filteredSchemaFields.length]);

  /* ---------- Smart collapse defaults (Target→Source) ---------- */

  useEffect(() => {
    if (collapsedInitialized || loading || filteredSchemaFields.length === 0) return;
    setCollapsedInitialized(true);
    if (localStorage.getItem(COLLAPSED_KEY)) return;

    const entities = [...new Set(filteredSchemaFields.map((f) => f.entity))];
    const collapseAll = new Set(entities);
    for (const entity of entities) {
      const entityFields = filteredSchemaFields.filter((f) => f.entity === entity);
      const hasWork = entityFields.some((f) => {
        const st = mappingByTarget[f.name]?.mappingStatus;
        return st === 'NEEDS_REVIEW' || st === 'CFV_PROPOSAL' || (f.required && !mappingByTarget[f.name]);
      });
      if (hasWork) collapseAll.delete(entity);
    }
    setCollapsedEntities(collapseAll);
  }, [loading, filteredSchemaFields, mappings]);

  /* ---------- Auto-select on initial load ---------- */

  const initialSelectDone = useRef(false);
  useEffect(() => {
    if (initialSelectDone.current || loading || mappings.length === 0) return;
    initialSelectDone.current = true;

    if (viewMode === 'source-target') {
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
    } else {
      const lastKey = localStorage.getItem(COACH_LAST_GZ_FIELD_KEY);
      if (lastKey) {
        const lastField = filteredSchemaFields.find((f) => f.name === lastKey);
        if (lastField) { selectGzField(lastField); return; }
      }
      const needsReview = filteredSchemaFields.find((f) => {
        const st = mappingByTarget[f.name]?.mappingStatus;
        return st === 'NEEDS_REVIEW' || st === 'CFV_PROPOSAL';
      });
      if (needsReview) { selectGzField(needsReview); return; }
      if (filteredSchemaFields.length > 0) selectGzField(filteredSchemaFields[0]);
    }
  }, [loading, mappings]);

  // Refresh panel when mappings change
  useEffect(() => {
    if (viewMode === 'target-source' && panelField) {
      const current = mappings.find((m) => m.targetField === panelField.name);
      setPanelSourceId(current?.id ?? null);
      setPanelComment(current?.customerComment ?? '');
    }
  }, [mappings, panelField]);

  /* ---------- Source → Target filtering ---------- */

  const statusFilterMap: Record<string, MappingStatus | undefined> = {
    all: undefined, needs_review: 'NEEDS_REVIEW', cfv: 'CFV_PROPOSAL',
    mapped: 'MAPPED', rejected: 'REJECTED', unmapped: 'UNMAPPED',
  };

  const stFiltered = mappings.filter((m) => {
    const statusVal = statusFilterMap[statusFilter];
    if (statusVal && m.mappingStatus !== statusVal) return false;
    if (targetFilter === 'Unassigned' && m.targetField) return false;
    if (targetFilter && targetFilter !== 'Unassigned' && m.targetEntity !== targetFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!m.sourceField.toLowerCase().includes(q)
          && !(m.targetField || '').toLowerCase().includes(q)
          && !(m.sampleValue || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const stSelectedRecords = stFiltered.filter((m) => selectedRowKeys.includes(m.id));
  const stBulkApprovable = stSelectedRecords.filter(
    (m) => m.targetField && (m.mappingStatus === 'NEEDS_REVIEW' || m.mappingStatus === 'CFV_PROPOSAL')
  );
  const stBulkSkippable = stSelectedRecords.filter(
    (m) => m.mappingStatus !== 'MAPPED' && m.mappingStatus !== 'REJECTED'
  );

  /* ---------- Source → Target grouped display ---------- */

  type StDisplayRow = FieldMappingEntryDto & {
    _sourceHeader?: string;
    _sourceGroup?: FieldMappingEntryDto[];
    _sourceTargetCount?: number;
  };

  const stGroupedRows: StDisplayRow[] = useMemo(() => {
    const groups: Map<string, FieldMappingEntryDto[]> = new Map();
    for (const m of stFiltered) {
      if (!groups.has(m.sourceField)) groups.set(m.sourceField, []);
      groups.get(m.sourceField)!.push(m);
    }

    const rows: StDisplayRow[] = [];
    for (const [sourceField, groupMappings] of groups) {
      const targetCount = groupMappings.filter((m) => m.targetField).length;
      rows.push({
        ...groupMappings[0],
        id: `__src_hdr__${sourceField}`,
        _sourceHeader: sourceField,
        _sourceGroup: groupMappings,
        _sourceTargetCount: targetCount,
      } as StDisplayRow);
      if (!stCollapsedSources.has(sourceField)) {
        for (const m of groupMappings) {
          rows.push(m as StDisplayRow);
        }
      }
    }
    return rows;
  }, [stFiltered, stCollapsedSources]);

  const toggleSourceGroup = (sourceField: string) => {
    setStCollapsedSources((prev) => {
      const next = new Set(prev);
      if (next.has(sourceField)) next.delete(sourceField); else next.add(sourceField);
      return next;
    });
  };

  const isSourceHeader = (row: StDisplayRow) => !!row._sourceHeader;

  /* ---------- Target → Source filtering ---------- */

  const tsFilteredGzFields = filteredSchemaFields.filter((f) => {
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
    if (entityFilter !== 'all') return tsFilteredGzFields;
    const rows: DisplayRow[] = [];
    let lastEntity = '';
    for (const f of tsFilteredGzFields) {
      if (f.entity !== lastEntity) {
        lastEntity = f.entity;
        const entityFields = tsFilteredGzFields.filter((g) => g.entity === f.entity);
        const mappedCount = entityFields.filter((g) => mappingByTarget[g.name]).length;
        const rFields = entityFields.filter((g) => g.required);
        const rMappedCount = rFields.filter((g) => mappingByTarget[g.name]).length;
        rows.push({
          name: `__hdr__${f.entity}`, entity: f.entity, label: '', required: false, description: '',
          _entityHeader: f.entity, _entityMapped: mappedCount, _entityTotal: entityFields.length,
          _entityRequired: rFields.length, _entityRequiredMapped: rMappedCount,
        });
      }
      if (!collapsedEntities.has(f.entity)) {
        rows.push(f);
      }
    }
    return rows;
  }, [tsFilteredGzFields, entityFilter, mappingByTarget, collapsedEntities]);

  const tsSelectedGzFields = filteredSchemaFields.filter((f) => selectedRowKeys.includes(f.name));
  const tsBulkApprovable = tsSelectedGzFields.filter((f) => {
    const m = mappingByTarget[f.name];
    return m && (m.mappingStatus === 'NEEDS_REVIEW' || m.mappingStatus === 'CFV_PROPOSAL');
  });
  const tsBulkSkippable = tsSelectedGzFields.filter((f) => {
    const m = mappingByTarget[f.name];
    return m && m.mappingStatus !== 'MAPPED' && m.mappingStatus !== 'REJECTED';
  });

  /* ---------- Source → Target handlers ---------- */

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
      const exists = customTargetFields.some((f) => f.entity === targetEntity && f.field === targetField);
      if (!exists) {
        const updated = [...customTargetFields, { entity: targetEntity!, field: targetField }];
        setCustomTargetFields(updated);
        saveCustomTargets(updated);
      }
    } else if (newField) {
      const predefined = filteredSchemaFields.find((t) => t.name === newField);
      if (predefined) {
        targetField = predefined.name;
        targetEntity = predefined.entity;
      } else {
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

  /* ---------- Target → Source handlers ---------- */

  const handleTsSourceChange = async (gzField: GzField, newEntryId: string | null) => {
    if (!projectId) return;
    setSavingId(gzField.name);
    try {
      if (newEntryId) {
        const entry = mappings.find((m) => m.id === newEntryId);
        const isAlreadyMapped = entry?.targetField && entry.targetField !== gzField.name;
        if (isAlreadyMapped) {
          await migrationApi.cloneMapping(projectId, newEntryId, {
            targetField: gzField.name,
            targetEntity: gzField.entity,
          });
        } else {
          await migrationApi.updateMapping(projectId, newEntryId, {
            targetField: gzField.name,
            targetEntity: gzField.entity,
          });
        }
      } else {
        const current = mappingByTarget[gzField.name];
        if (current) {
          await migrationApi.updateMapping(projectId, current.id, {
            targetField: undefined,
            targetEntity: undefined,
          });
        }
      }
      await loadAll(true);
    } catch {
      message.error('Failed to update mapping');
    } finally {
      setSavingId(null);
    }
  };

  /* ---------- Bulk handlers ---------- */

  const handleBulkApproveSelected = async () => {
    if (!projectId) return;
    if (viewMode === 'source-target') {
      if (!stBulkApprovable.length) return;
      try {
        const results = await Promise.all(
          stBulkApprovable.map((m) => migrationApi.approveMapping(projectId, m.id))
        );
        setMappings((prev) => prev.map((m) => {
          const updated = results.find((r) => r.data.id === m.id);
          return updated ? updated.data : m;
        }));
        migrationApi.getMappingStats(projectId).then(({ data: s }) => setStats(s));
        setSelectedRowKeys([]);
        message.success(`${stBulkApprovable.length} mapping${stBulkApprovable.length !== 1 ? 's' : ''} approved`);
      } catch {
        message.error('Some approvals failed');
      }
    } else {
      if (!tsBulkApprovable.length) return;
      try {
        await Promise.all(tsBulkApprovable.map((f) => migrationApi.approveMapping(projectId, mappingByTarget[f.name].id)));
        await loadAll(true);
        setSelectedRowKeys([]);
        message.success(`${tsBulkApprovable.length} mapping${tsBulkApprovable.length !== 1 ? 's' : ''} approved`);
      } catch {
        message.error('Some approvals failed');
      }
    }
  };

  const handleBulkSkipSelected = async () => {
    if (!projectId) return;
    if (viewMode === 'source-target') {
      if (!stBulkSkippable.length) return;
      try {
        const results = await Promise.all(
          stBulkSkippable.map((m) => migrationApi.updateMapping(projectId, m.id, { mappingStatus: 'REJECTED' }))
        );
        setMappings((prev) => prev.map((m) => {
          const updated = results.find((r) => r.data.id === m.id);
          return updated ? updated.data : m;
        }));
        migrationApi.getMappingStats(projectId).then(({ data: s }) => setStats(s));
        setSelectedRowKeys([]);
        message.success(`${stBulkSkippable.length} field${stBulkSkippable.length !== 1 ? 's' : ''} skipped`);
      } catch {
        message.error('Some skips failed');
      }
    } else {
      if (!tsBulkSkippable.length) return;
      try {
        await Promise.all(tsBulkSkippable.map((f) => migrationApi.updateMapping(projectId, mappingByTarget[f.name].id, { mappingStatus: 'REJECTED' })));
        await loadAll(true);
        setSelectedRowKeys([]);
        message.success(`${tsBulkSkippable.length} field${tsBulkSkippable.length !== 1 ? 's' : ''} skipped`);
      } catch {
        message.error('Some skips failed');
      }
    }
  };

  /* ---------- Panel handlers ---------- */

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

  /* ---------- Import/Export handlers ---------- */

  const handleExportMappings = async () => {
    if (!projectId) return;
    setExporting(true);
    try {
      const { data } = await migrationApi.exportMappings(projectId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(projectName || 'mappings').replace(/[^a-zA-Z0-9._-]/g, '_')}-mappings.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('Mappings exported');
    } catch {
      message.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleImportMappings = async (file: File) => {
    if (!projectId) return;
    setImporting(true);
    try {
      const { data } = await migrationApi.importMappings(projectId, file);
      setImportModalOpen(false);
      Modal.success({
        title: 'Import Complete',
        content: (
          <div>
            <p><strong>{data.updated}</strong> mapping(s) updated</p>
            <p><strong>{data.matched}</strong> source field(s) matched</p>
            {data.skippedNotFound > 0 && (
              <p><strong>{data.skippedNotFound}</strong> skipped (source field not found in project)</p>
            )}
            {data.skippedUnchanged > 0 && (
              <p><strong>{data.skippedUnchanged}</strong> unchanged (already matching)</p>
            )}
            {data.warnings.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary>Warnings ({data.warnings.length})</summary>
                <ul style={{ maxHeight: 200, overflow: 'auto', fontSize: 12 }}>
                  {data.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
          </div>
        ),
      });
      loadAll(true);
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  // Source → Target panel selection
  const selectRecord = (record: FieldMappingEntryDto) => {
    setPanelRecord(record);
    setPanelField(null);
    setPanelTab('detail');
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

  // Target → Source panel selection
  const selectGzField = (f: GzField) => {
    setPanelField(f);
    setPanelRecord(null);
    setPanelTab('detail');
    localStorage.setItem(COACH_LAST_GZ_FIELD_KEY, f.name);
    const current = mappingByTarget[f.name];
    setPanelSourceId(current?.id ?? null);
    setPanelComment(current?.customerComment ?? '');
    setPanelHistory([]);
    setPanelHistoryTotal(0);
    setPanelHistoryPage(0);
    setExpandedVersions(new Set());
    if (current && projectId) {
      loadFieldHistory(current.id, 0);
    }
  };

  // Source → Target panel save
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
        const predefined = filteredSchemaFields.find((t) => t.name === panelTarget);
        if (predefined) {
          targetField = predefined.name;
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
    if (!projectId) return;
    setPanelSaving(true);
    try {
      if (viewMode === 'source-target' && panelRecord) {
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
      } else if (viewMode === 'target-source' && panelField) {
        const current = mappingByTarget[panelField.name];
        if (!current) return;
        if (panelComment !== (current.customerComment ?? '')) {
          await migrationApi.updateMapping(projectId, current.id, {
            customerComment: panelComment.trim() || undefined,
          });
        }
        await migrationApi.approveMapping(projectId, current.id);
        await loadAll(true);
        message.success(`"${panelField.label}" approved`);
      }
    } catch {
      message.error('Failed to approve');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelSkip = async () => {
    if (!projectId) return;
    setPanelSaving(true);
    try {
      if (viewMode === 'source-target' && panelRecord) {
        const { data } = await migrationApi.updateMapping(projectId, panelRecord.id, { mappingStatus: 'REJECTED' });
        setMappings((prev) => prev.map((m) => m.id === data.id ? data : m));
        setPanelRecord(data);
        migrationApi.getMappingStats(projectId).then(({ data: s }) => setStats(s));
        message.success(`"${panelRecord.sourceField}" skipped`);
      } else if (viewMode === 'target-source' && panelField) {
        const current = mappingByTarget[panelField.name];
        if (!current) return;
        await migrationApi.updateMapping(projectId, current.id, { mappingStatus: 'REJECTED' });
        await loadAll(true);
        message.success(`"${panelField.label}" skipped`);
      }
    } catch {
      message.error('Failed to skip');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelRestore = async () => {
    if (!projectId) return;
    setPanelSaving(true);
    try {
      if (viewMode === 'source-target' && panelRecord) {
        const { data } = await migrationApi.updateMapping(projectId, panelRecord.id, { mappingStatus: 'UNMAPPED' });
        setMappings((prev) => prev.map((m) => m.id === data.id ? data : m));
        setPanelRecord(data);
        message.success(`"${panelRecord.sourceField}" restored`);
      } else if (viewMode === 'target-source' && panelField) {
        const current = mappingByTarget[panelField.name];
        if (!current) return;
        await migrationApi.updateMapping(projectId, current.id, { mappingStatus: 'UNMAPPED' });
        await loadAll(true);
        message.success(`"${panelField.label}" restored`);
      }
    } catch {
      message.error('Failed to restore');
    } finally {
      setPanelSaving(false);
    }
  };

  // Target → Source panel source change
  const handleTsPanelSourceChange = async (newEntryId: string | null) => {
    if (!panelField || !projectId) return;
    setPanelSaving(true);
    try {
      if (newEntryId) {
        const entry = mappings.find((m) => m.id === newEntryId);
        const isAlreadyMapped = entry?.targetField && entry.targetField !== panelField.name;
        if (isAlreadyMapped) {
          await migrationApi.cloneMapping(projectId, newEntryId, {
            targetField: panelField.name,
            targetEntity: panelField.entity,
          });
        } else {
          await migrationApi.updateMapping(projectId, newEntryId, {
            targetField: panelField.name,
            targetEntity: panelField.entity,
          });
        }
      } else {
        const current = mappingByTarget[panelField.name];
        if (current) {
          await migrationApi.updateMapping(projectId, current.id, {
            targetField: undefined,
            targetEntity: undefined,
          });
        }
      }
      await loadAll(true);
    } catch {
      message.error('Failed to update mapping');
    } finally {
      setPanelSaving(false);
    }
  };

  const handlePanelSaveComment = async () => {
    if (!projectId) return;
    setPanelSaving(true);
    try {
      if (viewMode === 'target-source' && panelField) {
        const current = mappingByTarget[panelField.name];
        if (!current) return;
        await migrationApi.updateMapping(projectId, current.id, {
          customerComment: panelComment.trim() || undefined,
        });
        await loadAll(true);
        message.success('Comment saved');
      }
    } catch {
      message.error('Failed to save comment');
    } finally {
      setPanelSaving(false);
    }
  };

  /* ---------- Source → Target 1:many handlers ---------- */

  // Add another target to a source field (via clone)
  const handleAddTarget = async (targetFieldName: string) => {
    if (!projectId || !panelRecord) return;
    setPanelSaving(true);
    try {
      const schema = filteredSchemaFields.find((f) => f.name === targetFieldName);
      await migrationApi.cloneMapping(projectId, panelRecord.id, {
        targetField: targetFieldName,
        targetEntity: schema?.entity ?? 'Contact',
      });
      await loadAll(true);
      setAddTargetField(null);
      message.success(`Added target: ${targetFieldName}`);
    } catch {
      message.error('Failed to add target');
    } finally {
      setPanelSaving(false);
    }
  };

  // Remove a specific target mapping (clear its target)
  const handleRemoveTarget = async (mappingId: string) => {
    if (!projectId) return;
    setPanelSaving(true);
    try {
      await migrationApi.updateMapping(projectId, mappingId, {
        targetField: undefined,
        targetEntity: undefined,
      });
      await loadAll(true);
      message.success('Target removed');
    } catch {
      message.error('Failed to remove target');
    } finally {
      setPanelSaving(false);
    }
  };

  // Approve a specific target mapping
  const handleApproveTarget = async (mappingId: string) => {
    if (!projectId) return;
    setPanelSaving(true);
    try {
      await migrationApi.approveMapping(projectId, mappingId);
      await loadAll(true);
      message.success('Mapping approved');
    } catch {
      message.error('Failed to approve');
    } finally {
      setPanelSaving(false);
    }
  };

  /* ---------- View toggle handler ---------- */

  const handleViewModeChange = (newMode: ViewMode) => {
    setViewMode(newMode);
    localStorage.setItem(COACH_VIEW_MODE_KEY, newMode);
    setSelectedRowKeys([]);
    setStatusFilter('all');
    setEntityFilter('all');
    // Clear panel state
    setPanelRecord(null);
    setPanelField(null);
  };

  /** Navigate to a specific GZ field — context-aware:
   *  - In Target→Source: expand entity, select it in table + detail tab
   *  - In Source→Target: switch to Coverage tab, expand entity, highlight the field */
  const navigateToField = (field: GzField) => {
    if (viewMode === 'target-source') {
      setEntityFilter('all');
      setStatusFilter('all');
      setCollapsedEntities((prev) => {
        if (prev.has(field.entity)) {
          const next = new Set(prev);
          next.delete(field.entity);
          localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
          return next;
        }
        return prev;
      });
      selectGzField(field);
    } else {
      // Stay in Source→Target — open Coverage tab and highlight
      setPanelTab('coverage');
      setHighlightedCoverageField(field.name);
      // Ensure the entity is expanded in the sidebar
      setSchemaSidebarCollapsed((prev) => {
        if (prev.has(field.entity)) {
          const next = new Set(prev);
          next.delete(field.entity);
          return next;
        }
        return prev;
      });
    }
  };

  /* ---------- Source → Target columns (grouped by source) ---------- */

  const [stColWidths, setStColWidths] = useState<Record<string, number>>({
    sourceField: 200, targetField: 220, confidence: 100, status: 130, customerComment: 160,
  });

  const handleStColumnResize = useCallback(
    (key: string) => (_e: any, { size }: { size: { width: number } }) => {
      setStColWidths((prev) => ({ ...prev, [key]: size.width }));
    },
    [],
  );

  const stBaseColumns: ColumnsType<StDisplayRow> = [
    {
      title: 'Source Field',
      key: 'sourceField',
      width: stColWidths.sourceField,
      onCell: (row: StDisplayRow) => isSourceHeader(row)
        ? { colSpan: 5, style: { background: '#fafafa', padding: '8px 12px', borderBottom: '1px solid #e8e8e8', cursor: 'pointer' } }
        : {},
      render: (_, row: StDisplayRow) => {
        if (isSourceHeader(row)) {
          const collapsed = stCollapsedSources.has(row._sourceHeader!);
          const tc = row._sourceTargetCount ?? 0;
          return (
            <Space size={8} align="center">
              {collapsed ? <RightOutlined style={{ color: '#999', fontSize: 11 }} /> : <DownOutlined style={{ color: '#999', fontSize: 11 }} />}
              <Text strong style={{ fontSize: 13 }}>{row._sourceHeader}</Text>
              {row.sampleValue && (
                <Text style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{row.sampleValue}</Text>
              )}
              <Tag style={{
                background: tc === 0 ? '#fff1f0' : tc > 1 ? '#e6f7ff' : '#f6ffed',
                color: tc === 0 ? '#d32029' : tc > 1 ? '#0050b3' : '#237804',
                border: 'none', fontSize: 11,
              }}>
                {tc} target{tc !== 1 ? 's' : ''}
              </Tag>
            </Space>
          );
        }
        // Sub-row: show indented target, colored by mapping status
        const stCfg = STATUS_CONFIG[row.mappingStatus] || STATUS_CONFIG.UNMAPPED;
        return (
          <Space size={4}>
            <span style={{ color: '#bbb', marginLeft: 20 }}>→</span>
            {row.targetField ? (
              <Tag style={{ ...stCfg.style, margin: 0, cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); startEdit(row); }}>
                {row.targetEntity ? `${row.targetEntity}.` : ''}{row.targetField}
              </Tag>
            ) : (
              <Button size="small" type="dashed" onClick={(e) => { e.stopPropagation(); startEdit(row); }}>
                Assign target
              </Button>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Target Field',
      key: 'targetField',
      width: stColWidths.targetField,
      onCell: (row: StDisplayRow) => isSourceHeader(row) ? { colSpan: 0 } : {},
      render: (_, row: StDisplayRow) => {
        if (isSourceHeader(row)) return null;
        const isEditing = editingId === row.id;
        if (isEditing) {
          if (editingValue === '__custom__') {
            return (
              <Space size={4} wrap>
                <Select size="small" style={{ width: 100 }} value={customEntity} onChange={setCustomEntity}
                  options={entityOptions.filter((e) => e.value !== 'all')} />
                <Input size="small" placeholder="field" value={customFieldName}
                  onChange={(e) => setCustomFieldName(e.target.value)} style={{ width: 90 }} autoFocus
                  onPressEnter={() => saveTarget(row, '__custom__')} />
                <Button size="small" type="primary" icon={<PlusOutlined />}
                  loading={savingId === row.id} disabled={!customFieldName.trim()}
                  onClick={() => saveTarget(row, '__custom__')}>OK</Button>
                <Button size="small" onClick={cancelEdit}>✕</Button>
              </Space>
            );
          }
          return (
            <Space.Compact>
              <Select size="small" style={{ width: 160 }} placeholder="Select target..."
                value={editingValue} onChange={setEditingValue} showSearch optionFilterProp="label"
                allowClear autoFocus
                options={targetOptions.map((group) => ({
                  ...group, options: group.options.map((opt) => ({
                    ...opt, disabled: usedTargets.has(opt.value) && opt.value !== row.targetField,
                  })),
                }))} />
              <Button size="small" type="primary" loading={savingId === row.id}
                disabled={editingValue === (row.targetField ?? null)}
                onClick={() => saveTarget(row, editingValue)}>Save</Button>
              <Button size="small" onClick={cancelEdit}>✕</Button>
            </Space.Compact>
          );
        }
        return null; // target shown in first column for sub-rows
      },
    },
    {
      title: 'Confidence',
      dataIndex: 'confidencePct',
      key: 'confidence',
      width: stColWidths.confidence,
      align: 'center',
      onCell: (row: StDisplayRow) => isSourceHeader(row) ? { colSpan: 0 } : {},
      render: (pct: number, row: StDisplayRow) => {
        if (isSourceHeader(row)) return null;
        return pct != null ? (
          <Progress percent={pct} size="small"
            strokeColor={pct >= 80 ? '#52c41a' : pct >= 50 ? '#fa8c16' : '#ff4d4f'}
            style={{ width: 75 }} />
        ) : <Text style={{ color: 'rgba(0,0,0,0.65)' }}>—</Text>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'mappingStatus',
      key: 'status',
      width: stColWidths.status,
      onCell: (row: StDisplayRow) => isSourceHeader(row) ? { colSpan: 0 } : {},
      render: (status: string, row: StDisplayRow) => {
        if (isSourceHeader(row)) return null;
        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.UNMAPPED;
        return <Tag icon={cfg.icon} style={cfg.style}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Customer Note',
      dataIndex: 'customerComment',
      key: 'customerComment',
      width: stColWidths.customerComment,
      ellipsis: true,
      onCell: (row: StDisplayRow) => isSourceHeader(row) ? { colSpan: 0 } : {},
      render: (v: string, row: StDisplayRow) => {
        if (isSourceHeader(row)) return null;
        return v ? <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }} title={v}>{v}</Text> : null;
      },
    },
  ];

  const stColumns = stBaseColumns.map((col: any) => ({
    ...col,
    onHeaderCell: (column: any) => ({
      width: column.width,
      onResize: handleStColumnResize(column.key as string),
    }),
  }));

  /* ---------- Target → Source columns ---------- */

  const [tsColWidths, setTsColWidths] = useState<Record<string, number>>({
    field: 200, source: 230, sample: 160, confidence: 100, status: 130,
  });

  const handleTsColumnResize = useCallback(
    (key: string) => (_e: any, { size }: { size: { width: number } }) => {
      setTsColWidths((prev) => ({ ...prev, [key]: size.width }));
    },
    [],
  );

  const isHeaderRow = (f: DisplayRow) => !!f._entityHeader;

  const tsBaseColumns: ColumnsType<DisplayRow> = [
    {
      title: 'GrowthZone Field',
      key: 'field',
      width: tsColWidths.field,
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
            </Space>
            <Text style={{ color: 'rgba(0,0,0,0.65)', fontSize: 12 }}>{f.description}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Your Data Column',
      key: 'source',
      width: tsColWidths.source,
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
            onChange={(val) => handleTsSourceChange(f, val ?? null)}
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
      width: tsColWidths.sample,
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
      width: tsColWidths.confidence,
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
      width: tsColWidths.status,
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

  const tsColumns = tsBaseColumns.map((col: any) => ({
    ...col,
    onHeaderCell: (column: any) => ({
      width: column.width,
      onResize: handleTsColumnResize(column.key as string),
    }),
  }));

  /* ---------- Tabs ---------- */

  const tabs = viewMode === 'source-target'
    ? [
        { key: 'all', label: `All (${stats.all})` },
        { key: 'needs_review', label: `Needs Review (${stats.needsReview})` },
        { key: 'mapped', label: `Approved (${stats.mapped})` },
        { key: 'unmapped', label: `Unmapped (${stats.unmapped})` },
        ...((stats.rejected ?? 0) > 0 ? [{ key: 'rejected', label: `Skipped (${stats.rejected})` }] : []),
      ]
    : [
        { key: 'all', label: `All (${filteredSchemaFields.length})` },
        { key: 'needs_review', label: `Needs Review (${needsReviewCount})` },
        { key: 'approved', label: `Approved (${approvedCount})` },
        { key: 'unmapped', label: `Unmapped (${filteredSchemaFields.filter((f) => !mappingByTarget[f.name]).length})` },
      ];

  /* ---------- Active bulk counts ---------- */

  const activeBulkApprovable = viewMode === 'source-target' ? stBulkApprovable : tsBulkApprovable;
  const activeBulkSkippable = viewMode === 'source-target' ? stBulkSkippable : tsBulkSkippable;

  /* ---------- Panel derived data ---------- */

  const panelMapping = viewMode === 'target-source' && panelField ? mappingByTarget[panelField.name] : null;
  const panelStatus = viewMode === 'source-target' ? panelRecord?.mappingStatus : panelMapping?.mappingStatus;
  const activePanelMappingId = viewMode === 'source-target' ? panelRecord?.id : panelMapping?.id;

  // All mappings for the same source field as the selected record (1:many view)
  const panelSourceMappings = panelRecord
    ? mappings.filter((m) => m.sourceField === panelRecord.sourceField)
    : [];
  const panelTargetMappings = panelSourceMappings.filter((m) => m.targetField);
  const panelUsedTargetSet = new Set(panelTargetMappings.map((m) => m.targetField!));

  // Unused AI candidates aggregated from all mappings of this source
  const panelUnusedCandidates = useMemo(() => {
    if (!panelRecord) return [];
    const srcMappings = mappings.filter((m) => m.sourceField === panelRecord.sourceField);
    const usedTgts = new Set(srcMappings.filter((m) => m.targetField).map((m) => m.targetField!));
    const candidates: Array<{ id: string; targetField: string; matchPct: number; description?: string }> = [];
    const seen = new Set<string>();
    for (const m of srcMappings) {
      for (const c of m.candidates ?? []) {
        if (!seen.has(c.targetField) && !usedTgts.has(c.targetField)) {
          candidates.push(c);
          seen.add(c.targetField);
        }
      }
    }
    return candidates.sort((a, b) => b.matchPct - a.matchPct);
  }, [panelRecord?.sourceField, mappings]);

  /* ---------- Change history rendering ---------- */

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

  const renderChangeHistory = () => {
    if (panelHistoryLoading) {
      return <div style={{ textAlign: 'center', padding: '8px 0' }}><Spin size="small" /></div>;
    }
    if (panelHistory.length === 0) {
      return <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>No changes recorded yet.</Text>;
    }

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
                onClick={() => { if (activePanelMappingId) loadFieldHistory(activePanelMappingId, panelHistoryPage - 1); }}>
                Prev
              </Button>
              <Text style={{ fontSize: 11 }}>{panelHistoryPage + 1}/{totalPages}</Text>
              <Button size="small" disabled={panelHistoryPage >= totalPages - 1}
                onClick={() => { if (activePanelMappingId) loadFieldHistory(activePanelMappingId, panelHistoryPage + 1); }}>
                Next
              </Button>
            </Space>
          </div>
        )}
      </>
    );
  };

  /* ---------- Schema coverage tree (empty-panel state) ---------- */

  const renderSchemaCoverageTree = () => {
    if (filteredSchemaFields.length === 0) {
      return (
        <Card
          size="small"
          style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', borderColor: '#e0d4f5', borderTop: '3px solid #6b4fa0' }}
          styles={{ body: { textAlign: 'center' } }}
        >
          <Spin size="small" />
        </Card>
      );
    }

    const entities = [...new Set(filteredSchemaFields.map((f) => f.entity))].sort();

    return (
      <Card
        size="small"
        style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}
        styles={{
          header: { background: '#f3eeff', borderBottom: '1px solid #e0d4f5', padding: '12px 16px' },
          body: { padding: 0, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' },
        }}
        title={
          <Space size={8}>
            <ApartmentOutlined style={{ color: '#6b4fa0' }} />
            <Text strong style={{ color: '#2d1854', fontSize: 13 }}>Schema Coverage</Text>
            <Tag style={{ fontSize: 10, backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5', margin: 0 }}>
              {Object.keys(mappingByTarget).length} / {filteredSchemaFields.length} mapped
            </Tag>
          </Space>
        }
      >
        {entities.map((entity) => {
          const entityFields = filteredSchemaFields.filter((f) => f.entity === entity);
          const mapped = entityFields.filter((f) => mappingByTarget[f.name]).length;
          const unmappedReq = entityFields.filter((f) => f.required && !mappingByTarget[f.name]).length;
          const isCollapsed = schemaSidebarCollapsed.has(entity);

          return (
            <div key={entity}>
              <div
                onClick={() => toggleSidebarEntity(entity)}
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  background: 'linear-gradient(135deg, #f9f6ff, #f3eeff)',
                  borderBottom: '1px solid #e0d4f5',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {isCollapsed
                  ? <RightOutlined style={{ fontSize: 10, color: '#6b4fa0' }} />
                  : <DownOutlined style={{ fontSize: 10, color: '#6b4fa0' }} />
                }
                <Text strong style={{ fontSize: 12, color: '#2d1854', flex: 1 }}>{entity}</Text>
                <Tag style={{
                  fontSize: 10, margin: 0,
                  backgroundColor: mapped === entityFields.length ? '#f6ffed' : '#f3eeff',
                  color: mapped === entityFields.length ? '#237804' : '#2d1854',
                  borderColor: mapped === entityFields.length ? '#b7eb8f' : '#e0d4f5',
                }}>
                  {mapped}/{entityFields.length}
                </Tag>
                {unmappedReq > 0 && (
                  <Tag style={{ fontSize: 10, margin: 0, backgroundColor: '#fff1f0', color: '#d32029', borderColor: '#ffa39e' }}>
                    {unmappedReq} req
                  </Tag>
                )}
              </div>
              {!isCollapsed && entityFields.map((f) => {
                const m = mappingByTarget[f.name];
                const isMapped = !!m;
                const isRequired = f.required;
                const isHighlighted = highlightedCoverageField === f.name;
                return (
                  <div
                    key={f.name}
                    ref={isHighlighted ? (el) => { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } : undefined}
                    className={`coverage-field-row${isHighlighted ? ' coverage-field-highlighted' : ''}`}
                    onClick={() => navigateToField(f)}
                    style={{
                      padding: '4px 16px 4px 36px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f5f0fa',
                      borderLeft: '3px solid transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      transition: 'background-color 0.3s, border-left-color 0.3s',
                    }}
                  >
                    {isMapped ? (
                      <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 11 }} />
                    ) : isRequired ? (
                      <WarningOutlined style={{ color: '#d32029', fontSize: 11 }} />
                    ) : (
                      <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid #d9d9d9', display: 'inline-block', flexShrink: 0 }} />
                    )}
                    <Text style={{
                      flex: 1, fontSize: 12,
                      color: isMapped ? 'rgba(0,0,0,0.85)' : isRequired ? '#d32029' : 'rgba(0,0,0,0.45)',
                      fontWeight: isRequired && !isMapped ? 500 : 400,
                    }}>
                      {f.label}
                    </Text>
                    {isRequired && !isMapped && (
                      <Tag style={{ fontSize: 9, lineHeight: '14px', margin: 0, backgroundColor: '#fff1f0', color: '#d32029', borderColor: '#ffa39e' }}>req</Tag>
                    )}
                    {isMapped && (
                      <Text style={{ fontSize: 11, color: '#6b4fa0' }}>{m.sourceField}</Text>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
    );
  };

  /* ---------- Render ---------- */

  return (
    <div>
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
              {/* View mode toggle */}
              <Radio.Group
                value={viewMode}
                onChange={(e) => handleViewModeChange(e.target.value)}
                size="small"
                buttonStyle="solid"
              >
                <Radio.Button value="source-target">
                  <SwapOutlined /> Source → Target
                </Radio.Button>
                <Radio.Button value="target-source">
                  <SwapOutlined style={{ transform: 'scaleX(-1)' }} /> Target → Source
                </Radio.Button>
              </Radio.Group>
              {lastRefreshed && (
                <Text style={{ fontSize: 12, color: '#6b4fa0' }}>
                  Updated {lastRefreshed.toLocaleTimeString()}
                </Text>
              )}
              <Button
                icon={<ExportOutlined />}
                size="small"
                loading={exporting}
                onClick={handleExportMappings}
                style={{ borderColor: '#6b4fa0', color: '#6b4fa0' }}
              >
                Export
              </Button>
              <Button
                icon={<ImportOutlined />}
                size="small"
                onClick={() => setImportModalOpen(true)}
                style={{ borderColor: '#6b4fa0', color: '#6b4fa0' }}
              >
                Import
              </Button>
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

      {/* Schema coverage summary bar (both views) */}
      {/* Entity Scope Panel (from LLM detection) */}
      {entityScope.length > 0 && (
        <EntityCoveragePanel
          coverage={entityScope}
          onToggle={handleEntityScopeToggle}
        />
      )}

      {filteredSchemaFields.length > 0 && (
        <Card size="small" style={{ marginBottom: unmappedRequired.length > 0 ? 8 : 16, borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}>
          <Row align="middle" gutter={[8, 6]} wrap>
            <Col>
              <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600 }}>SCHEMA COVERAGE</Text>
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
              <Text strong>{unmappedRequired.length} required field{unmappedRequired.length !== 1 ? 's' : ''} still need a source column: </Text>
              {unmappedRequired.map((f, i) => (
                <span key={f.name}>
                  {i > 0 && ', '}
                  <a
                    onClick={() => navigateToField(f)}
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

      {/* Status tabs + entity/search filter */}
      <Row align="middle" style={{ marginBottom: 8, borderBottom: '2px solid #e0d4f5', paddingBottom: 0 }}>
        <Col flex="auto">
          <Tabs
            activeKey={statusFilter}
            onChange={(k) => { setStatusFilter(k); setSelectedRowKeys([]); }}
            size="small"
            style={{ marginBottom: 0 }}
            items={tabs}
          />
        </Col>
        <Col>
          <Space>
            {viewMode === 'source-target' && (
              <Input
                placeholder="Search..."
                prefix={<SearchOutlined />}
                size="small"
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 160 }}
              />
            )}
            {viewMode === 'target-source' && (
              <Select
                value={entityFilter}
                onChange={(v) => { setEntityFilter(v); setSelectedRowKeys([]); }}
                size="small"
                style={{ width: 130 }}
                aria-label="Filter by entity"
                options={entityOptions}
              />
            )}
          </Space>
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
                    disabled={!activeBulkApprovable.length}
                    onClick={handleBulkApproveSelected}
                    style={{ background: '#2d1854', borderColor: '#2d1854' }}
                  >
                    Approve{activeBulkApprovable.length > 0 ? ` (${activeBulkApprovable.length})` : ''}
                  </Button>
                  <Button
                    size="small"
                    disabled={!activeBulkSkippable.length}
                    onClick={handleBulkSkipSelected}
                  >
                    Skip{activeBulkSkippable.length > 0 ? ` (${activeBulkSkippable.length})` : ''}
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
          {viewMode === 'source-target' ? (
            <Table<StDisplayRow>
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
                getCheckboxProps: (row: StDisplayRow) => ({
                  disabled: isSourceHeader(row),
                  style: isSourceHeader(row) ? { display: 'none' } : {},
                }),
                columnTitle: (
                  <Checkbox
                    indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < stFiltered.length}
                    checked={stFiltered.length > 0 && selectedRowKeys.length === stFiltered.length}
                    onChange={(e) => {
                      setSelectedRowKeys(e.target.checked ? stFiltered.map((m) => m.id) : []);
                    }}
                  >
                    <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                      Select all fields
                    </span>
                  </Checkbox>
                ),
                renderCell: (checked, row: StDisplayRow) => {
                  if (isSourceHeader(row)) return null;
                  return (
                    <Checkbox
                      checked={checked}
                      onChange={(e) => {
                        const newKeys = e.target.checked
                          ? [...(selectedRowKeys as string[]), row.id]
                          : (selectedRowKeys as string[]).filter((k) => k !== row.id);
                        setSelectedRowKeys(newKeys);
                      }}
                    >
                      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                        Select {row.sourceField}
                      </span>
                    </Checkbox>
                  );
                },
              } as TableRowSelection<StDisplayRow>}
              components={{ header: { cell: ResizableTitle } }}
              columns={stColumns}
              dataSource={stGroupedRows}
              rowKey="id"
              size="small"
              loading={loading}
              scroll={{ x: panelRecord ? 800 : 1000 }}
              pagination={false}
              locale={{ emptyText: 'No mappings found.' }}
              rowClassName={(row) => {
                if (isSourceHeader(row)) return 'coach-mapping-entity-header';
                return row.sourceField === panelRecord?.sourceField ? 'mapping-row-active' : '';
              }}
              onRow={(row) => ({
                onClick: () => {
                  if (isSourceHeader(row)) {
                    toggleSourceGroup(row._sourceHeader!);
                    // Also select this source in the panel
                    if (row._sourceGroup?.length) {
                      cancelEdit();
                      selectRecord(row._sourceGroup[0]);
                    }
                  } else {
                    cancelEdit();
                    selectRecord(row);
                  }
                },
                style: { cursor: 'pointer' },
              })}
            />
          ) : (
            <>
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
                      indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < tsFilteredGzFields.length}
                      checked={tsFilteredGzFields.length > 0 && selectedRowKeys.length === tsFilteredGzFields.length}
                      onChange={(e) => {
                        setSelectedRowKeys(e.target.checked ? tsFilteredGzFields.map((f) => f.name) : []);
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
                columns={tsColumns}
                dataSource={displayRows}
                rowKey="name"
                size="small"
                loading={loading}
                pagination={false}
                scroll={{ x: panelField ? 700 : 900 }}
                rowClassName={(f) => {
                  if (isHeaderRow(f)) return 'coach-mapping-entity-header';
                  return f.name === panelField?.name ? 'mapping-row-active' : '';
                }}
                onRow={(f) => ({
                  onClick: () => {
                    if (isHeaderRow(f)) toggleEntity(f._entityHeader!);
                    else selectGzField(f);
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
            </>
          )}
        </div>

        {/* Right: tabbed panel (Coverage / Detail) */}
        <div style={{ width: 380, flexShrink: 0, position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
          <Tabs
            activeKey={panelTab}
            onChange={(k) => setPanelTab(k as 'detail' | 'coverage')}
            size="small"
            style={{ marginBottom: 0 }}
            items={[
              {
                key: 'detail',
                label: (
                  <Space size={4}>
                    <ApartmentOutlined />
                    <span>Detail</span>
                  </Space>
                ),
              },
              {
                key: 'coverage',
                label: (
                  <Space size={4}>
                    <CheckCircleOutlined />
                    <span>Coverage</span>
                    {unmappedRequired.length > 0 && (
                      <Badge count={unmappedRequired.length} size="small"
                        style={{ backgroundColor: '#d32029', marginLeft: 2 }} />
                    )}
                  </Space>
                ),
              },
            ]}
          />

          {/* Coverage tab */}
          {panelTab === 'coverage' && renderSchemaCoverageTree()}

          {/* Detail tab */}
          {panelTab === 'detail' && (
            <>
              {/* Source → Target detail (1:many) */}
              {viewMode === 'source-target' && (
                <>
                  {!panelRecord ? (
                    <Card size="small" style={{ borderColor: '#e0d4f5', borderTop: '3px solid #6b4fa0', textAlign: 'center', padding: 32 }}>
                      <ApartmentOutlined style={{ fontSize: 28, color: '#d9d6fe', marginBottom: 8 }} />
                      <Text style={{ display: 'block', color: 'rgba(0,0,0,0.45)' }}>
                        Click a source field row to see its target mappings
                      </Text>
                    </Card>
                  ) : (
                    <Card
                      size="small"
                      style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}
                      styles={{
                        header: { background: '#f3eeff', borderBottom: '1px solid #e0d4f5', padding: '14px 16px' },
                        body: { padding: '16px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' },
                      }}
                      title={
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Tag style={{
                              fontSize: 11, margin: 0,
                              backgroundColor: panelTargetMappings.length > 0 ? '#e6f7ff' : '#fff1f0',
                              color: panelTargetMappings.length > 0 ? '#0050b3' : '#d32029',
                              borderColor: panelTargetMappings.length > 0 ? '#91d5ff' : '#ffa39e',
                            }}>
                              {panelTargetMappings.length} target{panelTargetMappings.length !== 1 ? 's' : ''}
                            </Tag>
                            <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600 }}>SOURCE FIELD</Text>
                          </div>
                          <Text strong style={{ fontSize: 14, display: 'block', marginTop: 4, color: '#2d1854' }}>
                            {panelRecord.sourceEntity ? `${panelRecord.sourceEntity}.` : ''}{panelRecord.sourceField}
                          </Text>
                        </div>
                      }
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        {panelRecord.sampleValue && (
                          <div style={{ padding: '6px 10px', background: '#f9f6ff', borderRadius: 4, border: '1px solid #e0d4f5' }}>
                            <Text style={{ fontSize: 12, color: '#6b4fa0' }}>Sample: </Text>
                            <Text style={{ fontSize: 12 }}>{panelRecord.sampleValue}</Text>
                          </div>
                        )}

                        {/* Current target assignments (1:many) */}
                        <div>
                          <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                            CURRENT TARGETS ({panelTargetMappings.length})
                          </Text>
                          {panelTargetMappings.length === 0 ? (
                            <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>No targets assigned yet</Text>
                          ) : (
                            <Space direction="vertical" style={{ width: '100%' }} size={4}>
                              {panelTargetMappings.map((m) => {
                                const cfg = STATUS_CONFIG[m.mappingStatus] || STATUS_CONFIG.UNMAPPED;
                                return (
                                  <div key={m.id} style={{
                                    border: '1px solid #e0d4f5', borderRadius: 6, padding: '8px 10px',
                                    backgroundColor: '#fff', display: 'flex', alignItems: 'center', gap: 6,
                                  }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Text strong style={{ fontSize: 13 }}>
                                          {m.targetEntity ? `${m.targetEntity}.` : ''}{m.targetField}
                                        </Text>
                                        {m.confidencePct != null && (
                                          <Progress
                                            percent={m.confidencePct} size="small"
                                            strokeColor={m.confidencePct >= 80 ? '#52c41a' : m.confidencePct >= 50 ? '#fa8c16' : '#ff4d4f'}
                                            style={{ width: 60 }} format={(p) => `${p}%`}
                                          />
                                        )}
                                      </div>
                                      <Tag icon={cfg.icon} style={{ ...cfg.style, fontSize: 10, lineHeight: '16px', marginTop: 2 }}>{cfg.label}</Tag>
                                    </div>
                                    <Space size={4}>
                                      {m.mappingStatus !== 'MAPPED' && (
                                        <Tooltip title="Approve">
                                          <Button size="small" type="text" icon={<CheckCircleOutlined style={{ color: '#237804' }} />}
                                            loading={panelSaving} onClick={() => handleApproveTarget(m.id)} />
                                        </Tooltip>
                                      )}
                                      <Tooltip title="Remove target">
                                        <Button size="small" type="text" danger icon={<StopOutlined />}
                                          loading={panelSaving} onClick={() => handleRemoveTarget(m.id)} />
                                      </Tooltip>
                                    </Space>
                                  </div>
                                );
                              })}
                            </Space>
                          )}
                        </div>

                        {/* AI Suggestions (addable) */}
                        {panelUnusedCandidates.length > 0 && (
                          <div>
                            <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                              AI SUGGESTIONS
                            </Text>
                            <Space direction="vertical" style={{ width: '100%' }} size={4}>
                              {panelUnusedCandidates.map((c) => (
                                <div key={c.id} style={{
                                  border: '1px dashed #e0d4f5', borderRadius: 6, padding: '6px 10px',
                                  backgroundColor: '#fafafa', display: 'flex', alignItems: 'center', gap: 6,
                                }}>
                                  <div style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 13 }}>{c.targetField}</Text>
                                    <Progress
                                      percent={c.matchPct} size="small"
                                      strokeColor={c.matchPct >= 80 ? '#52c41a' : c.matchPct >= 50 ? '#fa8c16' : '#ff4d4f'}
                                      style={{ width: 70, marginLeft: 8, display: 'inline-block' }}
                                      format={(p) => `${p}%`}
                                    />
                                    {c.description && (
                                      <Text style={{ fontSize: 11, color: 'rgba(0,0,0,0.65)', display: 'block' }}>{c.description}</Text>
                                    )}
                                  </div>
                                  <Tooltip title="Add this target">
                                    <Button size="small" icon={<PlusOutlined />} loading={panelSaving}
                                      onClick={() => handleAddTarget(c.targetField)}
                                      style={{ borderColor: '#6b4fa0', color: '#6b4fa0' }}>
                                      Add
                                    </Button>
                                  </Tooltip>
                                </div>
                              ))}
                            </Space>
                          </div>
                        )}

                        {/* Add another target manually */}
                        <div>
                          <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            ADD TARGET
                          </Text>
                          <Space.Compact style={{ width: '100%' }}>
                            <Select
                              size="small"
                              style={{ flex: 1 }}
                              placeholder="Select target field..."
                              value={addTargetField}
                              onChange={setAddTargetField}
                              showSearch
                              optionFilterProp="label"
                              allowClear
                              options={targetOptions.map((group) => ({
                                ...group,
                                options: group.options.filter((opt) => opt.value !== '__custom__').map((opt) => ({
                                  ...opt,
                                  disabled: panelUsedTargetSet.has(opt.value),
                                })),
                              }))}
                            />
                            <Button
                              size="small"
                              type="primary"
                              icon={<PlusOutlined />}
                              loading={panelSaving}
                              disabled={!addTargetField}
                              onClick={() => { if (addTargetField) handleAddTarget(addTargetField); }}
                              style={{ background: '#2d1854', borderColor: '#2d1854' }}
                            >
                              Add
                            </Button>
                          </Space.Compact>
                        </div>

                        <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />

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
                          <Button size="small" loading={panelSaving} onClick={savePanel} style={{ marginTop: 4 }}>
                            Save comment
                          </Button>
                        </div>

                        <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />

                        <div>
                          <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>CHANGE HISTORY</Text>
                          {renderChangeHistory()}
                        </div>
                      </Space>
                    </Card>
                  )}
                </>
              )}

              {/* Target → Source detail */}
              {viewMode === 'target-source' && (
                <>
                  {!panelField ? (
                    <Card size="small" style={{ borderColor: '#e0d4f5', borderTop: '3px solid #6b4fa0', textAlign: 'center', padding: 32 }}>
                      <ApartmentOutlined style={{ fontSize: 28, color: '#d9d6fe', marginBottom: 8 }} />
                      <Text style={{ display: 'block', color: 'rgba(0,0,0,0.45)' }}>
                        Click a GZ field row to see its mapping details
                      </Text>
                    </Card>
                  ) : (
                    <Card
                      size="small"
                      style={{ borderColor: '#e0d4f5', borderTop: '3px solid #2d1854' }}
                      styles={{
                        header: { background: '#f3eeff', borderBottom: '1px solid #e0d4f5', padding: '14px 16px' },
                        body: { padding: '16px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' },
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
                          </div>
                          <Text strong style={{ fontSize: 14, display: 'block', marginTop: 4, color: '#2d1854' }}>
                            {panelField.label}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#6b4fa0' }}>{panelField.description}</Text>
                        </div>
                      }
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        {panelMapping?.sampleValue && (
                          <div style={{ padding: '6px 10px', background: '#f9f6ff', borderRadius: 4, border: '1px solid #e0d4f5' }}>
                            <Text style={{ fontSize: 12, color: '#6b4fa0' }}>Sample: </Text>
                            <Text style={{ fontSize: 12 }}>{panelMapping.sampleValue}</Text>
                          </div>
                        )}

                        <div>
                          <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            YOUR DATA COLUMN
                          </Text>
                          <Select
                            size="small"
                            style={{ width: '100%' }}
                            placeholder="Select source column..."
                            value={panelSourceId ?? undefined}
                            onChange={(val) => handleTsPanelSourceChange(val ?? null)}
                            showSearch
                            optionFilterProp="label"
                            allowClear
                            loading={panelSaving}
                            options={sourceOptions}
                          />
                        </div>

                        <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />

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

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {panelMapping?.mappingStatus === 'REJECTED' ? (
                            <Button loading={panelSaving} onClick={handlePanelRestore} style={{ flex: 1 }}>Restore</Button>
                          ) : (
                            <>
                              {panelMapping && panelMapping.mappingStatus !== 'MAPPED' && (
                                <Button type="primary" loading={panelSaving} onClick={handlePanelApprove}
                                  style={{ flex: 1, background: '#2d1854', borderColor: '#2d1854' }}>
                                  Approve mapping
                                </Button>
                              )}
                              {panelMapping && panelMapping.mappingStatus !== 'MAPPED' && (
                                <Button danger loading={panelSaving} onClick={handlePanelSkip} style={{ color: '#a8071a', borderColor: '#cf1322' }}>
                                  Reject
                                </Button>
                              )}
                            </>
                          )}
                          {panelMapping && (
                            <Button loading={panelSaving} onClick={handlePanelSaveComment}>Save</Button>
                          )}
                        </div>

                        <Divider style={{ margin: 0, borderColor: '#e0d4f5' }} />

                        <div>
                          <Text style={{ fontSize: 12, color: '#2d1854', fontWeight: 600, display: 'block', marginBottom: 4 }}>CHANGE HISTORY</Text>
                          {renderChangeHistory()}
                        </div>
                      </Space>
                    </Card>
                  )}
                </>
              )}
            </>
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

      <FloatButton.BackTop visibilityHeight={300} />

      {/* Import mappings modal */}
      <Modal
        title="Import Mappings"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={null}
        width={480}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="This will overwrite existing mapping assignments. A version snapshot will be created first so you can roll back."
        />
        <Upload.Dragger
          accept=".json"
          maxCount={1}
          beforeUpload={(file) => {
            Modal.confirm({
              title: 'Confirm Import',
              content: `Import mappings from "${file.name}"? Existing mappings will be overwritten.`,
              okText: 'Import',
              okButtonProps: { danger: true },
              onOk: () => handleImportMappings(file),
            });
            return false;
          }}
          showUploadList={false}
          disabled={importing}
        >
          <p style={{ fontSize: 14, color: '#6b4fa0' }}>
            <ImportOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
            Click or drag a JSON mapping file here
          </p>
        </Upload.Dragger>
        {importing && <Spin style={{ display: 'block', marginTop: 16, textAlign: 'center' }} />}
      </Modal>
    </div>
  );
}
