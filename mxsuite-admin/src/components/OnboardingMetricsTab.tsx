import { useEffect, useState } from 'react';
import { Typography, Spin, Tag, Space, Tooltip } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { coachMappingApi, type PhaseTimeDto } from '../services/api';
import { analyticsApi } from '../services/analyticsApi';
import type { PhaseBenchmarkDto } from '@mxsuite/shared';

const { Text } = Typography;

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

interface Props {
  tenantId: string;
}

export default function OnboardingMetricsTab({ tenantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [phaseTimes, setPhaseTimes] = useState<PhaseTimeDto[]>([]);
  const [benchmarks, setBenchmarks] = useState<Map<string, PhaseBenchmarkDto>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: proj } = await coachMappingApi.getProject(tenantId);
        if (!proj.hasProject || !proj.projectId) {
          setError('No onboarding project found for this organization.');
          return;
        }
        const { data: times } = await coachMappingApi.getPhaseTimes(proj.projectId);
        if (!cancelled) setPhaseTimes(times);

        // Fetch benchmarks (non-blocking — graceful degradation)
        try {
          const { data: bm } = await analyticsApi.getProjectBenchmarks(proj.projectId);
          if (!cancelled) setBenchmarks(new Map(bm.map((b) => [b.phase, b])));
        } catch {
          // Benchmarks are optional — silently ignore
        }
      } catch {
        if (!cancelled) setError('Failed to load onboarding metrics.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin tip="Loading metrics..." />
      </div>
    );
  }

  if (error) {
    return (
      <Text type="secondary" style={{ fontSize: 13 }}>{error}</Text>
    );
  }

  if (phaseTimes.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 13 }}>
        No phase timing data recorded yet. Timers begin when the onboarding project is created.
      </Text>
    );
  }

  const timeMap = new Map(phaseTimes.map((pt) => [pt.phase, pt]));
  const totalMinutes = phaseTimes.reduce((sum, pt) => sum + pt.durationMinutes, 0);
  const maxMinutes = Math.max(...phaseTimes.map((pt) => pt.durationMinutes), 1);

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ padding: '12px 20px', background: '#f3eeff', borderRadius: 8, border: '1px solid #e0d4f5' }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Total Onboarding Time</Text>
          <Text strong style={{ fontSize: 20, color: '#2d1854' }}>{formatDuration(totalMinutes)}</Text>
        </div>
        <div style={{ padding: '12px 20px', background: '#f3eeff', borderRadius: 8, border: '1px solid #e0d4f5' }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Phases Completed</Text>
          <Text strong style={{ fontSize: 20, color: '#2d1854' }}>
            {phaseTimes.filter((pt) => pt.completedAt).length} / {PHASE_ORDER.length}
          </Text>
        </div>
        {phaseTimes.find((pt) => pt.active) && (
          <div style={{ padding: '12px 20px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffe58f' }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Current Phase</Text>
            <Text strong style={{ fontSize: 20, color: '#ad6800' }}>
              {PHASE_LABELS[phaseTimes.find((pt) => pt.active)!.phase] || phaseTimes.find((pt) => pt.active)!.phase}
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

      {/* Total */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0d4f5' }}>
        <Text style={{ width: 80, fontSize: 12, fontWeight: 600, color: '#2d1854', textAlign: 'right' }}>Total</Text>
        <div style={{ flex: 1 }} />
        <Text style={{ width: 140, textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#2d1854' }}>
          {formatDuration(totalMinutes)}
        </Text>
      </div>
    </div>
  );
}
