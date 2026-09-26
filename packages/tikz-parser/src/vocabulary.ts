import { formatNumber, ptToPx, pxToPt, PT_PER_CM } from '@tikzforge/graphic-ir';

/** The preamble every TikzForge picture is compiled with; keep in sync with the compiler service. */
export const TIKZ_PREAMBLE = [
  '\\documentclass{standalone}',
  '\\usepackage{tikz}',
  '\\usepackage{pgfplots}',
  '\\pgfplotsset{compat=1.18}',
  '\\usepackage{amsmath,amssymb}',
  '\\usetikzlibrary{arrows.meta,calc,positioning,shapes.geometric,fit,backgrounds}',
];

const UNIT_TO_CM: Record<string, number> = {
  cm: 1,
  mm: 0.1,
  in: 2.54,
  pt: 1 / PT_PER_CM,
  bp: 2.54 / 72,
  em: 10 / PT_PER_CM,
  ex: 4.3 / PT_PER_CM,
};

/** Parses a TikZ length such as `2cm`, `3mm` or `0.5`; bare numbers are centimetres. */
export function lengthToCm(value: string | undefined): number | undefined {
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*([a-z]{2})?\s*$/iu.exec(value ?? '');
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1] ?? '');
  const factor = match[2] ? UNIT_TO_CM[match[2].toLowerCase()] : 1;
  return Number.isFinite(amount) && factor !== undefined ? amount * factor : undefined;
}

/** Parses a TikZ length and returns TeX points; bare numbers are points (line widths, fonts). */
export function lengthToPt(value: string | undefined): number | undefined {
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*([a-z]{2})?\s*$/iu.exec(value ?? '');
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount)) return undefined;
  if (!match[2]) return amount;
  const factor = UNIT_TO_CM[match[2].toLowerCase()];
  return factor === undefined ? undefined : amount * factor * PT_PER_CM;
}

const FONT_SIZES: Array<[string, number]> = [
  ['\\tiny', 5],
  ['\\scriptsize', 7],
  ['\\footnotesize', 8],
  ['\\small', 9],
  ['\\normalsize', 10],
  ['\\large', 12],
  ['\\Large', 14.4],
  ['\\LARGE', 17.28],
  ['\\huge', 20.74],
  ['\\Huge', 24.88],
];

/** Reads `font=...` into a size (canvas px) and weight. */
export function parseFontOption(
  value: string,
  pixelsPerCm: number,
): { fontSize?: number; bold?: boolean } {
  const result: { fontSize?: number; bold?: boolean } = {};
  if (/\\(?:bfseries|bf)\b/u.test(value)) result.bold = true;
  const explicit = /\\fontsize\s*\{([^}]*)\}/u.exec(value);
  const explicitPt = explicit ? lengthToPt(explicit[1]) : undefined;
  if (explicitPt !== undefined) {
    result.fontSize = ptToPx(explicitPt, pixelsPerCm);
    return result;
  }
  for (const [command, size] of FONT_SIZES) {
    if (new RegExp(`\\${command}(?![A-Za-z])`, 'u').test(value))
      result.fontSize = ptToPx(size, pixelsPerCm);
  }
  return result;
}

/** `font=` value for a canvas font size, or undefined when it is LaTeX's default 10pt. */
export function fontOption(
  fontSize: number,
  bold: boolean,
  pixelsPerCm: number,
): string | undefined {
  const pt = pxToPt(fontSize, pixelsPerCm);
  const named = FONT_SIZES.find(([, size]) => Math.abs(size - pt) < 0.3);
  const size =
    named?.[0] === '\\normalsize'
      ? ''
      : (named?.[0] ??
        `\\fontsize{${formatNumber(pt, 1)}}{${formatNumber(pt * 1.2, 1)}}\\selectfont`);
  const value = `${size}${bold ? '\\bfseries' : ''}`;
  return value ? `font=${value}` : undefined;
}

const LINE_WIDTHS: Array<[string, number]> = [
  ['ultra thin', 0.1],
  ['very thin', 0.2],
  ['thin', 0.4],
  ['semithick', 0.6],
  ['thick', 0.8],
  ['very thick', 1.2],
  ['ultra thick', 1.6],
];

/** Canvas line width for a `thick`-style key or `line width=...`; undefined when not a width. */
export function parseLineWidth(
  key: string,
  value: string | undefined,
  pixelsPerCm: number,
): number | undefined {
  if (key === 'line width') {
    const pt = lengthToPt(value);
    return pt === undefined ? undefined : ptToPx(pt, pixelsPerCm);
  }
  const named = LINE_WIDTHS.find(([name]) => name === key);
  return named ? ptToPx(named[1], pixelsPerCm) : undefined;
}

/** TikZ option for a canvas line width, or undefined when it is the 0.4pt default. */
export function lineWidthOption(lineWidth: number, pixelsPerCm: number): string | undefined {
  const pt = pxToPt(lineWidth, pixelsPerCm);
  if (Math.abs(pt - 0.4) < 0.02) return undefined;
  const named = LINE_WIDTHS.find(([, size]) => Math.abs(size - pt) < 0.02);
  return named ? named[0] : `line width=${formatNumber(pt, 2)}pt`;
}

export interface ArrowSpec {
  start: string;
  end: string;
}

/**
 * Splits an arrow option such as `->`, `<->`, `-Stealth`, `Latex-` or `-{Stealth[length=3mm]}`
 * into its start and end tips. Returns undefined for options that are not arrow specs.
 */
export function parseArrowSpec(option: string): ArrowSpec | undefined {
  const text = option.trim();
  const tip = /^(?:[<>|)(]+|\{[^}]*\}|[A-Za-z][A-Za-z ']*(?:\[[^\]]*\])?)?$/u;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '{' || character === '[') depth += 1;
    if (character === '}' || character === ']') depth -= 1;
    if (character === '-' && depth === 0) {
      const start = text.slice(0, index).trim();
      const end = text.slice(index + 1).trim();
      return tip.test(start) && tip.test(end) ? { start, end } : undefined;
    }
  }
  return undefined;
}

/** The IR arrow style a TikZ tip name corresponds to. */
export function arrowStyleForTip(tip: string): 'stealth' | 'latex' | 'triangle' {
  const name = tip.replace(/^\{|\}$/gu, '').toLowerCase();
  if (name.startsWith('latex')) return 'latex';
  if (name.startsWith('triangle')) return 'triangle';
  return 'stealth';
}

/** Mirrors an arrow spec so `A <- B` can be stored as `B -> A`. */
export function mirrorArrowSpec(spec: ArrowSpec): string {
  const flip = (tip: string): string =>
    tip.replace(/[<>]/gu, (character) => (character === '<' ? '>' : '<'));
  return `${flip(spec.end)}-${flip(spec.start)}`;
}
