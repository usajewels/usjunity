import {
  ApartmentOutlined, ThunderboltOutlined,
  SafetyCertificateOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface Props {
  projectId: string;
  activeKey: 'mappings' | 'data-review' | 'reconciliation' | 'metrics';
}

const BASE = '/plans/onboarding-projects/projects';

const TABS = [
  { key: 'mappings' as const, label: 'Field Mappings', icon: <ApartmentOutlined /> },
  { key: 'data-review' as const, label: 'Data Review', icon: <ThunderboltOutlined /> },
  { key: 'reconciliation' as const, label: 'Reconciliation', icon: <SafetyCertificateOutlined /> },
  { key: 'metrics' as const, label: 'Metrics', icon: <ClockCircleOutlined /> },
];

export default function ProjectSubNav({ projectId, activeKey }: Props) {
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            onClick={() => { if (!isActive) navigate(`${BASE}/${projectId}/${tab.key}`); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: isActive ? 'default' : 'pointer',
              transition: 'all 0.2s ease',
              background: isActive ? '#2d1854' : 'transparent',
              color: isActive ? '#fff' : '#6b4fa0',
              border: isActive ? '1px solid #2d1854' : '1px solid transparent',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'rgba(45,24,84,0.08)';
                e.currentTarget.style.borderColor = '#e0d4f5';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }
            }}
          >
            {tab.icon}
            {tab.label}
          </div>
        );
      })}
    </div>
  );
}
