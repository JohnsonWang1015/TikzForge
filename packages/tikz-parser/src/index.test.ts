import { describe, expect, it } from 'vitest';
import { lex, parseTikz } from './index';

describe('TikZ lexer and parser', () => {
  it('lexes commands, coordinates and semicolons', () => {
    const tokens = lex('\\node[draw] (A) at (0,0) {Hello};');
    expect(tokens.some((token) => token.kind === 'command' && token.value === '\\node')).toBe(true);
    expect(tokens.some((token) => token.kind === 'number' && token.value === '0')).toBe(true);
    expect(tokens.some((token) => token.kind === 'semicolon')).toBe(true);
  });

  it('converts nodes and arrows into Graphic IR', () => {
    const result = parseTikz(
      '\\begin{tikzpicture}\n\\node[draw] (A) at (0,0) {Hello};\n\\node[draw] (B) at (4,0) {World};\n\\draw[->] (A) -- (B);\n\\end{tikzpicture}',
    );
    expect(result.valid).toBe(true);
    expect(result.project.elements.map((element) => element.id)).toEqual(['A', 'B', 'edge_03']);
    expect(result.project.elements[0]?.type).toBe('rectangle');
  });

  it('preserves unsupported macros as raw blocks without erasing supported nodes', () => {
    const result = parseTikz(
      '\\begin{tikzpicture}\n\\node[draw] (A) at (0,0) {Hello};\n\\foreach \\x in {1,...,3} {\\draw (\\x,0) -- (\\x,1);}\n\\end{tikzpicture}',
    );
    expect(result.project.elements.some((element) => element.id === 'A')).toBe(true);
    expect(result.project.elements.some((element) => element.type === 'raw-tikz')).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('reports malformed known syntax while retaining a partial project', () => {
    const result = parseTikz(
      '\\begin{tikzpicture}\n\\node[draw] (A) at (0,0);\n\\end{tikzpicture}',
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((item) => item.code === 'TIKZ_NODE_TEXT')).toBe(true);
  });
});
