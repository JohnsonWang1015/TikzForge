import {
  isEdgeElement,
  isNodeElement,
  type DiagramElement,
  type Project,
} from '@tikzforge/graphic-ir';
import type { SourceMap } from '@tikzforge/tikz-parser';
import { orderedElements, serializeElementSource, type SerializedProject } from './index';

interface Edit {
  start: number;
  end: number;
  text: string;
  /** Elements whose statement text starts at the given offset inside `text`. */
  placed: Array<{ id: string; offset: number; length: number }>;
}

function comparable(element: DiagramElement): string {
  const { sourceRange: _ignored, ...rest } = element;
  return JSON.stringify(rest);
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', offset - 1) + 1;
}

function lineEnd(source: string, offset: number): number {
  const end = source.indexOf('\n', offset);
  return end < 0 ? source.length : end;
}

function dependencies(element: DiagramElement): string[] {
  if (isEdgeElement(element)) return [element.from, element.to];
  if (isNodeElement(element) && element.position.mode === 'relative')
    return [element.position.target];
  return [];
}

/**
 * Rewrites only the statements of elements that changed between `previous` and `next`, so user
 * formatting and comments elsewhere survive canvas edits. Returns undefined when a precise patch
 * is not possible and the caller should serialize the whole picture instead.
 */
export function patchSource(
  source: string,
  sourceMap: SourceMap,
  previous: Project,
  next: Project,
): SerializedProject | undefined {
  if (
    previous.pictureOptions !== next.pictureOptions ||
    JSON.stringify(previous.documentWrapper) !== JSON.stringify(next.documentWrapper) ||
    previous.settings.pixelsPerCm !== next.settings.pixelsPerCm ||
    JSON.stringify(previous.settings.origin) !== JSON.stringify(next.settings.origin) ||
    JSON.stringify(previous.styles) !== JSON.stringify(next.styles)
  )
    return undefined;
  const previousById = new Map(previous.elements.map((element) => [element.id, element]));
  const nextIds = new Set(next.elements.map((element) => element.id));
  const validRange = (id: string) => {
    const range = sourceMap[id];
    return range && range.startOffset >= 0 && range.endOffset <= source.length ? range : undefined;
  };
  const edits: Edit[] = [];

  for (const element of previous.elements) {
    if (nextIds.has(element.id)) continue;
    const range = validRange(element.id);
    if (!range) return undefined;
    const from = lineStart(source, range.startOffset);
    const to = lineEnd(source, range.endOffset);
    const wholeLine =
      !source.slice(from, range.startOffset).trim() && !source.slice(range.endOffset, to).trim();
    edits.push(
      wholeLine
        ? { start: from, end: Math.min(source.length, to + 1), text: '', placed: [] }
        : { start: range.startOffset, end: range.endOffset, text: '', placed: [] },
    );
  }

  const inserted: DiagramElement[] = [];
  for (const element of next.elements) {
    const before = previousById.get(element.id);
    if (!before) {
      inserted.push(element);
      continue;
    }
    if (comparable(before) === comparable(element)) continue;
    const range = validRange(element.id);
    if (!range) return undefined;
    const indentation = source.slice(lineStart(source, range.startOffset), range.startOffset);
    const indent = /^\s*$/u.test(indentation) ? indentation : '  ';
    const text = serializeElementSource(element, next, { indent });
    edits.push({
      start: range.startOffset,
      end: range.endOffset,
      text,
      placed: [{ id: element.id, offset: 0, length: text.length }],
    });
  }

  if (inserted.length) {
    const endMatch = [...source.matchAll(/\\end\s*\{tikzpicture\}/gu)].at(-1);
    if (!endMatch) return undefined;
    const at = lineStart(source, endMatch.index);
    if (source.slice(at, endMatch.index).trim()) return undefined;
    const lastRange = next.elements
      .map((element) => validRange(element.id))
      .filter((range) => range !== undefined)
      .sort((a, b) => b.startOffset - a.startOffset)[0];
    const lastIndent = lastRange
      ? source.slice(lineStart(source, lastRange.startOffset), lastRange.startOffset)
      : '';
    const indent = lastIndent && /^\s*$/u.test(lastIndent) ? lastIndent : '  ';
    const insertedIds = new Set(inserted.map((element) => element.id));
    let text = '';
    const placed: Edit['placed'] = [];
    for (const element of orderedElements(next).filter((item) => insertedIds.has(item.id))) {
      const statement = serializeElementSource(element, next, { indent });
      placed.push({
        id: element.id,
        offset: text.length + indent.length,
        length: statement.length,
      });
      text += `${indent}${statement}\n`;
    }
    edits.push({ start: at, end: at, text, placed });
  }

  if (!edits.length) return { source, sourceMap: { ...sourceMap } };
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < edits.length; index += 1) {
    const previousEdit = edits[index - 1];
    const edit = edits[index];
    if (previousEdit && edit && edit.start < previousEdit.end) return undefined;
  }

  let patched = '';
  let cursor = 0;
  let delta = 0;
  const deltas: Array<{ end: number; delta: number }> = [];
  const nextMap: SourceMap = {};
  for (const edit of edits) {
    patched += source.slice(cursor, edit.start);
    const newStart = edit.start + delta;
    for (const item of edit.placed)
      nextMap[item.id] = {
        startOffset: newStart + item.offset,
        endOffset: newStart + item.offset + item.length,
      };
    patched += edit.text;
    cursor = edit.end;
    delta += edit.text.length - (edit.end - edit.start);
    deltas.push({ end: edit.end, delta });
  }
  patched += source.slice(cursor);

  for (const element of next.elements) {
    if (nextMap[element.id]) continue;
    const range = validRange(element.id);
    if (!range) {
      if (element.type === 'group') continue;
      return undefined;
    }
    const shift = deltas.filter((item) => item.end <= range.startOffset).at(-1)?.delta ?? 0;
    nextMap[element.id] = {
      startOffset: range.startOffset + shift,
      endOffset: range.endOffset + shift,
    };
  }

  // TikZ needs every referenced node defined earlier in the picture.
  for (const element of next.elements) {
    const start = nextMap[element.id]?.startOffset;
    if (start === undefined) continue;
    for (const dependency of dependencies(element)) {
      const dependencyStart = nextMap[dependency]?.startOffset;
      if (dependencyStart !== undefined && dependencyStart > start) return undefined;
    }
  }
  return { source: patched, sourceMap: nextMap };
}
