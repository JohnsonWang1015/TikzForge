import { projectFromJson, type Project } from '@tikzforge/graphic-ir';

const PROJECT_KEY = 'tikzforge.project.v1';
const RECOVERY_KEY = 'tikzforge.recovery.v1';

export function saveProjectToLocalStorage(project: Project): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

export function loadProjectFromLocalStorage(): Project | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(PROJECT_KEY);
  if (!raw) return undefined;
  try {
    return projectFromJson(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

export function saveRecovery(project: Project): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    RECOVERY_KEY,
    JSON.stringify({ project, savedAt: new Date().toISOString() }),
  );
}

export function loadRecovery(): Project | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(RECOVERY_KEY);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { project?: unknown };
    return value.project ? projectFromJson(value.project) : undefined;
  } catch {
    return undefined;
  }
}
