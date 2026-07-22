import { Tooltip } from 'antd';
import type { MigrationPhase, GateStatus, PhaseGateDto } from '@mxsuite/shared';

const PHASES: { key: MigrationPhase; label: string }[] = [
  { key: 'DISCOVER', label: 'Discover' },
  { key: 'MAP', label: 'Map' },
  { key: 'GENERATE', label: 'Generate' },
  { key: 'DRY_RUN', label: 'Dry Run' },
  { key: 'MIGRATE', label: 'Migrate' },
  { key: 'CUT_OVER', label: 'Cut Over' },
];

const PHASE_ORDER: Record<MigrationPhase, number> = {
  DISCOVER: 0, MAP: 1, GENERATE: 2, DRY_RUN: 3, MIGRATE: 4, CUT_OVER: 5,
};

function getDotColor(
  phase: MigrationPhase,
  currentPhase: MigrationPhase,
  gates: PhaseGateDto[],
): string {
  const phaseIdx = PHASE_ORDER[phase];
  const currentIdx = PHASE_ORDER[currentPhase];

  if (phaseIdx < currentIdx) return '#52c41a'; // completed — green
  if (phaseIdx === currentIdx) {
    const gate = gates.find(g => g.phase === phase);
    if (gate?.gateStatus === 'BLOCKED') return '#ff4d4f'; // blocked — red
    return '#fa8c16'; // current — orange
  }
  return '#d9d9d9'; // upcoming — gray
}

function getGateIndicator(phase: MigrationPhase, gates: PhaseGateDto[]): string | null {
  const gate = gates.find(g => g.phase === phase);
  if (!gate) return null;
  if (gate.gateStatus === 'CLEARED') return '✓';
  if (gate.gateStatus === 'BLOCKED') return '✕';
  if (gate.gateStatus === 'PENDING') return '⏳';
  return null;
}

interface Props {
  currentPhase: MigrationPhase;
  gates: PhaseGateDto[];
}

export default function PhaseLifecycleDots({ currentPhase, gates }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {PHASES.map((p, i) => {
        const color = getDotColor(p.key, currentPhase, gates);
        const gateIndicator = getGateIndicator(p.key, gates);
        const isActive = p.key === currentPhase;
        return (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title={`${p.label}${gateIndicator ? ` (gate: ${gates.find(g => g.phase === p.key)?.gateStatus})` : ''}`}>
              <div style={{
                width: isActive ? 14 : 10,
                height: isActive ? 14 : 10,
                borderRadius: '50%',
                background: color,
                border: isActive ? '2px solid #2d1854' : 'none',
                cursor: 'pointer',
                position: 'relative',
              }}>
                {gateIndicator && isActive && (
                  <span style={{
                    position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                    fontSize: 8, color,
                  }}>
                    {gateIndicator}
                  </span>
                )}
              </div>
            </Tooltip>
            {i < PHASES.length - 1 && (
              <div style={{
                width: 12, height: 2,
                background: PHASE_ORDER[p.key] < PHASE_ORDER[currentPhase] ? '#52c41a' : '#d9d9d9',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
