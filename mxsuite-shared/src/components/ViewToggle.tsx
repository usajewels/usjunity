import React, { useState, useCallback } from 'react';
import { Segmented } from 'antd';
import { AppstoreOutlined, UnorderedListOutlined } from '@ant-design/icons';

export type ViewMode = 'cards' | 'table';

const STORAGE_KEY_PREFIX = 'mxsuite_viewmode_';

export function useViewMode(key: string, defaultMode: ViewMode = 'cards'): [ViewMode, (mode: ViewMode) => void] {
  const storageKey = STORAGE_KEY_PREFIX + key;
  const [mode, setModeState] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(storageKey);
    return (stored === 'cards' || stored === 'table') ? stored : defaultMode;
  });

  const setMode = useCallback((newMode: ViewMode) => {
    setModeState(newMode);
    localStorage.setItem(storageKey, newMode);
  }, [storageKey]);

  return [mode, setMode];
}

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ mode, onChange }: ViewToggleProps) {
  return (
    <Segmented
      value={mode}
      onChange={(val) => onChange(val as ViewMode)}
      options={[
        { value: 'cards', icon: <AppstoreOutlined /> },
        { value: 'table', icon: <UnorderedListOutlined /> },
      ]}
      size="middle"
    />
  );
}
