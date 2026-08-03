import { useEffect, useState } from 'react';
import { Typography, Card, Spin, Table, Tag, Space, message } from 'antd';
import {
  MessageOutlined, RobotOutlined, TeamOutlined,
  QuestionCircleOutlined, SmileOutlined, InboxOutlined,
} from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie,
  Cell, Legend,
} from 'recharts';
import { analyticsApi } from '../services/analyticsApi';
import type { ChatAnalyticsDto } from '../services/analyticsApi';

const { Title, Text } = Typography;

const PURPLE   = '#2d1854';
const LAVENDER = '#6b4fa0';
const LIGHT    = '#9b7fd4';
const AI_COLOR = '#4096ff';
const HU_COLOR = '#52c41a';
const SENT_POS = '#52c41a';
const SENT_NEG = '#ff4d4f';

function sentimentColor(score: number) {
  if (score >= 0.3) return SENT_POS;
  if (score <= -0.3) return SENT_NEG;
  return '#faad14';
}

function sentimentLabel(score: number) {
  if (score >= 0.3) return 'Positive';
  if (score <= -0.3) return 'Negative';
  return 'Neutral';
}

function pct(part: number, total: number) {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export default function ChatAnalyticsPage() {
  usePageTitle('Chat Analytics');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ChatAnalyticsDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    analyticsApi.getChatAnalytics()
      .then(({ data: d }) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) message.error('Failed to load chat analytics'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" tip="Loading chat analytics..." />
      </div>
    );
  }

  if (!data) return null;

  const aiPct  = pct(data.aiModeCount, data.totalConversations);
  const huPct  = pct(data.humanModeCount, data.totalConversations);
  const helpPct = pct(data.helpRequestedCount, data.totalConversations);

  const modePieData = [
    { name: `AI  ${aiPct}`,    value: data.aiModeCount,    color: AI_COLOR },
    { name: `Human  ${huPct}`, value: data.humanModeCount, color: HU_COLOR },
  ];

  const coachColumns = [
    { title: 'Coach', dataIndex: 'coachName', key: 'coachName',
      render: (n: string) => <Text strong>{n}</Text> },
    { title: 'Conversations', dataIndex: 'conversations', key: 'conversations',
      sorter: (a: any, b: any) => a.conversations - b.conversations,
      defaultSortOrder: 'descend' as const },
    { title: 'Active', dataIndex: 'activeCount', key: 'activeCount' },
    { title: 'Help Requested', dataIndex: 'helpRequested', key: 'helpRequested' },
    {
      title: 'Avg Sentiment',
      dataIndex: 'avgSentiment',
      key: 'avgSentiment',
      sorter: (a: any, b: any) => a.avgSentiment - b.avgSentiment,
      render: (score: number) => (
        <Tag color={score >= 0.3 ? 'success' : score <= -0.3 ? 'error' : 'warning'}>
          {sentimentLabel(score)} ({score.toFixed(2)})
        </Tag>
      ),
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
          <MessageOutlined style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)' }} />
          <div>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>Chat Analytics</Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)' }}>
              Conversation volume, sentiment trends, and coach performance
            </Text>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* ── Summary Cards ─────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <SummaryCard label="Total Conversations" value={data.totalConversations}
            icon={<MessageOutlined style={{ color: PURPLE }} />}
            bg="#f3eeff" border="#e0d4f5" />
          <SummaryCard label="Active Now" value={data.activeConversations}
            icon={<TeamOutlined style={{ color: HU_COLOR }} />}
            bg="#f6ffed" border="#b7eb8f" />
          <SummaryCard label="AI Handled" value={`${data.aiModeCount} (${aiPct})`}
            icon={<RobotOutlined style={{ color: AI_COLOR }} />}
            bg="#e6f4ff" border="#91caff" />
          <SummaryCard label="Human Takeovers" value={`${data.humanModeCount} (${huPct})`}
            icon={<TeamOutlined style={{ color: LAVENDER }} />}
            bg="#f3eeff" border="#e0d4f5" />
          <SummaryCard label="Help Requested" value={`${data.helpRequestedCount} (${helpPct})`}
            icon={<QuestionCircleOutlined style={{ color: '#fa8c16' }} />}
            bg="#fff7e6" border="#ffe58f" />
          <SummaryCard
            label="Avg Sentiment"
            value={data.avgSentimentScore !== 0 ? `${data.avgSentimentScore.toFixed(2)}` : 'N/A'}
            icon={<SmileOutlined style={{ color: sentimentColor(data.avgSentimentScore) }} />}
            bg="#fafafa" border="#d9d9d9"
          />
          <SummaryCard label="Avg Unread (Coach)" value={data.avgUnreadCoachMessages.toFixed(1)}
            icon={<InboxOutlined style={{ color: '#ff4d4f' }} />}
            bg="#fff1f0" border="#ffa39e" />
        </div>

        {/* ── Row 1: Volume Trend + AI vs Human Pie ─────────────── */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <Card title="Conversation Volume Over Time" size="small"
            style={{ flex: '1 1 58%', minWidth: 380 }}>
            {data.volumeTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data.volumeTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0d4f5" />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: PURPLE }} />
                  <YAxis fontSize={12} tick={{ fill: LAVENDER }} />
                  <RechartsTooltip labelStyle={{ color: PURPLE, fontWeight: 600 }} />
                  <Legend />
                  <Line type="monotone" dataKey="total" name="Total" stroke={PURPLE}
                    strokeWidth={2} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="aiMode" name="AI" stroke={AI_COLOR}
                    strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="humanMode" name="Human" stroke={HU_COLOR}
                    strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Text type="secondary">No conversation data yet.</Text>
            )}
          </Card>

          <Card title="AI vs Human Distribution" size="small"
            style={{ flex: '1 1 36%', minWidth: 280 }}>
            {data.totalConversations > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={modePieData} cx="50%" cy="50%" outerRadius={90}
                    dataKey="value" label={({ name }) => name} labelLine={false}>
                    {modePieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Text type="secondary">No data yet.</Text>
            )}
          </Card>
        </div>

        {/* ── Row 2: Sentiment Trend + Help Rate ───────────────── */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <Card title="Sentiment Trend (Monthly Avg)" size="small"
            style={{ flex: '1 1 48%', minWidth: 340 }}>
            {data.sentimentTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.sentimentTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0d4f5" />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: PURPLE }} />
                  <YAxis fontSize={12} tick={{ fill: LAVENDER }} domain={[-1, 1]}
                    tickFormatter={(v) => v.toFixed(1)} />
                  <RechartsTooltip
                    formatter={(v: number) => [v.toFixed(2), 'Avg Sentiment']}
                    labelStyle={{ color: PURPLE, fontWeight: 600 }}
                  />
                  <Line type="monotone" dataKey="avgSentiment" name="Avg Sentiment"
                    stroke={LAVENDER} strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Text type="secondary">No sentiment data yet.</Text>
            )}
          </Card>

          <Card title="Help Request Rate by Month" size="small"
            style={{ flex: '1 1 48%', minWidth: 340 }}>
            {data.volumeTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.volumeTrend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0d4f5" />
                  <XAxis dataKey="month" fontSize={12} tick={{ fill: PURPLE }} />
                  <YAxis fontSize={12} tick={{ fill: LAVENDER }} />
                  <RechartsTooltip labelStyle={{ color: PURPLE, fontWeight: 600 }} />
                  <Bar dataKey="helpRequested" name="Help Requested" fill="#fa8c16" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="total" name="Total" fill={LIGHT} radius={[4, 4, 0, 0]} opacity={0.4} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Text type="secondary">No data yet.</Text>
            )}
          </Card>
        </div>

        {/* ── Per-Coach Table ───────────────────────────────────── */}
        {data.coachStats.length > 0 && (
          <Card
            title={
              <Space>
                <TeamOutlined style={{ color: LAVENDER }} />
                <span>Per-Coach Chat Performance</span>
                <Tag color="purple">{data.coachStats.length} coaches</Tag>
              </Space>
            }
            size="small"
          >
            <Table
              dataSource={data.coachStats}
              columns={coachColumns}
              rowKey="coachId"
              pagination={false}
              size="small"
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, bg, border }: {
  label: string; value: string | number;
  icon: React.ReactNode; bg: string; border: string;
}) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 148, padding: '14px 18px',
      background: bg, borderRadius: 10, border: `1px solid ${border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {icon}
        <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
      </div>
      <Text strong style={{ fontSize: 20, color: '#2d1854' }}>{value}</Text>
    </div>
  );
}
