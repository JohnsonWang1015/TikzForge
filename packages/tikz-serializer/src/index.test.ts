import { describe, expect, it } from 'vitest';
import {
  createArrow,
  createEmptyProject,
  createNode,
  createPlot,
  createStarterProject,
  patchElement,
  removeElements,
  type DiagramElement,
  type NodeElement,
  type Project,
} from '@tikzforge/graphic-ir';
import { parseTikz } from '@tikzforge/tikz-parser';
import { patchSource, serializeProject, serializeProjectWithMap } from './index';

function project(elements: DiagramElement[]): Project {
  const value = createEmptyProject();
  value.settings.origin = { x: 0, y: 0 };
  value.elements = elements;
  return value;
}

/** Geometry that must survive a serialize → parse round trip. */
function geometry(value: Project) {
  return value.elements.map((element) => ({
    id: element.id,
    type: element.type,
    ...('x' in element ? { x: Math.round(element.x), y: Math.round(element.y) } : {}),
    ...('width' in element
      ? { width: Math.round(element.width), height: Math.round(element.height) }
      : {}),
    ...('from' in element ? { from: element.from, to: element.to, label: element.label } : {}),
  }));
}

describe('TikZ serializer', () => {
  it('emits deterministic nodes and arrows with y pointing up', () => {
    const a = createNode('rectangle', { id: 'A', x: 0, y: 0, text: 'CNN' });
    const b = createNode('rectangle', { id: 'B', x: 200, y: -100, text: 'Transformer' });
    const value = project([a, b, createArrow('A', 'B', { id: 'edge' })]);
    const source = serializeProject(value);
    expect(source).toContain('\\node[draw');
    expect(source).toContain('(A) at (0,0)');
    expect(source).toContain('(B) at (4,2)');
    expect(source).toContain('\\draw[->, thick] (A) -- (B);');
    expect(source).toBe(serializeProject(value));
  });

  it('maps canvas sizes, fonts, widths and colors to idiomatic TikZ', () => {
    const source = serializeProject(createStarterProject());
    expect(source).toContain(
      '\\node[draw, fill=blue!15, rounded corners, thick, font=\\footnotesize, minimum width=3.2cm, minimum height=1.28cm] (input)',
    );
    const custom = createNode('circle', {
      id: 'C',
      x: 0,
      y: 0,
      text: '50% of x_1 and $x_1^2$',
      style: { fill: '#123456', stroke: 'none', textColor: 'red', fontWeight: 'bold' },
    });
    const text = serializeProject(project([custom]));
    expect(text).toContain('circle');
    expect(text).toContain('fill={rgb,255:red,18;green,52;blue,86}');
    expect(text).toContain('text=red');
    expect(text).toContain('font=\\footnotesize\\bfseries');
    expect(text).toContain('minimum size=3.2cm');
    expect(text).not.toContain('draw');
    expect(text).toContain('{50\\% of x\\_1 and $x_1^2$}');
  });

  it('keeps raw TikZ in export', () => {
    const value = createEmptyProject();
    value.elements.push({
      id: 'raw_01',
      type: 'raw-tikz',
      layer: 'overlays',
      visible: true,
      locked: true,
      rotation: 0,
      source: '\\foreach \\x in {1,...,3} {\\draw (\\x,0) -- (\\x,1);}',
      reason: 'unsupported',
      editable: false,
    });
    expect(serializeProject(value)).toContain('\\foreach');
  });

  it('round-trips supported TikZ semantics through IR', () => {
    const source = String.raw`\begin{tikzpicture}[box/.style={draw, fill=blue!20, rounded corners}, node distance=1.5cm]
\node[box] (A) at (0,0) {CNN};
\node[box, right=of A] (B) {Transformer};
\node[circle, draw=red, below=2cm of B] (C) {$\sigma$};
\node[draw, minimum width=3cm, minimum height=1cm] (D) at (0,-4) {Fixed};
\draw[->, thick] (A) -- node[above] {x} (B);
\draw[-Stealth, dashed] (B.south) -- (C.north);
\draw[->] (C) to[bend left=40] (A);
\draw[<->] (A) |- (D);
\draw[->] (D) .. controls (2,-5) and (4,-5) .. (C);
\foreach \i in {1,2} {\node (n\i) at (\i, -6) {\i};}
\begin{axis}[at={(8,0)}, width=6cm, height=4cm, title={Loss}, ybar]
  \addplot coordinates {(1,2) (2,3)};
\end{axis}
\end{tikzpicture}`;
    const first = parseTikz(source);
    expect(first.valid).toBe(true);
    const second = parseTikz(serializeProject(first.project));
    expect(second.valid).toBe(true);
    expect(geometry(second.project)).toEqual(geometry(first.project));
    const third = serializeProject(second.project);
    expect(third).toBe(serializeProject(first.project));
    expect(third).toContain('\\node[box, right=1.5cm of A] (B) {Transformer};');
    expect(third).toContain('(C) to[bend left=40] (A)');
    expect(third).toContain('\\draw[<->] (A) |- (D);');
    expect(third).toContain('\\draw[-Stealth, dashed] (B.south) -- (C.north);');
  });

  it('retains a full LaTeX wrapper through a canvas serialization', () => {
    const parsed = parseTikz(
      '\\documentclass{article}\n\\begin{document}\n\\begin{tikzpicture}\n\\node[draw] (A) at (0,0) {A};\n\\end{tikzpicture}\n\\end{document}',
    );
    expect(serializeProject(parsed.project)).toContain('\\documentclass{article}');
    expect(serializeProject(parsed.project)).toContain('\\end{document}');
  });

  it('wraps pictures in the shared standalone preamble for LaTeX export', () => {
    const source = serializeProject(createStarterProject(), { includeDocument: true });
    expect(source.startsWith('\\documentclass{standalone}')).toBe(true);
    expect(source).toContain(
      '\\usetikzlibrary{arrows.meta,calc,positioning,shapes.geometric,fit,backgrounds}',
    );
    expect(source).toContain('\\pgfplotsset{compat=1.18}');
    expect(source.trimEnd().endsWith('\\end{document}')).toBe(true);
  });

  it('orders statements so referenced nodes come first', () => {
    const edge = createArrow('A', 'B', { id: 'edge' });
    const a = createNode('rectangle', { id: 'A', x: 0, y: 0 });
    const b = createNode('rectangle', { id: 'B', x: 300, y: 0 });
    const source = serializeProject(project([edge, a, b]));
    expect(source.indexOf('(edge)')).toBe(-1);
    expect(source.indexOf('\\draw')).toBeGreaterThan(source.indexOf('(B) at'));
  });

  it('serializes plots with their position and size', () => {
    const plot = createPlot({ id: 'p', x: 150, y: -100, width: 300, height: 200, title: 'Loss' });
    const source = serializeProject(project([plot]));
    expect(source).toContain(
      '\\begin{axis}[at={(3,2)}, anchor=center, width=6cm, height=4cm, title={Loss}]',
    );
    expect(source).toContain('\\addplot coordinates { (1,2) (2,4) (3,3) };');
  });

  it('emits image nodes as \\includegraphics sized like the canvas and parses them back', () => {
    const image = createNode('image', { id: 'fig', x: 100, y: -50, width: 150, height: 100 });
    image.source = 'figs/plot.png';
    image.href =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
    const first = serializeProject(project([image]));
    expect(first).toContain(
      '\\node[inner sep=0pt] (fig) at (2,1) {\\includegraphics[width=3cm,height=2cm]{figs/plot.png}};',
    );
    const parsed = parseTikz(first);
    expect(parsed.valid).toBe(true);
    const node = parsed.project.elements[0] as NodeElement;
    expect(node).toMatchObject({ type: 'image', source: 'figs/plot.png', width: 150, height: 100 });
    expect(node.extraOptions).toBeUndefined();
    expect(node.href).toBeUndefined();
    expect(serializeProject(parsed.project)).toBe(first);
  });

  it('falls back to the placeholder picture for unusable image file names', () => {
    const image = createNode('image', { id: 'fig', x: 0, y: 0 });
    expect(image.source).toBe('example-image');
    image.source = '../secret}';
    expect(serializeProject(project([image]))).toContain('{example-image}');
  });

  it('maps every element to its statement text', () => {
    const { source, sourceMap } = serializeProjectWithMap(createStarterProject());
    for (const [id, range] of Object.entries(sourceMap)) {
      const statement = source.slice(range.startOffset, range.endOffset);
      expect(statement.endsWith(';'), id).toBe(true);
      expect(statement.startsWith('\\'), id).toBe(true);
    }
  });
});

describe('source patching', () => {
  const source = String.raw`\begin{tikzpicture}[node distance=1.5cm]
  % stages
  \node[draw] (a) {Input};
  \node[draw, right=of a] (b) {Model};   % keep this comment

  \node[draw, below=2cm of b] (c) {Out};
  \draw[->] (a) -- (b);
  \draw[->] (b) -- (c);
\end{tikzpicture}`;
  const parsed = parseTikz(source);

  function reparsed(text: string) {
    const result = parseTikz(text);
    expect(result.valid).toBe(true);
    return result;
  }

  it('rewrites only the statement of a moved node', () => {
    const c = parsed.project.elements.find((item) => item.id === 'c') as NodeElement;
    const next = patchElement(parsed.project, 'c', {
      x: c.x + 50,
      position: { mode: 'absolute' },
    } as Partial<NodeElement>);
    const patched = patchSource(source, parsed.sourceMap, parsed.project, next);
    expect(patched).toBeDefined();
    const lines = patched?.source.split('\n') ?? [];
    const original = source.split('\n');
    const changed = lines.filter((line, index) => line !== original[index]);
    expect(changed).toEqual([expect.stringMatching(/^ {2}\\node\[draw\] \(c\) at \(/u)]);
    const result = reparsed(patched?.source ?? '');
    expect(result.sourceMap).toEqual(patched?.sourceMap);
  });

  it('removes deleted statements with their line and keeps unrelated text', () => {
    const next = removeElements(parsed.project, new Set(['c']));
    const patched = patchSource(source, parsed.sourceMap, parsed.project, next);
    expect(patched?.source).not.toContain('(c)');
    expect(patched?.source).toContain('% keep this comment');
    const removed = source
      .split('\n')
      .filter((line) => !patched?.source.split('\n').includes(line));
    expect(removed).toEqual([
      '  \\node[draw, below=2cm of b] (c) {Out};',
      '  \\draw[->] (b) -- (c);',
    ]);
    reparsed(patched?.source ?? '');
  });

  it('appends new elements before \\end{tikzpicture} with matching indentation', () => {
    const node = createNode('rectangle', { id: 'd', x: 0, y: 0, text: 'New' });
    const edge = createArrow('c', 'd', { id: 'edge_new' });
    const next = { ...parsed.project, elements: [...parsed.project.elements, edge, node] };
    const patched = patchSource(source, parsed.sourceMap, parsed.project, next);
    const text = patched?.source ?? '';
    expect(text.indexOf('(d) at')).toBeLessThan(text.indexOf('(c) -- (d)'));
    expect(text).toMatch(/\n {2}\\draw\[->, thick\] \(c\) -- \(d\);\n\\end\{tikzpicture\}$/u);
    const result = reparsed(text);
    expect(result.sourceMap.d).toEqual(patched?.sourceMap.d);
  });

  it('refuses to patch when the picture options change', () => {
    const next = { ...parsed.project, pictureOptions: 'node distance=2cm' };
    expect(patchSource(source, parsed.sourceMap, parsed.project, next)).toBeUndefined();
  });

  it('refuses a patch that would use a node before it is defined', () => {
    const a = parsed.project.elements.find((item) => item.id === 'a') as NodeElement;
    const b = parsed.project.elements.find((item) => item.id === 'b') as NodeElement;
    const moved: NodeElement = {
      ...a,
      position: { mode: 'relative', relation: 'left', target: 'b', distance: 1 },
    };
    const next = {
      ...parsed.project,
      elements: parsed.project.elements.map((item) => (item.id === 'a' ? moved : item)),
    };
    expect(b.id).toBe('b');
    expect(patchSource(source, parsed.sourceMap, parsed.project, next)).toBeUndefined();
  });
});
