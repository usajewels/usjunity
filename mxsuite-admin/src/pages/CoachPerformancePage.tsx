import { useEffect, useState } from 'react';
import { Typography, Card, Spin, Table, Tag, Space, message } from 'antd';
import { TrophyOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import type { CoachLeaderboardDto, CoachPerformanceDto, PhaseAvgDurationDto } from '@mxsuite/shared';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
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
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

export default function CoachPerformancePage() {
  usePageTitle('Coach Performance');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CoachLeaderboardDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await analyticsApi.getCoachPerformance();
        if (!cancelled) setData(res.data);
      } catch {
        if (!cancelled) message.error('Failed to load coach performance data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="Loading coach performance..." />
      </div>
    );
  }

  if (!data) return null;

  const columns = [
    {
      title: '#',
      key: 'rank',
      width: 50,
      render: (_: unknown, __: unknown, index: number) => (
        <Text strong style={{ color: index < 3 ? '#2d1854' : undefined }}>
          {index + 1}
        </Text>
      ),
    },
    {
      title: 'Coach',
      dataIndex: 'coachName',
      key: 'coachName',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: 'Email',
      dataIndex: 'coachEmail',
      key: 'coachEmail',
      render: (email: string) => <Text type="secondary">{email}</Text>,
    },
    {
      title: 'Completed',
      dataIndex: 'projectsCompleted',
      key: 'projectsCompleted',
      sorter: (a: CoachPerformanceDto, b: CoachPerformanceDto) =>
        a.projectsCompleted - b.projectsCompleted,
      render: (count: number) => (
        <Tag style={{ backgroundColor: '#f6ffed', color: '#389e0d', borderColor: '#b7eb8f' }}>
          {count}
        </Tag>
      ),
    },
    {
      title: 'In-Flight',
      dataIndex: 'projectsInFlight',
      key: 'projectsInFlight',
      render: (count: number) => (
        <Tag style={{ backgroundColor: '#f3eeff', color: '#2d1854', borderColor: '#e0d4f5' }}>
          {count}
        </Tag>
      ),
    },
    {
      title: 'Avg Cycle Time',
      dataIndex: 'avgCycleTimeDays',
      key: 'avgCycleTimeDays',
      sorter: (a: CoachPerformanceDto, b: CoachPerformanceDto) =>
        a.avgCycleTimeDays - b.avgCycleTimeDays,
      render: (days: number) => (
        <Text strong>{days > 0 ? `${Math.round(days * 10) / 10}d` : '—'}</Text>
      ),
    },
    {
      title: 'vs Platform Avg',
      key: 'vsAvg',
      render: (_: unknown, record: CoachPerformanceDto) => {
        if (record.avgCycleTimeDays <= 0 || data.overallAvgCycleTimeDays <= 0) {
          return <Text type="secondary">—</Text>;
        }
        const diff = record.avgCycleTimeDays - data.overallAvgCycleTimeDays;
        const pct = Math.round((diff / data.overallAvgCycleTimeDays) * 100);
        if (Math.abs(pct) < 3) {
          return <Tag color="blue">On par</Tag>;
        }
        return pct < 0 ? (
          <Tag color="green" icon={<ArrowDownOutlined />}>{Math.abs(pct)}% faster</Tag>
        ) : (
          <Tag color="red" icon={<ArrowUpOutlined />}>{pct}% slower</Tag>
        );
      },
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
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TrophyOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Coach Performance</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>Leaderboard and per-coach onboarding metrics</Text>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Platform average callout */}
        <div style={{
          padding: '14px 24px', marginBottom: 24, borderRadius: 10,
          background: '#f3eeff', border: '1px solid #e0d4f5',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Text type="secondary">Platform average cycle time:</Text>
          <Text strong style={{ fontSize: 18, color: '#2d1854' }}>
            {data.overallAvgCycleTimeDays > 0
              ? `${Math.round(data.overallAvgCycleTimeDays * 10) / 10} days`
              : 'No data yet'}
          </Text>
        </div>

        {/* Leaderboard */}
        <Card
          title="Coach Leaderboard"
          size="small"
          style={{  }}
        >
          <Table
            dataSource={data.coaches}
            columns={columns}
            rowKey="coachId"
            pagination={false}
            size="small"
            expandable={{
              expandedRowRender: (record) => (
                <PhaseBreakdownChart breakdown={record.phaseBreakdown} />
              ),
              rowExpandable: (record) => record.phaseBreakdown.length > 0,
            }}
            locale={{ emptyText: 'No coaches with migration data yet.' }}
          />
        </Card>
      </div>
    </div>
  );
}

function PhaseBreakdownChart({ breakdown }: { breakdown: PhaseAvgDurationDto[] }) {
  const chartData = breakdown.map((b) => ({
    phase: PHASE_LABELS[b.phase] || b.phase,
    avgMinutes: Math.round(b.avgMinutes),
    projects: b.projectCount,
  }));

  return (
    <div style={{ padding: '8px 0 8px 50px' }}>
      <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
        Average duration per phase (completed phases only)
      </Text>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0d4f5" />
          <XAxis dataKey="phase" fontSize={11} tick={{ fill: '#2d1854' }} />
          <YAxis fontSize={11} tick={{ fill: '#6b4fa0' }} tickFormatter={(v) => formatMinutes(v)} />
          <RechartsTooltip
            formatter={(value: any) => [formatMinutes(value), 'Avg Duration']}
            labelStyle={{ color: '#2d1854', fontWeight: 600 }}
          />
          <Bar dataKey="avgMinutes" radius={[4, 4, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill="#6b4fa0" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
