import {
  isEdgeElement,
  isNodeElement,
  type DiagramElement,
  type GroupElement,
  type Project,
} from '@tikzforge/graphic-ir';
import type { ParseResult, SourceMap } from './index';

export interface ReconcileInput {
  /** The project that matched `previousSource`. */
  current: Project;
  currentMap: SourceMap;
  previousSource: string;
  /** Result of parsing `source`, the edited text. */
  parsed: ParseResult;
  source: string;
}

type Category = 'node' | 'edge' | 'plot' | 'raw' | 'group';

function category(element: DiagramElement): Category {
  if (isNodeElement(element)) return 'node';
  if (isEdgeElement(element)) return 'edge';
  if (element.type === 'raw-tikz') return 'raw';
  return element.type;
}

/**
 * Folds a fresh parse into the current project after a text edit. Unnamed statements keep the id
 * they had before (matched by position, or by endpoints for edges), IR-only state such as locks,
 * visibility and groups survives, and project metadata and settings are untouched.
 */
export function reconcileParsedProject({
  current,
  currentMap,
  previousSource,
  parsed,
  source,
}: ReconcileInput): { project: Project; sourceMap: SourceMap } {
  let prefix = 0;
  const limit = Math.min(previousSource.length, source.length);
  while (prefix < limit && previousSource[prefix] === source[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    previousSource[previousSource.length - 1 - suffix] === source[source.length - 1 - suffix]
  )
    suffix += 1;
  const delta = source.length - previousSource.length;
  const oldEditEnd = previousSource.length - suffix;
  const newEditEnd = source.length - suffix;
  const mapOffset = (offset: number): number | undefined =>
    offset <= prefix ? offset : offset >= oldEditEnd ? offset + delta : undefined;

  const generated = new Set(parsed.generatedIds);
  const namedIds = new Set(
    parsed.project.elements.map((element) => element.id).filter((id) => !generated.has(id)),
  );
  const candidates = current.elements.filter(
    (element) => element.type !== 'group' && !namedIds.has(element.id),
  );
  const claimed = new Set<string>();
  const renamed = new Map<string, string>();
  const matchOf = new Map<string, DiagramElement>();

  const take = (element: DiagramElement, match: DiagramElement | undefined) => {
    if (!match) return false;
    claimed.add(match.id);
    matchOf.set(element.id, match);
    if (match.id !== element.id) renamed.set(element.id, match.id);
    return true;
  };

  for (const element of parsed.project.elements) {
    if (!generated.has(element.id)) {
      const same = current.elements.find(
        (candidate) => candidate.id === element.id && category(candidate) === category(element),
      );
      if (same) {
        claimed.add(same.id);
        matchOf.set(element.id, same);
      }
    }
  }
  for (const element of parsed.project.elements) {
    if (!generated.has(element.id)) continue;
    const range = parsed.sourceMap[element.id];
    const kind = category(element);
    const open = candidates.filter(
      (candidate) => !claimed.has(candidate.id) && category(candidate) === kind,
    );
    const samePlace = open.find((candidate) => {
      const old = currentMap[candidate.id];
      return old && range && mapOffset(old.startOffset) === range.startOffset;
    });
    if (take(element, samePlace)) continue;
    if (isEdgeElement(element)) {
      const sameEnds = open.find(
        (candidate) =>
          isEdgeElement(candidate) &&
          candidate.from === element.from &&
          candidate.to === element.to,
      );
      if (take(element, sameEnds)) continue;
    }
    const edited =
      range && range.startOffset <= newEditEnd && range.endOffset >= prefix
        ? open.find((candidate) => {
            const old = currentMap[candidate.id];
            return old && old.startOffset <= oldEditEnd && old.endOffset >= prefix;
          })
        : undefined;
    take(element, edited);
  }

  const used = new Set<string>();
  const sourceMap: SourceMap = {};
  const elements = parsed.project.elements.map((element) => {
    let id = renamed.get(element.id) ?? element.id;
    if (used.has(id)) id = element.id;
    used.add(id);
    const range = parsed.sourceMap[element.id];
    if (range) sourceMap[id] = range;
    const match = matchOf.get(element.id);
    const merged = {
      ...element,
      id,
      ...(match
        ? { locked: match.locked, visible: match.visible, layer: match.layer, plugin: match.plugin }
        : {}),
    } as DiagramElement;
    if (merged.type === 'raw-tikz') merged.locked = true;
    if (merged.type === 'plot' && match?.type === 'plot') merged.style = match.style;
    return merged;
  });

  const ids = new Set(elements.map((element) => element.id));
  const groups = current.elements
    .filter((element): element is GroupElement => element.type === 'group')
    .map((group) => ({ ...group, children: group.children.filter((child) => ids.has(child)) }))
    .filter((group) => group.children.length > 0 && !ids.has(group.id));

  const project: Project = {
    ...current,
    elements: [...elements, ...groups],
    styles: parsed.project.styles,
    rawTikzBlocks: elements.filter((element) => element.type === 'raw-tikz'),
    pictureOptions: parsed.project.pictureOptions,
    documentWrapper: parsed.project.documentWrapper,
    metadata: { ...current.metadata, updatedAt: new Date().toISOString() },
  };
  if (!project.pictureOptions) delete project.pictureOptions;
  if (!project.documentWrapper) delete project.documentWrapper;
  return { project, sourceMap };
}
