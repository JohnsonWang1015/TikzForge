import type { Point, SourceRange } from '@tikzforge/graphic-ir';

export type TikzTokenKind =
  | 'command'
  | 'identifier'
  | 'number'
  | 'string'
  | 'option'
  | 'coordinate'
  | 'brace-open'
  | 'brace-close'
  | 'bracket-open'
  | 'bracket-close'
  | 'paren-open'
  | 'paren-close'
  | 'semicolon'
  | 'comma'
  | 'operator'
  | 'whitespace'
  | 'comment'
  | 'unknown';

export interface TikzToken {
  kind: TikzTokenKind;
  value: string;
  range: SourceRange;
}

export interface TikzOption {
  key: string;
  value?: string;
  range: SourceRange;
}

export interface AstNodeBase {
  kind: string;
  range: SourceRange;
}

export interface TikzNodeAst extends AstNodeBase {
  kind: 'node';
  id?: string;
  coordinate: Point;
  options: TikzOption[];
  text: string;
  position?: {
    target: string;
    relation: string;
    distance: number;
  };
}

export interface TikzCoordinateAst extends AstNodeBase {
  kind: 'coordinate';
  id: string;
  coordinate: Point;
  options: TikzOption[];
}

export interface TikzPathAst extends AstNodeBase {
  kind: 'path';
  command: 'draw' | 'path' | 'fill' | 'filldraw' | 'clip';
  options: TikzOption[];
  segments: TikzPathSegment[];
}

export type TikzPathSegment =
  | { kind: 'point'; value: Point | string }
  | { kind: 'line'; to: Point | string }
  | { kind: 'rectangle'; to: Point | string }
  | { kind: 'circle'; radius: number }
  | { kind: 'ellipse'; radii: Point }
  | { kind: 'bezier'; controls: Point[]; to: Point | string };

export interface TikzPlotAst extends AstNodeBase {
  kind: 'plot';
  options: TikzOption[];
  plotType: 'line' | 'scatter' | 'bar' | 'function';
  data: Point[];
  expression?: string;
}

export interface TikzRawAst extends AstNodeBase {
  kind: 'raw';
  source: string;
  reason: string;
}

export type TikzStatement =
  TikzNodeAst | TikzCoordinateAst | TikzPathAst | TikzPlotAst | TikzRawAst;

export interface TikzDocumentAst {
  kind: 'document';
  source: string;
  bodyRange: SourceRange;
  wrapperPrefix: string;
  wrapperSuffix: string;
  statements: TikzStatement[];
  tokens: TikzToken[];
}
