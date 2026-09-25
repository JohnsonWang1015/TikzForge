import { diagnosticsForTikz, parseTikz } from '@tikzforge/tikz-parser';
import type { Diagnostic } from '@tikzforge/graphic-ir';

export interface CompletionItem {
  label: string;
  kind: 'keyword' | 'value' | 'snippet';
  detail: string;
  insertText?: string;
}

export interface TikzLanguageService {
  completions(source: string, offset: number): CompletionItem[];
  diagnostics(source: string): Diagnostic[];
  format(source: string): string;
  snippets(): CompletionItem[];
}

const options: CompletionItem[] = [
  'draw',
  'fill',
  'minimum width',
  'minimum height',
  'rounded corners',
  'font',
  'text width',
  'align',
  'anchor',
  'above',
  'below',
  'left',
  'right',
  'dashed',
  'line width',
  'circle',
  'ellipse',
].map((label) => ({ label, kind: 'keyword', detail: 'TikZ option' }));

const snippets: CompletionItem[] = [
  {
    label: 'node',
    kind: 'snippet',
    detail: 'Named TikZ node',
    insertText: '\\node[draw] (${1:id}) at (${2:0},${3:0}) {${4:Text}};',
  },
  {
    label: 'arrow',
    kind: 'snippet',
    detail: 'Arrow between nodes',
    insertText: '\\draw[->] (${1:from}) -- (${2:to});',
  },
  {
    label: 'tikzpicture',
    kind: 'snippet',
    detail: 'TikZ picture environment',
    insertText: '\\begin{tikzpicture}\n\t$0\n\\end{tikzpicture}',
  },
  {
    label: 'plot',
    kind: 'snippet',
    detail: 'PGFPlots coordinate plot',
    insertText: '\\begin{axis}\n\\addplot coordinates { (${1:1},${2:1}) };\n\\end{axis}',
  },
];

function formatOptions(source: string): string {
  return source.replace(/\\node\[([^\]]*)\]/gu, (_, value: string) => {
    const formatted = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .join(', ');
    return `\\node[${formatted}]`;
  });
}

export const tikzLanguageService: TikzLanguageService = {
  completions(source, offset) {
    const before = source.slice(0, offset);
    const inOptions = before.lastIndexOf('[') > before.lastIndexOf(']');
    return inOptions ? options : snippets;
  },
  diagnostics(source) {
    return diagnosticsForTikz(source);
  },
  format(source) {
    const parsed = parseTikz(source);
    if (!parsed.ast.wrapperPrefix && parsed.valid) return formatOptions(source.trim());
    return formatOptions(source);
  },
  snippets() {
    return snippets;
  },
};
