import { useEffect, useState } from 'react';
import { Typography, Card, Spin, Table, Button, Space, message, Tag, Tooltip } from 'antd';
import {
  BarChartOutlined, DownloadOutlined, WarningOutlined,
  CheckCircleOutlined, RocketOutlined, CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import type {
  CrossOrgAnalyticsDto,
  SlaAlertDto,
} from '@mxsuite/shared';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, Cell,
} from 'recharts';
import { analyticsApi } from '../services/analyticsApi';

const { Title, Text } = Typography;

const PHASE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover',
  MAP: 'Map',
  GENERATE: 'Generate',
  DRY_RUN: 'Dry Run',
  MIGRATE: 'Migrate',
  CUT_OVER: 'Cut Over',
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${Math.round(minutes % 60)}m`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

export default function AnalyticsDashboardPage() {
  usePageTitle('Analytics');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CrossOrgAnalyticsDto | null>(null);
  const [alerts, setAlerts] = useState<SlaAlertDto[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [analyticsRes, alertsRes] = await Promise.all([
          analyticsApi.getCrossOrgAnalytics(),
          analyticsApi.getAlerts(),
        ]);
        if (!cancelled) {
          setData(analyticsRes.data);
          setAlerts(alertsRes.data);
        }
      } catch {
        if (!cancelled) message.error('Failed to load analytics data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleExport = async (type: 'phase-times' | 'project-summary') => {
    setExporting(type);
    try {
      const res = type === 'phase-times'
        ? await analyticsApi.exportPhaseTimes()
        : await analyticsApi.exportProjectSummary();
      const blob = new Blob([res.data as BlobPart], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-export.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('Export failed');
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="Loading analytics..." />
      </div>
    );
  }

  if (!data) return null;

  const phaseChartData = data.avgDurationPerPhase.map((p) => ({
    phase: PHASE_LABELS[p.phase] || p.phase,
    avgMinutes: Math.round(p.avgMinutes),
    medianMinutes: Math.round(p.medianMinutes),
    projects: p.projectCount,
  }));

  const distributionData = Object.entries(data.phaseDistribution).map(([phase, count]) => ({
    phase: PHASE_LABELS[phase] || phase,
    count,
  }));

  const trendData = data.cycleTimeTrend.map((pt) => ({
    month: pt.month,
    avgDays: Math.round(pt.avgCycleTimeDays * 10) / 10,
    completed: pt.completedCount,
  }));

  const alertColumns = [
    {
      title: 'Project',
      dataIndex: 'projectName',
      key: 'projectName',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    { title: 'Organization', dataIndex: 'tenantName', key: 'tenantName' },
    { title: 'Owner', dataIndex: 'ownerName', key: 'ownerName' },
    {
      title: 'Phase',
      dataIndex: 'phase',
      key: 'phase',
      render: (phase: string) => (
        <Tag style={{ backgroundColor: '#fff7e6', color: '#ad6800', borderColor: '#ffe58f' }}>
          {PHASE_LABELS[phase] || phase}
        </Tag>
      ),
    },
    {
      title: 'Time in Phase',
      dataIndex: 'minutesInPhase',
      key: 'minutesInPhase',
      render: (minutes: number) => formatMinutes(minutes),
      sorter: (a: SlaAlertDto, b: SlaAlertDto) => a.minutesInPhase - b.minutesInPhase,
    },
    {
      title: 'Threshold',
      dataIndex: 'thresholdMinutes',
      key: 'thresholdMinutes',
      render: (minutes: number) => formatMinutes(minutes),
    },
    {
      title: '% Over',
      dataIndex: 'percentOverThreshold',
      key: 'percentOverThreshold',
      render: (pct: number) => (
        <Text style={{ color: pct > 100 ? '#cf1322' : '#fa8c16', fontWeight: 600 }}>
          +{Math.round(pct)}%
        </Text>
      ),
      sorter: (a: SlaAlertDto, b: SlaAlertDto) => a.percentOverThreshold - b.percentOverThreshold,
      defaultSortOrder: 'descend' as const,
    },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #2d1854 0%, #1a0e3a 100%)',
        margin: '-24px -24px 24px -24px',
        padding: '28px 32px 20px 32px',
        borderBottom: '3px solid #6b4fa0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BarChartOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Analytics Dashboard</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Cross-organization onboarding analytics and performance metrics</Text>
          </div>
        </div>
        <Space>
          <Tooltip title="Download detailed phase timing data for all projects">
            <Button
              icon={<DownloadOutlined />}
              loading={exporting === 'phase-times'}
              onClick={() => handleExport('phase-times')}
              style={{ borderColor: '#fff', color: '#fff', background: 'transparent' }}
            >
              Phase Times CSV
            </Button>
          </Tooltip>
          <Tooltip title="Download project summary with total durations per phase">
            <Button
              icon={<DownloadOutlined />}
              loading={exporting === 'project-summary'}
              onClick={() => handleExport('project-summary')}
              style={{ borderColor: '#fff', color: '#fff', background: 'transparent' }}
            >
              Summary CSV
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Summary Cards */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <SummaryCard
            label="Completed"
            value={data.totalCompleted}
            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            bg="#f6ffed" border="#b7eb8f"
          />
          <SummaryCard
            label="In-Flight"
            value={data.totalInFlight}
            icon={<RocketOutlined style={{ color: '#2d1854' }} />}
            bg="#f3eeff" border="#e0d4f5"
          />
          <SummaryCard
            label="Avg Cycle Time"
            value={`${Math.round(data.avgCycleTimeDays * 10) / 10}d`}
            icon={<ClockCircleOutlined style={{ color: '#6b4fa0' }} />}
            bg="#f3eeff" border="#e0d4f5"
          />
          <SummaryCard
            label="Active Alerts"
            value={alerts.length}
            icon={<WarningOutlined style={{ color: alerts.length > 0 ? '#fa8c16' : '#52c41a' }} />}
            bg={alerts.length > 0 ? '#fff7e6' : '#f6ffed'}
            border={alerts.length > 0 ? '#ffe58f' : '#b7eb8f'}
          />
          <SummaryCard
            label="Cancelled"
            value={data.totalCancelled}
            icon={<CloseCircleOutlined style={{ color: '#8c8c8c' }} />}
            bg="#fafafa" border="#d9d9d9"
          />
        </div>

        {/* Charts Row */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {/* Avg Duration Per Phase */}
          <Card
            title="Average Duration per Phase"
            size="small"
            style={{ flex: '1 1 58%', minWidth: 400 }}
          >
            {phaseChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={phaseChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0d4f5" />
                  <XAxis dataKey="phase" fontSize={12} tick={{ fill: '#2d1854' }} />
                  <YAxis fontSize={12} tick={{ fill: '#6b4fa0' }} tickFormatter={(v) => formatMinutes(v)} />
                  <RechartsTooltip
                    formatter={(value: any, name: any) => [formatMinutes(value), name === 'avgMinutes' ? 'Average' : 'Median']}
                    labelStyle={{ color: '#2d1854', fontWeight: 600 }}
                  />
                  <Bar dataKey="avgMinutes" name="Average" radius={[4, 4, 0, 0]}>
                    {phaseChartData.map((_, i) => (
                      <Cell key={i} fill="#2d1854" />
                    ))}
                  </Bar>
                  <Bar dataKey="medianMinutes" name="Median" radius={[4, 4, 0, 0]}>
                    {phaseChartData.map((_, i) => (
                      <Cell key={i} fill="#6b4fa0" opacity={0.6} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Text type="secondary">No phase duration data available yet.</Text>
            )}
          </Card>

          {/* Phase Distribution */}
          <Card
            title="Current Phase Distribution"
            size="small"
            style={{ flex: '1 1 38%', minWidth: 300 }}
          >
            {distributionData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={distributionData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0d4f5" />
                  <XAxis type="number" fontSize={12} tick={{ fill: '#6b4fa0' }} />
                  <YAxis dataKey="phase" type="category" width={70} fontSize={12} tick={{ fill: '#2d1854' }} />
                  <RechartsTooltip
                    formatter={(value: any) => [value, 'Projects']}
                    labelStyle={{ color: '#2d1854', fontWeight: 600 }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {distributionData.map((_, i) => (
                      <Cell key={i} fill="#6b4fa0" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Text type="secondary">No active migrations to display.</Text>
            )}
          </Card>
        </div>

        {/* Cycle Time Trend */}
        {trendData.length > 0 && (
          <Card
            title="Cycle Time Trend (Monthly)"
            size="small"
            style={{ marginBottom: 24 }}
          >
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0d4f5" />
                <XAxis dataKey="month" fontSize={12} tick={{ fill: '#2d1854' }} />
                <YAxis fontSize={12} tick={{ fill: '#6b4fa0' }} unit="d" />
                <RechartsTooltip
                  formatter={(value: any, name: any) => [
                    name === 'avgDays' ? `${value}d` : value,
                    name === 'avgDays' ? 'Avg Cycle Time' : 'Completed',
                  ]}
                  labelStyle={{ color: '#2d1854', fontWeight: 600 }}
                />
                <Line type="monotone" dataKey="avgDays" stroke="#2d1854" strokeWidth={2} dot={{ fill: '#2d1854', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* SLA Alerts */}
        <Card
          title={
            <Space>
              <WarningOutlined style={{ color: alerts.length > 0 ? '#fa8c16' : '#52c41a' }} />
              <span>Projects Needing Attention</span>
              {alerts.length > 0 && (
                <Tag color="orange">{alerts.length}</Tag>
              )}
            </Space>
          }
          size="small"
          style={{  }}
        >
          {alerts.length > 0 ? (
            <Table
              dataSource={alerts}
              columns={alertColumns}
              rowKey="projectId"
              pagination={false}
              size="small"
            />
          ) : (
            <Text type="secondary">All projects are within SLA thresholds.</Text>
          )}
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, bg, border }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  bg: string;
  border: string;
}) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 160, padding: '16px 20px',
      background: bg, borderRadius: 10, border: `1px solid ${border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {icon}
        <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      </div>
      <Text strong style={{ fontSize: 24, color: '#2d1854' }}>{value}</Text>
    </div>
  );
}
