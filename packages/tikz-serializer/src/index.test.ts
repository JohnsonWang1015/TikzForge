import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode, createArrow } from '@tikzforge/graphic-ir';
import { parseTikz } from '@tikzforge/tikz-parser';
import { serializeProject } from './index';

describe('TikZ serializer', () => {
  it('emits deterministic nodes and arrows', () => {
    const project = createEmptyProject();
    const a = createNode('rectangle', { id: 'A', x: 0, y: 0, text: 'CNN' });
    const b = createNode('rectangle', { id: 'B', x: 400, y: 0, text: 'Transformer' });
    project.elements = [a, b, createArrow('A', 'B', { id: 'edge' })];
    const source = serializeProject(project);
    expect(source).toContain('\\node[draw');
    expect(source).toContain('(A) at (0,0)');
    expect(source).toContain('(B) at (4,0)');
    expect(source).toContain('\\draw[->');
    expect(source).toBe(serializeProject(project));
  });

  it('keeps raw TikZ in export', () => {
    const project = createEmptyProject();
    project.elements.push({
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
    expect(serializeProject(project)).toContain('\\foreach');
  });

  it('round-trips supported TikZ semantics through IR', () => {
    const source = '\\begin{tikzpicture}\n\\node[draw] (A) at (0,0) {CNN};\n\\node[draw, rounded corners] (B) at (4,0) {Transformer};\n\\draw[->] (A) -- (B);\n\\end{tikzpicture}';
    const first = parseTikz(source);
    const second = parseTikz(serializeProject(first.project));
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(second.project.elements.filter((element) => element.type === 'rectangle').map((element) => element.id)).toEqual(['A', 'B']);
    expect(second.project.elements.some((element) => element.type === 'arrow' && element.from === 'A' && element.to === 'B')).toBe(true);
  });

  it('retains a full LaTeX wrapper through a canvas serialization', () => {
    const parsed = parseTikz('\\documentclass{article}\n\\begin{document}\n\\begin{tikzpicture}\n\\node[draw] (A) at (0,0) {A};\n\\end{tikzpicture}\n\\end{document}');
    expect(serializeProject(parsed.project)).toContain('\\documentclass{article}');
    expect(serializeProject(parsed.project)).toContain('\\end{document}');
  });
});
