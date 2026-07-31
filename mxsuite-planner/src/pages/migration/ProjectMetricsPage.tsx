import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb, Button, Card, Typography, Spin, Tag, Space, Tooltip } from 'antd';
import { ArrowLeftOutlined, ClockCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { usePageTitle } from '@mxsuite/shared';
import type { PhaseBenchmarkDto } from '@mxsuite/shared';
import ProjectSubNav from '../../components/migration/ProjectSubNav';
import { migrationApi } from '../../services/migrationApi';
import type { PhaseTimeDto } from '../../services/migrationApi';

const { Title, Text } = Typography;

const PHASE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover',
  MAP: 'Map',
  GENERATE: 'Generate',
  DRY_RUN: 'Dry Run',
  MIGRATE: 'Migrate',
  CUT_OVER: 'Cut Over',
};

const PHASE_ORDER = ['DISCOVER', 'MAP', 'GENERATE', 'DRY_RUN', 'MIGRATE', 'CUT_OVER'];

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

export default function ProjectMetricsPage() {
  usePageTitle('Onboarding Metrics');
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [phaseTimes, setPhaseTimes] = useState<PhaseTimeDto[]>([]);
  const [benchmarks, setBenchmarks] = useState<Map<string, PhaseBenchmarkDto>>(new Map());
  const [projectName, setProjectName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [timesRes, projRes] = await Promise.all([
          migrationApi.getProjectPhaseTimes(projectId),
          migrationApi.getProject(projectId),
        ]);
        if (!cancelled) {
          setPhaseTimes(timesRes.data);
          setProjectName(projRes.data.name || projectId);
        }

        // Fetch benchmarks (non-blocking)
        try {
          const bmRes = await migrationApi.getProjectBenchmarks(projectId);
          if (!cancelled) setBenchmarks(new Map(bmRes.data.map((b) => [b.phase, b])));
        } catch {
          // Benchmarks are optional — may be 403 for non-admin users
        }
      } catch {
        if (!cancelled) setError('Failed to load onboarding metrics.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, retryKey]);

  const headerBlock = (
    <div style={{
      background: 'linear-gradient(135deg, #f3eeff 0%, #ece4fc 100%)',
      margin: '-24px -24px 20px -24px',
      padding: '28px 32px 16px 32px',
      borderBottom: '2px solid #e0d4f5',
    }}>
      <Breadcrumb
        style={{ marginBottom: 10 }}
        items={[
          { title: <Button type="link" size="small" icon={<ArrowLeftOutlined />} style={{ padding: 0, color: '#1a0e3a' }} onClick={() => navigate('/plans/onboarding-projects/projects')}>Projects</Button> },
          { title: <span style={{ color: '#6b4fa0' }}>{projectName || '…'}</span> },
          { title: <span style={{ color: '#2d1854', fontWeight: 500 }}>Metrics</span> },
        ]}
      />
      <ProjectSubNav projectId={projectId!} activeKey="metrics" />
    </div>
  );

  if (loading) {
    return (
      <div>
        {headerBlock}
        <div style={{ textAlign: 'center', padding: 64 }}>
          <Spin size="large" tip="Loading metrics..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {headerBlock}
        <div style={{ padding: '32px 24px', maxWidth: 500, margin: '0 auto' }}>
          <Card style={{ textAlign: 'center', borderColor: '#ffa39e', borderTop: '3px solid #ff4d4f' }}>
            <WarningOutlined style={{ fontSize: 36, color: '#ff4d4f', marginBottom: 12 }} />
            <Title level={5} style={{ color: '#cf1322', marginBottom: 8 }}>{error}</Title>
            <Button icon={<ReloadOutlined />} onClick={() => setRetryKey((k) => k + 1)}>
              Retry
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  if (phaseTimes.length === 0) {
    return (
      <div>
        {headerBlock}
        <div style={{ padding: '32px 24px', maxWidth: 500, margin: '0 auto' }}>
          <Card style={{ textAlign: 'center', borderColor: '#e0d4f5', borderTop: '3px solid #6b4fa0' }}>
            <ClockCircleOutlined style={{ fontSize: 40, color: '#6b4fa0', marginBottom: 16 }} />
            <Title level={5} style={{ color: '#2d1854', marginBottom: 8 }}>No metrics recorded yet</Title>
            <Text type="secondary" style={{ display: 'block', lineHeight: 1.6 }}>
              Phase timers track how long each stage of onboarding takes. Timing begins
              automatically when the project is created and phases are advanced through
              the pipeline.
            </Text>
          </Card>
        </div>
      </div>
    );
  }

  const timeMap = new Map(phaseTimes.map((pt) => [pt.phase, pt]));
  const totalMinutes = phaseTimes.reduce((sum, pt) => sum + pt.durationMinutes, 0);
  const maxMinutes = Math.max(...phaseTimes.map((pt) => pt.durationMinutes), 1);
  const completedCount = phaseTimes.filter((pt) => pt.completedAt).length;
  const activePhase = phaseTimes.find((pt) => pt.active);

  return (
    <div>
      {headerBlock}
    <div style={{ padding: '0 24px', maxWidth: 800 }}>
      <Title level={4} style={{ marginBottom: 4, color: '#2d1854' }}>
        <ClockCircleOutlined style={{ marginRight: 8 }} />
        Onboarding Metrics — {projectName}
      </Title>
      <Text style={{ fontSize: 12, color: '#6b4fa0', display: 'block', marginBottom: 20 }}>
        Track time spent in each onboarding phase.
      </Text>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 32, flexWrap: 'wrap' }}>
        <div style={{ padding: '12px 20px', background: '#f3eeff', borderRadius: 8, border: '1px solid #e0d4f5' }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Total Onboarding Time</Text>
          <Text strong style={{ fontSize: 20, color: '#2d1854' }}>{formatDuration(totalMinutes)}</Text>
        </div>
        <div style={{ padding: '12px 20px', background: '#f3eeff', borderRadius: 8, border: '1px solid #e0d4f5' }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Phases Completed</Text>
          <Text strong style={{ fontSize: 20, color: '#2d1854' }}>
            {completedCount} / {PHASE_ORDER.length}
          </Text>
        </div>
        {activePhase && (
          <div style={{ padding: '12px 20px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffe58f' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Current Phase</Text>
            <Text strong style={{ fontSize: 20, color: '#ad6800' }}>
              {PHASE_LABELS[activePhase.phase] || activePhase.phase}
            </Text>
          </div>
        )}
      </div>

      {/* Phase timeline bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PHASE_ORDER.map((phase) => {
          const entry = timeMap.get(phase);
          const barWidth = entry ? Math.max((entry.durationMinutes / maxMinutes) * 100, 4) : 0;
          const isActive = entry?.active ?? false;
          const isCompleted = !!entry?.completedAt;

          return (
            <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Text style={{ width: 80, fontSize: 12, color: '#2d1854', fontWeight: isActive ? 600 : 400, textAlign: 'right' }}>
                {PHASE_LABELS[phase]}
              </Text>
              <div style={{ flex: 1, position: 'relative', height: 24 }}>
                <div style={{
                  width: '100%', height: '100%', backgroundColor: '#f5f5f5',
                  borderRadius: 4, overflow: 'hidden',
                }}>
                  {entry && (
                    <div style={{
                      width: `${barWidth}%`,
                      height: '100%',
                      backgroundColor: isActive ? '#fa8c16' : isCompleted ? '#2d1854' : '#e0d4f5',
                      borderRadius: 4,
                      transition: 'width 0.3s ease',
                    }} />
                  )}
                </div>
              </div>
              <div style={{ width: 140, textAlign: 'right' }}>
                {entry ? (
                  <Space size={4}>
                    <Text style={{ fontSize: 12, fontWeight: 500, color: isActive ? '#ad6800' : '#2d1854' }}>
                      {formatDuration(entry.durationMinutes)}
                    </Text>
                    {(() => {
                      const bm = benchmarks.get(phase);
                      if (!bm) return null;
                      const pct = Math.round(bm.percentAboveAvg);
                      return (
                        <Tooltip title={`Platform Avg: ${formatDuration(Math.round(bm.platformAvgMinutes))}`}>
                          <Text style={{
                            fontSize: 11, fontWeight: 600,
                            color: pct > 0 ? (bm.significantlySlower ? '#cf1322' : '#fa8c16') : '#52c41a',
                          }}>
                            {pct > 0 ? `+${pct}%` : `${pct}%`}
                          </Text>
                        </Tooltip>
                      );
                    })()}
                    {isActive && (
                      <Tag style={{ fontSize: 10, margin: 0, backgroundColor: '#fff7e6', color: '#ad6800', borderColor: '#ffe58f' }}>
                        <ClockCircleOutlined /> Active
                      </Tag>
                    )}
                  </Space>
                ) : (
                  <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.25)' }}>—</Text>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0d4f5' }}>
        <Text style={{ width: 80, fontSize: 12, fontWeight: 600, color: '#2d1854', textAlign: 'right' }}>Total</Text>
        <div style={{ flex: 1 }} />
        <Text style={{ width: 140, textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#2d1854' }}>
          {formatDuration(totalMinutes)}
        </Text>
      </div>
    </div>
    </div>
  );
}
