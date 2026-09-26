import type { SourceRange } from '@tikzforge/graphic-ir';

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
  /** The option exactly as written, e.g. `fill = blue!20`. */
  raw: string;
  range: SourceRange;
}

export type TikzStatementKind =
  'node' | 'coordinate' | 'path' | 'plot' | 'foreach' | 'environment' | 'styles' | 'raw';

/** One top-level statement of a picture and the IR elements it produced. */
export interface TikzStatement {
  kind: TikzStatementKind;
  /** Command or environment name, e.g. `draw`, `foreach` or `scope`. */
  command?: string;
  /** Covers the statement text including its terminating `;`. */
  range: SourceRange;
  options: TikzOption[];
  elementIds: string[];
}

export interface TikzDocumentAst {
  kind: 'document';
  source: string;
  bodyRange: SourceRange;
  wrapperPrefix: string;
  wrapperSuffix: string;
  /** Text inside `\begin{tikzpicture}[...]`, when present. */
  pictureOptions?: string;
  statements: TikzStatement[];
  tokens: TikzToken[];
}
