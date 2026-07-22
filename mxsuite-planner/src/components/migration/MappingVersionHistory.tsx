import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Drawer, Timeline, Typography, Tag, Button, Space, Spin, Tooltip,
  Collapse, Popconfirm, Input, message, ConfigProvider, Empty,
} from 'antd';
import {
  HistoryOutlined, RollbackOutlined, SearchOutlined,
  DownOutlined, RightOutlined,
} from '@ant-design/icons';
import type {
  MappingVersionDto, MappingVersionDetailDto, MappingVersionChangeDto,
} from '@mxsuite/shared';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const { Text } = Typography;

const SOURCE_STYLES: Record<string, { label: string; style: React.CSSProperties }> = {
  EDIT: { label: 'Edit', style: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' } },
  ROLLBACK: { label: 'Rollback', style: { backgroundColor: '#fff2f0', color: '#cf1322', borderColor: '#ffa39e' } },
  IMPORT: { label: 'Import', style: { backgroundColor: '#6b4fa0', color: '#ffffff', borderColor: '#6b4fa0' } },
  AI_MAPPING: { label: 'AI Mapping', style: { backgroundColor: '#2d1854', color: '#ffffff', borderColor: '#2d1854' } },
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  TARGET_CHANGED: 'Target changed',
  STATUS_CHANGED: 'Status changed',
  COMMENT_CHANGED: 'Comment updated',
  COERCION_CHANGED: 'Coercion changed',
  SKIPPED: 'Skipped',
  UNSKIPPED: 'Unskipped',
  APPROVED: 'Approved',
  RESTORED: 'Restored',
};

const FRIENDLY_VALUES: Record<string, string> = {
  MAPPED: 'Approved',
  NEEDS_REVIEW: 'Needs Review',
  CFV_PROPOSAL: 'Proposal',
  REJECTED: 'Skipped',
  UNMAPPED: 'Unmapped',
};
const friendly = (v: string | null) => (v && FRIENDLY_VALUES[v]) || v || '';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fetch version list */
  fetchVersions: (params: { page: number; size: number; search?: string }) =>
    Promise<{ data: { content: MappingVersionDto[]; totalElements: number } }>;
  /** Fetch version detail with changes */
  fetchVersion: (versionId: string) =>
    Promise<{ data: MappingVersionDetailDto }>;
  /** Rollback to a version */
  onRollback: (targetVersion: number) => Promise<void>;
  /** Called after a successful rollback so parent can reload mappings */
  onRollbackComplete?: () => void;
}

export default function MappingVersionHistory({
  open, onClose, fetchVersions, fetchVersion, onRollback, onRollbackComplete,
}: Props) {
  const [versions, setVersions] = useState<MappingVersionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MappingVersionDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadVersions = useCallback(async (search?: string) => {
    setLoading(true);
    try {
      const params: { page: number; size: number; search?: string } = { page: 0, size: 50 };
      if (search) params.search = search;
      const { data } = await fetchVersions(params);
      setVersions(data.content || []);
      setTotal(data.totalElements || 0);
    } catch {
      message.error('Failed to load version history');
    } finally {
      setLoading(false);
    }
  }, [fetchVersions]);

  useEffect(() => {
    if (open) {
      setSearchTerm('');
      loadVersions();
      setExpandedId(null);
      setDetail(null);
    }
  }, [open]);

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setExpandedId(null);
      setDetail(null);
      loadVersions(value || undefined);
    }, 400);
  };

  const handleExpand = async (versionId: string) => {
    if (expandedId === versionId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(versionId);
    setDetailLoading(true);
    try {
      const { data } = await fetchVersion(versionId);
      setDetail(data);
    } catch {
      message.error('Failed to load version details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRollback = async (targetVersion: number) => {
    setRollbackLoading(true);
    try {
      await onRollback(targetVersion);
      message.success(`Rolled back to version ${targetVersion}`);
      loadVersions(searchTerm || undefined);
      onRollbackComplete?.();
    } catch {
      message.error('Rollback failed');
    } finally {
      setRollbackLoading(false);
    }
  };

  return (
    <Drawer
      title={
        <Space>
          <HistoryOutlined style={{ color: '#2d1854' }} />
          <span style={{ color: '#2d1854' }}>Version History</span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={480}
    >
      <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        <Input
          placeholder="Search by field name, user, or description..."
          prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
          allowClear
          value={searchTerm}
          onChange={(e) => handleSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : versions.length === 0 ? (
          <Empty
            description={searchTerm
              ? `No versions found matching "${searchTerm}"`
              : 'No version history yet. Changes will be tracked automatically.'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              {total} version{total !== 1 ? 's' : ''}{searchTerm ? ' matching' : ' recorded'}
            </Text>
            <Timeline
              items={versions.map((v) => ({
                color: '#6b4fa0',
                children: (
                  <VersionItem
                    key={v.id}
                    version={v}
                    expanded={expandedId === v.id}
                    detail={expandedId === v.id ? detail : null}
                    detailLoading={expandedId === v.id && detailLoading}
                    rollbackLoading={rollbackLoading}
                    onToggle={() => handleExpand(v.id)}
                    onRollback={() => handleRollback(v.versionNumber)}
                    highlightTerm={searchTerm}
                  />
                ),
              }))}
            />
          </>
        )}
      </ConfigProvider>
    </Drawer>
  );
}

function VersionItem({
  version: v, expanded, detail, detailLoading, rollbackLoading,
  onToggle, onRollback, highlightTerm,
}: {
  version: MappingVersionDto;
  expanded: boolean;
  detail: MappingVersionDetailDto | null;
  detailLoading: boolean;
  rollbackLoading: boolean;
  onToggle: () => void;
  onRollback: () => void;
  highlightTerm?: string;
}) {
  const sourceInfo = SOURCE_STYLES[v.source] || SOURCE_STYLES.EDIT;
  const [showAll, setShowAll] = useState(false);

  const PREVIEW_LIMIT = 3;

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header */}
      <div
        style={{ cursor: 'pointer', marginBottom: 4 }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          {expanded
            ? <DownOutlined style={{ fontSize: 10, color: '#6b4fa0' }} />
            : <RightOutlined style={{ fontSize: 10, color: '#6b4fa0' }} />}
          <Text strong style={{ color: '#2d1854' }}>v{v.versionNumber}</Text>
          <Tag style={sourceInfo.style}>{sourceInfo.label}</Tag>
          {v.label && (
            <Tag style={{ backgroundColor: '#f9f6ff', color: '#6b4fa0', borderColor: '#e0d4f5' }}>
              {v.label}
            </Tag>
          )}
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {v.createdByName} &middot;{' '}
            <Tooltip title={dayjs(v.createdAt).format('YYYY-MM-DD HH:mm:ss')}>
              {dayjs(v.createdAt).fromNow()}
            </Tooltip>
          </Text>
        </div>
        {v.description && (
          <Text style={{ fontSize: 13 }}>{v.description}</Text>
        )}
        {!expanded && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {v.changeCount} change{v.changeCount !== 1 ? 's' : ''}
          </Text>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          marginTop: 8, padding: 12, background: '#f9f6ff',
          border: '1px solid #e0d4f5', borderRadius: 6,
        }}>
          {detailLoading ? (
            <Spin size="small" />
          ) : detail ? (
            <>
              {detail.changes.length > 0 && (() => {
                const canCollapse = detail.changes.length > PREVIEW_LIMIT;
                const visible = canCollapse && !showAll
                  ? detail.changes.slice(0, PREVIEW_LIMIT)
                  : detail.changes;
                return (
                  <div style={{ marginBottom: 8 }}>
                    {visible.map((c) => (
                      <ChangeRow key={c.id} change={c} highlightTerm={highlightTerm} />
                    ))}
                    {canCollapse && (
                      <Button
                        type="link"
                        size="small"
                        onClick={(e) => { e.stopPropagation(); setShowAll(!showAll); }}
                        style={{ padding: '4px 0', color: '#6b4fa0', fontSize: 12 }}
                      >
                        {showAll
                          ? 'Show less'
                          : `Show all ${detail.changes.length} changes`}
                      </Button>
                    )}
                  </div>
                );
              })()}
              <Popconfirm
                title="Rollback to this version?"
                description={`This will restore all mappings to the state at version ${v.versionNumber}. A new version will be created recording the rollback.`}
                onConfirm={onRollback}
                okText="Rollback"
                okButtonProps={{ danger: true, loading: rollbackLoading }}
              >
                <Button
                  size="small"
                  icon={<RollbackOutlined />}
                  style={{ borderColor: '#cf1322', color: '#cf1322' }}
                >
                  Rollback to v{v.versionNumber}
                </Button>
              </Popconfirm>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ChangeRow({ change: c, highlightTerm }: { change: MappingVersionChangeDto; highlightTerm?: string }) {
  const label = CHANGE_TYPE_LABELS[c.changeType] || c.changeType;
  const fieldText = `${c.sourceEntity}.${c.sourceField}`;
  const isHighlighted = highlightTerm &&
    fieldText.toLowerCase().includes(highlightTerm.toLowerCase());

  return (
    <div style={{
      padding: '4px 0', borderBottom: '1px solid #e0d4f5',
      fontSize: 12,
      backgroundColor: isHighlighted ? '#ece4fc' : undefined,
      marginLeft: isHighlighted ? -4 : undefined,
      marginRight: isHighlighted ? -4 : undefined,
      paddingLeft: isHighlighted ? 4 : undefined,
      paddingRight: isHighlighted ? 4 : undefined,
      borderRadius: isHighlighted ? 3 : undefined,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text code style={{ fontSize: 11 }}>
          {fieldText}
        </Text>
        <Text type="secondary">{label}</Text>
      </div>
      {(c.oldValue || c.newValue) && c.changeType !== 'APPROVED' && (
        <div style={{ marginLeft: 8, marginTop: 2 }}>
          {c.oldValue && <Text type="secondary" style={{ fontSize: 11 }}>{friendly(c.oldValue)}</Text>}
          {c.oldValue && c.newValue && <span style={{ margin: '0 4px', color: '#6b4fa0', fontSize: 11 }}>&rarr;</span>}
          {c.newValue && <Text style={{ fontSize: 11, color: '#237804', fontWeight: 500 }}>{friendly(c.newValue)}</Text>}
        </div>
      )}
    </div>
  );
}
