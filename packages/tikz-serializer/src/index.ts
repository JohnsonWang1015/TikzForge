import {
  autoNodeSize,
  canvasToTikzPoint,
  formatNumber,
  isEdgeElement,
  isNodeElement,
  pxToPt,
  relativePlacement,
  resolveStyleRefs,
  tikzColor,
  type DiagramElement,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type Point,
  type Project,
  type RawTikzBlock,
} from '@tikzforge/graphic-ir';
import {
  arrowStyleForTip,
  fontOption,
  lineWidthOption,
  parseArrowSpec,
  TIKZ_PREAMBLE,
  type SourceMap,
} from '@tikzforge/tikz-parser';

export { patchSource } from './patch';

export interface SerializerOptions {
  includeDocument?: boolean;
  indent?: string;
  pixelsPerCm?: number;
  documentPrefix?: string;
  documentSuffix?: string;
}

export interface SerializedProject {
  source: string;
  sourceMap: SourceMap;
}

/** Escapes characters TeX would misread in node text while leaving intended markup alone. */
function texText(value: string): string {
  let result = '';
  let math = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '\\') {
      result += character + (value[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (character === '$') math = !math;
    if (character === '%' || character === '&' || character === '#') result += '\\';
    if (!math && character === '_') result += '\\';
    result += !math && character === '^' ? '\\^{}' : character;
  }
  return result;
}

function coordinate(point: Point, project: Project, pixelsPerCm: number): string {
  const tikz = canvasToTikzPoint(point, { ...project.settings, pixelsPerCm });
  return `(${formatNumber(tikz.x)},${formatNumber(tikz.y)})`;
}

function cm(pixels: number, pixelsPerCm: number): string {
  return `${formatNumber(pixels / pixelsPerCm, 2)}cm`;
}

function optionList(options: string[]): string {
  const list = options.filter(Boolean);
  return list.length ? `[${list.join(', ')}]` : '';
}

function nodeOptions(node: NodeElement, project: Project, pixelsPerCm: number): string[] {
  const refs = node.styleRefs ?? [];
  const baseline = resolveStyleRefs(project.styles, refs, pixelsPerCm);
  const base = baseline.style;
  const style = node.style;
  const options = [...refs];
  const shape = node.type === 'circle' || node.type === 'ellipse' ? node.type : 'rectangle';
  if (shape !== (baseline.shape ?? 'rectangle')) options.push(shape);
  const stroke = tikzColor(style.stroke, 'stroke');
  if (stroke !== tikzColor(base.stroke, 'stroke'))
    options.push(stroke === 'none' ? 'draw=none' : stroke === 'black' ? 'draw' : `draw=${stroke}`);
  const fill = tikzColor(style.fill, 'fill');
  if (fill !== tikzColor(base.fill, 'fill')) options.push(`fill=${fill}`);
  const text = tikzColor(style.textColor, 'text');
  if (text !== tikzColor(base.textColor, 'text')) options.push(`text=${text}`);
  if (style.rounded !== base.rounded)
    options.push(style.rounded ? 'rounded corners' : 'sharp corners');
  if (Boolean(style.dashed) !== Boolean(base.dashed))
    options.push(style.dashed ? 'dashed' : 'solid');
  if (Math.abs(pxToPt(style.lineWidth - base.lineWidth, pixelsPerCm)) > 0.02)
    options.push(lineWidthOption(style.lineWidth, pixelsPerCm) ?? 'thin');
  if (
    Math.abs(pxToPt(style.fontSize - base.fontSize, pixelsPerCm)) > 0.2 ||
    style.fontWeight !== base.fontWeight
  )
    options.push(
      fontOption(style.fontSize, style.fontWeight === 'bold', pixelsPerCm) ?? 'font=\\normalsize',
    );
  if (style.textWidth !== base.textWidth && style.textWidth)
    options.push(`text width=${cm(style.textWidth, pixelsPerCm)}`);
  if (style.align !== base.align) options.push(`align=${style.align}`);
  if (node.sizeMode !== 'auto') {
    const auto = autoNodeSize(shape, node.text, style);
    const differs = (value: number, minimum: number | undefined, natural: number) =>
      Math.abs(value - (minimum ?? natural)) >= 0.5;
    if (shape === 'circle') {
      if (differs(node.width, baseline.minimumWidth, auto.width))
        options.push(`minimum size=${cm(node.width, pixelsPerCm)}`);
    } else {
      if (differs(node.width, baseline.minimumWidth, auto.width))
        options.push(`minimum width=${cm(node.width, pixelsPerCm)}`);
      if (differs(node.height, baseline.minimumHeight, auto.height))
        options.push(`minimum height=${cm(node.height, pixelsPerCm)}`);
    }
  }
  return [...options, ...(node.extraOptions ?? [])];
}

function nodePosition(node: NodeElement, project: Project, pixelsPerCm: number): string {
  const position = node.position;
  if (position.mode === 'relative') {
    const target = project.elements.find((element) => element.id === position.target);
    const expected = target ? relativePlacement(node, target, pixelsPerCm) : undefined;
    if (expected && Math.abs(expected.x - node.x) < 0.5 && Math.abs(expected.y - node.y) < 0.5) {
      const implicit =
        position.distance === 1 && !/node distance/u.test(project.pictureOptions ?? '');
      return implicit ? '' : `${formatNumber(position.distance)}cm `;
    }
  }
  return `at ${coordinate(node, project, pixelsPerCm)}`;
}

function serializeNode(node: NodeElement, project: Project, pixelsPerCm: number): string {
  const options = nodeOptions(node, project, pixelsPerCm);
  const position = nodePosition(node, project, pixelsPerCm);
  if (node.type === 'coordinate')
    return `\\coordinate${optionList(node.extraOptions ?? [])} (${node.id}) ${
      position.startsWith('at') ? position : `at ${coordinate(node, project, pixelsPerCm)}`
    };`;
  if (!position.startsWith('at') && node.position.mode === 'relative')
    options.push(`${node.position.relation}=${position}of ${node.position.target}`);
  const at = position.startsWith('at') ? ` ${position}` : '';
  return `\\node${optionList(options)} (${node.id})${at} {${texText(node.text)}};`;
}

type Direction = 'none' | 'forward' | 'backward' | 'both';

function specDirection(spec: string | undefined): Direction | undefined {
  const tips = spec === undefined ? undefined : parseArrowSpec(spec);
  if (!tips) return undefined;
  if (tips.start && tips.end) return 'both';
  if (tips.end) return 'forward';
  return tips.start ? 'backward' : 'none';
}

function edgeDirection(edge: EdgeElement): Direction {
  if (edge.type === 'line' || edge.style.arrow === 'none') return 'none';
  return edge.type === 'bidirectional-arrow' ? 'both' : 'forward';
}

function arrowOption(edge: EdgeElement): string {
  const direction = edgeDirection(edge);
  const spec = edge.arrowSpec;
  if (spec && specDirection(spec) === direction) {
    const tips = parseArrowSpec(spec);
    const tip = tips?.end || tips?.start || '';
    if (direction === 'none' || arrowStyleForTip(tip) === edge.style.arrow || /^[<>]$/u.test(tip))
      return spec;
  }
  if (direction === 'none') return '';
  const tip =
    edge.style.arrow === 'latex' ? 'Latex' : edge.style.arrow === 'triangle' ? 'Triangle' : '';
  if (direction === 'both') return tip ? `${tip}-${tip}` : '<->';
  return tip ? `-${tip}` : '->';
}

function edgeOptions(edge: EdgeElement, project: Project, pixelsPerCm: number): string[] {
  const refs = edge.styleRefs ?? [];
  const definition = Object.assign({}, ...refs.map((name) => project.styles[name] ?? {})) as {
    arrowSpec?: string;
    dashed?: boolean;
    stroke?: string;
    lineWidth?: number;
  };
  const options = [...refs];
  const arrow = arrowOption(edge);
  if ((specDirection(arrow) ?? 'none') !== (specDirection(definition.arrowSpec) ?? 'none'))
    options.push(arrow || '-');
  else if (arrow && arrow !== definition.arrowSpec) options.push(arrow);
  const dashed = edge.style.dashed || edge.type === 'dashed-arrow';
  if (dashed !== Boolean(definition.dashed)) options.push(dashed ? 'dashed' : 'solid');
  const stroke = tikzColor(edge.style.stroke, 'stroke');
  if (stroke !== tikzColor(definition.stroke ?? 'black', 'stroke') && stroke !== 'none')
    options.push(stroke);
  const baseWidth = definition.lineWidth ?? (0.4 / 28.4528) * pixelsPerCm;
  if (Math.abs(pxToPt(edge.style.lineWidth - baseWidth, pixelsPerCm)) > 0.02)
    options.push(lineWidthOption(edge.style.lineWidth, pixelsPerCm) ?? 'thin');
  return [...options, ...(edge.extraOptions ?? [])];
}

function serializeEdge(edge: EdgeElement, project: Project, pixelsPerCm: number): string {
  const endpoint = (id: string, anchor: string | undefined) =>
    `(${id}${anchor ? `.${anchor}` : ''})`;
  const start = endpoint(edge.from, edge.fromAnchor);
  const end = endpoint(edge.to, edge.toAnchor);
  let operation = '--';
  if (edge.route) operation = edge.route;
  else if (edge.bend) {
    const angle = Math.abs(edge.bend);
    operation = `to[bend ${edge.bend > 0 ? 'left' : 'right'}${angle === 30 ? '' : `=${formatNumber(angle)}`}]`;
  } else if (edge.type === 'curved-arrow' && edge.controlPoints?.length) {
    operation = `.. controls ${edge.controlPoints
      .slice(0, 2)
      .map((point) => coordinate(point, project, pixelsPerCm))
      .join(' and ')} ..`;
  }
  const label = edge.label
    ? ` node${optionList(['midway', edge.labelOptions ?? ''])} {${texText(edge.label)}}`
    : '';
  const options = optionList(edgeOptions(edge, project, pixelsPerCm));
  return `\\draw${options} ${start} ${operation} ${end}${label};`;
}

function serializePlot(
  plot: PlotElement,
  project: Project,
  pixelsPerCm: number,
  indent: string,
): string {
  const options = [
    `at={${coordinate(plot, project, pixelsPerCm)}}`,
    'anchor=center',
    `width=${cm(plot.width, pixelsPerCm)}`,
    `height=${cm(plot.height, pixelsPerCm)}`,
  ];
  if (plot.plotType === 'bar') options.push('ybar');
  const addplotOptions = plot.addplotOptions ?? '';
  if (plot.plotType === 'scatter' && !/only marks/u.test(addplotOptions))
    options.push('only marks');
  if (plot.title) options.push(`title={${texText(plot.title)}}`);
  if (plot.xLabel) options.push(`xlabel={${texText(plot.xLabel)}}`);
  if (plot.yLabel) options.push(`ylabel={${texText(plot.yLabel)}}`);
  options.push(...(plot.extraOptions ?? []));
  const addplot = `\\addplot${addplotOptions ? `[${addplotOptions}]` : ''}`;
  const expression = plot.expression?.trim();
  const body =
    plot.plotType === 'function' && expression
      ? `${addplot} ${expression.startsWith('{') ? expression : `{${expression}}`};`
      : `${addplot} coordinates {${plot.data
          .map((point) => ` (${formatNumber(point.x)},${formatNumber(point.y)})`)
          .join('')} };`;
  return `\\begin{axis}[${options.join(', ')}]\n${indent}  ${body}\n${indent}\\end{axis}`;
}

const PATH_STATEMENT =
  /^\\(?:node|coordinate|draw|path|fill|filldraw|clip|shade|shadedraw|pic|matrix)\b/u;

function serializeRaw(raw: RawTikzBlock): string {
  const source = raw.source.trim();
  // Blocks saved by older versions dropped the terminating semicolon.
  return PATH_STATEMENT.test(source) && !/[;}]$/u.test(source) ? `${source};` : source;
}

/** Statement text for one element, without leading indentation; later lines use `indent`. */
export function serializeElementSource(
  element: DiagramElement,
  project: Project,
  options: { pixelsPerCm?: number; indent?: string } = {},
): string {
  const pixelsPerCm = options.pixelsPerCm ?? project.settings.pixelsPerCm;
  const indent = options.indent ?? '  ';
  if (element.type === 'raw-tikz') return serializeRaw(element);
  if (element.type === 'plot') return serializePlot(element, project, pixelsPerCm, indent);
  if (element.type === 'group') return `% Group ${element.name}: ${element.children.join(', ')}`;
  if (isEdgeElement(element)) return serializeEdge(element, project, pixelsPerCm);
  return isNodeElement(element) ? serializeNode(element, project, pixelsPerCm) : '';
}

function dependencies(element: DiagramElement): string[] {
  if (isEdgeElement(element)) return [element.from, element.to];
  if (isNodeElement(element) && element.position.mode === 'relative')
    return [element.position.target];
  return [];
}

/** IR order, except that an element is moved after the nodes it references (TikZ needs that). */
export function orderedElements(project: Project): DiagramElement[] {
  const ids = new Set(project.elements.map((element) => element.id));
  const defined = new Set<string>();
  const ordered: DiagramElement[] = [];
  let pending = [...project.elements];
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    const waiting: DiagramElement[] = [];
    for (const element of pending) {
      const ready = dependencies(element).every((id) => !ids.has(id) || defined.has(id));
      if (ready) {
        ordered.push(element);
        defined.add(element.id);
        progress = true;
      } else waiting.push(element);
    }
    pending = waiting;
  }
  return [...ordered, ...pending];
}

export function pictureBegin(project: Project): string {
  return `\\begin{tikzpicture}${project.pictureOptions ? `[${project.pictureOptions}]` : ''}`;
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
  let source = '';
  const sourceMap: SourceMap = {};
  const append = (line: string) => {
    source += `${source ? '\n' : ''}${line}`;
  };
  const wrapper = project.documentWrapper;
  if (wrapper) append(`${wrapper.prefix.trimEnd()}\n`);
  else if (options.includeDocument) {
    const preamble = options.documentPrefix ? [options.documentPrefix] : TIKZ_PREAMBLE;
    append([...preamble, '', '\\begin{document}', ''].join('\n'));
  }
  append(pictureBegin(project));
  for (const element of orderedElements(project)) {
    const text = serializeElementSource(element, project, { pixelsPerCm, indent });
    if (!text) continue;
    append(indent);
    sourceMap[element.id] = { startOffset: source.length, endOffset: source.length + text.length };
    source += text;
  }
  append('\\end{tikzpicture}');
  if (wrapper) append(`\n${wrapper.suffix.trimStart()}`);
  else if (options.includeDocument) append('\n\\end{document}');
  if (options.documentSuffix) append(options.documentSuffix);
  return { source, sourceMap };
}

export const projectToTikz = serializeProject;
