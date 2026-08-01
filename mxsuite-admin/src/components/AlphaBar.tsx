import { Button, Space } from 'antd';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface AlphaBarProps {
  activeLetter: string | null;
  onChange: (letter: string | null) => void;
  disabled?: boolean;
}

export default function AlphaBar({ activeLetter, onChange, disabled }: AlphaBarProps) {
  return (
    <Space wrap size={4} style={{ marginBottom: 12 }}>
      <Button
        size="small"
        type={activeLetter === null ? 'primary' : 'text'}
        onClick={() => onChange(null)}
        disabled={disabled}
        style={activeLetter === null
          ? { background: '#2d1854', borderColor: '#2d1854', color: '#fff', minWidth: 36 }
          : { color: '#6b4fa0', minWidth: 36 }}
      >
        All
      </Button>
      {LETTERS.map((l) => (
        <Button
          key={l}
          size="small"
          type={activeLetter === l ? 'primary' : 'text'}
          onClick={() => onChange(l)}
          disabled={disabled}
          style={activeLetter === l
            ? { background: '#2d1854', borderColor: '#2d1854', color: '#fff', minWidth: 28, padding: '0 6px' }
            : { color: '#6b4fa0', minWidth: 28, padding: '0 6px' }}
        >
          {l}
        </Button>
      ))}
    </Space>
  );
}
