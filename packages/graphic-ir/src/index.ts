/**
 * LaTeX-independent domain model used by every editor surface.
 *
 * Coordinates are canvas pixels. TikZ conversion belongs to the serializer/parser boundary and
 * uses `project.settings.pixelsPerCm`.
 */

export const GRAPHIC_IR_FORMAT = 'latex-diagram-project' as const;
export const GRAPHIC_IR_VERSION = '1.0' as const;

/** 50 px per cm keeps the default 14 px canvas text close to LaTeX's \footnotesize. */
export const DEFAULT_PIXELS_PER_CM = 50;
export const DEFAULT_ORIGIN: Readonly<Point> = { x: 120, y: 360 };

export type ElementLayer = 'background' | 'connections' | 'nodes' | 'labels' | 'overlays';

export type PrimitiveNodeType =
  'rectangle' | 'circle' | 'ellipse' | 'text' | 'formula' | 'coordinate' | 'image';

export type EdgeType = 'line' | 'arrow' | 'bidirectional-arrow' | 'dashed-arrow' | 'curved-arrow';

export type PlotType = 'line' | 'scatter' | 'bar' | 'function';

export interface Point {
  x: number;
  y: number;
}

export interface SourceRange {
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
}

export interface AbsolutePosition {
  mode: 'absolute';
}

export interface RelativePosition {
  mode: 'relative';
  target: string;
  relation:
    | 'above'
    | 'below'
    | 'left'
    | 'right'
    | 'above left'
    | 'above right'
    | 'below left'
    | 'below right';
  distance: number;
}

export type ElementPosition = AbsolutePosition | RelativePosition;

export interface NodeStyle {
  fill: string;
  stroke: string;
  lineWidth: number;
  rounded: boolean;
  dashed?: boolean;
  opacity?: number;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  textColor: string;
  align: 'left' | 'center' | 'right';
  textWidth?: number;
}

export interface EdgeStyle {
  stroke: string;
  lineWidth: number;
  arrow: 'none' | 'stealth' | 'latex' | 'triangle';
  dashed: boolean;
  opacity?: number;
}

export interface PlotStyle {
  stroke: string;
  fill: string;
  lineWidth: number;
  pointRadius: number;
  showPoints: boolean;
}

export interface ElementBase {
  id: string;
  layer: ElementLayer;
  visible: boolean;
  locked: boolean;
  rotation: number;
  sourceRange?: SourceRange;
  plugin?: string;
}

export interface NodeElement extends ElementBase {
  type: PrimitiveNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  style: NodeStyle;
  position: ElementPosition;
  /** Formula/Image elements can retain their original payload without losing visual fallback text. */
  source?: string;
  href?: string;
  /**
   * `fixed` sizes are emitted as TikZ minimum width/height; `auto` nodes size to their text like
   * plain TikZ nodes. Missing means `fixed`, which is what canvas-created nodes use.
   */
  sizeMode?: 'auto' | 'fixed';
  /** Named TikZ styles applied to the node, in option order (e.g. `box` from `box/.style`). */
  styleRefs?: string[];
  /** TikZ options the IR does not model (e.g. `inner sep=2pt`), re-emitted verbatim. */
  extraOptions?: string[];
}

export interface EdgeElement extends ElementBase {
  type: EdgeType;
  from: string;
  to: string;
  points?: Point[];
  controlPoints?: Point[];
  style: EdgeStyle;
  label?: string;
  /** Extra options for the label node, e.g. `above` or `sloped, below`. */
  labelOptions?: string;
  /** TikZ anchor such as `east`, `north west` or an angle; the border point is used when absent. */
  fromAnchor?: string;
  toAnchor?: string;
  /** `bend left` angle in degrees; negative values bend right. */
  bend?: number;
  /** Orthogonal routing: `-|` goes horizontal first, `|-` vertical first. */
  route?: '-|' | '|-';
  /** Verbatim arrow option such as `-Stealth` or `<->`, kept so round-trips don't rewrite it. */
  arrowSpec?: string;
  /** Named TikZ styles applied to the path, in option order. */
  styleRefs?: string[];
  /** TikZ options the IR does not model (e.g. `shorten >=2pt`), re-emitted verbatim. */
  extraOptions?: string[];
}

export interface GroupElement extends ElementBase {
  type: 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  children: string[];
  name: string;
}

export interface PlotElement extends ElementBase {
  type: 'plot';
  x: number;
  y: number;
  width: number;
  height: number;
  plotType: PlotType;
  data: Point[];
  expression?: string;
  style: PlotStyle;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** Verbatim `\addplot[...]` options. */
  addplotOptions?: string;
  /** Axis options the IR does not model (e.g. `grid=major`), re-emitted verbatim. */
  extraOptions?: string[];
}

export interface RawTikzBlock extends ElementBase {
  type: 'raw-tikz';
  source: string;
  reason: string;
  editable: false;
  /**
   * Read-only shapes the block draws (e.g. an unrolled `\foreach`), shown on the canvas but never
   * serialized or edited.
   */
  preview?: PreviewShape[];
}

/** A plain drawn path inside a raw block's preview, in canvas coordinates. */
export interface PreviewPath {
  id: string;
  type: 'preview-path';
  d: string;
  stroke: string;
  fill: string;
  lineWidth: number;
  dashed: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export type PreviewShape = NodeElement | EdgeElement | PlotElement | PreviewPath;

export type DiagramElement = NodeElement | EdgeElement | GroupElement | PlotElement | RawTikzBlock;

export function isNodeElement(element: DiagramElement): element is NodeElement {
  return (
    element.type === 'rectangle' ||
    element.type === 'circle' ||
    element.type === 'ellipse' ||
    element.type === 'text' ||
    element.type === 'formula' ||
    element.type === 'coordinate' ||
    element.type === 'image'
  );
}

export function isEdgeElement(element: DiagramElement): element is EdgeElement {
  return (
    element.type === 'line' ||
    element.type === 'arrow' ||
    element.type === 'bidirectional-arrow' ||
    element.type === 'dashed-arrow' ||
    element.type === 'curved-arrow'
  );
}

export interface ProjectMetadata {
  title: string;
  description?: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasSettings {
  width: number;
  height: number;
  background: string;
}

export interface ProjectSettings {
  grid: boolean;
  snap: boolean;
  gridSize: number;
  pixelsPerCm: number;
  /** Canvas point that maps to TikZ (0,0). TikZ y grows upward while canvas y grows downward. */
  origin: Point;
  compilerMode: 'server' | 'browser' | 'fast';
  previewMode: 'fast' | 'latex';
}

/** A named TikZ style (`name/.style={...}`); lengths are canvas pixels. */
export interface TikzStyleDefinition {
  draw?: boolean;
  rounded?: boolean;
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  dashed?: boolean;
  fontSize?: number;
  fontWeight?: NodeStyle['fontWeight'];
  textColor?: string;
  textWidth?: number;
  align?: NodeStyle['align'];
  minimumWidth?: number;
  minimumHeight?: number;
  shape?: 'rectangle' | 'circle' | 'ellipse';
  /** Arrow option a path style sets, e.g. `-Stealth`. */
  arrowSpec?: string;
}

export interface Project {
  format: typeof GRAPHIC_IR_FORMAT;
  version: typeof GRAPHIC_IR_VERSION;
  metadata: ProjectMetadata;
  canvas: CanvasSettings;
  elements: DiagramElement[];
  styles: Record<string, TikzStyleDefinition>;
  rawTikzBlocks: RawTikzBlock[];
  settings: ProjectSettings;
  /** Verbatim `\begin{tikzpicture}[...]` options (named styles, node distance, ...). */
  pictureOptions?: string;
  /** Optional full-document wrapper retained when importing a .tex file. */
  documentWrapper?: {
    prefix: string;
    suffix: string;
  };
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  code?: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export const DEFAULT_NODE_STYLE: NodeStyle = {
  fill: '#101827',
  stroke: '#6f83a7',
  lineWidth: 1.4,
  rounded: true,
  fontSize: 14,
  fontWeight: 'normal',
  textColor: '#e6edf7',
  align: 'center',
};

export const DEFAULT_EDGE_STYLE: EdgeStyle = {
  stroke: '#91a4c6',
  lineWidth: 1.4,
  arrow: 'stealth',
  dashed: false,
};

export const DEFAULT_PLOT_STYLE: PlotStyle = {
  stroke: '#65d1b8',
  fill: '#65d1b833',
  lineWidth: 2,
  pointRadius: 3,
  showPoints: true,
};

function now(): string {
  return new Date().toISOString();
}

/** Creates a stable-enough local id without coupling the model to a particular id package. */
export function createElementId(prefix: string, existing: Iterable<string> = []): string {
  const used = new Set(existing);
  let index = 1;
  let candidate = `${prefix}_${String(index).padStart(2, '0')}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${prefix}_${String(index).padStart(2, '0')}`;
  }
  return candidate;
}

export function createEmptyProject(title = 'Untitled diagram'): Project {
  const timestamp = now();
  return {
    format: GRAPHIC_IR_FORMAT,
    version: GRAPHIC_IR_VERSION,
    metadata: {
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    canvas: { width: 1280, height: 720, background: '#0b1020' },
    elements: [],
    styles: {},
    rawTikzBlocks: [],
    settings: {
      grid: true,
      snap: true,
      gridSize: 20,
      pixelsPerCm: DEFAULT_PIXELS_PER_CM,
      origin: { ...DEFAULT_ORIGIN },
      compilerMode: 'fast',
      previewMode: 'fast',
    },
  };
}

export function createNode(
  type: PrimitiveNodeType,
  values: Partial<
    Pick<NodeElement, 'id' | 'x' | 'y' | 'width' | 'height' | 'text' | 'position'>
  > & { style?: Partial<NodeStyle> } = {},
  existingIds: Iterable<string> = [],
): NodeElement {
  const id = values.id ?? createElementId(type === 'text' ? 'text' : 'node', existingIds);
  return {
    id,
    type,
    x: values.x ?? 240,
    y: values.y ?? 180,
    width: values.width ?? (type === 'text' || type === 'formula' ? 180 : 160),
    height: values.height ?? (type === 'text' || type === 'formula' ? 42 : 64),
    text: values.text ?? (type === 'text' ? 'Label' : 'Node'),
    style: { ...DEFAULT_NODE_STYLE, ...(values.style ?? {}) },
    position: values.position ?? { mode: 'absolute' },
    layer: type === 'text' || type === 'formula' ? 'labels' : 'nodes',
    visible: true,
    locked: false,
    rotation: 0,
  };
}

export function createArrow(
  from: string,
  to: string,
  values: Partial<Pick<EdgeElement, 'id' | 'type' | 'label'>> & { style?: Partial<EdgeStyle> } = {},
  existingIds: Iterable<string> = [],
): EdgeElement {
  return {
    id: values.id ?? createElementId('edge', existingIds),
    type: values.type ?? 'arrow',
    from,
    to,
    style: { ...DEFAULT_EDGE_STYLE, ...(values.style ?? {}) },
    label: values.label,
    layer: 'connections',
    visible: true,
    locked: false,
    rotation: 0,
  };
}

export function createPlot(
  values: Partial<
    Pick<
      PlotElement,
      | 'id'
      | 'x'
      | 'y'
      | 'width'
      | 'height'
      | 'plotType'
      | 'data'
      | 'expression'
      | 'title'
      | 'xLabel'
      | 'yLabel'
    >
  > & { style?: Partial<PlotStyle> } = {},
  existingIds: Iterable<string> = [],
): PlotElement {
  return {
    id: values.id ?? createElementId('plot', existingIds),
    type: 'plot',
    x: values.x ?? 300,
    y: values.y ?? 300,
    width: values.width ?? 320,
    height: values.height ?? 200,
    plotType: values.plotType ?? 'line',
    data: values.data ?? [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 3 },
    ],
    ...(values.expression !== undefined ? { expression: values.expression } : {}),
    ...(values.title !== undefined ? { title: values.title } : {}),
    ...(values.xLabel !== undefined ? { xLabel: values.xLabel } : {}),
    ...(values.yLabel !== undefined ? { yLabel: values.yLabel } : {}),
    style: { ...DEFAULT_PLOT_STYLE, ...(values.style ?? {}) },
    layer: 'nodes',
    visible: true,
    locked: false,
    rotation: 0,
  };
}

export function createStarterProject(): Project {
  const project = createEmptyProject('Scientific flowchart');
  const input = createNode('rectangle', {
    id: 'input',
    x: 230,
    y: 260,
    text: 'Input',
    style: { fill: '#163250' },
  });
  const model = createNode('rectangle', {
    id: 'model',
    x: 540,
    y: 260,
    text: 'Transformer',
    style: { fill: '#382650' },
  });
  const output = createNode('rectangle', {
    id: 'output',
    x: 850,
    y: 260,
    text: 'Output',
    style: { fill: '#18443b' },
  });
  project.elements = [
    input,
    model,
    output,
    createArrow(input.id, model.id, { id: 'edge_input_model' }),
    createArrow(model.id, output.id, { id: 'edge_model_output' }),
  ];
  return project;
}

export function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

export function cloneElement(element: DiagramElement, newId: string): DiagramElement {
  return { ...JSON.parse(JSON.stringify(element)), id: newId } as DiagramElement;
}

export function getElement(project: Project, id: string): DiagramElement | undefined {
  return project.elements.find((element) => element.id === id);
}

export function getNode(project: Project, id: string): NodeElement | undefined {
  const element = getElement(project, id);
  return element &&
    'x' in element &&
    'width' in element &&
    element.type !== 'group' &&
    element.type !== 'plot'
    ? (element as NodeElement)
    : undefined;
}

export function elementIds(project: Project): Set<string> {
  return new Set(project.elements.map((element) => element.id));
}

export function validateProject(project: Project): ValidationResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const element of project.elements) {
    if (!element.id.trim()) {
      errors.push({
        severity: 'error',
        message: 'Every element needs a stable id.',
        line: 1,
        column: 1,
        code: 'IR_ID',
      });
    }
    if (ids.has(element.id)) {
      errors.push({
        severity: 'error',
        message: `Duplicate element id "${element.id}".`,
        line: 1,
        column: 1,
        code: 'IR_DUPLICATE_ID',
      });
    }
    ids.add(element.id);
    if ('x' in element && !Number.isFinite(element.x)) {
      errors.push({
        severity: 'error',
        message: `${element.id} has an invalid x coordinate.`,
        line: 1,
        column: 1,
        code: 'IR_COORDINATE',
      });
    }
    if ('y' in element && !Number.isFinite(element.y)) {
      errors.push({
        severity: 'error',
        message: `${element.id} has an invalid y coordinate.`,
        line: 1,
        column: 1,
        code: 'IR_COORDINATE',
      });
    }
    if (element.type === 'raw-tikz' && element.editable) {
      errors.push({
        severity: 'error',
        message: 'Raw TikZ blocks must be read-only.',
        line: 1,
        column: 1,
        code: 'IR_RAW_EDITABLE',
      });
    }
    if (element.type === 'plot' && element.data.length === 0) {
      warnings.push({
        severity: 'warning',
        message: `Plot "${element.id}" has no data points.`,
        line: 1,
        column: 1,
        code: 'IR_EMPTY_PLOT',
      });
    }
  }
  for (const edge of project.elements.filter(
    (element): element is EdgeElement => 'from' in element && 'to' in element,
  )) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      errors.push({
        severity: 'error',
        message: `Edge "${edge.id}" references a missing node.`,
        line: 1,
        column: 1,
        code: 'IR_EDGE_REFERENCE',
      });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function projectFromJson(input: unknown): Project {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Project JSON must be an object.');
  }
  const value = input as Partial<Project>;
  const base = createEmptyProject(value.metadata?.title ?? 'Imported diagram');
  const project: Project = {
    ...base,
    ...value,
    format: GRAPHIC_IR_FORMAT,
    version: GRAPHIC_IR_VERSION,
    metadata: { ...base.metadata, ...(value.metadata ?? {}) },
    canvas: { ...base.canvas, ...(value.canvas ?? {}) },
    settings: {
      ...base.settings,
      ...(value.settings ?? {}),
      origin: { ...base.settings.origin, ...(value.settings?.origin ?? {}) },
    },
    styles: value.styles ?? {},
    elements: Array.isArray(value.elements) ? (value.elements as DiagramElement[]) : [],
    rawTikzBlocks: Array.isArray(value.rawTikzBlocks)
      ? (value.rawTikzBlocks as RawTikzBlock[])
      : [],
  };
  const result = validateProject(project);
  if (!result.valid) {
    throw new Error(result.errors.map((error) => error.message).join(' '));
  }
  return project;
}

export function patchElement(
  project: Project,
  id: string,
  patch: Partial<DiagramElement>,
): Project {
  const elements = project.elements.map((element) => {
    if (element.id !== id) return element;
    return { ...element, ...patch } as DiagramElement;
  });
  return { ...project, elements, metadata: { ...project.metadata, updatedAt: now() } };
}

export function removeElements(project: Project, ids: ReadonlySet<string>): Project {
  const elements = project.elements.filter((element) => {
    if (ids.has(element.id)) return false;
    if (isEdgeElement(element) && (ids.has(element.from) || ids.has(element.to))) return false;
    return true;
  });
  return {
    ...project,
    elements: elements.map((element) => {
      if (element.type === 'group')
        return { ...element, children: element.children.filter((id) => !ids.has(id)) };
      return element;
    }),
    metadata: { ...project.metadata, updatedAt: now() },
  };
}

export function snapValue(value: number, gridSize: number, enabled: boolean): number {
  return enabled ? Math.round(value / gridSize) * gridSize : value;
}

export function elementBounds(
  element: DiagramElement,
): { x: number; y: number; width: number; height: number } | undefined {
  if ('x' in element && 'y' in element && 'width' in element && 'height' in element) {
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }
  return undefined;
}

/** Node text as shown on the canvas: common TeX escapes and line breaks are simplified. */
export function displayText(text: string): string {
  return text
    .replace(/\\\\/gu, ' ')
    .replace(/\\([%&#_$])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function formatNumber(value: number, precision = 3): string {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(precision)).toString();
}

export * from './color';
export * from './geometry';
export * from './style';
export { layoutProject } from './layout';
export type { LayoutDirection } from './layout';
export {
  AddElementCommand,
  BatchCommand,
  DeleteElementsCommand,
  UpdateElementCommand,
} from './commands';
export type { DiagramCommand } from './commands';

export function canvasToTikz(value: number, pixelsPerCm: number): number {
  return value / pixelsPerCm;
}

export function tikzToCanvas(value: number, pixelsPerCm: number): number {
  return value * pixelsPerCm;
}
