const STORAGE_KEY = 'mxsuite_workspace';
const EVENT_NAME = 'mxsuite:workspace-changed';

export interface WorkspaceInfo {
  id: string;
  name: string;
}

export function getSelectedWorkspace(): WorkspaceInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return parsed as WorkspaceInfo;
    }
    return null;
  } catch {
    return null;
  }
}

export function setSelectedWorkspace(ws: WorkspaceInfo | null): void {
  if (ws) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: ws }));
}

export function onWorkspaceChange(cb: (ws: WorkspaceInfo | null) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail ?? null);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
