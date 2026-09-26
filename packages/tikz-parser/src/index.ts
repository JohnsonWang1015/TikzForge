import {
  applyStyleDefinition,
  autoNodeSize,
  colorFromTikz,
  createArrow,
  createElementId,
  createEmptyProject,
  createNode,
  createPlot,
  isEdgeElement,
  isImagePath,
  isNodeElement,
  nodeAnchorPoint,
  parseTikzColor,
  PT_PER_CM,
  ptToPx,
  relativePlacement,
  resolveStyleRefs,
  tikzToCanvasPoint,
  validateProject,
  DEFAULT_ORIGIN,
  DEFAULT_PIXELS_PER_CM,
  type Diagnostic,
  type DiagramElement,
  type EdgeElement,
  type NodeElement,
  type NodeStyle,
  type PlotElement,
  type Point,
  type PreviewPath,
  type PreviewShape,
  type Project,
  type RawTikzBlock,
  type RelativePosition,
  type SourceRange,
  type TikzStyleDefinition,
} from '@tikzforge/graphic-ir';
import type {
  TikzDocumentAst,
  TikzOption,
  TikzStatement,
  TikzStatementKind,
} from '@tikzforge/tikz-ast';
import { evaluateExpression } from './expression';
import { lex } from './lexer';
import {
  arrowStyleForTip,
  lengthToCm,
  mirrorArrowSpec,
  parseArrowSpec,
  parseFontOption,
  parseLineWidth,
} from './vocabulary';

export { lex } from './lexer';
export { evaluateExpression } from './expression';
export * from './vocabulary';
export { reconcileParsedProject, type ReconcileInput } from './reconcile';
export type { TikzDocumentAst, TikzToken } from '@tikzforge/tikz-ast';

/** Element id → offsets of the statement that produced it, including its terminating `;`. */
export type SourceMap = Record<string, { startOffset: number; endOffset: number }>;

export interface ParseResult {
  ast: TikzDocumentAst;
  project: Project;
  diagnostics: Diagnostic[];
  valid: boolean;
  sourceMap: SourceMap;
  /** Ids the parser invented because the statement had no TikZ name. */
  generatedIds: string[];
}

export interface ParseOptions {
  pixelsPerCm?: number;
  origin?: Point;
}

interface Settings {
  pixelsPerCm: number;
  origin: Point;
}

interface Context {
  source: string;
  settings: Settings;
  styles: Record<string, TikzStyleDefinition>;
  nodeDistance: { vertical: number; horizontal: number };
  diagnostics: Diagnostic[];
  /** Real IR nodes and nodes that only exist inside raw blocks (loops, scopes), by name. */
  nodes: Map<string, NodeElement>;
  /** Names of nodes that are editable IR elements (not previews). */
  irNodes: Set<string>;
  /** Names defined by raw TikZ we could not place, e.g. `\path ... node (A)` or matrix cells. */
  externalNames: Set<string>;
  externalPrefixes: string[];
  usedIds: Set<string>;
  generatedIds: string[];
  /** Nested loop/scope expansion depth; diagnostics are dropped inside previews. */
  depth: number;
  previewBudget: { remaining: number };
}

interface Slice {
  start: number;
  end: number;
  terminated: boolean;
}

interface Outcome {
  kind: TikzStatementKind;
  command?: string;
  options: TikzOption[];
  elements: DiagramElement[];
  raw?: { reason: string; preview?: PreviewShape[] };
}

const PATH_COMMANDS = new Set([
  'node',
  'coordinate',
  'draw',
  'path',
  'fill',
  'filldraw',
  'clip',
  'shade',
  'shadedraw',
  'pattern',
  'pic',
  'matrix',
  'graph',
  'useasboundingbox',
  'scoped',
  'datavisualization',
  'calendar',
  'chainin',
]);

const RELATIONS = [
  'above left',
  'above right',
  'below left',
  'below right',
  'above',
  'below',
  'left',
  'right',
];

const MAX_PREVIEW_SHAPES = 500;
const MAX_LOOP_ITEMS = 200;

// ---------------------------------------------------------------------------------------------
// Scanning helpers

/** Blanks out `%` comments (keeping offsets and newlines) so they never affect parsing. */
function maskComments(source: string): string {
  let masked = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (character === '\\') {
      masked += character + (source[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (character === '%') {
      while (index < source.length && source[index] !== '\n') {
        masked += ' ';
        index += 1;
      }
      if (index < source.length) masked += '\n';
      continue;
    }
    masked += character;
  }
  return masked;
}

function skipWhitespace(text: string, start: number, end = text.length): number {
  let index = start;
  while (index < end && /\s/u.test(text[index] ?? '')) index += 1;
  return index;
}

/** Index just past the group that opens at `start`, honouring TeX escapes and nested braces. */
function readGroup(text: string, start: number, open: string, close: string): number | undefined {
  if (text[start] !== open) return undefined;
  let depth = 0;
  let braces = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (open !== '{') {
      if (character === '{') {
        braces += 1;
        continue;
      }
      if (character === '}') {
        braces = Math.max(0, braces - 1);
        continue;
      }
      if (braces > 0) continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

function depthZeroIndex(text: string, target: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') depth += 1;
    else if (character === '}' || character === ']' || character === ')')
      depth = Math.max(0, depth - 1);
    else if (character === target && depth === 0) return index;
  }
  return -1;
}

function splitDepthZero(text: string, separator: string): string[] {
  const parts: string[] = [];
  let rest = text;
  for (;;) {
    const index = depthZeroIndex(rest, separator);
    if (index < 0) {
      parts.push(rest);
      return parts;
    }
    parts.push(rest.slice(0, index));
    rest = rest.slice(index + 1);
  }
}

function stripBraces(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && readGroup(trimmed, 0, '{', '}') === trimmed.length)
    return trimmed.slice(1, -1).trim();
  return trimmed;
}

function lineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, offset));
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1) + 1,
  };
}

function sourceRange(source: string, start: number, end: number): SourceRange {
  return { startOffset: start, endOffset: end, ...lineColumn(source, start) };
}

function report(
  ctx: Context,
  message: string,
  offset: number,
  severity: Diagnostic['severity'] = 'error',
  code?: string,
  suggestion?: string,
): void {
  if (ctx.depth > 0) return;
  ctx.diagnostics.push({
    severity,
    message,
    ...lineColumn(ctx.source, offset),
    code,
    suggestion,
  });
}

function pad(index: number): string {
  return String(index + 1).padStart(2, '0');
}

function claimId(ctx: Context, preferred: string, prefix: string): string {
  const id = ctx.usedIds.has(preferred) ? createElementId(prefix, ctx.usedIds) : preferred;
  ctx.usedIds.add(id);
  ctx.generatedIds.push(id);
  return id;
}

// ---------------------------------------------------------------------------------------------
// Options

function parseOptionList(ctx: Context, content: string, offset: number): TikzOption[] {
  const options: TikzOption[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= content.length; index += 1) {
    const character = content[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') depth += 1;
    if (character === '}' || character === ']' || character === ')') depth = Math.max(0, depth - 1);
    if ((character === ',' && depth === 0) || index >= content.length) {
      const segment = content.slice(start, index);
      const raw = segment.trim();
      if (raw) {
        const equals = depthZeroIndex(raw, '=');
        const leading = segment.length - segment.trimStart().length;
        options.push({
          key: (equals >= 0 ? raw.slice(0, equals) : raw).trim(),
          value: equals >= 0 ? raw.slice(equals + 1).trim() : undefined,
          raw,
          range: sourceRange(
            ctx.source,
            offset + start + leading,
            offset + start + leading + raw.length,
          ),
        });
      }
      start = index + 1;
    }
  }
  return options;
}

function relationDistance(
  ctx: Context,
  relation: string,
  distances: string | undefined,
): number | undefined {
  const vertical = relation.includes('above') || relation.includes('below');
  if (!distances) return vertical ? ctx.nodeDistance.vertical : ctx.nodeDistance.horizontal;
  const [first, second] = distances.split(/\s+and\s+/u);
  const value = lengthToCm(vertical || second === undefined ? first : second);
  return value;
}

function setNodeDistance(ctx: Context, value: string | undefined): void {
  const [first, second] = (value ?? '').split(/\s+and\s+/u);
  const vertical = lengthToCm(first);
  const horizontal = lengthToCm(second ?? first);
  if (vertical !== undefined) ctx.nodeDistance.vertical = vertical;
  if (horizontal !== undefined) ctx.nodeDistance.horizontal = horizontal;
}

/** Applies one appearance option to a style definition; false when the key is not appearance. */
function applyAppearanceOption(
  ctx: Context,
  definition: TikzStyleDefinition,
  key: string,
  value: string | undefined,
): boolean {
  const pixelsPerCm = ctx.settings.pixelsPerCm;
  if (key === 'draw') {
    if (value === 'none') definition.draw = false;
    else {
      definition.draw = true;
      if (value) definition.stroke = colorFromTikz(value);
    }
    return true;
  }
  if (key === 'fill') {
    definition.fill = value ? colorFromTikz(value) : 'black';
    return true;
  }
  if (key === 'color' && value) {
    definition.stroke = colorFromTikz(value);
    definition.textColor = colorFromTikz(value);
    return true;
  }
  if (key === 'text' && value) {
    definition.textColor = colorFromTikz(value);
    return true;
  }
  if (key === 'rounded corners') {
    definition.rounded = true;
    return true;
  }
  if (key === 'sharp corners') {
    definition.rounded = false;
    return true;
  }
  if (/^(?:(?:densely|loosely) )?(?:dashed|dotted)$/u.test(key)) {
    definition.dashed = true;
    return true;
  }
  if (key === 'solid') {
    definition.dashed = false;
    return true;
  }
  const lineWidth = parseLineWidth(key, value, pixelsPerCm);
  if (lineWidth !== undefined) {
    definition.lineWidth = lineWidth;
    return true;
  }
  if (key === 'font' && value !== undefined) {
    const font = parseFontOption(value, pixelsPerCm);
    const understood = value.replace(
      /\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|bfseries|bf|selectfont)\b|\\fontsize\s*\{[^}]*\}\s*\{[^}]*\}|[{}\s]/gu,
      '',
    );
    if (understood) return false;
    if (font.fontSize !== undefined) definition.fontSize = font.fontSize;
    definition.fontWeight = font.bold ? 'bold' : 'normal';
    return true;
  }
  if (key === 'text width' && value) {
    const width = lengthToCm(value);
    if (width === undefined) return false;
    definition.textWidth = width * pixelsPerCm;
    return true;
  }
  if (key === 'align' && value) {
    const align = value.replace(/^flush\s+/u, '');
    if (align !== 'left' && align !== 'center' && align !== 'right') return false;
    definition.align = align;
    return true;
  }
  if (key === 'minimum width' || key === 'minimum height' || key === 'minimum size') {
    const size = lengthToCm(value);
    if (size === undefined) return false;
    if (key !== 'minimum height') definition.minimumWidth = size * pixelsPerCm;
    if (key !== 'minimum width') definition.minimumHeight = size * pixelsPerCm;
    return true;
  }
  if ((key === 'circle' || key === 'ellipse' || key === 'rectangle') && value === undefined) {
    definition.shape = key;
    return true;
  }
  if (key === 'shape' && (value === 'circle' || value === 'ellipse' || value === 'rectangle')) {
    definition.shape = value;
    return true;
  }
  if (value === undefined && parseArrowSpec(key)) {
    definition.arrowSpec = key;
    return true;
  }
  if (value === undefined && parseTikzColor(key)) {
    definition.stroke = key;
    definition.textColor = key;
    return true;
  }
  return false;
}

function styleDefinitionFromOptions(
  ctx: Context,
  options: TikzOption[],
  visiting: Set<string> = new Set(),
): TikzStyleDefinition {
  const definition: TikzStyleDefinition = {};
  for (const option of options) {
    const inherited = option.value === undefined ? ctx.styles[option.key] : undefined;
    if (inherited && !visiting.has(option.key)) {
      Object.assign(definition, inherited);
      continue;
    }
    applyAppearanceOption(ctx, definition, option.key, option.value);
  }
  return definition;
}

/** Reads `name/.style={...}`, `every node/.style` and `node distance` from an option list. */
function registerStyles(ctx: Context, options: TikzOption[]): void {
  for (const option of options) {
    const style = /^(.+?)\s*\/\.(style|append style)$/u.exec(option.key);
    if (style?.[1] && option.value !== undefined) {
      const name = style[1].trim();
      const body = stripBraces(option.value);
      const definition = styleDefinitionFromOptions(
        ctx,
        parseOptionList(ctx, body, option.range.startOffset),
        new Set([name]),
      );
      ctx.styles[name] =
        style[2] === 'append style' ? { ...(ctx.styles[name] ?? {}), ...definition } : definition;
      continue;
    }
    if (option.key === 'node distance') setNodeDistance(ctx, option.value);
  }
}

interface NodeOptions {
  refs: string[];
  definition: TikzStyleDefinition;
  extras: string[];
  relative?: { relation: RelativePosition['relation']; target: string; distance: number };
}

function interpretNodeOptions(ctx: Context, options: TikzOption[]): NodeOptions {
  const result: NodeOptions = { refs: [], definition: {}, extras: [] };
  let distanceOverride: string | undefined;
  for (const option of options) {
    if (option.value === undefined && ctx.styles[option.key]) {
      result.refs.push(option.key);
      continue;
    }
    if (option.key === 'node distance') {
      distanceOverride = option.value;
      continue;
    }
    if (RELATIONS.includes(option.key) && option.value) {
      const match = /^(?:(.+?)\s+)?of\s+(.+)$/u.exec(option.value.trim());
      if (match?.[2]) {
        const target = match[2].trim().replace(/\.[^.]+$/u, '');
        result.relative = {
          relation: option.key as RelativePosition['relation'],
          target,
          distance: relationDistance(ctx, option.key, match[1]) ?? 1,
        };
        continue;
      }
    }
    if (!applyAppearanceOption(ctx, result.definition, option.key, option.value))
      result.extras.push(option.raw);
  }
  if (distanceOverride !== undefined && result.relative) {
    const saved = { ...ctx.nodeDistance };
    setNodeDistance(ctx, distanceOverride);
    result.relative.distance = relationDistance(ctx, result.relative.relation, undefined) ?? 1;
    ctx.nodeDistance = saved;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Coordinates

type CoordinateSpec =
  { kind: 'point'; point: Point } | { kind: 'ref'; id: string; anchor?: string };

function coordinateNumber(value: string): number | undefined {
  const text = stripBraces(value);
  return lengthToCm(text) ?? evaluateExpression(text);
}

function parseCoordinateSpec(content: string): CoordinateSpec | undefined {
  const text = content.trim();
  if (!text || text.startsWith('$')) return undefined;
  const colon = depthZeroIndex(text, ':');
  if (colon >= 0) {
    const angle = evaluateExpression(stripBraces(text.slice(0, colon)));
    const radius = coordinateNumber(text.slice(colon + 1));
    if (angle === undefined || radius === undefined) return undefined;
    const radians = (angle * Math.PI) / 180;
    return {
      kind: 'point',
      point: { x: radius * Math.cos(radians), y: radius * Math.sin(radians) },
    };
  }
  const comma = depthZeroIndex(text, ',');
  if (comma >= 0) {
    const x = coordinateNumber(text.slice(0, comma));
    const y = coordinateNumber(text.slice(comma + 1));
    return x === undefined || y === undefined ? undefined : { kind: 'point', point: { x, y } };
  }
  const reference = /^([\w][\w :-]*?)(?:\.([\w ]+|-?\d+(?:\.\d+)?))?$/u.exec(text);
  if (!reference?.[1]) return undefined;
  return { kind: 'ref', id: reference[1].trim(), anchor: reference[2]?.trim() };
}

function lookupNode(ctx: Context, id: string): NodeElement | undefined {
  return ctx.nodes.get(id);
}

function isKnownExternal(ctx: Context, id: string): boolean {
  return (
    ctx.externalNames.has(id) ||
    ctx.externalPrefixes.some((prefix) => new RegExp(`^${prefix}-\\d+-\\d+$`, 'u').test(id))
  );
}

function canvasPoint(ctx: Context, spec: CoordinateSpec): Point | undefined {
  if (spec.kind === 'point') return tikzToCanvasPoint(spec.point, ctx.settings);
  const node = lookupNode(ctx, spec.id);
  return node ? nodeAnchorPoint(node, spec.anchor) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Statement slicing

function findTerminator(text: string, from: number, to: number): Omit<Slice, 'start'> {
  let braces = 0;
  let brackets = 0;
  for (let index = from; index < to; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '{') braces += 1;
    else if (character === '}') braces = Math.max(0, braces - 1);
    else if (character === '[' && braces === 0) brackets += 1;
    else if (character === ']' && braces === 0) brackets = Math.max(0, brackets - 1);
    else if (character === ';' && braces === 0 && brackets === 0)
      return { end: index + 1, terminated: true };
  }
  return { end: to, terminated: false };
}

function findEnvironmentEnd(
  text: string,
  from: number,
  to: number,
  name: string,
): { start: number; end: number } | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(`\\\\(begin|end)\\s*\\{${escaped}\\}`, 'gu');
  pattern.lastIndex = from;
  let depth = 0;
  for (let match = pattern.exec(text); match && match.index < to; match = pattern.exec(text)) {
    if (match[1] === 'begin') depth += 1;
    else {
      depth -= 1;
      if (depth === 0) return { start: match.index, end: match.index + match[0].length };
    }
  }
  return undefined;
}

const FOREACH_HEADER =
  /^\\foreach\s*(\\[A-Za-z]+(?:\s*\/\s*\\[A-Za-z]+)*)\s*(?:\[([^\]]*)\])?\s*in\s*/u;

function findForeachEnd(text: string, from: number, to: number): Omit<Slice, 'start'> {
  const header = FOREACH_HEADER.exec(text.slice(from, to));
  if (!header) return findTerminator(text, from, to);
  const listStart = from + header[0].length;
  const listEnd =
    text[listStart] === '{'
      ? readGroup(text, listStart, '{', '}')
      : (/^\\[A-Za-z@]+/u.exec(text.slice(listStart))?.[0]?.length ?? 0) + listStart;
  if (listEnd === undefined || listEnd === listStart) return findTerminator(text, from, to);
  const bodyStart = skipWhitespace(text, listEnd, to);
  if (text[bodyStart] === '{') {
    const bodyEnd = readGroup(text, bodyStart, '{', '}');
    if (bodyEnd === undefined || bodyEnd > to) return { end: to, terminated: false };
    const after = skipWhitespace(text, bodyEnd, to);
    return text[after] === ';'
      ? { end: after + 1, terminated: true }
      : { end: bodyEnd, terminated: true };
  }
  if (text.startsWith('\\foreach', bodyStart)) return findForeachEnd(text, bodyStart, to);
  return findTerminator(text, bodyStart, to);
}

function findMacroEnd(text: string, from: number, to: number, name: string): Omit<Slice, 'start'> {
  let index = from + 1 + name.length;
  if (/^[gex]?def$/u.test(name)) {
    const target = skipWhitespace(text, index, to);
    const token = /^\\(?:[A-Za-z@]+|.)/u.exec(text.slice(target, to))?.[0];
    index = target + (token?.length ?? 0);
    while (index < to && text[index] !== '{') index += 1;
  }
  for (;;) {
    const next = skipWhitespace(text, index, to);
    const character = text[next];
    if (character === '{' || character === '[') {
      const end = readGroup(text, next, character, character === '{' ? '}' : ']');
      if (end === undefined || end > to) return { end: to, terminated: false };
      index = end;
      continue;
    }
    if (character === '=') {
      const value = skipWhitespace(text, next + 1, to);
      if (text[value] === '[' || text[value] === '{') {
        index = value;
        continue;
      }
    }
    break;
  }
  const after = skipWhitespace(text, index, to);
  return text[after] === ';'
    ? { end: after + 1, terminated: true }
    : { end: index, terminated: true };
}

function sliceStatements(text: string, from: number, to: number): Slice[] {
  const slices: Slice[] = [];
  let index = from;
  while (index < to) {
    index = skipWhitespace(text, index, to);
    if (index >= to) break;
    const head = text.slice(index, Math.min(to, index + 160));
    const environment = /^\\begin\s*\{([^}]+)\}/u.exec(head)?.[1];
    let result: Omit<Slice, 'start'>;
    if (environment) {
      const end = findEnvironmentEnd(text, index, to, environment);
      result = end ? { end: end.end, terminated: true } : { end: to, terminated: false };
    } else {
      const command = /^\\([A-Za-z@]+)/u.exec(head)?.[1];
      if (command === 'foreach') result = findForeachEnd(text, index, to);
      else if (command && PATH_COMMANDS.has(command)) result = findTerminator(text, index, to);
      else if (command) result = findMacroEnd(text, index, to, command);
      else result = findTerminator(text, index, to);
    }
    if (result.end <= index) result = { end: index + 1, terminated: false };
    slices.push({ start: index, ...result });
    index = result.end;
  }
  return slices;
}

// ---------------------------------------------------------------------------------------------
// Nodes

function statementBodyEnd(text: string, slice: Slice): number {
  return slice.terminated && text[slice.end - 1] === ';' ? slice.end - 1 : slice.end;
}

function rawOutcome(kind: TikzStatementKind, command: string | undefined, reason: string): Outcome {
  return { kind, command, options: [], elements: [], raw: { reason } };
}

function nodeSize(
  shape: NonNullable<TikzStyleDefinition['shape']>,
  text: string,
  style: NodeStyle,
  minimumWidth: number | undefined,
  minimumHeight: number | undefined,
): { width: number; height: number } {
  const auto = autoNodeSize(shape, text, style);
  if (shape === 'circle') {
    const size = Math.max(auto.width, minimumWidth ?? 0, minimumHeight ?? 0);
    return { width: size, height: size };
  }
  return {
    width: Math.max(auto.width, minimumWidth ?? 0),
    height: Math.max(auto.height, minimumHeight ?? 0),
  };
}

interface ImageContent {
  path: string;
  width: number;
  height: number;
}

/**
 * `\includegraphics[width=…,height=…]{file}` node text becomes an image node. Other graphics
 * options or a missing dimension would not survive re-serialization, so those stay text.
 */
function imageContent(ctx: Context, content: string): ImageContent | undefined {
  const match = /^\\includegraphics\s*(?:\[([^[\]]*)\])?\s*\{([^{}]*)\}$/u.exec(content);
  const path = match?.[2];
  if (!match || !isImagePath(path)) return undefined;
  const size: { width?: number; height?: number } = {};
  for (const option of splitDepthZero(match[1] ?? '', ',')) {
    if (!option.trim()) continue;
    const [key = '', value] = option.split('=').map((part) => part.trim());
    const length = /[a-z]\s*$/iu.test(value ?? '') ? lengthToCm(value) : undefined;
    if ((key !== 'width' && key !== 'height') || length === undefined || length <= 0)
      return undefined;
    size[key] = length * ctx.settings.pixelsPerCm;
  }
  if (size.width === undefined || size.height === undefined) return undefined;
  return { path, width: size.width, height: size.height };
}

function parseNodeStatement(
  ctx: Context,
  text: string,
  slice: Slice,
  command: 'node' | 'coordinate',
  index: number,
): Outcome {
  const bodyEnd = statementBodyEnd(text, slice);
  const options: TikzOption[] = [];
  let name: string | undefined;
  let at: CoordinateSpec | undefined;
  let content: string | undefined;
  let cursor = slice.start + 1 + command.length;
  while (cursor < bodyEnd) {
    cursor = skipWhitespace(text, cursor, bodyEnd);
    if (cursor >= bodyEnd) break;
    const character = text[cursor];
    if (character === '[') {
      const end = readGroup(text, cursor, '[', ']');
      if (end === undefined || end > bodyEnd) {
        report(
          ctx,
          'Unclosed TikZ option list.',
          cursor,
          'error',
          'TIKZ_UNCLOSED_OPTIONS',
          'Add a closing ]',
        );
        return { kind: command, command, options, elements: [] };
      }
      options.push(...parseOptionList(ctx, text.slice(cursor + 1, end - 1), cursor + 1));
      cursor = end;
      continue;
    }
    if (character === '(' && name === undefined && content === undefined) {
      const end = readGroup(text, cursor, '(', ')');
      const inner = end === undefined ? '' : text.slice(cursor + 1, end - 1).trim();
      if (end === undefined || !inner || /[,:$]/u.test(inner))
        return rawOutcome(command, command, 'Node name is not a plain identifier');
      name = inner;
      cursor = end;
      continue;
    }
    if (text.startsWith('at', cursor) && /[\s(]/u.test(text[cursor + 2] ?? '') && !at) {
      const open = skipWhitespace(text, cursor + 2, bodyEnd);
      const end = readGroup(text, open, '(', ')');
      const spec =
        end === undefined ? undefined : parseCoordinateSpec(text.slice(open + 1, end - 1));
      if (end === undefined || !spec)
        return rawOutcome(command, command, 'Unsupported node position');
      at = spec;
      cursor = end;
      continue;
    }
    if (character === '{' && command === 'node') {
      const end = readGroup(text, cursor, '{', '}');
      if (end === undefined || end > bodyEnd) {
        report(ctx, 'Unbalanced braces in node text.', cursor, 'error', 'TIKZ_UNBALANCED');
        return { kind: command, command, options, elements: [] };
      }
      content = text.slice(cursor + 1, end - 1).trim();
      cursor = skipWhitespace(text, end, bodyEnd);
      if (cursor < bodyEnd)
        return rawOutcome(command, command, 'Node is followed by edges, children or more nodes');
      break;
    }
    return rawOutcome(command, command, 'Unsupported node syntax');
  }
  if (command === 'node' && content === undefined) {
    report(
      ctx,
      'Node text must be enclosed in braces.',
      slice.end,
      'error',
      'TIKZ_NODE_TEXT',
      'Add {} after the node, even if it is empty',
    );
    return { kind: command, command, options, elements: [] };
  }
  if (command === 'coordinate' && !name) {
    report(
      ctx,
      'Coordinate declarations require an identifier.',
      slice.start,
      'error',
      'TIKZ_COORDINATE_ID',
    );
    return { kind: command, command, options, elements: [] };
  }
  if (!slice.terminated)
    report(ctx, 'Missing ";" after the node.', slice.end, 'error', 'TIKZ_MISSING_SEMICOLON');

  const interpreted = interpretNodeOptions(ctx, options);
  if (interpreted.relative && !lookupNode(ctx, interpreted.relative.target)) {
    if (isKnownExternal(ctx, interpreted.relative.target))
      return rawOutcome(
        command,
        command,
        'Positioned relative to a node defined by unsupported TikZ',
      );
    report(
      ctx,
      `Relative node target "${interpreted.relative.target}" does not exist.`,
      slice.start,
      'error',
      'TIKZ_RELATIVE_TARGET',
    );
    return { kind: command, command, options, elements: [] };
  }
  const id = name ?? claimId(ctx, `node_${pad(index)}`, 'node');
  if (name) ctx.usedIds.add(name);
  else if (ctx.depth === 0)
    report(
      ctx,
      'Unnamed nodes get a generated id for visual editing.',
      slice.start,
      'info',
      'TIKZ_GENERATED_ID',
    );

  let element: NodeElement;
  let extras = interpreted.extras;
  if (command === 'coordinate') {
    element = createNode('coordinate', {
      id,
      width: 12,
      height: 12,
      text: '',
      style: { fill: 'none', stroke: 'teal', lineWidth: 1, textColor: 'teal' },
    });
  } else {
    const resolved = resolveStyleRefs(ctx.styles, interpreted.refs, ctx.settings.pixelsPerCm);
    const style = applyStyleDefinition(resolved.style, interpreted.definition);
    const shape = interpreted.definition.shape ?? resolved.shape ?? 'rectangle';
    const minimumWidth = interpreted.definition.minimumWidth ?? resolved.minimumWidth;
    const minimumHeight = interpreted.definition.minimumHeight ?? resolved.minimumHeight;
    const nodeText = content ?? '';
    const image = shape === 'rectangle' ? imageContent(ctx, nodeText) : undefined;
    if (image) {
      element = createNode('image', {
        id,
        text: '',
        style,
        width: image.width,
        height: image.height,
      });
      element.source = image.path;
      element.sizeMode = 'fixed';
      // The serializer always emits this for images, so it is part of the image, not an extra.
      extras = extras.filter(
        (option) => !/^inner sep\s*=\s*0(?:\.0*)?(?:pt|cm|mm)?$/u.test(option.trim()),
      );
    } else {
      element = createNode(shape, {
        id,
        text: nodeText,
        style,
        ...nodeSize(shape, nodeText, style, minimumWidth, minimumHeight),
      });
      element.sizeMode =
        minimumWidth !== undefined || minimumHeight !== undefined ? 'fixed' : 'auto';
    }
    if (interpreted.refs.length) element.styleRefs = interpreted.refs;
  }
  if (extras.length) element.extraOptions = extras;
  if (interpreted.relative) {
    element.position = { mode: 'relative', ...interpreted.relative };
    const target = lookupNode(ctx, interpreted.relative.target);
    const placement = target
      ? relativePlacement(element, target, ctx.settings.pixelsPerCm)
      : undefined;
    if (placement) Object.assign(element, placement);
  } else {
    const point = at ? canvasPoint(ctx, at) : tikzToCanvasPoint({ x: 0, y: 0 }, ctx.settings);
    if (!point) {
      if (at?.kind === 'ref' && isKnownExternal(ctx, at.id))
        return rawOutcome(command, command, 'Positioned at a node defined by unsupported TikZ');
      report(
        ctx,
        `Node position refers to unknown node "${at?.kind === 'ref' ? at.id : ''}".`,
        slice.start,
        'error',
        'TIKZ_COORDINATE',
      );
      return { kind: command, command, options, elements: [] };
    }
    element.x = point.x;
    element.y = point.y;
  }
  if (name) ctx.nodes.set(name, element);
  const anchoredTo = interpreted.relative?.target ?? (at?.kind === 'ref' ? at.id : undefined);
  if (ctx.depth === 0 && anchoredTo !== undefined && !ctx.irNodes.has(anchoredTo))
    return {
      kind: command,
      command,
      options,
      elements: [],
      raw: {
        reason: 'Positioned relative to a node defined by unsupported TikZ',
        preview: [{ ...element, locked: true }],
      },
    };
  if (ctx.depth === 0 && name) ctx.irNodes.add(name);
  return { kind: command, command, options, elements: [element] };
}

// ---------------------------------------------------------------------------------------------
// Paths

type PathItem =
  | { kind: 'coordinate'; spec: CoordinateSpec; relative?: '+' | '++'; offset: number }
  | { kind: 'cycle' }
  | {
      kind: 'operation';
      operation: '--' | '-|' | '|-' | 'to' | 'rectangle' | 'controls';
      options?: TikzOption[];
      controls?: CoordinateSpec[];
    }
  | { kind: 'circle'; radius: Point }
  | { kind: 'label'; options: TikzOption[]; text: string; name?: string };

function readPathItems(
  ctx: Context,
  text: string,
  start: number,
  end: number,
  options: TikzOption[],
): { items: PathItem[] } | { unsupported: string } {
  const items: PathItem[] = [];
  let cursor = start;
  const coordinateAt = (open: number): { spec: CoordinateSpec; next: number } | undefined => {
    const close = readGroup(text, open, '(', ')');
    if (close === undefined || close > end) return undefined;
    const spec = parseCoordinateSpec(text.slice(open + 1, close - 1));
    return spec ? { spec, next: close } : undefined;
  };
  while (cursor < end) {
    cursor = skipWhitespace(text, cursor, end);
    if (cursor >= end) break;
    const character = text[cursor];
    const rest = text.slice(cursor, Math.min(end, cursor + 12));
    if (character === '[') {
      const close = readGroup(text, cursor, '[', ']');
      if (close === undefined || close > end) return { unsupported: 'Unclosed option list' };
      options.push(...parseOptionList(ctx, text.slice(cursor + 1, close - 1), cursor + 1));
      cursor = close;
      continue;
    }
    const relative = /^\+\+?(?=\s*\()/u.exec(rest)?.[0] as '+' | '++' | undefined;
    if (relative || character === '(') {
      const open = skipWhitespace(text, cursor + (relative?.length ?? 0), end);
      const coordinate = coordinateAt(open);
      if (!coordinate) return { unsupported: 'Unsupported coordinate' };
      items.push({ kind: 'coordinate', spec: coordinate.spec, relative, offset: cursor });
      cursor = coordinate.next;
      continue;
    }
    const operator = /^(--|-\||\|-)/u.exec(rest)?.[1] as '--' | '-|' | '|-' | undefined;
    if (operator) {
      items.push({ kind: 'operation', operation: operator });
      cursor += operator.length;
      continue;
    }
    if (rest.startsWith('..')) {
      let next = skipWhitespace(text, cursor + 2, end);
      if (!text.startsWith('controls', next)) return { unsupported: 'Unsupported .. syntax' };
      next += 'controls'.length;
      const controls: CoordinateSpec[] = [];
      for (;;) {
        next = skipWhitespace(text, next, end);
        const coordinate = coordinateAt(next);
        if (!coordinate) return { unsupported: 'Unsupported control point' };
        controls.push(coordinate.spec);
        next = skipWhitespace(text, coordinate.next, end);
        if (controls.length < 2 && text.startsWith('and', next)) {
          next += 3;
          continue;
        }
        break;
      }
      if (!text.startsWith('..', next)) return { unsupported: 'Unsupported .. syntax' };
      items.push({ kind: 'operation', operation: 'controls', controls });
      cursor = next + 2;
      continue;
    }
    const word = /^[A-Za-z]+/u.exec(rest)?.[0];
    if (word === 'to') {
      cursor = skipWhitespace(text, cursor + 2, end);
      const toOptions: TikzOption[] = [];
      if (text[cursor] === '[') {
        const close = readGroup(text, cursor, '[', ']');
        if (close === undefined || close > end) return { unsupported: 'Unclosed option list' };
        toOptions.push(...parseOptionList(ctx, text.slice(cursor + 1, close - 1), cursor + 1));
        cursor = close;
      }
      items.push({ kind: 'operation', operation: 'to', options: toOptions });
      continue;
    }
    if (word === 'rectangle') {
      items.push({ kind: 'operation', operation: 'rectangle' });
      cursor += word.length;
      continue;
    }
    if (word === 'circle' || word === 'ellipse') {
      cursor = skipWhitespace(text, cursor + word.length, end);
      let radius: Point | undefined;
      if (text[cursor] === '(') {
        const close = readGroup(text, cursor, '(', ')');
        const inner = close === undefined ? '' : text.slice(cursor + 1, close - 1);
        const [first, second] = inner.split(/\s+and\s+/u);
        const rx = first === undefined ? undefined : coordinateNumber(first);
        const ry = second === undefined ? rx : coordinateNumber(second);
        if (close !== undefined && rx !== undefined && ry !== undefined) {
          radius = { x: rx, y: ry };
          cursor = close;
        }
      } else if (text[cursor] === '[') {
        const close = readGroup(text, cursor, '[', ']');
        const radiusOptions =
          close === undefined ? [] : parseOptionList(ctx, text.slice(cursor + 1, close - 1), 0);
        const value = (key: string) =>
          lengthToCm(radiusOptions.find((option) => option.key === key)?.value);
        const both = value('radius');
        const rx = value('x radius') ?? both;
        const ry = value('y radius') ?? both;
        if (close !== undefined && rx !== undefined && ry !== undefined) {
          radius = { x: rx, y: ry };
          cursor = close;
        }
      }
      if (!radius) return { unsupported: `Unsupported ${word} radius` };
      items.push({ kind: 'circle', radius });
      continue;
    }
    if (word === 'cycle') {
      items.push({ kind: 'cycle' });
      cursor += word.length;
      continue;
    }
    if (word === 'node') {
      cursor = skipWhitespace(text, cursor + 4, end);
      const labelOptions: TikzOption[] = [];
      let name: string | undefined;
      for (;;) {
        if (text[cursor] === '[') {
          const close = readGroup(text, cursor, '[', ']');
          if (close === undefined || close > end) return { unsupported: 'Unclosed option list' };
          labelOptions.push(...parseOptionList(ctx, text.slice(cursor + 1, close - 1), cursor + 1));
          cursor = skipWhitespace(text, close, end);
          continue;
        }
        if (text[cursor] === '(') {
          const close = readGroup(text, cursor, '(', ')');
          if (close === undefined) return { unsupported: 'Unbalanced parentheses' };
          name = text.slice(cursor + 1, close - 1).trim();
          cursor = skipWhitespace(text, close, end);
          continue;
        }
        break;
      }
      const close = text[cursor] === '{' ? readGroup(text, cursor, '{', '}') : undefined;
      if (close === undefined || close > end) return { unsupported: 'Unsupported inline node' };
      items.push({
        kind: 'label',
        options: labelOptions,
        text: text.slice(cursor + 1, close - 1).trim(),
        name,
      });
      cursor = close;
      continue;
    }
    return { unsupported: `Unsupported path operation "${word ?? character ?? ''}"` };
  }
  return { items };
}

interface PathAppearance {
  arrow?: { spec: string; start: string; end: string };
  stroke: string;
  fill: string;
  lineWidth: number;
  dashed: boolean;
  refs: string[];
  extras: string[];
  bend?: number;
}

function pathAppearance(ctx: Context, command: string, options: TikzOption[]): PathAppearance {
  const definition: TikzStyleDefinition = {};
  const refs: string[] = [];
  const extras: string[] = [];
  let bend: number | undefined;
  for (const option of options) {
    const style = option.value === undefined ? ctx.styles[option.key] : undefined;
    if (style) {
      refs.push(option.key);
      Object.assign(definition, style);
      continue;
    }
    const bendMatch = /^bend (left|right)$/u.exec(option.key);
    if (bendMatch) {
      const angle = option.value === undefined ? 30 : Number.parseFloat(option.value);
      bend = (bendMatch[1] === 'left' ? 1 : -1) * (Number.isFinite(angle) ? angle : 30);
      continue;
    }
    if (!applyAppearanceOption(ctx, definition, option.key, option.value)) extras.push(option.raw);
  }
  const drawn = command === 'draw' || command === 'filldraw' || definition.draw === true;
  const filled = command === 'fill' || command === 'filldraw' || definition.fill !== undefined;
  const arrow = definition.arrowSpec ? parseArrowSpec(definition.arrowSpec) : undefined;
  return {
    arrow: arrow && definition.arrowSpec ? { spec: definition.arrowSpec, ...arrow } : undefined,
    stroke: drawn && definition.draw !== false ? (definition.stroke ?? 'black') : 'none',
    fill: filled ? (definition.fill ?? definition.stroke ?? 'black') : 'none',
    lineWidth: definition.lineWidth ?? ptToPx(0.4, ctx.settings.pixelsPerCm),
    dashed: definition.dashed ?? false,
    refs,
    extras,
    bend,
  };
}

function labelInfo(
  item: Extract<PathItem, { kind: 'label' }>,
  position: 'start' | 'middle' | 'end',
): { text: string; options?: string } {
  const placed = item.options.some(
    (option) =>
      option.key === 'midway' ||
      option.key === 'pos' ||
      /^(?:near|very near|at) (?:start|end)$/u.test(option.key),
  );
  const options = item.options
    .filter((option) => option.key !== 'midway')
    .map((option) => option.raw);
  if (!placed && position !== 'middle') options.unshift(position === 'end' ? 'pos=1' : 'pos=0');
  return { text: item.text, options: options.length ? options.join(', ') : undefined };
}

function edgeFromItems(
  ctx: Context,
  items: PathItem[],
  appearance: PathAppearance,
  id: string,
): EdgeElement | undefined {
  const coordinates = items.filter(
    (item): item is Extract<PathItem, { kind: 'coordinate' }> => item.kind === 'coordinate',
  );
  const operations = items.filter(
    (item): item is Extract<PathItem, { kind: 'operation' }> => item.kind === 'operation',
  );
  const labels = items.filter(
    (item): item is Extract<PathItem, { kind: 'label' }> => item.kind === 'label',
  );
  const [first, second] = coordinates;
  const [operation] = operations;
  if (
    items.some((item) => item.kind === 'cycle' || item.kind === 'circle') ||
    coordinates.length !== 2 ||
    operations.length !== 1 ||
    labels.length > 1 ||
    labels.some((label) => label.name) ||
    !first ||
    !second ||
    !operation ||
    operation.operation === 'rectangle' ||
    first.spec.kind !== 'ref' ||
    second.spec.kind !== 'ref' ||
    first.relative ||
    second.relative ||
    appearance.fill !== 'none' ||
    appearance.stroke === 'none'
  )
    return undefined;
  let bend: number | undefined;
  if (operation.operation === 'to') {
    for (const option of operation.options ?? []) {
      const match = /^bend (left|right)$/u.exec(option.key);
      if (!match) return undefined;
      const angle = option.value === undefined ? 30 : Number.parseFloat(option.value);
      bend = (match[1] === 'left' ? 1 : -1) * (Number.isFinite(angle) ? angle : 30);
    }
    bend ??= appearance.bend;
  }
  let controlPoints: Point[] | undefined;
  if (operation.operation === 'controls') {
    controlPoints = [];
    for (const control of operation.controls ?? []) {
      if (control.kind !== 'point') return undefined;
      controlPoints.push(tikzToCanvasPoint(control.point, ctx.settings));
    }
  }
  const labelItem = labels[0];
  const labelIndex = labelItem ? items.indexOf(labelItem) : -1;
  const label = labelItem
    ? labelInfo(
        labelItem,
        labelIndex < items.indexOf(operation)
          ? 'start'
          : labelIndex > items.indexOf(second)
            ? 'end'
            : 'middle',
      )
    : undefined;

  let from = first.spec;
  let to = second.spec;
  let arrowSpec = appearance.arrow?.spec;
  let route =
    operation.operation === '-|' || operation.operation === '|-' ? operation.operation : undefined;
  const tips = appearance.arrow;
  if (tips && tips.start && !tips.end) {
    [from, to] = [to, from];
    arrowSpec = mirrorArrowSpec(tips);
    route = route === '-|' ? '|-' : route === '|-' ? '-|' : undefined;
    bend = bend === undefined ? undefined : -bend;
    controlPoints = controlPoints?.reverse();
  }
  const forward = Boolean(tips?.start || tips?.end);
  const both = Boolean(tips?.start && tips.end);
  const endTip = tips?.end || tips?.start || '';
  const type: EdgeElement['type'] = both
    ? 'bidirectional-arrow'
    : controlPoints
      ? 'curved-arrow'
      : !forward
        ? 'line'
        : appearance.dashed
          ? 'dashed-arrow'
          : 'arrow';
  const edge = createArrow(from.kind === 'ref' ? from.id : '', to.kind === 'ref' ? to.id : '', {
    id,
    type,
    label: label?.text,
    style: {
      arrow: forward ? arrowStyleForTip(endTip) : 'none',
      dashed: appearance.dashed,
      stroke: appearance.stroke,
      lineWidth: appearance.lineWidth,
    },
  });
  if (label?.options) edge.labelOptions = label.options;
  if (from.kind === 'ref' && from.anchor) edge.fromAnchor = from.anchor;
  if (to.kind === 'ref' && to.anchor) edge.toAnchor = to.anchor;
  if (bend) edge.bend = bend;
  if (route) edge.route = route;
  if (controlPoints) edge.controlPoints = controlPoints;
  if (arrowSpec && !appearance.refs.length) edge.arrowSpec = arrowSpec;
  if (appearance.refs.length) edge.styleRefs = appearance.refs;
  if (appearance.extras.length) edge.extraOptions = appearance.extras;
  return edge;
}

function shapeFromItems(
  ctx: Context,
  items: PathItem[],
  appearance: PathAppearance,
  index: number,
): NodeElement | undefined {
  if (appearance.refs.length || appearance.extras.length || appearance.arrow) return undefined;
  const [first, second, third] = items;
  if (first?.kind !== 'coordinate' || first.spec.kind !== 'point' || first.relative)
    return undefined;
  const style = {
    fill: appearance.fill,
    stroke: appearance.stroke,
    lineWidth: appearance.lineWidth,
    dashed: appearance.dashed,
    rounded: false,
  };
  if (
    items.length === 3 &&
    second?.kind === 'operation' &&
    second.operation === 'rectangle' &&
    third?.kind === 'coordinate' &&
    third.spec.kind === 'point'
  ) {
    const corner = third.relative
      ? { x: first.spec.point.x + third.spec.point.x, y: first.spec.point.y + third.spec.point.y }
      : third.spec.point;
    const a = tikzToCanvasPoint(first.spec.point, ctx.settings);
    const b = tikzToCanvasPoint(corner, ctx.settings);
    const node = createNode('rectangle', {
      id: claimId(ctx, `rectangle_${pad(index)}`, 'rectangle'),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
      text: '',
      style,
    });
    node.sizeMode = 'fixed';
    return node;
  }
  if (items.length === 2 && second?.kind === 'circle') {
    const center = tikzToCanvasPoint(first.spec.point, ctx.settings);
    const circle = second.radius.x === second.radius.y;
    const node = createNode(circle ? 'circle' : 'ellipse', {
      id: claimId(
        ctx,
        `${circle ? 'circle' : 'ellipse'}_${pad(index)}`,
        circle ? 'circle' : 'ellipse',
      ),
      x: center.x,
      y: center.y,
      width: second.radius.x * 2 * ctx.settings.pixelsPerCm,
      height: second.radius.y * 2 * ctx.settings.pixelsPerCm,
      text: '',
      style,
    });
    node.sizeMode = 'fixed';
    return node;
  }
  return undefined;
}

/** SVG path for a path we keep as raw TikZ, so the canvas still shows what it draws. */
function previewPath(
  ctx: Context,
  items: PathItem[],
  appearance: PathAppearance,
  id: string,
): PreviewPath | undefined {
  const ppcm = ctx.settings.pixelsPerCm;
  const commands: string[] = [];
  let current: Point | undefined;
  let reference: Point | undefined;
  let start: Point | undefined;
  let pending: Extract<PathItem, { kind: 'operation' }> | undefined;
  const round = (value: number) => Math.round(value * 100) / 100;
  const point = (value: Point) => `${round(value.x)} ${round(value.y)}`;
  for (const item of items) {
    if (item.kind === 'label') continue;
    if (item.kind === 'cycle') {
      commands.push('Z');
      current = start;
      pending = undefined;
      continue;
    }
    if (item.kind === 'circle') {
      if (!current) return undefined;
      const rx = item.radius.x * ppcm;
      const ry = item.radius.y * ppcm;
      commands.push(
        `M ${point({ x: current.x - rx, y: current.y })}`,
        `A ${round(rx)} ${round(ry)} 0 1 0 ${point({ x: current.x + rx, y: current.y })}`,
        `A ${round(rx)} ${round(ry)} 0 1 0 ${point({ x: current.x - rx, y: current.y })}`,
        `M ${point(current)}`,
      );
      continue;
    }
    if (item.kind === 'operation') {
      pending = item;
      continue;
    }
    let target: Point | undefined;
    if (item.relative && reference && item.spec.kind === 'point') {
      target = {
        x: reference.x + item.spec.point.x * ppcm,
        y: reference.y - item.spec.point.y * ppcm,
      };
    } else {
      target = canvasPoint(ctx, item.spec);
    }
    if (!target) return undefined;
    if (item.relative !== '+') reference = target;
    if (!pending || !current) {
      commands.push(`M ${point(target)}`);
      start = target;
    } else if (pending.operation === '-|') {
      commands.push(`L ${point({ x: target.x, y: current.y })}`, `L ${point(target)}`);
    } else if (pending.operation === '|-') {
      commands.push(`L ${point({ x: current.x, y: target.y })}`, `L ${point(target)}`);
    } else if (pending.operation === 'rectangle') {
      commands.push(
        `L ${point({ x: target.x, y: current.y })}`,
        `L ${point(target)}`,
        `L ${point({ x: current.x, y: target.y })}`,
        'Z',
        `M ${point(target)}`,
      );
    } else if (pending.operation === 'controls') {
      const controls = (pending.controls ?? []).map((control) =>
        control.kind === 'point' ? tikzToCanvasPoint(control.point, ctx.settings) : undefined,
      );
      const [c1, c2] = controls;
      if (!c1) return undefined;
      commands.push(`C ${point(c1)}, ${point(c2 ?? c1)}, ${point(target)}`);
    } else {
      commands.push(`L ${point(target)}`);
    }
    current = target;
    pending = undefined;
  }
  if (commands.length < 2) return undefined;
  return {
    id,
    type: 'preview-path',
    d: commands.join(' '),
    stroke: appearance.stroke,
    fill: appearance.fill,
    lineWidth: appearance.lineWidth,
    dashed: appearance.dashed,
    arrowStart: Boolean(appearance.arrow?.start),
    arrowEnd: Boolean(appearance.arrow?.end),
  };
}

function parsePathStatement(
  ctx: Context,
  text: string,
  slice: Slice,
  command: string,
  index: number,
): Outcome {
  const bodyEnd = statementBodyEnd(text, slice);
  const options: TikzOption[] = [];
  if (!slice.terminated)
    report(ctx, 'Missing ";" after the path.', slice.end, 'error', 'TIKZ_MISSING_SEMICOLON');
  const read = readPathItems(ctx, text, slice.start + 1 + command.length, bodyEnd, options);
  if ('unsupported' in read) return { ...rawOutcome('path', command, read.unsupported), options };
  const items = read.items;
  for (const item of items) {
    if (item.kind === 'label' && item.name) ctx.externalNames.add(item.name);
  }
  if (!items.some((item) => item.kind === 'coordinate')) {
    report(ctx, 'Path needs a starting coordinate.', slice.start, 'error', 'TIKZ_PATH_START');
    return { kind: 'path', command, options, elements: [] };
  }
  const appearance = pathAppearance(ctx, command, options);
  const edgeCandidate =
    (command === 'draw' || command === 'path') &&
    items
      .filter((item) => item.kind === 'coordinate')
      .every((item) => item.kind === 'coordinate' && item.spec.kind === 'ref');
  if (edgeCandidate) {
    const edge = edgeFromItems(ctx, items, appearance, `edge_${pad(index)}`);
    if (edge) {
      edge.id = claimId(ctx, edge.id, 'edge');
      return { kind: 'path', command, options, elements: [edge] };
    }
  }
  if (command === 'draw' || command === 'fill' || command === 'filldraw' || command === 'path') {
    const shape = shapeFromItems(ctx, items, appearance, index);
    if (shape) return { kind: 'path', command, options, elements: [shape] };
  }
  const preview = previewPath(ctx, items, appearance, `preview_${pad(index)}`);
  return {
    kind: 'path',
    command,
    options,
    elements: [],
    raw: {
      reason: 'Path geometry is outside the editable subset',
      preview: preview ? [preview] : undefined,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// PGFPlots

interface AddplotInfo {
  options?: string;
  data?: Point[];
  expression?: string;
  end: number;
}

function readAddplot(text: string, start: number, end: number): AddplotInfo | undefined {
  let cursor = start + '\\addplot'.length;
  if (text[cursor] === '+') cursor += 1;
  cursor = skipWhitespace(text, cursor, end);
  let options: string | undefined;
  if (text[cursor] === '[') {
    const close = readGroup(text, cursor, '[', ']');
    if (close === undefined) return undefined;
    options = text.slice(cursor + 1, close - 1).trim();
    cursor = skipWhitespace(text, close, end);
  }
  const finish = (next: number): number | undefined => {
    const semicolon = skipWhitespace(text, next, end);
    return text[semicolon] === ';' ? semicolon + 1 : undefined;
  };
  if (text.startsWith('coordinates', cursor)) {
    const open = skipWhitespace(text, cursor + 'coordinates'.length, end);
    const close = readGroup(text, open, '{', '}');
    const after = close === undefined ? undefined : finish(close);
    if (close === undefined || after === undefined) return undefined;
    const data: Point[] = [];
    for (const match of text
      .slice(open + 1, close - 1)
      .matchAll(/\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/gu)) {
      const x = Number.parseFloat(match[1] ?? '');
      const y = Number.parseFloat(match[2] ?? '');
      if (Number.isFinite(x) && Number.isFinite(y)) data.push({ x, y });
    }
    return { options, data, end: after };
  }
  if (text[cursor] === '{') {
    const close = readGroup(text, cursor, '{', '}');
    const after = close === undefined ? undefined : finish(close);
    if (close === undefined || after === undefined) return undefined;
    return { options, expression: text.slice(cursor, close).trim(), end: after };
  }
  return undefined;
}

function sampleExpression(expression: string, domain: string | undefined): Point[] {
  const [from, to] = (domain ?? '-5:5').split(':').map((value) => evaluateExpression(value));
  if (from === undefined || to === undefined || from === to) return [];
  const body = stripBraces(expression)
    .replace(/\bdeg\s*\(/gu, '(57.29577951308232*')
    .replace(/\bexp\s*\(/gu, '(2.718281828459045^');
  const points: Point[] = [];
  for (let step = 0; step <= 24; step += 1) {
    const x = from + ((to - from) * step) / 24;
    const y = evaluateExpression(body.replace(/\bx\b/gu, `(${x})`));
    if (y !== undefined)
      points.push({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  }
  return points;
}

function parseAxisEnvironment(ctx: Context, text: string, slice: Slice, index: number): Outcome {
  const header = /^\\begin\s*\{axis\}\s*/u.exec(text.slice(slice.start, slice.end));
  const close = findEnvironmentEnd(text, slice.start, slice.end, 'axis');
  if (!header || !close) return rawOutcome('plot', 'axis', 'Unclosed axis environment');
  let cursor = slice.start + header[0].length;
  const options: TikzOption[] = [];
  if (text[cursor] === '[') {
    const end = readGroup(text, cursor, '[', ']');
    if (end === undefined) return rawOutcome('plot', 'axis', 'Unclosed axis options');
    options.push(...parseOptionList(ctx, text.slice(cursor + 1, end - 1), cursor + 1));
    cursor = end;
  }
  const plots: AddplotInfo[] = [];
  let simple = true;
  for (;;) {
    cursor = skipWhitespace(text, cursor, close.start);
    if (cursor >= close.start) break;
    if (!text.startsWith('\\addplot', cursor)) {
      simple = false;
      break;
    }
    const plot = readAddplot(text, cursor, close.start);
    if (!plot) {
      simple = false;
      break;
    }
    plots.push(plot);
    cursor = plot.end;
  }
  const valueOf = (key: string) => options.find((option) => option.key === key)?.value;
  let plotType: PlotElement['plotType'] = 'line';
  const extras: string[] = [];
  const width = lengthToCm(valueOf('width')) ?? 240 / PT_PER_CM;
  const height = lengthToCm(valueOf('height')) ?? 207 / PT_PER_CM;
  let at: Point = { x: 0, y: 0 };
  let anchor = 'south west';
  for (const option of options) {
    if (option.key === 'ybar' && option.value === undefined) plotType = 'bar';
    else if (option.key === 'only marks') plotType = 'scatter';
    else if (option.key === 'at' && option.value) {
      const inner = stripBraces(option.value).replace(/^\(|\)$/gu, '');
      const spec = parseCoordinateSpec(inner);
      if (spec?.kind === 'point') at = spec.point;
      else extras.push(option.raw);
    } else if (option.key === 'anchor' && option.value) anchor = option.value;
    else if (!['width', 'height', 'title', 'xlabel', 'ylabel'].includes(option.key))
      extras.push(option.raw);
  }
  const first = plots[0];
  if (first?.options && /(?:^|,)\s*only marks\s*(?:,|$)/u.test(first.options)) plotType = 'scatter';
  const horizontal = anchor.includes('west') ? 1 : anchor.includes('east') ? -1 : 0;
  const vertical = anchor.includes('south') ? 1 : anchor.includes('north') ? -1 : 0;
  const center = tikzToCanvasPoint(
    { x: at.x + (horizontal * width) / 2, y: at.y + (vertical * height) / 2 },
    ctx.settings,
  );
  const expression = first?.expression;
  const domain =
    valueOf('domain') ??
    (first?.options ? /domain\s*=\s*([^,\]]+)/u.exec(first.options)?.[1] : undefined);
  const plot = createPlot({
    id: `plot_${pad(index)}`,
    x: center.x,
    y: center.y,
    width: width * ctx.settings.pixelsPerCm,
    height: height * ctx.settings.pixelsPerCm,
    plotType: expression ? 'function' : plotType,
    data: first?.data ?? (expression ? sampleExpression(expression, domain) : []),
    expression,
    title: valueOf('title') === undefined ? undefined : stripBraces(valueOf('title') ?? ''),
    xLabel: valueOf('xlabel') === undefined ? undefined : stripBraces(valueOf('xlabel') ?? ''),
    yLabel: valueOf('ylabel') === undefined ? undefined : stripBraces(valueOf('ylabel') ?? ''),
  });
  if (anchor !== 'south west' && anchor !== 'center') extras.push(`anchor=${anchor}`);
  if (first?.options) plot.addplotOptions = first.options;
  if (extras.length) plot.extraOptions = extras;
  if (!simple || plots.length !== 1 || (!first?.data && !expression)) {
    plot.id = `${plot.id}_preview`;
    plot.locked = true;
    return {
      kind: 'plot',
      command: 'axis',
      options,
      elements: [],
      raw: { reason: 'Axis with several plots or extra content', preview: [plot] },
    };
  }
  plot.id = claimId(ctx, plot.id, 'plot');
  return { kind: 'plot', command: 'axis', options, elements: [plot] };
}

// ---------------------------------------------------------------------------------------------
// Loops, scopes and other raw statements

function expandList(content: string): string[] | undefined {
  const parts = splitDepthZero(content, ',').map((part) => part.trim());
  const items: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (part !== '...') {
      items.push(part);
      continue;
    }
    const previous = items.at(-1);
    const before = items.at(-2);
    const next = parts[index + 1];
    if (previous === undefined || next === undefined) return undefined;
    const letters = /^[A-Za-z]$/u.test(previous) && /^[A-Za-z]$/u.test(next);
    const toNumber = (value: string) => (letters ? value.charCodeAt(0) : Number.parseFloat(value));
    const last = toNumber(previous);
    const target = toNumber(next);
    const step =
      before !== undefined && Number.isFinite(toNumber(before))
        ? last - toNumber(before)
        : target >= last
          ? 1
          : -1;
    if (!Number.isFinite(last) || !Number.isFinite(target) || step === 0) return undefined;
    for (
      let value = last + step;
      step > 0 ? value < target - 1e-9 : value > target + 1e-9;
      value += step
    ) {
      if (items.length > MAX_LOOP_ITEMS) return undefined;
      items.push(letters ? String.fromCharCode(value) : String(Math.round(value * 1e9) / 1e9));
    }
  }
  return items.length <= MAX_LOOP_ITEMS ? items : undefined;
}

function childContext(ctx: Context, origin: Point = ctx.settings.origin): Context {
  return {
    ...ctx,
    settings: { ...ctx.settings, origin },
    diagnostics: [],
    usedIds: new Set(ctx.usedIds),
    generatedIds: [],
    depth: ctx.depth + 1,
  };
}

/** Parses statements of a loop body or scope into read-only preview shapes. */
function previewStatements(ctx: Context, text: string, prefix: string): PreviewShape[] {
  const shapes: PreviewShape[] = [];
  if (ctx.depth > 3) return shapes;
  sliceStatements(text, 0, text.length).forEach((slice, index) => {
    if (ctx.previewBudget.remaining <= 0) return;
    const outcome = parseStatement(ctx, text, slice, index);
    for (const element of outcome.elements) {
      if (!isNodeElement(element) && !isEdgeElement(element) && element.type !== 'plot') continue;
      const shape = { ...element, locked: true } as PreviewShape;
      if (ctx.generatedIds.includes(element.id)) shape.id = `${prefix}${shapes.length}`;
      shapes.push(shape);
      ctx.previewBudget.remaining -= 1;
    }
    for (const preview of outcome.raw?.preview ?? []) {
      shapes.push({ ...preview, id: `${prefix}${shapes.length}` });
      ctx.previewBudget.remaining -= 1;
    }
  });
  return shapes;
}

function foreachPreview(ctx: Context, text: string, slice: Slice, prefix: string): PreviewShape[] {
  const statement = text.slice(slice.start, slice.end);
  const header = FOREACH_HEADER.exec(statement);
  if (!header?.[1]) return [];
  const variables = header[1].split('/').map((name) => name.trim());
  const count = header[2] ? /count\s*=\s*(\\[A-Za-z]+)/u.exec(header[2])?.[1] : undefined;
  const listStart = header[0].length;
  const listEnd = readGroup(statement, listStart, '{', '}');
  if (listEnd === undefined) return [];
  const list = expandList(statement.slice(listStart + 1, listEnd - 1));
  if (!list) return [];
  const bodyStart = skipWhitespace(statement, listEnd);
  const bodyEnd =
    statement[bodyStart] === '{' ? readGroup(statement, bodyStart, '{', '}') : undefined;
  const body =
    bodyEnd === undefined
      ? statement.slice(bodyStart)
      : statement.slice(bodyStart + 1, bodyEnd - 1);
  const shapes: PreviewShape[] = [];
  list.forEach((item, iteration) => {
    const values = splitDepthZero(item, '/').map((value) => stripBraces(value));
    let substituted = body;
    const replacements: Array<[string, string]> = variables.map((name, position) => [
      name,
      values[position] ?? values.at(-1) ?? '',
    ]);
    if (count) replacements.push([count, String(iteration + 1)]);
    for (const [name, value] of replacements) {
      const escaped = name.replace(/\\/gu, '\\\\');
      substituted = substituted.replace(new RegExp(`${escaped}(?![A-Za-z])`, 'gu'), value);
    }
    shapes.push(...previewStatements(childContext(ctx), substituted, `${prefix}${iteration}_`));
  });
  return shapes;
}

function environmentPreview(
  ctx: Context,
  text: string,
  slice: Slice,
  name: string,
  prefix: string,
): PreviewShape[] {
  const close = findEnvironmentEnd(text, slice.start, slice.end, name);
  if (!close) return [];
  let cursor =
    slice.start + (/^\\begin\s*\{[^}]+\}/u.exec(text.slice(slice.start))?.[0].length ?? 0);
  let shift: Point = { x: 0, y: 0 };
  for (;;) {
    cursor = skipWhitespace(text, cursor, close.start);
    const character = text[cursor];
    if (character === '{') {
      cursor = readGroup(text, cursor, '{', '}') ?? close.start;
      continue;
    }
    if (character === '[') {
      const end = readGroup(text, cursor, '[', ']');
      if (end === undefined) return [];
      for (const option of parseOptionList(ctx, text.slice(cursor + 1, end - 1), cursor + 1)) {
        if (/^(?:x|y)?scale$|^rotate$|^cm$|^transform|^rotate around/u.test(option.key)) return [];
        if (option.key === 'shift' && option.value) {
          const spec = parseCoordinateSpec(stripBraces(option.value).replace(/^\(|\)$/gu, ''));
          if (spec?.kind !== 'point') return [];
          shift = { x: shift.x + spec.point.x, y: shift.y + spec.point.y };
        }
        if (option.key === 'xshift') shift.x += lengthToCm(option.value) ?? 0;
        if (option.key === 'yshift') shift.y += lengthToCm(option.value) ?? 0;
      }
      cursor = end;
      continue;
    }
    break;
  }
  const origin = {
    x: ctx.settings.origin.x + shift.x * ctx.settings.pixelsPerCm,
    y: ctx.settings.origin.y - shift.y * ctx.settings.pixelsPerCm,
  };
  return previewStatements(childContext(ctx, origin), text.slice(cursor, close.start), prefix);
}

function registerRawNames(ctx: Context, statement: string): void {
  for (const match of statement.matchAll(/\bnode\s*(?:\[[^\]]*\]\s*)?\(([^)]+)\)/gu))
    if (match[1]) ctx.externalNames.add(match[1].trim());
  for (const match of statement.matchAll(/\\coordinate\s*(?:\[[^\]]*\]\s*)?\(([^)]+)\)/gu))
    if (match[1]) ctx.externalNames.add(match[1].trim());
  for (const match of statement.matchAll(/\\matrix\s*(?:\[[^\]]*\]\s*)?\(([^)]+)\)/gu))
    if (match[1])
      ctx.externalPrefixes.push(match[1].trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
}

function parseStatement(ctx: Context, text: string, slice: Slice, index: number): Outcome {
  const statement = text.slice(slice.start, slice.end);
  const environment = /^\\begin\s*\{([^}]+)\}/u.exec(statement)?.[1];
  if (environment === 'axis') return parseAxisEnvironment(ctx, text, slice, index);
  const command = /^\\([A-Za-z@]+)/u.exec(statement)?.[1];
  if (!environment && !command && statement.trim() === ';')
    return { kind: 'raw', options: [], elements: [] };
  const prefix = `raw_${pad(index)}_`;
  if (environment) {
    registerRawNames(ctx, statement);
    if (!slice.terminated)
      report(
        ctx,
        `Environment "${environment}" is missing \\end{${environment}}.`,
        slice.start,
        'error',
        'TIKZ_UNCLOSED_ENV',
      );
    return {
      kind: 'environment',
      command: environment,
      options: [],
      elements: [],
      raw: {
        reason: `${environment} environment`,
        preview: environmentPreview(ctx, text, slice, environment, prefix),
      },
    };
  }
  if (command === 'node' || command === 'coordinate')
    return parseNodeStatement(ctx, text, slice, command, index);
  if (command === 'draw' || command === 'path' || command === 'fill' || command === 'filldraw')
    return parsePathStatement(ctx, text, slice, command, index);
  registerRawNames(ctx, statement);
  if (command === 'foreach')
    return {
      kind: 'foreach',
      command,
      options: [],
      elements: [],
      raw: { reason: '\\foreach loop', preview: foreachPreview(ctx, text, slice, prefix) },
    };
  if (command === 'tikzset' || command === 'tikzstyle') {
    const open = statement.indexOf(command === 'tikzset' ? '{' : '[');
    const close =
      open < 0
        ? undefined
        : readGroup(statement, open, statement[open] ?? '{', command === 'tikzset' ? '}' : ']');
    if (open >= 0 && close !== undefined) {
      const options = parseOptionList(
        ctx,
        statement.slice(open + 1, close - 1),
        slice.start + open + 1,
      );
      if (command === 'tikzset') registerStyles(ctx, options);
      else {
        const name = /^\\tikzstyle\s*\{([^}]+)\}/u.exec(statement)?.[1]?.trim();
        if (name) ctx.styles[name] = styleDefinitionFromOptions(ctx, options, new Set([name]));
      }
    }
    return {
      kind: 'styles',
      command,
      options: [],
      elements: [],
      raw: { reason: 'TikZ style definitions' },
    };
  }
  if (command && !slice.terminated && PATH_COMMANDS.has(command))
    report(ctx, `Missing ";" after \\${command}.`, slice.end, 'error', 'TIKZ_MISSING_SEMICOLON');
  return rawOutcome(
    'raw',
    command,
    command ? `\\${command} is not visually editable` : 'Unrecognized TikZ content',
  );
}

// ---------------------------------------------------------------------------------------------
// Document

interface PictureBounds {
  bodyStart: number;
  bodyEnd: number;
  prefixEnd: number;
  suffixStart: number;
  options?: { start: number; end: number };
}

function locatePicture(ctx: Context, masked: string): PictureBounds {
  const begin = /\\begin\s*\{tikzpicture\}/u.exec(masked);
  if (!begin)
    return { bodyStart: 0, bodyEnd: masked.length, prefixEnd: 0, suffixStart: masked.length };
  let bodyStart = begin.index + begin[0].length;
  let options: PictureBounds['options'];
  const optionsStart = skipWhitespace(masked, bodyStart);
  if (masked[optionsStart] === '[') {
    const end = readGroup(masked, optionsStart, '[', ']');
    if (end !== undefined) {
      options = { start: optionsStart + 1, end: end - 1 };
      bodyStart = end;
    }
  }
  const close = findEnvironmentEnd(masked, begin.index, masked.length, 'tikzpicture');
  if (!close) {
    report(
      ctx,
      'TikZ picture is missing \\end{tikzpicture}.',
      bodyStart,
      'error',
      'TIKZ_UNCLOSED_ENV',
    );
    return {
      bodyStart,
      bodyEnd: masked.length,
      prefixEnd: begin.index,
      suffixStart: masked.length,
      options,
    };
  }
  return {
    bodyStart,
    bodyEnd: close.start,
    prefixEnd: begin.index,
    suffixStart: close.end,
    options,
  };
}

/** Parses source and returns a project even when diagnostics exist, so the editor can retain context. */
export function parseTikz(source: string, options: ParseOptions = {}): ParseResult {
  const masked = maskComments(source);
  const settings: Settings = {
    pixelsPerCm: options.pixelsPerCm ?? DEFAULT_PIXELS_PER_CM,
    origin: { ...(options.origin ?? DEFAULT_ORIGIN) },
  };
  const project = createEmptyProject('Imported TikZ diagram');
  project.settings.pixelsPerCm = settings.pixelsPerCm;
  project.settings.origin = { ...settings.origin };
  const ctx: Context = {
    source,
    settings,
    styles: {},
    nodeDistance: { vertical: 1, horizontal: 1 },
    diagnostics: [],
    nodes: new Map(),
    irNodes: new Set(),
    externalNames: new Set(),
    externalPrefixes: [],
    usedIds: new Set(),
    generatedIds: [],
    depth: 0,
    previewBudget: { remaining: MAX_PREVIEW_SHAPES },
  };
  const picture = locatePicture(ctx, masked);
  if (picture.options) {
    project.pictureOptions = source.slice(picture.options.start, picture.options.end);
    registerStyles(
      ctx,
      parseOptionList(
        ctx,
        masked.slice(picture.options.start, picture.options.end),
        picture.options.start,
      ),
    );
  }
  const sourceMap: SourceMap = {};
  const statements: TikzStatement[] = [];
  const statementOf = new Map<string, Slice & { index: number }>();
  sliceStatements(masked, picture.bodyStart, picture.bodyEnd).forEach((slice, index) => {
    const outcome = parseStatement(ctx, masked, slice, index);
    const range = sourceRange(source, slice.start, slice.end);
    const elements: DiagramElement[] = outcome.elements;
    if (outcome.raw) {
      const raw: RawTikzBlock = {
        id: claimId(ctx, `raw_${pad(index)}`, 'raw'),
        type: 'raw-tikz',
        layer: 'overlays',
        visible: true,
        locked: true,
        rotation: 0,
        source: source.slice(slice.start, slice.end),
        reason: outcome.raw.reason,
        editable: false,
      };
      if (outcome.raw.preview?.length) raw.preview = outcome.raw.preview;
      elements.push(raw);
      report(
        ctx,
        `Kept as TikZ source (not visually editable): ${outcome.raw.reason}.`,
        slice.start,
        'info',
        'TIKZ_RAW_BLOCK',
      );
    }
    for (const element of elements) {
      element.sourceRange = range;
      sourceMap[element.id] = { startOffset: slice.start, endOffset: slice.end };
      statementOf.set(element.id, { ...slice, index });
    }
    project.elements.push(...elements);
    statements.push({
      kind: outcome.kind,
      command: outcome.command,
      range,
      options: outcome.options,
      elementIds: elements.map((element) => element.id),
    });
  });

  // Edges between nodes that only unsupported TikZ defines stay raw so the IR never dangles.
  const irNodes = new Set(project.elements.filter(isNodeElement).map((element) => element.id));
  project.elements = project.elements.map((element) => {
    if (!isEdgeElement(element)) return element;
    const missing = [element.from, element.to].filter((id) => !irNodes.has(id));
    if (!missing.length) return element;
    const external = missing.every((id) => ctx.nodes.has(id) || isKnownExternal(ctx, id));
    const statement = statementOf.get(element.id);
    if (!external || !statement) return element;
    delete sourceMap[element.id];
    const raw: RawTikzBlock = {
      id: claimId(ctx, `raw_${pad(statement.index)}`, 'raw'),
      type: 'raw-tikz',
      layer: 'overlays',
      visible: true,
      locked: true,
      rotation: 0,
      source: source.slice(statement.start, statement.end),
      reason: 'Connects nodes defined by unsupported TikZ',
      editable: false,
      sourceRange: element.sourceRange,
    };
    if (missing.every((id) => ctx.nodes.has(id))) raw.preview = [{ ...element, locked: true }];
    sourceMap[raw.id] = { startOffset: statement.start, endOffset: statement.end };
    return raw;
  });

  project.styles = ctx.styles;
  project.rawTikzBlocks = project.elements.filter(
    (element): element is RawTikzBlock => element.type === 'raw-tikz',
  );
  const prefix = source.slice(0, picture.prefixEnd);
  const suffix = source.slice(picture.suffixStart);
  if (prefix.trim() || suffix.trim()) project.documentWrapper = { prefix, suffix };
  const validation = validateProject(project);
  ctx.diagnostics.push(
    ...validation.errors.map((error) => {
      const id = /"([^"]+)"/u.exec(error.message)?.[1];
      const range = id ? sourceMap[id] : undefined;
      return {
        ...error,
        ...(range ? lineColumn(source, range.startOffset) : {}),
        severity: 'error' as const,
      };
    }),
  );
  const generated = new Set(ctx.generatedIds);
  return {
    ast: {
      kind: 'document',
      source,
      bodyRange: sourceRange(source, picture.bodyStart, picture.bodyEnd),
      wrapperPrefix: prefix,
      wrapperSuffix: suffix,
      pictureOptions: project.pictureOptions,
      statements,
      tokens: lex(source),
    },
    project,
    diagnostics: ctx.diagnostics,
    valid: ctx.diagnostics.every((item) => item.severity !== 'error'),
    sourceMap,
    generatedIds: project.elements.map((element) => element.id).filter((id) => generated.has(id)),
  };
}

export function diagnosticsForTikz(source: string): Diagnostic[] {
  return parseTikz(source).diagnostics;
}
