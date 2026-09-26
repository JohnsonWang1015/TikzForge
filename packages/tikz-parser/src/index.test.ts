import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isEdgeElement,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type RawTikzBlock,
} from '@tikzforge/graphic-ir';
import { lex, parseTikz } from './index';

const picture = (body: string, options = '') =>
  `\\begin{tikzpicture}${options}\n${body}\n\\end{tikzpicture}`;

function element<T>(result: ReturnType<typeof parseTikz>, id: string): T {
  const found = result.project.elements.find((item) => item.id === id);
  if (!found) throw new Error(`missing element ${id}`);
  return found as T;
}

function errors(result: ReturnType<typeof parseTikz>) {
  return result.diagnostics.filter((item) => item.severity === 'error');
}

describe('TikZ lexer and parser', () => {
  it('lexes commands, coordinates and semicolons', () => {
    const tokens = lex('\\node[draw] (A) at (0,0) {Hello};');
    expect(tokens.some((token) => token.kind === 'command' && token.value === '\\node')).toBe(true);
    expect(tokens.some((token) => token.kind === 'number' && token.value === '0')).toBe(true);
    expect(tokens.some((token) => token.kind === 'semicolon')).toBe(true);
  });

  it('converts nodes and arrows into Graphic IR', () => {
    const result = parseTikz(
      picture(
        '\\node[draw] (A) at (0,0) {Hello};\n\\node[draw] (B) at (4,0) {World};\n\\draw[->] (A) -- (B);',
      ),
    );
    expect(result.valid).toBe(true);
    expect(result.project.elements.map((item) => item.id)).toEqual(['A', 'B', 'edge_03']);
    expect(result.generatedIds).toEqual(['edge_03']);
    expect(result.project.elements[0]?.type).toBe('rectangle');
  });

  it('flips the y axis and applies the canvas origin', () => {
    const result = parseTikz(picture('\\node (A) at (0,0) {A};\n\\node (B) at (2,1) {B};'), {
      pixelsPerCm: 50,
      origin: { x: 100, y: 400 },
    });
    const a = element<NodeElement>(result, 'A');
    const b = element<NodeElement>(result, 'B');
    expect([a.x, a.y]).toEqual([100, 400]);
    expect([b.x, b.y]).toEqual([200, 350]);
  });

  it('preserves unsupported macros as raw blocks without erasing supported nodes', () => {
    const result = parseTikz(
      picture(
        '\\node[draw] (A) at (0,0) {Hello};\n\\foreach \\x in {1,...,3} {\\draw (\\x,0) -- (\\x,1);}',
      ),
    );
    expect(result.project.elements.some((item) => item.id === 'A')).toBe(true);
    expect(result.project.elements.some((item) => item.type === 'raw-tikz')).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('reports malformed known syntax while retaining a partial project', () => {
    const result = parseTikz(picture('\\node[draw] (A) at (0,0);'));
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === 'TIKZ_NODE_TEXT')).toBe(true);
  });

  it('ignores comments, including a comment right before a statement', () => {
    const result = parseTikz(
      picture(
        '% first\n\\node[draw] (A) at (0,0) {A; 50\\% done};\n\\node (B) at (1,0) {B}; % trailing ; and {\n\\draw (A) -- (B);',
      ),
    );
    expect(errors(result)).toEqual([]);
    expect(result.project.elements.map((item) => item.id)).toEqual(['A', 'B', 'edge_03']);
    expect(element<NodeElement>(result, 'A').text).toBe('A; 50\\% done');
  });

  it('records statement ranges that include the terminating semicolon', () => {
    const source = picture('  \\node (A) at (0,0) {A};  % note');
    const result = parseTikz(source);
    const range = result.sourceMap.A;
    expect(range && source.slice(range.startOffset, range.endOffset)).toBe(
      '\\node (A) at (0,0) {A};',
    );
  });

  it('reads picture options: named styles, every node and node distance', () => {
    const result = parseTikz(
      picture(
        '\\node[box] (a) {In};\n\\node[box, right=of a] (b) {Out};\n\\node[below=of a] (c) {C};',
        '[box/.style={draw=red, fill=blue!20, rounded corners, minimum width=2cm}, every node/.style={font=\\small}, node distance=1cm and 2cm]',
      ),
      { pixelsPerCm: 50, origin: { x: 0, y: 0 } },
    );
    expect(result.valid).toBe(true);
    expect(result.project.pictureOptions).toContain('box/.style');
    const a = element<NodeElement>(result, 'a');
    const b = element<NodeElement>(result, 'b');
    const c = element<NodeElement>(result, 'c');
    expect(a.styleRefs).toEqual(['box']);
    expect(a.style).toMatchObject({ stroke: 'red', fill: 'blue!20', rounded: true });
    expect(a.width).toBe(100);
    expect(a.sizeMode).toBe('fixed');
    expect(c.sizeMode).toBe('auto');
    expect(b.position).toMatchObject({
      mode: 'relative',
      relation: 'right',
      target: 'a',
      distance: 2,
    });
    expect(b.x - a.x).toBeCloseTo(a.width / 2 + 100 + b.width / 2);
    expect(c.position).toMatchObject({ relation: 'below', distance: 1 });
    expect(c.y).toBeGreaterThan(a.y);
    expect(a.style.fontSize).toBeCloseTo((9 / 28.4528) * 50);
  });

  it('parses flexible node syntax: at before the name, polar coordinates, no position', () => {
    const result = parseTikz(
      picture('\\node[draw] at (90:1) (p) {P};\n\\node (o) {O};\n\\node[right=2cm of o] (q) {Q};'),
      { pixelsPerCm: 50, origin: { x: 0, y: 0 } },
    );
    expect(errors(result)).toEqual([]);
    const p = element<NodeElement>(result, 'p');
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-50);
    expect(element<NodeElement>(result, 'o').style.stroke).toBe('none');
    expect(element<NodeElement>(result, 'q').position).toMatchObject({ distance: 2 });
  });

  it('keeps TikZ colors, text, fonts and line widths', () => {
    const result = parseTikz(
      picture(
        '\\node[draw=red!50!black, fill={rgb,255:red,10;green,20;blue,30}, text=blue, very thick, font=\\bfseries\\large, inner sep=2pt] (A) {$\\alpha$ 50\\%};',
      ),
    );
    const node = element<NodeElement>(result, 'A');
    expect(node.style).toMatchObject({
      stroke: 'red!50!black',
      fill: '#0a141e',
      textColor: 'blue',
      fontWeight: 'bold',
    });
    expect(node.style.lineWidth).toBeCloseTo((1.2 / 28.4528) * 50);
    expect(node.style.fontSize).toBeCloseTo((12 / 28.4528) * 50);
    expect(node.extraOptions).toEqual(['inner sep=2pt']);
    expect(node.text).toBe('$\\alpha$ 50\\%');
  });

  it('parses edges with labels, anchors, arrow tips, bends and orthogonal routes', () => {
    const result = parseTikz(
      picture(
        [
          '\\node (a) at (0,0) {a};',
          '\\node (b) at (3,0) {b};',
          '\\draw[->, thick] (a) -- node[above] {x} (b);',
          '\\draw[-Stealth, dashed] (a.south) -- (b.north west);',
          '\\draw[<-] (a) to[bend left=40] (b);',
          '\\draw[->] (a) |- (b) node[right] {end};',
          '\\draw[<->, blue] (a) .. controls (1,1) and (2,1) .. (b);',
          '\\draw (a) -- (b);',
        ].join('\n'),
      ),
    );
    expect(errors(result)).toEqual([]);
    const edges = result.project.elements.filter(isEdgeElement);
    expect(edges).toHaveLength(6);
    const [labelled, anchored, bent, routed, curved, plain] = edges as EdgeElement[];
    expect(labelled).toMatchObject({ type: 'arrow', label: 'x', labelOptions: 'above' });
    expect(anchored).toMatchObject({
      type: 'dashed-arrow',
      arrowSpec: '-Stealth',
      fromAnchor: 'south',
      toAnchor: 'north west',
    });
    expect(bent).toMatchObject({ from: 'b', to: 'a', bend: -40, arrowSpec: '->' });
    expect(routed).toMatchObject({ route: '|-', label: 'end', labelOptions: 'pos=1, right' });
    expect(curved?.type).toBe('bidirectional-arrow');
    expect(curved?.controlPoints).toHaveLength(2);
    expect(curved?.style.stroke).toBe('blue');
    expect(plain).toMatchObject({ type: 'line', style: { arrow: 'none' } });
  });

  it('turns simple coordinate paths into shapes and keeps the rest as previewed raw TikZ', () => {
    const result = parseTikz(
      picture(
        [
          '\\draw[red] (0,0) circle (1cm);',
          '\\draw (1,1) rectangle ++(2,1);',
          '\\fill[blue!30] (5,0) ellipse (1 and 0.5);',
          '\\draw[->] (0,0) -- (4,0) node[right] {$x$};',
          '\\draw (0,0) arc (0:90:1);',
        ].join('\n'),
      ),
      { pixelsPerCm: 50, origin: { x: 0, y: 0 } },
    );
    expect(result.valid).toBe(true);
    const [circle, rectangle, ellipse, axis, arc] = result.project.elements;
    expect(circle).toMatchObject({ type: 'circle', width: 100, style: { stroke: 'red' } });
    expect(rectangle).toMatchObject({ type: 'rectangle', x: 100, y: -75, width: 100, height: 50 });
    expect(ellipse).toMatchObject({ type: 'ellipse', style: { fill: 'blue!30', stroke: 'none' } });
    expect(axis?.type).toBe('raw-tikz');
    expect((axis as RawTikzBlock).preview?.[0]).toMatchObject({
      type: 'preview-path',
      arrowEnd: true,
      d: 'M 0 0 L 200 0',
    });
    expect(arc).toMatchObject({ type: 'raw-tikz', source: '\\draw (0,0) arc (0:90:1);' });
    expect((arc as RawTikzBlock).preview).toBeUndefined();
  });

  it('unrolls \\foreach loops into previews that later statements can reference', () => {
    const result = parseTikz(
      picture(
        '\\foreach \\i in {1,...,4} {\\node[draw, circle] (n\\i) at (\\i*1.5, 0) {\\i};}\n\\draw[->] (n1) -- (n2);\n\\node[right=of n4] (tail) {tail};',
      ),
    );
    expect(errors(result)).toEqual([]);
    const [loop, edge] = result.project.elements as RawTikzBlock[];
    expect(loop?.reason).toBe('\\foreach loop');
    expect(loop?.preview?.map((shape) => shape.id)).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(edge?.type).toBe('raw-tikz');
    expect(edge?.preview?.[0]).toMatchObject({ from: 'n1', to: 'n2' });
    expect(element<RawTikzBlock>(result, 'raw_03').reason).toContain('unsupported TikZ');
  });

  it('previews scopes with shifts and keeps style definitions', () => {
    const result = parseTikz(
      picture(
        '\\tikzset{hot/.style={fill=red!20}}\n\\begin{scope}[shift={(2,0)}]\n  \\node (s) at (0,0) {S};\n\\end{scope}\n\\node[hot] (h) at (0,0) {H};',
      ),
      { pixelsPerCm: 50, origin: { x: 0, y: 0 } },
    );
    expect(errors(result)).toEqual([]);
    expect(result.project.styles.hot).toMatchObject({ fill: 'red!20' });
    const scope = result.project.elements[1] as RawTikzBlock;
    expect(scope.preview?.[0]).toMatchObject({ id: 's', x: 100, y: 0 });
    expect(element<NodeElement>(result, 'h').style.fill).toBe('red!20');
  });

  it('reads pgfplots axes, including position, size, labels and function plots', () => {
    const result = parseTikz(
      picture(
        [
          '\\begin{axis}[title={Loss}, xlabel=epoch, width=6cm, height=4cm, grid=major]',
          '  \\addplot[blue, mark=*] coordinates {(1,2) (2,4) (3,3)};',
          '\\end{axis}',
          '\\begin{axis}[at={(8,0)}, anchor=center, domain=0:2]',
          '  \\addplot {x^2};',
          '\\end{axis}',
          '\\begin{axis}\\addplot coordinates {(0,0)};\\addplot coordinates {(1,1)};\\end{axis}',
        ].join('\n'),
      ),
      { pixelsPerCm: 50, origin: { x: 0, y: 0 } },
    );
    expect(result.valid).toBe(true);
    const [first, second, third] = result.project.elements as [
      PlotElement,
      PlotElement,
      RawTikzBlock,
    ];
    expect(first).toMatchObject({
      type: 'plot',
      title: 'Loss',
      xLabel: 'epoch',
      width: 300,
      height: 200,
      x: 150,
      y: -100,
      addplotOptions: 'blue, mark=*',
      extraOptions: ['grid=major'],
    });
    expect(first.data).toHaveLength(3);
    expect(second).toMatchObject({ plotType: 'function', expression: '{x^2}', x: 400, y: 0 });
    expect(second.data.at(-1)).toEqual({ x: 2, y: 4 });
    expect(third.type).toBe('raw-tikz');
    expect(third.preview?.[0]?.type).toBe('plot');
  });

  it('reports genuine errors: missing nodes, unclosed options and missing semicolons', () => {
    const result = parseTikz(
      picture('\\node (A) at (0,0) {A};\n\\draw (A) -- (Missing);\n\\node[draw (B) at (1,1) {x};'),
    );
    expect(result.valid).toBe(false);
    const codes = errors(result).map((item) => item.code);
    expect(codes).toContain('IR_EDGE_REFERENCE');
    expect(codes).toContain('TIKZ_UNCLOSED_OPTIONS');
    const edgeError = errors(result).find((item) => item.code === 'IR_EDGE_REFERENCE');
    expect(edgeError?.line).toBe(3);
    const unterminated = parseTikz(picture('\\draw (0,0) -- (1,1)'));
    expect(errors(unterminated).map((item) => item.code)).toContain('TIKZ_MISSING_SEMICOLON');
  });

  it('parses every bundled example without errors', () => {
    const directory = fileURLToPath(new URL('../../../examples/', import.meta.url));
    for (const file of readdirSync(directory)) {
      const result = parseTikz(readFileSync(`${directory}${file}`, 'utf8'));
      expect(errors(result), file).toEqual([]);
    }
  });
});
