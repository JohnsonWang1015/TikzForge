import {
  createEmptyProject,
  createNode,
  createPlot,
  createArrow,
  type Diagnostic,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type Project,
  type RawTikzBlock,
  tikzToCanvas,
  validateProject,
  type NodeStyle,
  type RelativePosition,
  type TikzStyleDefinition,
} from '@tikzforge/graphic-ir';
import type {
  TikzCoordinateAst,
  TikzDocumentAst,
  TikzNodeAst,
  TikzOption,
  TikzPathAst,
  TikzPathSegment,
  TikzPlotAst,
  TikzRawAst,
  TikzStatement,
  TikzToken,
} from '@tikzforge/tikz-ast';
import type { Point, SourceRange } from '@tikzforge/graphic-ir';

interface Cursor {
  index: number;
  line: number;
  column: number;
}

export interface ParseResult {
  ast: TikzDocumentAst;
  project: Project;
  diagnostics: Diagnostic[];
  valid: boolean;
}

export interface ParseOptions {
  pixelsPerCm?: number;
  preserveWrapper?: boolean;
}

function range(start: Cursor, end: Cursor): SourceRange {
  return {
    startOffset: start.index,
    endOffset: end.index,
    line: start.line,
    column: start.column,
  };
}

function advance(cursor: Cursor, value: string): void {
  for (const character of value) {
    cursor.index += 1;
    if (character === '\n') {
      cursor.line += 1;
      cursor.column = 1;
    } else {
      cursor.column += 1;
    }
  }
}

/** Lexer for the supported, source-mapped TikZ subset. Unknown syntax remains a token. */
export function lex(source: string): TikzToken[] {
  const tokens: TikzToken[] = [];
  const cursor: Cursor = { index: 0, line: 1, column: 1 };
  const push = (kind: TikzToken['kind'], value: string, start: Cursor): void => {
    tokens.push({ kind, value, range: range(start, { ...cursor }) });
  };
  while (cursor.index < source.length) {
    const start = { ...cursor };
    const character = source[cursor.index];
    if (character === undefined) break;
    if (/\s/.test(character)) {
      let value = character;
      advance(cursor, character);
      while (cursor.index < source.length && /\s/.test(source[cursor.index] ?? '')) {
        const next = source[cursor.index];
        if (next === undefined) break;
        value += next;
        advance(cursor, next);
      }
      push('whitespace', value, start);
      continue;
    }
    if (character === '%') {
      let value = character;
      advance(cursor, character);
      while (cursor.index < source.length && source[cursor.index] !== '\n') {
        const next = source[cursor.index];
        if (next === undefined) break;
        value += next;
        advance(cursor, next);
      }
      push('comment', value, start);
      continue;
    }
    if (character === '\\') {
      const match = source.slice(cursor.index).match(/^\\[A-Za-z@]+|^\\./u);
      const value = match?.[0] ?? '\\';
      advance(cursor, value);
      push('command', value, start);
      continue;
    }
    if (character === '{') {
      advance(cursor, character);
      push('brace-open', character, start);
      continue;
    }
    if (character === '}') {
      advance(cursor, character);
      push('brace-close', character, start);
      continue;
    }
    if (character === '[') {
      advance(cursor, character);
      push('bracket-open', character, start);
      continue;
    }
    if (character === ']') {
      advance(cursor, character);
      push('bracket-close', character, start);
      continue;
    }
    if (character === '(') {
      advance(cursor, character);
      push('paren-open', character, start);
      continue;
    }
    if (character === ')') {
      advance(cursor, character);
      push('paren-close', character, start);
      continue;
    }
    if (character === ';') {
      advance(cursor, character);
      push('semicolon', character, start);
      continue;
    }
    if (character === ',') {
      advance(cursor, character);
      push('comma', character, start);
      continue;
    }
    const number = source.slice(cursor.index).match(/^-?(?:\d+\.\d*|\.\d+|\d+)/u)?.[0];
    if (number) {
      advance(cursor, number);
      push('number', number, start);
      continue;
    }
    const operator = source.slice(cursor.index).match(/^(?:<->|->|<-|--|\.\.|=)/u)?.[0];
    if (operator) {
      advance(cursor, operator);
      push('operator', operator, start);
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const identifier =
        source.slice(cursor.index).match(/^[A-Za-z_][A-Za-z0-9_:-]*/u)?.[0] ?? character;
      advance(cursor, identifier);
      push('identifier', identifier, start);
      continue;
    }
    advance(cursor, character);
    push('unknown', character, start);
  }
  return tokens;
}

function diagnostic(
  message: string,
  source: string,
  offset: number,
  severity: Diagnostic['severity'] = 'error',
  code?: string,
  suggestion?: string,
): Diagnostic {
  const before = source.slice(0, Math.max(0, offset));
  const line = before.split('\n').length;
  const column = (before.match(/(?:^|\n)([^\n]*)$/)?.[1]?.length ?? 0) + 1;
  return { severity, message, line, column, code, suggestion };
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && /\s/.test(value[index] ?? '')) index += 1;
  return index;
}

function readDelimited(
  value: string,
  start: number,
  open: string,
  close: string,
): { content: string; next: number } | undefined {
  if (value[start] !== open) return undefined;
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth === 0) return { content: value.slice(start + 1, index), next: index + 1 };
  }
  return undefined;
}

function parseCoordinate(value: string): Point | string | undefined {
  const trimmed = value.trim();
  const parts = trimmed.split(',').map((part) => part.trim());
  if (parts.length === 2) {
    const x = Number.parseFloat(parts[0] ?? '');
    const y = Number.parseFloat(parts[1] ?? '');
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  if (/^[A-Za-z_][A-Za-z0-9_:-]*$/u.test(trimmed)) return trimmed;
  return undefined;
}

function parseScalar(value: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(/cm|pt|mm$/u, '').trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptions(
  content: string,
  source: string,
  absoluteOffset: number,
): { options: TikzOption[]; diagnostics: Diagnostic[] } {
  const options: TikzOption[] = [];
  const diagnostics: Diagnostic[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index <= content.length; index += 1) {
    const character = content[index];
    if (character === '{' || character === '(') depth += 1;
    if (character === '}' || character === ')') depth -= 1;
    if ((character === ',' && depth === 0) || index === content.length) {
      const raw = content.slice(start, index).trim();
      if (raw) {
        const equal = raw.indexOf('=');
        const key = (equal >= 0 ? raw.slice(0, equal) : raw).trim();
        const optionValue = equal >= 0 ? raw.slice(equal + 1).trim() : undefined;
        if (!key) {
          diagnostics.push(
            diagnostic('TikZ option key cannot be empty.', source, absoluteOffset + start),
          );
        } else {
          options.push({
            key,
            value: optionValue,
            range: {
              startOffset: absoluteOffset + start,
              endOffset: absoluteOffset + index,
              line: 1,
              column: 1,
            },
          });
        }
      }
      start = index + 1;
    }
  }
  return { options, diagnostics };
}

function optionValue(options: TikzOption[], key: string): string | undefined {
  return options.find((option) => option.key.trim() === key)?.value;
}

function hasOption(options: TikzOption[], key: string): boolean {
  return options.some((option) => option.key.trim() === key);
}

function readOptionsAndRest(
  rest: string,
  absoluteOffset: number,
  source: string,
): { options: TikzOption[]; rest: string; offset: number; diagnostics: Diagnostic[] } {
  const start = skipWhitespace(rest, 0);
  if (rest[start] !== '[')
    return {
      options: [],
      rest: rest.slice(start),
      offset: absoluteOffset + start,
      diagnostics: [],
    };
  const bracket = readDelimited(rest, start, '[', ']');
  if (!bracket) {
    return {
      options: [],
      rest: rest.slice(start),
      offset: absoluteOffset + start,
      diagnostics: [
        diagnostic(
          'Unclosed TikZ option list.',
          source,
          absoluteOffset + start,
          'error',
          'TIKZ_UNCLOSED_OPTIONS',
          'Add a closing ]',
        ),
      ],
    };
  }
  const parsed = parseOptions(bracket.content, source, absoluteOffset + start + 1);
  return {
    options: parsed.options,
    rest: rest.slice(bracket.next),
    offset: absoluteOffset + bracket.next,
    diagnostics: parsed.diagnostics,
  };
}

function parseNodeStatement(
  statement: string,
  startOffset: number,
  source: string,
  command: 'node' | 'coordinate',
): { ast: TikzStatement; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const commandLength = command.length + 1;
  const optionResult = readOptionsAndRest(
    statement.slice(commandLength),
    startOffset + commandLength,
    source,
  );
  diagnostics.push(...optionResult.diagnostics);
  let rest = optionResult.rest;
  let offset = optionResult.offset;
  const idMatch = rest.match(/^\s*\(([^)]+)\)/u);
  const id = idMatch?.[1]?.trim();
  if (idMatch) {
    offset += idMatch[0].length;
    rest = rest.slice(idMatch[0].length);
  }
  const atMatch = rest.match(/\bat\s*\(([^)]+)\)/u);
  const coordinateValue = atMatch?.[1] ? parseCoordinate(atMatch[1]) : undefined;
  const relativeOption = optionResult.options.find((option) =>
    [
      'above',
      'below',
      'left',
      'right',
      'above left',
      'above right',
      'below left',
      'below right',
    ].includes(option.key),
  );
  const relativeTarget = relativeOption?.value?.match(/^of\s+(.+)$/u)?.[1];
  if (atMatch) {
    offset += atMatch.index ?? 0;
    rest = rest.slice((atMatch.index ?? 0) + atMatch[0].length);
  }
  const coordinate =
    coordinateValue && typeof coordinateValue !== 'string' ? coordinateValue : { x: 0, y: 0 };
  if ((!atMatch || !coordinateValue || typeof coordinateValue === 'string') && !relativeTarget) {
    diagnostics.push(
      diagnostic(
        `\\${command} requires an absolute coordinate in the supported subset.`,
        source,
        startOffset,
        'error',
        'TIKZ_COORDINATE',
      ),
    );
  }
  if (command === 'coordinate') {
    if (!id)
      diagnostics.push(
        diagnostic(
          'Coordinate declarations require an identifier.',
          source,
          startOffset,
          'error',
          'TIKZ_COORDINATE_ID',
        ),
      );
    const ast: TikzCoordinateAst = {
      kind: 'coordinate',
      id: id ?? `coordinate_${startOffset}`,
      coordinate,
      options: optionResult.options,
      range: { startOffset, endOffset: startOffset + statement.length, line: 1, column: 1 },
    };
    return { ast, diagnostics };
  }
  const bodyStart = rest.search(/\{/u);
  const body = bodyStart >= 0 ? readDelimited(rest, bodyStart, '{', '}') : undefined;
  if (!body) {
    diagnostics.push(
      diagnostic(
        'Node text must be enclosed in braces.',
        source,
        startOffset + statement.length,
        'error',
        'TIKZ_NODE_TEXT',
      ),
    );
  }
  const text = body?.content.trim() ?? '';
  const ast: TikzNodeAst = {
    kind: 'node',
    id,
    coordinate,
    options: optionResult.options,
    text,
    position:
      relativeOption && relativeTarget
        ? {
            target: relativeTarget,
            relation: relativeOption.key,
            distance: parseScalar(optionValue(optionResult.options, 'node distance') ?? '1') ?? 1,
          }
        : undefined,
    range: { startOffset, endOffset: startOffset + statement.length, line: 1, column: 1 },
  };
  void offset;
  return { ast, diagnostics };
}

function readParen(value: string, start: number): { content: string; next: number } | undefined {
  return readDelimited(value, start, '(', ')');
}

function parsePathSegment(
  value: string,
  start: number,
): { segment?: Extract<TikzPathSegment, { kind: 'point' }>; next: number; error?: string } {
  let cursor = skipWhitespace(value, start);
  const point = readParen(value, cursor);
  if (!point) return { next: cursor, error: 'Expected a coordinate or node reference.' };
  const parsedPoint = parseCoordinate(point.content);
  if (!parsedPoint) return { next: point.next, error: `Invalid coordinate "${point.content}".` };
  return { segment: { kind: 'point', value: parsedPoint }, next: point.next };
}

function parsePathStatement(
  statement: string,
  startOffset: number,
  source: string,
  command: TikzPathAst['command'],
): { ast: TikzPathAst; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const commandLength = command.length + 1;
  const optionResult = readOptionsAndRest(
    statement.slice(commandLength),
    startOffset + commandLength,
    source,
  );
  diagnostics.push(...optionResult.diagnostics);
  const body = optionResult.rest.trim();
  const bodyOffset = optionResult.offset + optionResult.rest.indexOf(body);
  const segments: TikzPathSegment[] = [];
  let cursor = 0;
  const first = parsePathSegment(body, cursor);
  if (!first.segment) {
    diagnostics.push(
      diagnostic(
        first.error ?? 'Path needs a starting coordinate.',
        source,
        bodyOffset + cursor,
        'error',
        'TIKZ_PATH_START',
      ),
    );
  } else {
    segments.push(first.segment);
    cursor = first.next;
  }
  while (cursor < body.length) {
    cursor = skipWhitespace(body, cursor);
    if (cursor >= body.length) break;
    const operatorMatch = body.slice(cursor).match(/^(--|rectangle|circle|ellipse|\.\.)/u);
    const operator = operatorMatch?.[1];
    if (!operator) {
      diagnostics.push(
        diagnostic(
          'Unsupported or incomplete path segment.',
          source,
          bodyOffset + cursor,
          'error',
          'TIKZ_PATH_SEGMENT',
          'Use --, rectangle, circle, ellipse or .. controls ..',
        ),
      );
      break;
    }
    cursor += operator.length;
    if (operator === '--' || operator === 'rectangle') {
      const next = parsePathSegment(body, cursor);
      if (!next.segment) {
        diagnostics.push(
          diagnostic(
            next.error ?? 'Expected a path endpoint.',
            source,
            bodyOffset + cursor,
            'error',
            'TIKZ_PATH_ENDPOINT',
          ),
        );
        break;
      }
      segments.push(
        operator === '--'
          ? { kind: 'line', to: next.segment.value }
          : { kind: 'rectangle', to: next.segment.value },
      );
      cursor = next.next;
      continue;
    }
    if (operator === 'circle') {
      cursor = skipWhitespace(body, cursor);
      const radius = readParen(body, cursor);
      const parsedRadius = radius ? parseScalar(radius.content) : undefined;
      if (!radius || parsedRadius === undefined) {
        diagnostics.push(
          diagnostic(
            'Circle paths need a numeric radius.',
            source,
            bodyOffset + cursor,
            'error',
            'TIKZ_CIRCLE_RADIUS',
          ),
        );
        break;
      }
      segments.push({ kind: 'circle', radius: parsedRadius });
      cursor = radius.next;
      continue;
    }
    if (operator === 'ellipse') {
      cursor = skipWhitespace(body, cursor);
      const radii = readParen(body, cursor);
      const parsedRadii = radii
        ? parseCoordinate(radii.content.replace(/\s+and\s+/u, ','))
        : undefined;
      if (!radii || !parsedRadii || typeof parsedRadii === 'string') {
        diagnostics.push(
          diagnostic(
            'Ellipse paths need two numeric radii.',
            source,
            bodyOffset + cursor,
            'error',
            'TIKZ_ELLIPSE_RADII',
          ),
        );
        break;
      }
      segments.push({ kind: 'ellipse', radii: parsedRadii });
      cursor = radii.next;
      continue;
    }
    const controls: Point[] = [];
    cursor = skipWhitespace(body, cursor);
    if (body.slice(cursor).startsWith('controls')) cursor += 'controls'.length;
    while (controls.length < 2) {
      cursor = skipWhitespace(body, cursor);
      const control = readParen(body, cursor);
      const parsedControl = control ? parseCoordinate(control.content) : undefined;
      if (!control || !parsedControl || typeof parsedControl === 'string') break;
      controls.push(parsedControl);
      cursor = control.next;
      cursor = skipWhitespace(body, cursor);
      if (body.slice(cursor).startsWith('and')) cursor += 3;
    }
    cursor = skipWhitespace(body, cursor);
    if (body.slice(cursor).startsWith('..')) cursor += 2;
    const endpoint = parsePathSegment(body, cursor);
    if (!endpoint.segment) {
      diagnostics.push(
        diagnostic(
          'Bézier paths need an endpoint.',
          source,
          bodyOffset + cursor,
          'error',
          'TIKZ_BEZIER_ENDPOINT',
        ),
      );
      break;
    }
    segments.push({ kind: 'bezier', controls, to: endpoint.segment.value });
    cursor = endpoint.next;
  }
  const ast: TikzPathAst = {
    kind: 'path',
    command,
    options: optionResult.options,
    segments,
    range: { startOffset, endOffset: startOffset + statement.length, line: 1, column: 1 },
  };
  return { ast, diagnostics };
}

function parsePlotStatement(
  statement: string,
  startOffset: number,
  source: string,
): { ast: TikzPlotAst; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const optionsMatch = statement.match(/\\begin\s*\{axis\}\s*(?:\[([\s\S]*?)\])?/u);
  const options = optionsMatch?.[1]
    ? parseOptions(optionsMatch[1], source, startOffset).options
    : [];
  const coordinateMatch = statement.match(/coordinates\s*\{([\s\S]*?)\}/u);
  const data: Point[] = [];
  for (const match of coordinateMatch?.[1]?.matchAll(/\(([-+\d.]+)\s*,\s*([-+\d.]+)\)/gu) ?? []) {
    const x = Number.parseFloat(match[1] ?? '');
    const y = Number.parseFloat(match[2] ?? '');
    if (Number.isFinite(x) && Number.isFinite(y)) data.push({ x, y });
  }
  if (data.length === 0 && /\\addplot\s*\{/u.test(statement)) {
    diagnostics.push(
      diagnostic(
        'Function plots are preserved but need an expression for visual data.',
        source,
        startOffset,
        'warning',
        'PGFPLOTS_FUNCTION',
      ),
    );
  }
  const plotType: TikzPlotAst['plotType'] = hasOption(options, 'ybar')
    ? 'bar'
    : hasOption(options, 'only marks')
      ? 'scatter'
      : 'line';
  const ast: TikzPlotAst = {
    kind: 'plot',
    options,
    plotType,
    data,
    expression: statement.match(/\\addplot\s*(?:\[[^\]]*\])?\s*\{([\s\S]*?)\}/u)?.[1]?.trim(),
    range: { startOffset, endOffset: startOffset + statement.length, line: 1, column: 1 },
  };
  return { ast, diagnostics };
}

function parseStatement(
  statement: string,
  startOffset: number,
  source: string,
): { ast: TikzStatement; diagnostics: Diagnostic[] } {
  const trimmed = statement.trim();
  const leading = statement.indexOf(trimmed);
  const offset = startOffset + Math.max(0, leading);
  if (trimmed.startsWith('\\begin{axis}')) return parsePlotStatement(trimmed, offset, source);
  const command = trimmed.match(/^\\(node|coordinate|draw|path|filldraw|fill|clip)\b/u)?.[1];
  if (command === 'node' || command === 'coordinate')
    return parseNodeStatement(trimmed, offset, source, command);
  if (
    command === 'draw' ||
    command === 'path' ||
    command === 'filldraw' ||
    command === 'fill' ||
    command === 'clip'
  ) {
    return parsePathStatement(trimmed, offset, source, command);
  }
  const raw: TikzRawAst = {
    kind: 'raw',
    source: trimmed,
    reason: trimmed.startsWith('\\') ? 'Unsupported TikZ command' : 'Unrecognized TikZ content',
    range: { startOffset: offset, endOffset: offset + trimmed.length, line: 1, column: 1 },
  };
  return {
    ast: raw,
    diagnostics: [
      diagnostic(
        `Preserved unsupported TikZ as a RawTikZBlock: ${raw.reason}.`,
        source,
        offset,
        'warning',
        'TIKZ_RAW_BLOCK',
      ),
    ],
  };
}

function splitStatements(body: string, offset: number): Array<{ source: string; offset: number }> {
  const statements: Array<{ source: string; offset: number }> = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let index = 0;
  while (index < body.length) {
    if (body.startsWith('\\begin{axis}', index)) {
      const endMarker = '\\end{axis}';
      const end = body.indexOf(endMarker, index + '\\begin{axis}'.length);
      if (end >= 0) {
        if (body.slice(start, index).trim())
          statements.push({ source: body.slice(start, index), offset: offset + start });
        const endOffset = end + endMarker.length;
        statements.push({ source: body.slice(index, endOffset), offset: offset + index });
        index = endOffset;
        start = index;
        continue;
      }
    }
    const character = body[index];
    if (character === '{') braces += 1;
    if (character === '}') braces = Math.max(0, braces - 1);
    if (character === '[') brackets += 1;
    if (character === ']') brackets = Math.max(0, brackets - 1);
    if (character === '(') parentheses += 1;
    if (character === ')') parentheses = Math.max(0, parentheses - 1);
    if (character === ';' && braces === 0 && brackets === 0 && parentheses === 0) {
      statements.push({ source: body.slice(start, index), offset: offset + start });
      start = index + 1;
    }
    index += 1;
  }
  if (body.slice(start).trim())
    statements.push({ source: body.slice(start), offset: offset + start });
  return statements;
}

function parseDocument(source: string): { ast: TikzDocumentAst; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const begin = /\\begin\s*\{tikzpicture\}/u.exec(source);
  const end = begin
    ? /\\end\s*\{tikzpicture\}/u.exec(source.slice((begin.index ?? 0) + begin[0].length))
    : undefined;
  const bodyStart = begin ? (begin.index ?? 0) + begin[0].length : 0;
  const bodyEnd = begin && end ? bodyStart + (end.index ?? 0) : source.length;
  if (begin && !end)
    diagnostics.push(
      diagnostic(
        'TikZ picture is missing \\end{tikzpicture}.',
        source,
        bodyStart,
        'error',
        'TIKZ_UNCLOSED_ENV',
      ),
    );
  const body = source.slice(bodyStart, bodyEnd);
  const statements: TikzStatement[] = [];
  for (const part of splitStatements(body, bodyStart)) {
    if (!part.source.trim() || /^\s*%/u.test(part.source)) continue;
    const parsed = parseStatement(part.source, part.offset, source);
    statements.push(parsed.ast);
    diagnostics.push(...parsed.diagnostics);
  }
  const tokens = lex(source);
  const ast: TikzDocumentAst = {
    kind: 'document',
    source,
    bodyRange: { startOffset: bodyStart, endOffset: bodyEnd, line: 1, column: 1 },
    wrapperPrefix: begin ? source.slice(0, begin.index ?? 0) : '',
    wrapperSuffix: begin && end ? source.slice(bodyEnd + end[0].length) : '',
    statements,
    tokens,
  };
  return { ast, diagnostics };
}

function tikzColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim();
  const known: Record<string, string> = {
    blue: '#4b83d1',
    green: '#45aa78',
    red: '#e06464',
    orange: '#df9b4e',
    violet: '#9b75d1',
    yellow: '#d2bd5d',
    black: '#111827',
    white: '#f7f9fc',
  };
  const base = normalized.split('!')[0] ?? normalized;
  return known[base] ?? (normalized.startsWith('#') ? normalized : fallback);
}

function styleFromOptions(
  options: TikzOption[],
  styles: Record<string, TikzStyleDefinition>,
): NodeStyle {
  const style: NodeStyle = {
    fill: 'transparent',
    stroke: '#91a4c6',
    lineWidth: 1.5,
    rounded: false,
    fontSize: 14,
    fontWeight: 'normal',
    textColor: '#e6edf7',
    align: 'center',
  };
  for (const option of options) {
    const named = styles[option.key];
    if (named) {
      if (named.fill) style.fill = tikzColor(named.fill, style.fill);
      if (named.stroke) style.stroke = tikzColor(named.stroke, style.stroke);
      if (named.lineWidth) style.lineWidth = named.lineWidth;
      if (named.rounded) style.rounded = true;
      if (named.dashed) style.dashed = true;
    }
    if (option.key === 'draw') style.stroke = '#91a4c6';
    if (option.key === 'fill') style.fill = tikzColor(option.value, '#263b66');
    if (option.key === 'rounded corners') style.rounded = true;
    if (option.key === 'dashed') style.dashed = true;
    if (option.key === 'font' && option.value?.includes('bf')) style.fontWeight = 'bold';
    if (option.key === 'font size')
      style.fontSize = parseScalar(option.value ?? '') ?? style.fontSize;
    if (option.key === 'text width')
      style.textWidth = parseScalar(option.value ?? '') ?? style.textWidth;
    if (
      option.key === 'align' &&
      option.value &&
      ['left', 'center', 'right'].includes(option.value)
    )
      style.align = option.value as NodeStyle['align'];
    if (option.key === 'line width')
      style.lineWidth = parseScalar(option.value ?? '') ?? style.lineWidth;
  }
  return style;
}

function edgeFromPath(
  path: TikzPathAst,
  project: Project,
  pixelsPerCm: number,
  index: number,
): EdgeElement | undefined {
  const start = path.segments[0];
  const next = path.segments[1];
  if (!start || start.kind !== 'point' || !next || (next.kind !== 'line' && next.kind !== 'bezier'))
    return undefined;
  const from = typeof start.value === 'string' ? start.value : undefined;
  const toValue = next.to;
  const to = typeof toValue === 'string' ? toValue : undefined;
  if (!from || !to) return undefined;
  const bidirectional = hasOption(path.options, '<->') || hasOption(path.options, 'bidirectional');
  const directed = hasOption(path.options, '->') || hasOption(path.options, '<-');
  const arrow = directed || bidirectional ? 'stealth' : 'none';
  const edge = createArrow(
    from,
    to,
    {
      id: `edge_${String(index + 1).padStart(2, '0')}`,
      type: bidirectional
        ? 'bidirectional-arrow'
        : hasOption(path.options, 'dashed') && directed
          ? 'dashed-arrow'
          : directed
            ? 'arrow'
            : 'line',
      style: {
        arrow: optionValue(path.options, '->') ? 'stealth' : arrow,
        dashed: hasOption(path.options, 'dashed'),
        stroke: '#91a4c6',
        lineWidth: parseScalar(optionValue(path.options, 'line width') ?? '') ?? 1.5,
      },
    },
    project.elements.map((element) => element.id),
  );
  if (next.kind === 'bezier') {
    edge.type = 'curved-arrow';
    edge.controlPoints = next.controls.map((point) => ({
      x: tikzToCanvas(point.x, pixelsPerCm),
      y: tikzToCanvas(point.y, pixelsPerCm),
    }));
  }
  return edge;
}

function statementToElements(
  statement: TikzStatement,
  project: Project,
  pixelsPerCm: number,
  index: number,
  diagnostics: Diagnostic[],
  source: string,
): Project['elements'] {
  if (statement.kind === 'node') {
    const style = styleFromOptions(statement.options, project.styles);
    const shape = hasOption(statement.options, 'circle')
      ? 'circle'
      : hasOption(statement.options, 'ellipse')
        ? 'ellipse'
        : 'rectangle';
    const node = createNode(
      shape,
      {
        id: statement.id ?? `node_${String(index + 1).padStart(2, '0')}`,
        x: tikzToCanvas(statement.coordinate.x, pixelsPerCm),
        y: tikzToCanvas(statement.coordinate.y, pixelsPerCm),
        text: statement.text,
        style,
        position: statement.position
          ? {
              mode: 'relative',
              target: statement.position.target,
              relation: statement.position.relation as RelativePosition['relation'],
              distance: statement.position.distance,
            }
          : { mode: 'absolute' },
      },
      project.elements.map((element) => element.id),
    );
    node.sourceRange = statement.range;
    if (!statement.id)
      diagnostics.push(
        diagnostic(
          'Unnamed nodes are assigned a generated id for visual editing.',
          source,
          statement.range.startOffset,
          'warning',
          'TIKZ_GENERATED_ID',
        ),
      );
    return [node];
  }
  if (statement.kind === 'coordinate') {
    const coordinate = createNode(
      'coordinate',
      {
        id: statement.id,
        x: tikzToCanvas(statement.coordinate.x, pixelsPerCm),
        y: tikzToCanvas(statement.coordinate.y, pixelsPerCm),
        width: 12,
        height: 12,
        text: '',
        style: {
          fill: 'transparent',
          stroke: '#65d1b8',
          lineWidth: 1,
          rounded: false,
          fontSize: 10,
          fontWeight: 'normal',
          textColor: '#65d1b8',
          align: 'center',
        },
      },
      project.elements.map((element) => element.id),
    );
    coordinate.sourceRange = statement.range;
    return [coordinate];
  }
  if (statement.kind === 'plot') {
    const plot = createPlot({
      id: `plot_${String(index + 1).padStart(2, '0')}`,
      data: statement.data,
      plotType: statement.plotType,
    });
    plot.sourceRange = statement.range;
    return [plot];
  }
  if (statement.kind === 'path') {
    const first = statement.segments[0];
    const second = statement.segments[1];
    if (
      first?.kind === 'point' &&
      second?.kind === 'rectangle' &&
      typeof first.value !== 'string' &&
      typeof second.to !== 'string'
    ) {
      const rectangle = createNode('rectangle', {
        id: `rectangle_${String(index + 1).padStart(2, '0')}`,
        x: tikzToCanvas((first.value.x + second.to.x) / 2, pixelsPerCm),
        y: tikzToCanvas((first.value.y + second.to.y) / 2, pixelsPerCm),
        width: Math.abs(tikzToCanvas(second.to.x - first.value.x, pixelsPerCm)),
        height: Math.abs(tikzToCanvas(second.to.y - first.value.y, pixelsPerCm)),
        text: '',
        style: styleFromOptions(statement.options, project.styles),
      });
      rectangle.sourceRange = statement.range;
      return [rectangle];
    }
    if (first?.kind === 'point' && second?.kind === 'circle' && typeof first.value !== 'string') {
      const circle = createNode('circle', {
        id: `circle_${String(index + 1).padStart(2, '0')}`,
        x: tikzToCanvas(first.value.x, pixelsPerCm),
        y: tikzToCanvas(first.value.y, pixelsPerCm),
        width: tikzToCanvas(second.radius * 2, pixelsPerCm),
        height: tikzToCanvas(second.radius * 2, pixelsPerCm),
        text: '',
        style: styleFromOptions(statement.options, project.styles),
      });
      circle.sourceRange = statement.range;
      return [circle];
    }
    const edge = edgeFromPath(statement, project, pixelsPerCm, index);
    if (edge) {
      edge.sourceRange = statement.range;
      return [edge];
    }
  }
  const raw: RawTikzBlock = {
    id: `raw_${String(index + 1).padStart(2, '0')}`,
    type: 'raw-tikz',
    layer: 'overlays',
    visible: true,
    locked: true,
    rotation: 0,
    source:
      statement.kind === 'raw'
        ? statement.source
        : source.slice(statement.range.startOffset, statement.range.endOffset),
    reason:
      statement.kind === 'raw'
        ? statement.reason
        : 'Geometry is outside the editable visual subset',
    editable: false,
    sourceRange: statement.range,
  };
  return [raw];
}

function resolveRelativeNodes(
  project: Project,
  pixelsPerCm: number,
  diagnostics: Diagnostic[],
  source: string,
): void {
  const nodes = project.elements.filter(
    (element): element is NodeElement =>
      element.type === 'rectangle' ||
      element.type === 'circle' ||
      element.type === 'ellipse' ||
      element.type === 'text' ||
      element.type === 'formula' ||
      element.type === 'coordinate' ||
      element.type === 'image',
  );
  for (const node of nodes) {
    const position = node.position;
    if (position.mode !== 'relative') continue;
    const target = nodes.find((candidate) => candidate.id === position.target);
    if (!target) {
      diagnostics.push(
        diagnostic(
          `Relative node target "${position.target}" does not exist.`,
          source,
          node.sourceRange?.startOffset ?? 0,
          'error',
          'TIKZ_RELATIVE_TARGET',
        ),
      );
      continue;
    }
    const distance = tikzToCanvas(position.distance, pixelsPerCm);
    const horizontal = position.relation.includes('right')
      ? 1
      : position.relation.includes('left')
        ? -1
        : 0;
    const vertical = position.relation.includes('below')
      ? 1
      : position.relation.includes('above')
        ? -1
        : 0;
    node.x = target.x + horizontal * (target.width / 2 + node.width / 2 + distance);
    node.y = target.y + vertical * (target.height / 2 + node.height / 2 + distance);
  }
}

/** Parses source and returns a project even when diagnostics exist, so the editor can retain context. */
export function parseTikz(source: string, options: ParseOptions = {}): ParseResult {
  const parsed = parseDocument(source);
  const project = createEmptyProject('Imported TikZ diagram');
  project.settings.pixelsPerCm = options.pixelsPerCm ?? 100;
  const diagnostics = [...parsed.diagnostics];
  for (const [index, statement] of parsed.ast.statements.entries()) {
    const elements = statementToElements(
      statement,
      project,
      project.settings.pixelsPerCm,
      index,
      diagnostics,
      source,
    );
    project.elements.push(...elements);
  }
  resolveRelativeNodes(project, project.settings.pixelsPerCm, diagnostics, source);
  project.rawTikzBlocks = project.elements.filter(
    (element): element is RawTikzBlock => element.type === 'raw-tikz',
  );
  const validation = validateProject(project);
  diagnostics.push(...validation.errors.map((error) => ({ ...error, severity: 'error' as const })));
  if (options.preserveWrapper !== false)
    project.metadata.description = parsed.ast.wrapperPrefix || undefined;
  if (parsed.ast.wrapperPrefix || parsed.ast.wrapperSuffix)
    project.documentWrapper = {
      prefix: parsed.ast.wrapperPrefix,
      suffix: parsed.ast.wrapperSuffix,
    };
  return {
    ast: parsed.ast,
    project,
    diagnostics,
    valid: diagnostics.every((item) => item.severity !== 'error'),
  };
}

export function diagnosticsForTikz(source: string): Diagnostic[] {
  return parseTikz(source).diagnostics;
}

export type { TikzDocumentAst, TikzToken } from '@tikzforge/tikz-ast';
