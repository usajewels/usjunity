import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Card, Typography, Space, Button, Select, Input, Switch, Tag, Tooltip,
  Table, Modal, Spin, Row, Col, Badge, message, ConfigProvider,
} from 'antd';
import {
  ReloadOutlined, PauseOutlined, CaretRightOutlined,
  SearchOutlined, SettingOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import { logApi, type LogEntry, type LoggerInfo } from '../services/api';

const { Title, Text } = Typography;

const LEVEL_COLORS: Record<string, string> = {
  ERROR: '#ff4d4f',
  WARN: '#faad14',
  INFO: '#6b4fa0',
  DEBUG: '#52c41a',
  TRACE: '#d9d9d9',
};

const LEVEL_TAG_STYLES: Record<string, React.CSSProperties> = {
  ERROR: { backgroundColor: '#fff2f0', color: '#cf1322', borderColor: '#ffa39e' },
  WARN: { backgroundColor: '#fffbe6', color: '#ad6800', borderColor: '#ffe58f' },
  INFO: { backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' },
  DEBUG: { backgroundColor: '#f6ffed', color: '#237804', borderColor: '#b7eb8f' },
  TRACE: { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function LogViewerPage() {
  usePageTitle('System Logs');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const [fileName, setFileName] = useState('');

  // Filters
  const [levelFilter, setLevelFilter] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [lineCount, setLineCount] = useState(500);

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Logger management
  const [loggersVisible, setLoggersVisible] = useState(false);
  const [loggers, setLoggers] = useState<LoggerInfo[]>([]);
  const [loggersLoading, setLoggersLoading] = useState(false);

  // Expanded entries (for multi-line messages / stack traces)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // Scroll to bottom
  const bottomRef = useRef<HTMLDivElement>(null);
  const [followTail, setFollowTail] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await logApi.getLogs({
        lines: lineCount,
        level: levelFilter.length > 0 ? levelFilter.join(',') : undefined,
        search: searchText || undefined,
      });
      setEntries(data.entries);
      setFileSize(data.fileSize);
      setFileName(data.fileName);
      if (followTail) {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch {
      message.error('Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [lineCount, levelFilter, searchText, followTail]);

  // Initial load
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refreshInterval, fetchLogs]);

  // Fetch loggers
  const fetchLoggers = async () => {
    setLoggersLoading(true);
    try {
      const { data } = await logApi.getLoggers();
      setLoggers(data);
    } catch {
      message.error('Failed to load loggers');
    } finally {
      setLoggersLoading(false);
    }
  };

  const handleSetLogLevel = async (loggerName: string, level: string | null) => {
    try {
      await logApi.setLoggerLevel(loggerName, level);
      message.success(`Logger ${loggerName} set to ${level || 'default'}`);
      fetchLoggers();
    } catch {
      message.error('Failed to update logger level');
    }
  };

  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const levelCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.level] = (acc[e.level] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
        margin: '-24px -24px 20px -24px',
        padding: '28px 32px 16px 32px',
        borderBottom: '2px solid #e0d4f5',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <Title level={4} style={{ margin: 0, color: '#2d1854' }}>System Logs</Title>
          <Text style={{ color: '#6b4fa0' }}>
            {fileName} &middot; {formatFileSize(fileSize)} &middot; {entries.length} entries
          </Text>
        </div>
        <Space>
          <Button
            icon={<SettingOutlined />}
            onClick={() => { setLoggersVisible(true); fetchLoggers(); }}
            style={{ borderColor: '#2d1854', color: '#2d1854', background: '#f3eeff' }}
          >
            Log Levels
          </Button>
        </Space>
      </div>

      {/* Controls bar */}
      <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
        <Card size="small" style={{ marginBottom: 16, borderTop: '3px solid #2d1854', border: '1px solid #e0d4f5' }}>
          <Row gutter={[12, 12]} align="middle">
            <Col flex="auto">
              <Space wrap>
                {/* Level filter */}
                <Select
                  mode="multiple"
                  placeholder="Filter by level"
                  value={levelFilter}
                  onChange={setLevelFilter}
                  style={{ minWidth: 200 }}
                  allowClear
                  options={['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].map(l => ({
                    label: (
                      <span>
                        <Badge color={LEVEL_COLORS[l]} />
                        {' '}{l}
                        {levelCounts[l] ? ` (${levelCounts[l]})` : ''}
                      </span>
                    ),
                    value: l,
                  }))}
                />

                {/* Search */}
                <Input
                  placeholder="Search logs..."
                  prefix={<SearchOutlined style={{ color: '#6b4fa0' }} />}
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  allowClear
                  style={{ width: 220 }}
                  onPressEnter={fetchLogs}
                />

                {/* Line count */}
                <Select
                  value={lineCount}
                  onChange={setLineCount}
                  style={{ width: 110 }}
                  options={[
                    { label: '100 lines', value: 100 },
                    { label: '250 lines', value: 250 },
                    { label: '500 lines', value: 500 },
                    { label: '1000 lines', value: 1000 },
                    { label: '2000 lines', value: 2000 },
                  ]}
                />
              </Space>
            </Col>

            <Col>
              <Space>
                {/* Auto-refresh */}
                <Tooltip title={autoRefresh ? 'Pause auto-refresh' : 'Start auto-refresh'}>
                  <Button
                    icon={autoRefresh ? <PauseOutlined /> : <CaretRightOutlined />}
                    type={autoRefresh ? 'primary' : 'default'}
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    style={autoRefresh ? { background: '#2d1854', borderColor: '#2d1854' } : {}}
                  />
                </Tooltip>
                {autoRefresh && (
                  <Select
                    value={refreshInterval}
                    onChange={setRefreshInterval}
                    style={{ width: 70 }}
                    size="small"
                    options={[
                      { label: '2s', value: 2 },
                      { label: '5s', value: 5 },
                      { label: '10s', value: 10 },
                      { label: '30s', value: 30 },
                    ]}
                  />
                )}

                {/* Follow tail */}
                <Tooltip title="Auto-scroll to bottom on refresh">
                  <Switch
                    checked={followTail}
                    onChange={setFollowTail}
                    checkedChildren="Tail"
                    unCheckedChildren="Tail"
                    size="small"
                    style={followTail ? { backgroundColor: '#2d1854' } : {}}
                  />
                </Tooltip>

                {/* Manual refresh */}
                <Button
                  icon={<ReloadOutlined spin={loading} />}
                  onClick={fetchLogs}
                  style={{ borderColor: '#2d1854', color: '#2d1854' }}
                >
                  Refresh
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>
      </ConfigProvider>

      {/* Log entries */}
      <Card
        size="small"
        style={{ border: '1px solid #e0d4f5' }}
        bodyStyle={{
          padding: 0,
          maxHeight: 'calc(100vh - 320px)',
          overflow: 'auto',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: 12,
          lineHeight: '20px',
          background: '#1e1e1e',
        }}
      >
        {loading && entries.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#999' }}>
            No log entries found
          </div>
        ) : (
          <div style={{ padding: '8px 0' }}>
            {entries.map((entry, idx) => {
              const key = `${entry.timestamp}-${idx}`;
              const isMultiLine = entry.message.includes('\n');
              const isExpanded = expandedKeys.has(key);
              const firstLine = isMultiLine ? entry.message.split('\n')[0] : entry.message;
              const levelColor = LEVEL_COLORS[entry.level] || '#999';
              const isError = entry.level === 'ERROR';
              const isWarn = entry.level === 'WARN';

              return (
                <div
                  key={key}
                  style={{
                    padding: '2px 12px',
                    borderLeft: `3px solid ${levelColor}`,
                    background: isError ? 'rgba(255,77,79,0.08)' : isWarn ? 'rgba(250,173,20,0.06)' : 'transparent',
                    cursor: isMultiLine ? 'pointer' : 'default',
                  }}
                  onClick={isMultiLine ? () => toggleExpand(key) : undefined}
                >
                  <span style={{ color: '#888' }}>{entry.timestamp}</span>
                  {' '}
                  <span style={{
                    color: levelColor,
                    fontWeight: isError || isWarn ? 'bold' : 'normal',
                    display: 'inline-block',
                    width: 44,
                    textAlign: 'right',
                  }}>
                    {entry.level}
                  </span>
                  {' '}
                  <span style={{ color: '#6a9fb5' }}>{entry.logger}</span>
                  {entry.traceId && (
                    <span style={{ color: '#555' }}> [{entry.traceId.substring(0, 8)}]</span>
                  )}
                  {' '}
                  <span style={{ color: '#d4d4d4' }}>{firstLine}</span>
                  {isMultiLine && !isExpanded && (
                    <span style={{ color: '#666', marginLeft: 4 }}>
                      {' '}[+{entry.message.split('\n').length - 1} lines]
                    </span>
                  )}
                  {isMultiLine && isExpanded && (
                    <pre style={{
                      margin: '4px 0 4px 48px',
                      color: isError ? '#ff8888' : '#ccc',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontSize: 11,
                    }}>
                      {entry.message.split('\n').slice(1).join('\n')}
                    </pre>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </Card>

      {/* Logger Management Modal */}
      <Modal
        title="Logger Configuration"
        open={loggersVisible}
        onCancel={() => setLoggersVisible(false)}
        footer={null}
        width={700}
      >
        <ConfigProvider theme={{ token: { colorPrimary: '#2d1854' } }}>
          {loggersLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
          ) : (
            <Table
              dataSource={loggers}
              rowKey="name"
              size="small"
              pagination={{ pageSize: 15, size: 'small' }}
              columns={[
                {
                  title: 'Logger',
                  dataIndex: 'name',
                  key: 'name',
                  ellipsis: true,
                  render: (name: string) => (
                    <Text style={{ fontSize: 12 }}>{name || 'ROOT'}</Text>
                  ),
                },
                {
                  title: 'Effective',
                  dataIndex: 'effectiveLevel',
                  key: 'effective',
                  width: 90,
                  render: (level: string) => (
                    <Tag style={LEVEL_TAG_STYLES[level] || { backgroundColor: '#f5f5f5', color: '#8c8c8c', borderColor: '#d9d9d9' }}>
                      {level}
                    </Tag>
                  ),
                },
                {
                  title: 'Set Level',
                  key: 'setLevel',
                  width: 130,
                  render: (_: unknown, record: LoggerInfo) => (
                    <Select
                      value={record.configuredLevel || undefined}
                      placeholder="Inherited"
                      size="small"
                      style={{ width: 110 }}
                      allowClear
                      onChange={(value) => handleSetLogLevel(record.name, value || null)}
                      options={[
                        { label: 'TRACE', value: 'TRACE' },
                        { label: 'DEBUG', value: 'DEBUG' },
                        { label: 'INFO', value: 'INFO' },
                        { label: 'WARN', value: 'WARN' },
                        { label: 'ERROR', value: 'ERROR' },
                      ]}
                    />
                  ),
                },
              ]}
            />
          )}
        </ConfigProvider>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <ExclamationCircleOutlined style={{ marginRight: 4 }} />
            Changes take effect immediately but are not persisted across restarts.
          </Text>
        </div>
      </Modal>
    </div>
  );
}
