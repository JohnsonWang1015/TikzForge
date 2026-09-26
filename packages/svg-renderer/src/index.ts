import {
  DEFAULT_IMAGE_PATH,
  displayColor,
  displayText,
  edgeGeometry,
  isEdgeElement,
  isImageDataUrl,
  isNodeElement,
  plotGeometry,
  type DiagramElement,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type PreviewShape,
  type Project,
} from '@tikzforge/graphic-ir';

export interface SvgRenderOptions {
  includeBackground?: boolean;
  includeGrid?: boolean;
  /** Crop to the drawing (plus padding) instead of the whole canvas, like LaTeX's standalone. */
  fitToContent?: boolean;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Points of an SVG path produced by the IR renderers (M/L/C/A/Z with absolute coordinates). */
function pathPoints(d: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const [, command = '', args = ''] of d.matchAll(/([MLCAZ])([^MLCAZ]*)/gu)) {
    const numbers = (args.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
    if (command === 'A') {
      const x = numbers[5];
      const y = numbers[6];
      const r = Math.max(numbers[0] ?? 0, numbers[1] ?? 0);
      if (x !== undefined && y !== undefined)
        points.push({ x: x - r, y: y - r }, { x: x + r, y: y + r });
      continue;
    }
    for (let index = 0; index + 1 < numbers.length; index += 2)
      points.push({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
  }
  return points;
}

function contentBounds(
  project: Project,
  previews: PreviewShape[],
  lookup: Lookup,
): Bounds | undefined {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (x: number, y: number) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  };
  const shapes: Array<DiagramElement | PreviewShape> = [
    ...project.elements.filter((element) => element.visible),
    ...previews,
  ];
  for (const shape of shapes) {
    if (shape.type === 'preview-path') {
      for (const point of pathPoints(shape.d)) include(point.x, point.y);
    } else if (isEdgeElement(shape)) {
      const geometry = edgeGeometry(shape, lookup);
      if (geometry) for (const point of pathPoints(geometry.d)) include(point.x, point.y);
    } else if ((isNodeElement(shape) || shape.type === 'plot') && 'width' in shape) {
      include(shape.x - shape.width / 2, shape.y - shape.height / 2);
      include(shape.x + shape.width / 2, shape.y + shape.height / 2);
    }
  }
  return Number.isFinite(bounds.minX) ? bounds : undefined;
}

type Lookup = (id: string) => DiagramElement | undefined;

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function number(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The uploaded picture, or a dashed box naming the file LaTeX will include. */
function imageSvg(node: NodeElement, paint: string): string {
  const box = `x="${number(node.x - node.width / 2)}" y="${number(node.y - node.height / 2)}" width="${number(node.width)}" height="${number(node.height)}"`;
  if (isImageDataUrl(node.href))
    return `<image ${box} href="${node.href}" preserveAspectRatio="none" /><rect ${box} ${paint.replace(/fill="[^"]*"/u, 'fill="none"')} />`;
  const name = node.source || DEFAULT_IMAGE_PATH;
  return `<rect ${box} fill="#101827" stroke="#6f83a7" stroke-width="1" stroke-dasharray="6 4" /><text x="${number(node.x)}" y="${number(node.y + 4)}" text-anchor="middle" fill="#8fa1be" font-size="11">${escapeXml(name)}</text>`;
}

function nodeSvg(node: NodeElement, opacity = 1): string {
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const fill = displayColor(node.style.fill, 'fill');
  const stroke = displayColor(node.style.stroke, 'stroke');
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${number(node.style.lineWidth)}" stroke-dasharray="${node.style.dashed ? '6 4' : 'none'}"`;
  const shape =
    node.type === 'image'
      ? imageSvg(node, paint)
      : node.type === 'coordinate'
        ? `<path d="M ${number(node.x - 5)} ${number(node.y)} H ${number(node.x + 5)} M ${number(node.x)} ${number(node.y - 5)} V ${number(node.y + 5)}" stroke="${stroke}" stroke-width="1.2" />`
        : node.type === 'circle'
          ? `<circle cx="${number(node.x)}" cy="${number(node.y)}" r="${number(Math.min(node.width, node.height) / 2)}" ${paint} />`
          : node.type === 'ellipse'
            ? `<ellipse cx="${number(node.x)}" cy="${number(node.y)}" rx="${number(node.width / 2)}" ry="${number(node.height / 2)}" ${paint} />`
            : `<rect x="${number(x)}" y="${number(y)}" width="${number(node.width)}" height="${number(node.height)}" rx="${node.style.rounded ? number(Math.min(10, node.height / 4)) : 0}" ${paint} />`;
  const text = displayText(node.text);
  const anchor =
    node.style.align === 'left' ? 'start' : node.style.align === 'right' ? 'end' : 'middle';
  const label =
    text && node.type !== 'coordinate' && node.type !== 'image'
      ? `<text x="${number(node.x)}" y="${number(node.y + node.style.fontSize * 0.35)}" text-anchor="${anchor}" fill="${displayColor(node.style.textColor, 'text')}" font-size="${number(node.style.fontSize)}" font-weight="${node.style.fontWeight}">${escapeXml(text)}</text>`
      : '';
  return `<g id="${escapeXml(node.id)}" opacity="${opacity}" transform="rotate(${node.rotation} ${number(node.x)} ${number(node.y)})">${shape}${label}</g>`;
}

function edgeSvg(edge: EdgeElement, lookup: Lookup, opacity = 1): string {
  const geometry = edgeGeometry(edge, lookup);
  if (!geometry) return '';
  const stroke = displayColor(edge.style.stroke, 'stroke');
  const hasArrow = edge.type !== 'line' && edge.style.arrow !== 'none';
  const marker = hasArrow
    ? `${edge.type === 'bidirectional-arrow' ? ' marker-start="url(#arrow)"' : ''} marker-end="url(#arrow)"`
    : '';
  const dash = edge.style.dashed || edge.type === 'dashed-arrow' ? ' stroke-dasharray="7 5"' : '';
  const label = edge.label
    ? `<text x="${number(geometry.label.x)}" y="${number(geometry.label.y - 6)}" text-anchor="middle" fill="#c9d4e5" font-size="12">${escapeXml(displayText(edge.label))}</text>`
    : '';
  return `<g opacity="${opacity}"><path d="${geometry.d}" fill="none" stroke="${stroke}" color="${stroke}" stroke-width="${number(edge.style.lineWidth)}"${dash}${marker} />${label}</g>`;
}

function plotSvg(plot: PlotElement, opacity = 1): string {
  const { frame, points } = plotGeometry(plot);
  const box = `<rect x="${number(frame.x)}" y="${number(frame.y)}" width="${number(frame.width)}" height="${number(frame.height)}" fill="${plot.style.fill}" stroke="#6f83a7" />`;
  const path =
    plot.plotType === 'scatter' || plot.plotType === 'bar' || !points.length
      ? ''
      : `<path d="${points.map((point, index) => `${index ? 'L' : 'M'} ${number(point.x)} ${number(point.y)}`).join(' ')}" fill="none" stroke="${plot.style.stroke}" stroke-width="${plot.style.lineWidth}" />`;
  const baseline = frame.y + frame.height * 0.92;
  const barWidth = points.length ? Math.max(4, (frame.width * 0.6) / points.length) : 0;
  const marks = points
    .map((point) =>
      plot.plotType === 'bar'
        ? `<rect x="${number(point.x - barWidth / 2)}" y="${number(Math.min(point.y, baseline))}" width="${number(barWidth)}" height="${number(Math.abs(baseline - point.y))}" fill="${plot.style.stroke}" opacity="0.75" />`
        : plot.style.showPoints || plot.plotType === 'scatter'
          ? `<circle cx="${number(point.x)}" cy="${number(point.y)}" r="${plot.style.pointRadius}" fill="${plot.style.stroke}" />`
          : '',
    )
    .join('');
  return `<g id="${escapeXml(plot.id)}" opacity="${opacity}">${box}${path}${marks}</g>`;
}

function previewSvg(shape: PreviewShape, lookup: Lookup): string {
  const opacity = 0.7;
  if (shape.type === 'preview-path') {
    const stroke = displayColor(shape.stroke, 'stroke');
    const markers = `${shape.arrowStart ? ' marker-start="url(#arrow)"' : ''}${shape.arrowEnd ? ' marker-end="url(#arrow)"' : ''}`;
    return `<path opacity="${opacity}" d="${shape.d}" fill="${displayColor(shape.fill, 'fill')}" stroke="${stroke}" color="${stroke}" stroke-width="${number(shape.lineWidth)}"${shape.dashed ? ' stroke-dasharray="7 5"' : ''}${markers} />`;
  }
  if (shape.type === 'plot') return plotSvg(shape, opacity);
  if (isNodeElement(shape)) return nodeSvg(shape, opacity);
  return edgeSvg(shape, lookup, opacity);
}

/** Fast, deterministic IR renderer used by the browser and as the compiler fallback. */
export function renderProjectToSvg(project: Project, options: SvgRenderOptions = {}): string {
  const background =
    options.includeBackground === false
      ? ''
      : `<rect x="-100000" y="-100000" width="200000" height="200000" fill="${displayColor(project.canvas.background, 'fill')}" />`;
  const grid = options.includeGrid
    ? `<path d="M 20 0 V ${project.canvas.height} M 40 0 V ${project.canvas.height} M 0 20 H ${project.canvas.width} M 0 40 H ${project.canvas.width}" stroke="#ffffff08" />`
    : '';
  const defs =
    '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" /></marker></defs>';
  const visible = project.elements.filter((element) => element.visible);
  const byId = new Map<string, DiagramElement>();
  const previews: PreviewShape[] = [];
  for (const element of visible)
    if (element.type === 'raw-tikz') previews.push(...(element.preview ?? []));
  for (const shape of previews) if (shape.type !== 'preview-path') byId.set(shape.id, shape);
  for (const element of project.elements) byId.set(element.id, element);
  const lookup: Lookup = (id) => byId.get(id);
  const fitted = options.fitToContent ? contentBounds(project, previews, lookup) : undefined;
  const padding = 24;
  const view = fitted
    ? {
        x: Math.floor(fitted.minX - padding),
        y: Math.floor(fitted.minY - padding),
        width: Math.ceil(fitted.maxX - fitted.minX + padding * 2),
        height: Math.ceil(fitted.maxY - fitted.minY + padding * 2),
      }
    : { x: 0, y: 0, width: project.canvas.width, height: project.canvas.height };
  const content = [
    ...previews.map((shape) => previewSvg(shape, lookup)),
    ...visible
      .filter((element) => element.type === 'plot')
      .map((plot) => plotSvg(plot as PlotElement)),
    ...visible.filter(isEdgeElement).map((edge) => edgeSvg(edge, lookup)),
    ...visible.filter(isNodeElement).map((node) => nodeSvg(node)),
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}" viewBox="${view.x} ${view.y} ${view.width} ${view.height}">${defs}${background}${grid}${content}</svg>`;
}

export function sanitizeSvg(svg: string): string {
  return svg.replace(/<script[\s\S]*?<\/script>/giu, '').replace(/\son[a-z]+="[^"]*"/giu, '');
}
