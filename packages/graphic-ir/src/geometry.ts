import type {
  DiagramElement,
  EdgeElement,
  NodeElement,
  PlotElement,
  Point,
  Project,
  ProjectSettings,
} from './index';

/** TeX points per centimetre. */
export const PT_PER_CM = 72.27 / 2.54;

type CoordinateSettings = Pick<ProjectSettings, 'pixelsPerCm'> &
  Partial<Pick<ProjectSettings, 'origin'>>;

const FALLBACK_ORIGIN: Point = { x: 120, y: 360 };

export function canvasToTikzPoint(point: Point, settings: CoordinateSettings): Point {
  const origin = settings.origin ?? FALLBACK_ORIGIN;
  return {
    x: (point.x - origin.x) / settings.pixelsPerCm,
    y: (origin.y - point.y) / settings.pixelsPerCm,
  };
}

export function tikzToCanvasPoint(point: Point, settings: CoordinateSettings): Point {
  const origin = settings.origin ?? FALLBACK_ORIGIN;
  return {
    x: origin.x + point.x * settings.pixelsPerCm,
    y: origin.y - point.y * settings.pixelsPerCm,
  };
}

export function pxToPt(px: number, pixelsPerCm: number): number {
  return (px / pixelsPerCm) * PT_PER_CM;
}

export function ptToPx(pt: number, pixelsPerCm: number): number {
  return (pt / PT_PER_CM) * pixelsPerCm;
}

/** Visible characters of node text once TeX markup is stripped, for size estimates. */
function visibleText(text: string): string {
  return text
    .replace(/\\[A-Za-z]+\s*/gu, '')
    .replace(/[{}$^_]/gu, '')
    .trim();
}

/**
 * Approximates the size TikZ gives a node that has no minimum size: its text plus the default
 * `inner sep` (0.3333em) on every side.
 */
export function estimateNodeSize(
  text: string,
  fontSize: number,
  textWidth?: number,
): { width: number; height: number } {
  const innerSep = fontSize * 0.3333;
  const lines = text.split(/\\\\/u);
  const longest = Math.max(1, ...lines.map((line) => visibleText(line).length));
  const naturalWidth = longest * fontSize * 0.5;
  const contentWidth = textWidth ?? naturalWidth;
  const wrappedLines = textWidth ? Math.max(1, Math.ceil(naturalWidth / textWidth)) : lines.length;
  return {
    width: Math.round(contentWidth + innerSep * 2),
    height: Math.round(fontSize * 1.2 * wrappedLines + innerSep * 2),
  };
}

/** Size TikZ gives a node of this shape with no minimum size. */
export function autoNodeSize(
  shape: 'rectangle' | 'circle' | 'ellipse',
  text: string,
  style: Pick<NodeElement['style'], 'fontSize' | 'textWidth'>,
): { width: number; height: number } {
  const estimate = estimateNodeSize(text, style.fontSize, style.textWidth);
  if (shape === 'circle') {
    const size = Math.round(Math.hypot(estimate.width, estimate.height));
    return { width: size, height: size };
  }
  const factor = shape === 'ellipse' ? Math.SQRT2 : 1;
  return {
    width: Math.round(estimate.width * factor),
    height: Math.round(estimate.height * factor),
  };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'rectangle' | 'circle' | 'ellipse' | 'point';
}

function boxOf(element: DiagramElement): Box | undefined {
  if (!('x' in element) || !('y' in element)) return undefined;
  if (element.type === 'coordinate')
    return { x: element.x, y: element.y, width: 0, height: 0, shape: 'point' };
  const width = 'width' in element ? element.width : 0;
  const height = 'height' in element ? element.height : 0;
  if (element.type === 'circle') {
    const size = Math.min(width, height);
    return { x: element.x, y: element.y, width: size, height: size, shape: 'circle' };
  }
  if (element.type === 'ellipse')
    return { x: element.x, y: element.y, width, height, shape: 'ellipse' };
  return { x: element.x, y: element.y, width, height, shape: 'rectangle' };
}

function borderPoint(box: Box, direction: Point): Point {
  const length = Math.hypot(direction.x, direction.y);
  if (box.shape === 'point' || length === 0) return { x: box.x, y: box.y };
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  let scale: number;
  if (box.shape === 'rectangle') {
    const sx = direction.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(direction.x);
    const sy = direction.y === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(direction.y);
    scale = Math.min(sx, sy);
  } else if (halfWidth === 0 || halfHeight === 0) {
    scale = 0;
  } else {
    scale = 1 / Math.hypot(direction.x / halfWidth, direction.y / halfHeight);
  }
  return { x: box.x + direction.x * scale, y: box.y + direction.y * scale };
}

/** Unit vector on the canvas (y down) for a TikZ angle in degrees (y up). */
function angleVector(degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return { x: Math.cos(radians), y: -Math.sin(radians) };
}

const COMPASS: Record<string, [number, number]> = {
  east: [1, 0],
  'north east': [1, -1],
  north: [0, -1],
  'north west': [-1, -1],
  west: [-1, 0],
  'south west': [-1, 1],
  south: [0, 1],
  'south east': [1, 1],
};

function anchorPoint(box: Box, anchor: string): Point {
  const name = anchor.trim();
  const compass = COMPASS[name];
  if (compass) {
    if (box.shape === 'rectangle')
      return {
        x: box.x + (compass[0] * box.width) / 2,
        y: box.y + (compass[1] * box.height) / 2,
      };
    return borderPoint(box, { x: compass[0], y: compass[1] });
  }
  const angle = Number.parseFloat(name);
  if (Number.isFinite(angle)) return borderPoint(box, angleVector(angle));
  return { x: box.x, y: box.y };
}

/** Canvas point of `node.anchor` (center when no anchor is given). */
export function nodeAnchorPoint(element: DiagramElement, anchor?: string): Point | undefined {
  const box = boxOf(element);
  if (!box) return undefined;
  return anchor ? anchorPoint(box, anchor) : { x: box.x, y: box.y };
}

export interface EdgeGeometry {
  /** SVG path data in canvas coordinates. */
  d: string;
  start: Point;
  end: Point;
  /** Where TikZ puts a `midway` label. */
  label: Point;
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function round(point: Point): Point {
  return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
}

/**
 * Canvas geometry of an edge: endpoints sit on node borders (or named anchors) so arrow tips stay
 * visible, and bends/orthogonal routes follow TikZ's `bend left` and `-|` conventions.
 */
export function edgeGeometry(
  edge: EdgeElement,
  lookup: (id: string) => DiagramElement | undefined,
): EdgeGeometry | undefined {
  const fromElement = lookup(edge.from);
  const toElement = lookup(edge.to);
  const from = fromElement ? boxOf(fromElement) : undefined;
  const to = toElement ? boxOf(toElement) : undefined;
  if (!from || !to) return undefined;
  const fromFixed = edge.fromAnchor ? anchorPoint(from, edge.fromAnchor) : undefined;
  const toFixed = edge.toAnchor ? anchorPoint(to, edge.toAnchor) : undefined;
  const fromRef = fromFixed ?? { x: from.x, y: from.y };
  const toRef = toFixed ?? { x: to.x, y: to.y };
  const toward = (box: Box, target: Point): Point =>
    borderPoint(box, { x: target.x - box.x, y: target.y - box.y });

  if (edge.route) {
    const corner =
      edge.route === '-|' ? { x: toRef.x, y: fromRef.y } : { x: fromRef.x, y: toRef.y };
    const start = round(fromFixed ?? toward(from, corner));
    const end = round(toFixed ?? toward(to, corner));
    return {
      d: `M ${start.x} ${start.y} L ${corner.x} ${corner.y} L ${end.x} ${end.y}`,
      start,
      end,
      label: corner,
    };
  }

  if (edge.bend) {
    const direction = (Math.atan2(-(toRef.y - fromRef.y), toRef.x - fromRef.x) * 180) / Math.PI;
    const outAngle = direction + edge.bend;
    const inAngle = direction + 180 - edge.bend;
    const start = fromFixed ?? borderPoint(from, angleVector(outAngle));
    const end = toFixed ?? borderPoint(to, angleVector(inAngle));
    const distance = Math.hypot(end.x - start.x, end.y - start.y) * 0.3915;
    const outVector = angleVector(outAngle);
    const inVector = angleVector(inAngle);
    const c1 = { x: start.x + outVector.x * distance, y: start.y + outVector.y * distance };
    const c2 = { x: end.x + inVector.x * distance, y: end.y + inVector.y * distance };
    const [s, a, b, e] = [start, c1, c2, end].map(round) as [Point, Point, Point, Point];
    return {
      d: `M ${s.x} ${s.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${e.x} ${e.y}`,
      start: s,
      end: e,
      label: round(cubicPoint(s, a, b, e, 0.5)),
    };
  }

  if (edge.type === 'curved-arrow' && edge.controlPoints?.length) {
    const c1 = edge.controlPoints[0] ?? fromRef;
    const c2 = edge.controlPoints[1] ?? c1;
    const start = round(fromFixed ?? toward(from, c1));
    const end = round(toFixed ?? toward(to, c2));
    return {
      d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
      start,
      end,
      label: round(cubicPoint(start, c1, c2, end, 0.5)),
    };
  }

  const start = round(fromFixed ?? toward(from, toRef));
  const end = round(toFixed ?? toward(to, fromRef));
  return {
    d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    start,
    end,
    label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

/**
 * Where the positioning library puts `node` for `relation=distance of target`: border to border
 * along each axis the relation names.
 */
export function relativePlacement(
  node: NodeElement,
  target: DiagramElement,
  pixelsPerCm: number,
): Point | undefined {
  if (node.position.mode !== 'relative' || !('x' in target) || !('y' in target)) return undefined;
  const position = node.position;
  const targetWidth = 'width' in target && target.type !== 'coordinate' ? target.width : 0;
  const targetHeight = 'height' in target && target.type !== 'coordinate' ? target.height : 0;
  const width = node.type === 'coordinate' ? 0 : node.width;
  const height = node.type === 'coordinate' ? 0 : node.height;
  const distance = position.distance * pixelsPerCm;
  const horizontal = position.relation.includes('right')
    ? 1
    : position.relation.includes('left')
      ? -1
      : 0;
  const vertical = position.relation.includes('below')
    ? 1
    : position.relation.includes('above')
      ? -1
      : 0;
  return {
    x: target.x + horizontal * (targetWidth / 2 + width / 2 + distance),
    y: target.y + vertical * (targetHeight / 2 + height / 2 + distance),
  };
}

/**
 * Recomputes the canvas position of every relatively positioned node (`right=of A`) from its
 * target, following chains.
 */
export function resolveRelativePositions(project: Project): {
  project: Project;
  missingTargets: string[];
} {
  const elements = [...project.elements];
  const indexById = new Map(elements.map((element, index) => [element.id, index]));
  const missingTargets: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const resolve = (index: number): void => {
    const node = elements[index];
    if (!node || !isRelativeNode(node) || state.has(node.id)) return;
    state.set(node.id, 'visiting');
    const position = node.position;
    const targetIndex = position.mode === 'relative' ? indexById.get(position.target) : undefined;
    if (targetIndex === undefined) {
      missingTargets.push(node.id);
    } else {
      resolve(targetIndex);
      const target = elements[targetIndex];
      const placement = target
        ? relativePlacement(node, target, project.settings.pixelsPerCm)
        : undefined;
      if (placement && (placement.x !== node.x || placement.y !== node.y))
        elements[index] = { ...node, ...placement };
    }
    state.set(node.id, 'done');
  };

  elements.forEach((_, index) => resolve(index));
  const changed = elements.some((element, index) => element !== project.elements[index]);
  return { project: changed ? { ...project, elements } : project, missingTargets };
}

function isRelativeNode(element: DiagramElement): element is NodeElement {
  return 'position' in element && element.position.mode === 'relative';
}

export interface PlotGeometry {
  frame: { x: number; y: number; width: number; height: number };
  points: Point[];
}

/** Maps plot data into the plot's canvas frame (y up inside the frame, like an axis). */
export function plotGeometry(plot: PlotElement): PlotGeometry {
  const frame = {
    x: plot.x - plot.width / 2,
    y: plot.y - plot.height / 2,
    width: plot.width,
    height: plot.height,
  };
  if (plot.data.length === 0) return { frame, points: [] };
  const xs = plot.data.map((point) => point.x);
  const ys = plot.data.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.08;
  const innerX = frame.x + frame.width * pad;
  const innerY = frame.y + frame.height * pad;
  const innerWidth = frame.width * (1 - pad * 2);
  const innerHeight = frame.height * (1 - pad * 2);
  return {
    frame,
    points: plot.data.map((point) => ({
      x: innerX + ((point.x - minX) / (maxX - minX || 1)) * innerWidth,
      y: innerY + innerHeight - ((point.y - minY) / (maxY - minY || 1)) * innerHeight,
    })),
  };
}
