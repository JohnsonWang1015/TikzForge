'use client';

import { create } from 'zustand';
import {
  autoNodeSize,
  cloneProject,
  createArrow,
  createElementId,
  createNode,
  createPlot,
  createStarterProject,
  isNodeElement,
  AddElementCommand,
  BatchCommand,
  DeleteElementsCommand,
  UpdateElementCommand,
  type DiagramCommand,
  type NodeElement,
  type GroupElement,
  patchElement,
  projectFromJson,
  removeElements,
  resolveRelativePositions,
  snapValue,
  type DiagramElement,
  type EdgeElement,
  type Project,
  type PrimitiveNodeType,
  type Diagnostic,
} from '@tikzforge/graphic-ir';
import { parseTikz, reconcileParsedProject, type SourceMap } from '@tikzforge/tikz-parser';
import { patchSource, serializeProjectWithMap } from '@tikzforge/tikz-serializer';
import { imagePathAfterUpload, type UploadedImage } from '@/lib/image-upload';
import {
  loadProjectFromLocalStorage,
  loadSourceFromLocalStorage,
  saveProjectToLocalStorage,
  saveRecovery,
} from '@/lib/storage';

export interface HistoryEntry {
  project: Project;
  label: string;
  timestamp: string;
  command?: DiagramCommand;
}

interface ProjectState {
  project: Project;
  source: string;
  /** Where each element's statement sits in `mappedSource`. */
  sourceMap: SourceMap;
  /** The source text `project` and `sourceMap` describe; differs from `source` while typing. */
  mappedSource: string;
  diagnostics: Diagnostic[];
  selectedIds: string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastSavedAt?: string;
  setProject: (
    project: Project,
    label?: string,
    recordHistory?: boolean,
    command?: DiagramCommand,
  ) => void;
  /** Loads a different document (template, file, AI result); its TikZ is regenerated or given. */
  replaceProject: (
    project: Project,
    label: string,
    options?: { recordHistory?: boolean; source?: string; sourceMap?: SourceMap },
  ) => void;
  updateElement: (id: string, patch: Partial<DiagramElement>, label?: string) => void;
  updateElementTransient: (id: string, patch: Partial<DiagramElement>) => void;
  commitInteraction: (before: Project, label: string) => void;
  addNode: (type: PrimitiveNodeType) => void;
  addArrow: (from?: string, to?: string, type?: EdgeElement['type']) => void;
  addPlot: () => void;
  /** Embeds an uploaded picture in an image node, keeping its width and the picture's ratio. */
  applyImageUpload: (id: string, upload: UploadedImage) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  copySelected: () => string;
  pasteClipboard: (payload: string) => void;
  restoreHistory: (index: number) => void;
  select: (id: string, additive?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  moveSelected: (dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  setSource: (source: string) => void;
  applySource: () => void;
  resetDiagnostics: () => void;
  save: () => void;
  load: () => void;
}

/**
 * Keeps derived geometry consistent after any edit: nodes whose relative target disappeared become
 * absolute, relative nodes follow their targets, and auto-sized nodes fit their text.
 */
function normalize(project: Project): Project {
  const ids = new Set(project.elements.map((element) => element.id));
  let changed = false;
  const elements = project.elements.map((element) => {
    if (!isNodeElement(element)) return element;
    let next: NodeElement = element;
    if (next.position.mode === 'relative' && !ids.has(next.position.target))
      next = { ...next, position: { mode: 'absolute' } };
    if (next.sizeMode === 'auto' && next.type !== 'coordinate') {
      const shape = next.type === 'circle' || next.type === 'ellipse' ? next.type : 'rectangle';
      const size = autoNodeSize(shape, next.text, next.style);
      if (size.width !== next.width || size.height !== next.height) next = { ...next, ...size };
    }
    if (next !== element) changed = true;
    return next;
  });
  return resolveRelativePositions(changed ? { ...project, elements } : project).project;
}

/**
 * Moving or resizing a node on the canvas means it is no longer where its TikZ relation or text
 * would put it, so the patch pins it.
 */
function geometryPatch(
  element: DiagramElement,
  patch: Partial<DiagramElement>,
): Partial<DiagramElement> {
  if (!isNodeElement(element)) return patch;
  const next: Partial<NodeElement> = { ...(patch as Partial<NodeElement>) };
  if (('x' in patch || 'y' in patch) && element.position.mode === 'relative')
    next.position = { mode: 'absolute' };
  if (('width' in patch || 'height' in patch) && element.sizeMode === 'auto')
    next.sizeMode = 'fixed';
  return next as Partial<DiagramElement>;
}

const initialProject = createStarterProject();
const initialSerialized = serializeProjectWithMap(initialProject);

function historyEntry(project: Project, label: string, command?: DiagramCommand): HistoryEntry {
  return { project: cloneProject(project), label, timestamp: new Date().toISOString(), command };
}

export const useProjectStore = create<ProjectState>((set, get) => {
  /** TikZ for `next`: a minimal patch of the current text when possible, otherwise a rewrite. */
  function sourceAfter(next: Project): Pick<ProjectState, 'source' | 'sourceMap' | 'mappedSource'> {
    const state = get();
    const patched =
      state.source === state.mappedSource
        ? patchSource(state.source, state.sourceMap, state.project, next)
        : undefined;
    const serialized = patched ?? serializeProjectWithMap(next);
    return {
      source: serialized.source,
      sourceMap: serialized.sourceMap,
      mappedSource: serialized.source,
    };
  }

  function commit(next: Project, extra: Partial<ProjectState> = {}): void {
    const project = normalize(next);
    set({ ...sourceAfter(project), ...extra, project });
    saveRecovery(project);
  }

  return {
    project: initialProject,
    source: initialSerialized.source,
    sourceMap: initialSerialized.sourceMap,
    mappedSource: initialSerialized.source,
    diagnostics: [],
    selectedIds: [],
    past: [],
    future: [],
    setProject: (project, label = 'Update diagram', recordHistory = true, command) => {
      const current = get().project;
      commit(project, {
        diagnostics: [],
        past: recordHistory
          ? [...get().past, historyEntry(current, label, command)].slice(-100)
          : get().past,
        future: recordHistory ? [] : get().future,
      });
    },
    replaceProject: (project, label, options = {}) => {
      const current = get().project;
      const next = normalize(project);
      const serialized =
        options.source !== undefined && options.sourceMap
          ? { source: options.source, sourceMap: options.sourceMap }
          : serializeProjectWithMap(next);
      const recordHistory = options.recordHistory ?? true;
      set({
        project: next,
        source: serialized.source,
        sourceMap: serialized.sourceMap,
        mappedSource: serialized.source,
        diagnostics: [],
        selectedIds: [],
        past: recordHistory
          ? [...get().past, historyEntry(current, label)].slice(-100)
          : get().past,
        future: recordHistory ? [] : get().future,
      });
      saveRecovery(next);
    },
    updateElement: (id, patch, label = 'Change element') => {
      const current = get().project;
      const before = current.elements.find((element) => element.id === id);
      if (!before) return;
      const next = normalize(patchElement(current, id, geometryPatch(before, patch)));
      const after = next.elements.find((element) => element.id === id);
      get().setProject(
        next,
        label,
        true,
        after ? new UpdateElementCommand(label, before, after) : undefined,
      );
    },
    updateElementTransient: (id, patch) => {
      const current = get().project;
      const before = current.elements.find((element) => element.id === id);
      if (!before) return;
      commit(patchElement(current, id, geometryPatch(before, patch)));
    },
    commitInteraction: (before, label) => {
      const current = get().project;
      if (JSON.stringify(before) === JSON.stringify(current)) return;
      const commands = before.elements.flatMap((element) => {
        const after = current.elements.find((candidate) => candidate.id === element.id);
        return after && JSON.stringify(element) !== JSON.stringify(after)
          ? [new UpdateElementCommand(label, element, after)]
          : [];
      });
      const command = commands.length ? new BatchCommand(label, commands) : undefined;
      set({
        past: [...get().past, historyEntry(before, label, command)].slice(-100),
        future: [],
      });
      saveRecovery(current);
    },
    addNode: (type) => {
      const current = get().project;
      const ids = current.elements.map((element) => element.id);
      const selected = current.elements.find(
        (element): element is NodeElement =>
          get().selectedIds.includes(element.id) && isNodeElement(element),
      );
      const node = createNode(
        type,
        { x: selected ? selected.x + 30 : 300, y: selected ? selected.y + 30 : 160 },
        ids,
      );
      get().setProject(
        { ...current, elements: [...current.elements, node] },
        `Add ${type}`,
        true,
        new AddElementCommand(`Add ${type}`, node),
      );
      set({ selectedIds: [node.id] });
    },
    addArrow: (from, to, type = 'arrow') => {
      const current = get().project;
      const nodes = current.elements.filter(isNodeElement);
      const source =
        from ??
        get().selectedIds.find((id) => nodes.some((node) => node.id === id)) ??
        nodes[0]?.id;
      const target = to ?? nodes.find((node) => node.id !== source)?.id;
      if (!source || !target) return;
      const edge = createArrow(
        source,
        target,
        { type },
        current.elements.map((element) => element.id),
      );
      get().setProject(
        { ...current, elements: [...current.elements, edge] },
        'Add arrow',
        true,
        new AddElementCommand('Add arrow', edge),
      );
      set({ selectedIds: [edge.id] });
    },
    addPlot: () => {
      const current = get().project;
      const plot = createPlot(
        {},
        current.elements.map((element) => element.id),
      );
      get().setProject(
        { ...current, elements: [...current.elements, plot] },
        'Add plot',
        true,
        new AddElementCommand('Add plot', plot),
      );
      set({ selectedIds: [plot.id] });
    },
    applyImageUpload: (id, upload) => {
      const node = get().project.elements.find((element) => element.id === id);
      if (!node || node.type !== 'image') return;
      const ratio = upload.naturalWidth > 0 ? upload.naturalHeight / upload.naturalWidth : 1;
      get().updateElement(
        id,
        {
          href: upload.href,
          source: imagePathAfterUpload(node.source, upload),
          height: Math.max(20, Math.round(node.width * ratio)),
        },
        'Upload image',
      );
    },
    deleteSelected: () => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      const current = get().project;
      get().setProject(
        removeElements(current, ids),
        'Delete selection',
        true,
        new DeleteElementsCommand('Delete selection', current, ids),
      );
      set({ selectedIds: [] });
    },
    duplicateSelected: () => {
      const current = get().project;
      const selected = current.elements.filter((element) => get().selectedIds.includes(element.id));
      if (!selected.length) return;
      const ids = current.elements.map((element) => element.id);
      const replacements = new Map<string, string>();
      const duplicates = selected.map((element) => {
        const newId = createElementId(element.type === 'raw-tikz' ? 'raw' : element.type, [
          ...ids,
          ...replacements.values(),
        ]);
        replacements.set(element.id, newId);
        const clone = {
          ...cloneProject({ ...current, elements: [element] }).elements[0],
          id: newId,
        } as DiagramElement;
        if ('x' in clone) clone.x += 30;
        if ('y' in clone) clone.y += 30;
        if ('position' in clone) clone.position = { mode: 'absolute' };
        return clone;
      });
      const copiedEdges = duplicates
        .filter((element): element is EdgeElement => 'from' in element && 'to' in element)
        .map((edge) => ({
          ...edge,
          from: replacements.get(edge.from) ?? edge.from,
          to: replacements.get(edge.to) ?? edge.to,
        }));
      const nonEdges = duplicates.filter((element) => !('from' in element && 'to' in element));
      get().setProject(
        { ...current, elements: [...current.elements, ...nonEdges, ...copiedEdges] },
        'Duplicate selection',
        true,
      );
      set({ selectedIds: duplicates.map((element) => element.id) });
    },
    groupSelected: () => {
      const current = get().project;
      const children = get().selectedIds.filter((id) =>
        current.elements.some((element) => element.id === id),
      );
      if (children.length < 2) return;
      const groupId = createElementId(
        'group',
        current.elements.map((element) => element.id),
      );
      const group: DiagramElement = {
        id: groupId,
        type: 'group',
        name: 'Group',
        children,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        layer: 'nodes',
        visible: true,
        locked: false,
        rotation: 0,
      };
      get().setProject(
        { ...current, elements: [...current.elements, group] },
        'Group selection',
        true,
      );
      set({ selectedIds: [groupId] });
    },
    ungroupSelected: () => {
      const current = get().project;
      const groups = current.elements.filter(
        (element): element is GroupElement =>
          get().selectedIds.includes(element.id) && element.type === 'group',
      );
      if (!groups.length) return;
      const groupIds = new Set(groups.map((group) => group.id));
      const children = groups.flatMap((group) => group.children);
      get().setProject(
        { ...current, elements: current.elements.filter((element) => !groupIds.has(element.id)) },
        'Ungroup selection',
        true,
      );
      set({ selectedIds: children });
    },
    copySelected: () =>
      JSON.stringify({
        type: 'latex-diagram-elements',
        elements: get().project.elements.filter((element) =>
          get().selectedIds.includes(element.id),
        ),
      }),
    pasteClipboard: (payload) => {
      try {
        const parsed = JSON.parse(payload) as { type?: string; elements?: DiagramElement[] };
        if (parsed.type !== 'latex-diagram-elements' || !Array.isArray(parsed.elements)) return;
        const current = get().project;
        const ids = current.elements.map((element) => element.id);
        const replacements = new Map<string, string>();
        const duplicates = parsed.elements
          .map((element) => {
            const id = createElementId(element.type === 'raw-tikz' ? 'raw' : element.type, [
              ...ids,
              ...replacements.values(),
            ]);
            replacements.set(element.id, id);
            const duplicate = { ...element, id } as DiagramElement;
            if ('x' in duplicate) duplicate.x += 40;
            if ('y' in duplicate) duplicate.y += 40;
            if ('position' in duplicate) duplicate.position = { mode: 'absolute' };
            return duplicate;
          })
          .map((element) =>
            'from' in element && 'to' in element
              ? {
                  ...element,
                  from: replacements.get(element.from) ?? element.from,
                  to: replacements.get(element.to) ?? element.to,
                }
              : element,
          );
        get().setProject(
          { ...current, elements: [...current.elements, ...duplicates] },
          'Paste elements',
          true,
        );
        set({ selectedIds: duplicates.map((element) => element.id) });
      } catch {
        // Clipboard contents are user input; invalid payloads are intentionally ignored.
      }
    },
    restoreHistory: (index) => {
      const entry = get().past[index];
      if (!entry) return;
      const current = get().project;
      const future = [...get().future, historyEntry(current, 'Return to current state')];
      const remaining = get().past.slice(0, index);
      commit(cloneProject(entry.project), { diagnostics: [], past: remaining, future });
    },
    select: (id, additive = false) =>
      set({
        selectedIds: additive
          ? get().selectedIds.includes(id)
            ? get().selectedIds.filter((selected) => selected !== id)
            : [...get().selectedIds, id]
          : [id],
      }),
    selectAll: () =>
      set({
        selectedIds: get()
          .project.elements.filter((element) => element.type !== 'raw-tikz')
          .map((element) => element.id),
      }),
    clearSelection: () => set({ selectedIds: [] }),
    moveSelected: (dx, dy) => {
      const current = get().project;
      const ids = new Set(get().selectedIds);
      const snap = current.settings.snap;
      const grid = current.settings.gridSize;
      const elements = current.elements.map((element) => {
        if (!ids.has(element.id) || !('x' in element) || !('y' in element)) return element;
        return {
          ...element,
          ...geometryPatch(element, {
            x: snapValue(element.x + dx, grid, snap),
            y: snapValue(element.y + dy, grid, snap),
          }),
        } as DiagramElement;
      });
      get().setProject({ ...current, elements }, 'Move selection', true);
    },
    undo: () => {
      const past = get().past;
      const previous = past.at(-1);
      if (!previous) return;
      const current = get().project;
      const project = previous.command ? previous.command.undo(current) : previous.project;
      commit(cloneProject(project), {
        diagnostics: [],
        past: past.slice(0, -1),
        future: [...get().future, historyEntry(current, previous.label, previous.command)],
      });
    },
    redo: () => {
      const next = get().future.at(-1);
      if (!next) return;
      const current = get().project;
      const project = next.command ? next.command.execute(current) : next.project;
      commit(cloneProject(project), {
        diagnostics: [],
        future: get().future.slice(0, -1),
        past: [...get().past, historyEntry(current, next.label, next.command)],
      });
    },
    setSource: (source) => set({ source }),
    applySource: () => {
      const state = get();
      const source = state.source;
      const parsed = parseTikz(source, {
        pixelsPerCm: state.project.settings.pixelsPerCm,
        origin: state.project.settings.origin,
      });
      if (!parsed.valid) {
        set({ diagnostics: parsed.diagnostics });
        return;
      }
      const reconciled = reconcileParsedProject({
        current: state.project,
        currentMap: state.sourceMap,
        previousSource: state.mappedSource,
        parsed,
        source,
      });
      const ids = new Set(reconciled.project.elements.map((element) => element.id));
      const drawing = (project: Project) =>
        JSON.stringify([
          project.elements.map((element) => ({ ...element, sourceRange: undefined })),
          project.styles,
          project.pictureOptions,
        ]);
      const drawingChanged = drawing(reconciled.project) !== drawing(state.project);
      set({
        project: reconciled.project,
        sourceMap: reconciled.sourceMap,
        mappedSource: source,
        diagnostics: parsed.diagnostics,
        selectedIds: state.selectedIds.filter((id) => ids.has(id)),
        ...(drawingChanged
          ? {
              past: [...state.past, historyEntry(state.project, 'Edit TikZ source')].slice(-100),
              future: [],
            }
          : {}),
      });
      saveRecovery(reconciled.project);
    },
    resetDiagnostics: () => set({ diagnostics: [] }),
    save: () => {
      const { project, mappedSource, sourceMap } = get();
      if (saveProjectToLocalStorage(project, { source: mappedSource, sourceMap }))
        set({ lastSavedAt: new Date().toISOString() });
    },
    load: () => {
      const loaded = loadProjectFromLocalStorage();
      if (!loaded) return;
      const project = projectFromJson(loaded);
      const saved = loadSourceFromLocalStorage(project);
      get().replaceProject(project, 'Load project', {
        recordHistory: false,
        source: saved?.source,
        sourceMap: saved?.sourceMap,
      });
    },
  };
});
