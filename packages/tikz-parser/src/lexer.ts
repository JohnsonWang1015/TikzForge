import type { SourceRange } from '@tikzforge/graphic-ir';
import type { TikzToken } from '@tikzforge/tikz-ast';

interface Cursor {
  index: number;
  line: number;
  column: number;
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
