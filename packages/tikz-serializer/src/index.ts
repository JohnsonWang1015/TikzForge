import {
  canvasToTikz,
  formatNumber,
  isNodeElement,
  type DiagramElement,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type Project,
  type RawTikzBlock,
} from '@tikzforge/graphic-ir';

export interface SerializerOptions {
  includeDocument?: boolean;
  indent?: string;
  pixelsPerCm?: number;
  documentPrefix?: string;
  documentSuffix?: string;
}

export interface SerializedProject {
  source: string;
  sourceMap: Record<string, { startOffset: number; endOffset: number }>;
}

function escapeNodeText(value: string): string {
  return value
    .replace(/\\/gu, '\\textbackslash{}')
    .replace(/([{}])/gu, '\\$1')
    .replace(/%/gu, '\\%')
    .replace(/&/gu, '\\&');
}

function colorToTikz(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase();
  const colors: Record<string, string> = {
    transparent: 'none',
    none: 'none',
    '#101827': 'black!8',
    '#0b1020': 'black!2',
    '#163250': 'blue!15',
    '#382650': 'violet!15',
    '#18443b': 'green!15',
    '#91a4c6': 'black!65',
    '#6f83a7': 'black!60',
    '#65d1b8': 'teal!70!black',
    '#e6edf7': 'black',
  };
  if (colors[normalized]) return colors[normalized];
  if (/^[a-z][a-z0-9!]*$/u.test(normalized)) return normalized;
  return fallback;
}

function optionList(options: string[]): string {
  return options.filter(Boolean).join(', ');
}

function coordinate(x: number, y: number, pixelsPerCm: number): string {
  return `(${formatNumber(canvasToTikz(x, pixelsPerCm))},${formatNumber(canvasToTikz(y, pixelsPerCm))})`;
}

function nodeOptions(node: NodeElement, pixelsPerCm: number): string[] {
  const options: string[] = [];
  if (node.style.stroke !== 'transparent' && node.style.stroke !== 'none') options.push('draw');
  if (node.style.rounded) options.push('rounded corners');
  if (node.style.dashed) options.push('dashed');
  const fill = colorToTikz(node.style.fill, 'none');
  if (fill !== 'none') options.push(`fill=${fill}`);
  if (node.style.lineWidth > 0) options.push(`line width=${formatNumber(node.style.lineWidth)}pt`);
  if (node.type === 'circle') options.push('circle');
  if (node.type === 'ellipse') options.push('ellipse');
  if (node.style.fontWeight === 'bold') options.push('font=\\bfseries');
  if (node.style.fontSize > 0)
    options.push(
      `font=\\fontsize{${formatNumber(node.style.fontSize)}pt}{${formatNumber(node.style.fontSize * 1.2)}pt}\\selectfont`,
    );
  if (node.style.textWidth)
    options.push(`text width=${formatNumber(canvasToTikz(node.style.textWidth, pixelsPerCm))}cm`);
  if (node.style.align !== 'center') options.push(`align=${node.style.align}`);
  return options;
}

function serializeNode(node: NodeElement, pixelsPerCm: number, indent: string): string {
  const options = nodeOptions(node, pixelsPerCm);
  const id = node.id ? ` (${node.id})` : '';
  const position =
    node.position.mode === 'relative'
      ? `${node.position.relation}=of ${node.position.target}`
      : `at ${coordinate(node.x, node.y, pixelsPerCm)}`;
  const text = node.text ? ` {${escapeNodeText(node.text)}}` : ' {}';
  return `${indent}\\node[${optionList(options)}]${id} ${position}${text};`;
}

function edgeArrow(element: EdgeElement): string {
  if (element.type === 'bidirectional-arrow') return '<->';
  if (element.type === 'line') return '';
  if (element.style.arrow === 'none') return '';
  return '->';
}

function serializeEdge(edge: EdgeElement, pixelsPerCm: number, indent: string): string {
  const options: string[] = [];
  const arrow = edgeArrow(edge);
  if (arrow) options.push(arrow);
  if (edge.style.dashed || edge.type === 'dashed-arrow') options.push('dashed');
  if (edge.style.lineWidth > 0) options.push(`line width=${formatNumber(edge.style.lineWidth)}pt`);
  const start = `(${edge.from})`;
  const end = `(${edge.to})`;
  let path = `${start} -- ${end}`;
  if (edge.type === 'curved-arrow' && edge.controlPoints?.length) {
    const controls = edge.controlPoints
      .map((point) => coordinate(point.x, point.y, pixelsPerCm))
      .join(' and ');
    path = `${start} .. controls ${controls} .. ${end}`;
  }
  const label = edge.label ? ` node[midway] {${escapeNodeText(edge.label)}}` : '';
  return `${indent}\\draw[${optionList(options)}] ${path}${label};`;
}

function serializePlot(plot: PlotElement, indent: string): string {
  const options: string[] = [];
  if (plot.plotType === 'bar') options.push('ybar');
  if (plot.plotType === 'scatter') options.push('only marks');
  if (plot.title) options.push(`title={${escapeNodeText(plot.title)}}`);
  if (plot.xLabel) options.push(`xlabel={${escapeNodeText(plot.xLabel)}}`);
  if (plot.yLabel) options.push(`ylabel={${escapeNodeText(plot.yLabel)}}`);
  const data = plot.data
    .map((point) => `(${formatNumber(point.x)},${formatNumber(point.y)})`)
    .join(' ');
  if (plot.plotType === 'function' && plot.expression) {
    return `${indent}\\begin{axis}[${optionList(options)}]\n${indent}  \\addplot ${plot.expression};\n${indent}\\end{axis}`;
  }
  return `${indent}\\begin{axis}[${optionList(options)}]\n${indent}  \\addplot coordinates { ${data} };\n${indent}\\end{axis}`;
}

function serializeRaw(raw: RawTikzBlock, indent: string): string {
  return raw.source
    .split('\n')
    .map((line) => `${indent}${line.trim()}`)
    .join('\n');
}

function elementSort(a: DiagramElement, b: DiagramElement): number {
  const order: Record<DiagramElement['layer'], number> = {
    background: 0,
    nodes: 1,
    labels: 2,
    connections: 3,
    overlays: 4,
  };
  return order[a.layer] - order[b.layer] || a.id.localeCompare(b.id);
}

function serializeElement(
  element: DiagramElement,
  project: Project,
  indent: string,
  pixelsPerCm: number,
): string {
  if (element.type === 'raw-tikz') return serializeRaw(element, indent);
  if (element.type === 'plot') return serializePlot(element, indent);
  if (element.type === 'group')
    return `${indent}% Group ${element.name}: ${element.children.join(', ')}`;
  if (
    element.type === 'line' ||
    element.type === 'arrow' ||
    element.type === 'bidirectional-arrow' ||
    element.type === 'dashed-arrow' ||
    element.type === 'curved-arrow'
  ) {
    return serializeEdge(element, pixelsPerCm, indent);
  }
  void project;
  return isNodeElement(element) ? serializeNode(element, pixelsPerCm, indent) : '';
}

/** Deterministic, human-readable serializer for the Graphic IR. */
export function serializeProject(project: Project, options: SerializerOptions = {}): string {
  return serializeProjectWithMap(project, options).source;
}

export function serializeProjectWithMap(
  project: Project,
  options: SerializerOptions = {},
): SerializedProject {
  const indent = options.indent ?? '  ';
  const pixelsPerCm = options.pixelsPerCm ?? project.settings.pixelsPerCm;
  const lines: string[] = [];
  const sourceMap: Record<string, { startOffset: number; endOffset: number }> = {};
  const wrapper = project.documentWrapper;
  if (wrapper) {
    lines.push(wrapper.prefix.trimEnd(), '');
  } else if (options.includeDocument) {
    lines.push(
      options.documentPrefix ?? '\\documentclass{standalone}',
      options.documentPrefix ? '' : '\\usepackage{tikz}',
      '',
      '\\begin{document}',
      '',
    );
  }
  lines.push('\\begin{tikzpicture}');
  const elements = [...project.elements].sort(elementSort);
  for (const element of elements) {
    const startOffset = lines.join('\n').length + (lines.length ? 1 : 0);
    lines.push(serializeElement(element, project, indent, pixelsPerCm));
    const endOffset = lines.join('\n').length;
    sourceMap[element.id] = { startOffset, endOffset };
  }
  lines.push('\\end{tikzpicture}');
  if (wrapper) lines.push('', wrapper.suffix.trimStart());
  else if (options.includeDocument) lines.push('', '\\end{document}');
  if (options.documentSuffix) lines.push(options.documentSuffix);
  return { source: lines.join('\n'), sourceMap };
}

export const projectToTikz = serializeProject;
