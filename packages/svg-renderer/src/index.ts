import {
  isNodeElement,
  type DiagramElement,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type Project,
} from '@tikzforge/graphic-ir';

export interface SvgRenderOptions {
  includeBackground?: boolean;
  includeGrid?: boolean;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function cssColor(value: string, fallback: string): string {
  if (value === 'transparent' || value === 'none') return 'none';
  if (value.startsWith('#') || /^[a-z]+$/iu.test(value)) return value;
  return fallback;
}

function nodeSvg(node: NodeElement): string {
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const fill = cssColor(node.style.fill, '#101827');
  const stroke = cssColor(node.style.stroke, '#6f83a7');
  const rx = node.type === 'circle' ? node.width / 2 : node.style.rounded ? 10 : 0;
  const shape =
    node.type === 'circle'
      ? `<circle cx="${node.x}" cy="${node.y}" r="${Math.min(node.width, node.height) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.lineWidth}" />`
      : node.type === 'ellipse'
        ? `<ellipse cx="${node.x}" cy="${node.y}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.lineWidth}" />`
        : `<rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${node.style.lineWidth}" stroke-dasharray="${node.style.dashed ? '6 4' : 'none'}" />`;
  if (!node.text)
    return `<g id="${escapeXml(node.id)}" transform="rotate(${node.rotation} ${node.x} ${node.y})">${shape}</g>`;
  const anchor =
    node.style.align === 'left' ? 'start' : node.style.align === 'right' ? 'end' : 'middle';
  return `<g id="${escapeXml(node.id)}" transform="rotate(${node.rotation} ${node.x} ${node.y})">${shape}<text x="${node.x}" y="${node.y + node.style.fontSize * 0.35}" text-anchor="${anchor}" fill="${cssColor(node.style.textColor, '#e6edf7')}" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}">${escapeXml(node.text)}</text></g>`;
}

function edgeSvg(edge: EdgeElement, project: Project): string {
  const from = project.elements.find((element) => element.id === edge.from);
  const to = project.elements.find((element) => element.id === edge.to);
  if (!from || !to || !('x' in from) || !('y' in from) || !('x' in to) || !('y' in to)) return '';
  const marker =
    edge.type === 'bidirectional-arrow'
      ? ' marker-start="url(#arrow)" marker-end="url(#arrow)"'
      : edge.style.arrow === 'none' || edge.type === 'line'
        ? ''
        : ' marker-end="url(#arrow)"';
  const dash = edge.style.dashed || edge.type === 'dashed-arrow' ? ' stroke-dasharray="7 5"' : '';
  let path = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  if (edge.type === 'curved-arrow' && edge.controlPoints?.length) {
    const first = edge.controlPoints[0] ?? from;
    const second = edge.controlPoints[1] ?? first;
    path = `M ${from.x} ${from.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${to.x} ${to.y}`;
  }
  return `<path d="${path}" fill="none" stroke="${cssColor(edge.style.stroke, '#91a4c6')}" stroke-width="${edge.style.lineWidth}"${dash}${marker} />`;
}

function plotSvg(plot: PlotElement): string {
  const left = plot.x - plot.width / 2;
  const top = plot.y - plot.height / 2;
  const points = plot.data;
  if (points.length === 0)
    return `<rect x="${left}" y="${top}" width="${plot.width}" height="${plot.height}" fill="none" stroke="#6f83a7" />`;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const scaleX = (value: number) => left + ((value - minX) / (maxX - minX || 1)) * plot.width;
  const scaleY = (value: number) =>
    top + plot.height - ((value - minY) / (maxY - minY || 1)) * plot.height;
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(point.x)} ${scaleY(point.y)}`)
    .join(' ');
  const circles = plot.style.showPoints
    ? points
        .map(
          (point) =>
            `<circle cx="${scaleX(point.x)}" cy="${scaleY(point.y)}" r="${plot.style.pointRadius}" fill="${plot.style.stroke}" />`,
        )
        .join('')
    : '';
  return `<g id="${escapeXml(plot.id)}"><rect x="${left}" y="${top}" width="${plot.width}" height="${plot.height}" fill="${plot.style.fill}" stroke="#6f83a7" /><path d="${path}" fill="none" stroke="${plot.style.stroke}" stroke-width="${plot.style.lineWidth}" />${circles}</g>`;
}

function elementSvg(element: DiagramElement, project: Project): string {
  if (!element.visible) return '';
  if (element.type === 'raw-tikz')
    return `<g id="${escapeXml(element.id)}"><rect x="20" y="20" width="220" height="42" rx="8" fill="#251e33" stroke="#a67bd6" stroke-dasharray="5 4" /><text x="32" y="46" fill="#d4bbfa" font-size="12">Raw TikZ · unsupported visual block</text></g>`;
  if (element.type === 'plot') return plotSvg(element);
  if (element.type === 'group') return '';
  if (
    element.type === 'line' ||
    element.type === 'arrow' ||
    element.type === 'bidirectional-arrow' ||
    element.type === 'dashed-arrow' ||
    element.type === 'curved-arrow'
  )
    return edgeSvg(element, project);
  return isNodeElement(element) ? nodeSvg(element) : '';
}

/** Fast, deterministic IR renderer used by the browser and as the compiler fallback. */
export function renderProjectToSvg(project: Project, options: SvgRenderOptions = {}): string {
  const background =
    options.includeBackground === false
      ? ''
      : `<rect width="100%" height="100%" fill="${cssColor(project.canvas.background, '#0b1020')}" />`;
  const grid = options.includeGrid
    ? `<path d="M 20 0 V ${project.canvas.height} M 40 0 V ${project.canvas.height} M 0 20 H ${project.canvas.width} M 0 40 H ${project.canvas.width}" stroke="#ffffff08" />`
    : '';
  const defs =
    '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="#91a4c6" /></marker></defs>';
  const content = [...project.elements]
    .sort((a, b) => (a.layer === 'connections' ? -1 : 1) - (b.layer === 'connections' ? -1 : 1))
    .map((element) => elementSvg(element, project))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${project.canvas.width}" height="${project.canvas.height}" viewBox="0 0 ${project.canvas.width} ${project.canvas.height}">${defs}${background}${grid}${content}</svg>`;
}

export function sanitizeSvg(svg: string): string {
  return svg.replace(/<script[\s\S]*?<\/script>/giu, '').replace(/\son[a-z]+="[^"]*"/giu, '');
}
