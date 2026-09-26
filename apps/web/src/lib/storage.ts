import { projectFromJson, type Project } from '@tikzforge/graphic-ir';

const PROJECT_KEY = 'tikzforge.project.v1';
const SOURCE_KEY = 'tikzforge.source.v1';
const RECOVERY_KEY = 'tikzforge.recovery.v1';

export interface SavedSource {
  source: string;
  sourceMap: Record<string, { startOffset: number; endOffset: number }>;
}

export function saveProjectToLocalStorage(project: Project, source?: SavedSource): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  if (source) window.localStorage.setItem(SOURCE_KEY, JSON.stringify(source));
  else window.localStorage.removeItem(SOURCE_KEY);
}

/** The TikZ text saved with the project, so reloading keeps the user's formatting. */
export function loadSourceFromLocalStorage(project: Project): SavedSource | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const value = JSON.parse(
      window.localStorage.getItem(SOURCE_KEY) ?? 'null',
    ) as SavedSource | null;
    if (!value || typeof value.source !== 'string' || typeof value.sourceMap !== 'object')
      return undefined;
    const ids = new Set(project.elements.map((element) => element.id));
    const complete = project.elements.every(
      (element) => element.type === 'group' || value.sourceMap[element.id],
    );
    const inBounds = Object.entries(value.sourceMap).every(
      ([id, range]) => ids.has(id) && range.endOffset <= value.source.length,
    );
    return complete && inBounds ? value : undefined;
  } catch {
    return undefined;
  }
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
