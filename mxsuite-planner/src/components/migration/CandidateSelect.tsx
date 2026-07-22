import { Select, Tooltip, Typography } from 'antd';
import type { MappingCandidateDto } from '@mxsuite/shared';

const { Text } = Typography;

interface Props {
  candidates: MappingCandidateDto[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

export default function CandidateSelect({ candidates, value, onChange, disabled }: Props) {
  if (candidates.length === 0) {
    return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
  }

  if (disabled) {
    return <Text style={{ fontSize: 12 }}>{value || '—'}</Text>;
  }

  return (
    <Select
      size="small"
      value={value}
      onChange={onChange}
      style={{ width: '100%', fontSize: 12 }}
      placeholder={`${candidates.length} candidate field${candidates.length > 1 ? 's' : ''}`}
      options={candidates.map(c => ({
        value: c.targetField,
        label: (
          <Tooltip title={c.description}>
            <span>
              {c.targetField}
              <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>{c.matchPct}%</Text>
            </span>
          </Tooltip>
        ),
      }))}
    />
  );
}
