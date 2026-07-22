import { useState, useEffect, useCallback } from 'react';
import { getSelectedWorkspace, setSelectedWorkspace, onWorkspaceChange, type WorkspaceInfo } from '../store/WorkspaceStore';

export function useWorkspace() {
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(getSelectedWorkspace);

  useEffect(() => {
    return onWorkspaceChange((ws) => setWorkspaceState(ws));
  }, []);

  const setWorkspace = useCallback((ws: WorkspaceInfo | null) => {
    setSelectedWorkspace(ws);
  }, []);

  return { workspace, setWorkspace };
}
