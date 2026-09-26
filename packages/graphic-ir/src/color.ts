/**
 * Colors in the IR are either `#rrggbb` values (canvas palette / color picker) or xcolor
 * expressions imported from TikZ such as `blue!15` or `red!50!black`. Expressions keep their print
 * semantics; `displayColor` maps them onto the dark canvas so white paper becomes the canvas
 * background and black ink becomes the light foreground.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export type ColorRole = 'fill' | 'stroke' | 'text';

const CANVAS_BACKGROUND: Rgb = { r: 11, g: 16, b: 32 };
const CANVAS_FOREGROUND: Rgb = { r: 230, g: 237, b: 247 };

/** xcolor base colors plus the dvipsnames TikZ users reach for most often. */
const NAMED_COLORS: Record<string, Rgb> = {
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 255, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  cyan: { r: 0, g: 255, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  yellow: { r: 255, g: 255, b: 0 },
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  gray: { r: 128, g: 128, b: 128 },
  darkgray: { r: 64, g: 64, b: 64 },
  lightgray: { r: 191, g: 191, b: 191 },
  brown: { r: 191, g: 128, b: 64 },
  lime: { r: 191, g: 255, b: 0 },
  olive: { r: 128, g: 128, b: 0 },
  orange: { r: 255, g: 128, b: 0 },
  pink: { r: 255, g: 191, b: 191 },
  purple: { r: 191, g: 0, b: 64 },
  teal: { r: 0, g: 128, b: 128 },
  violet: { r: 128, g: 0, b: 128 },
};

/** Canvas palette → print color, so the dark UI defaults export as light, printable colors. */
const PALETTE_TO_TIKZ: Record<string, string> = {
  '#101827': 'black!8',
  '#0b1020': 'black!2',
  '#163250': 'blue!15',
  '#382650': 'violet!15',
  '#18443b': 'green!15',
  '#91a4c6': 'black!65',
  '#6f83a7': 'black!60',
  '#65d1b8': 'teal!70!black',
  '#e6edf7': 'black',
};

/** The default canvas strokes and text read as plain black ink in TikZ. */
const INK_DEFAULTS = new Set(['#91a4c6', '#6f83a7', '#e6edf7']);

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function mix(a: Rgb, b: Rgb, weightOfA: number): Rgb {
  const w = Math.min(1, Math.max(0, weightOfA));
  return {
    r: a.r * w + b.r * (1 - w),
    g: a.g * w + b.g * (1 - w),
    b: a.b * w + b.b * (1 - w),
  };
}

export function rgbToHex(color: Rgb): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hexToRgb(value: string): Rgb | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value.trim());
  if (!match?.[1]) return undefined;
  const hex =
    match[1].length === 3
      ? [...match[1]].map((character) => character + character).join('')
      : match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function isHexColor(value: string): boolean {
  return hexToRgb(value) !== undefined;
}

function parseRgb255(value: string): Rgb | undefined {
  const match =
    /^rgb\s*,\s*255\s*:\s*red\s*,\s*(\d+)\s*;\s*green\s*,\s*(\d+)\s*;\s*blue\s*,\s*(\d+)$/iu.exec(
      value,
    );
  if (!match) return undefined;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

/** Evaluates `#hex`, `{rgb,255:red,..;green,..;blue,..}` and xcolor `a!p!b` mix expressions. */
export function parseTikzColor(value: string): Rgb | undefined {
  const trimmed = value
    .trim()
    .replace(/^\{([\s\S]*)\}$/u, '$1')
    .trim();
  if (!trimmed) return undefined;
  const hex = hexToRgb(trimmed);
  if (hex) return hex;
  const rgb = parseRgb255(trimmed);
  if (rgb) return rgb;
  const parts = trimmed.split('!').map((part) => part.trim());
  const first = parts[0] ? NAMED_COLORS[parts[0].toLowerCase()] : undefined;
  if (!first) return undefined;
  let current = first;
  for (let index = 1; index < parts.length; index += 2) {
    const percent = Number.parseFloat(parts[index] ?? '');
    if (!Number.isFinite(percent)) return undefined;
    const nextName = parts[index + 1];
    const next = nextName === undefined ? NAMED_COLORS.white : NAMED_COLORS[nextName.toLowerCase()];
    if (!next) return undefined;
    current = mix(current, next, percent / 100);
  }
  return current;
}

function isTransparent(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === 'none' || normalized === 'transparent';
}

/** CSS color for rendering an IR color on the dark canvas. */
export function displayColor(value: string | undefined, role: ColorRole): string {
  if (isTransparent(value)) return 'none';
  const color = value?.trim() ?? '';
  if (isHexColor(color)) return color;
  const rgb = parseTikzColor(color);
  if (!rgb) return role === 'fill' ? '#1b2436' : rgbToHex(CANVAS_FOREGROUND);
  const max = Math.max(rgb.r, rgb.g, rgb.b) / 255;
  const min = Math.min(rgb.r, rgb.g, rgb.b) / 255;
  const whiteness = min;
  const blackness = 1 - max;
  const chroma = max - min;
  const hue: Rgb =
    chroma > 0
      ? {
          r: ((rgb.r / 255 - min) / chroma) * 255,
          g: ((rgb.g / 255 - min) / chroma) * 255,
          b: ((rgb.b / 255 - min) / chroma) * 255,
        }
      : CANVAS_FOREGROUND;
  const hueOnDark = mix(hue, CANVAS_FOREGROUND, 0.7);
  return rgbToHex({
    r: whiteness * CANVAS_BACKGROUND.r + blackness * CANVAS_FOREGROUND.r + chroma * hueOnDark.r,
    g: whiteness * CANVAS_BACKGROUND.g + blackness * CANVAS_FOREGROUND.g + chroma * hueOnDark.g,
    b: whiteness * CANVAS_BACKGROUND.b + blackness * CANVAS_FOREGROUND.b + chroma * hueOnDark.b,
  });
}

/** TikZ color expression for an IR color, or `none` when it is transparent. */
export function tikzColor(value: string | undefined, role: ColorRole): string {
  if (isTransparent(value)) return 'none';
  const color = value?.trim() ?? '';
  const normalized = color.toLowerCase();
  if ((role === 'stroke' || role === 'text') && INK_DEFAULTS.has(normalized)) return 'black';
  const palette = PALETTE_TO_TIKZ[normalized];
  if (palette) return palette;
  const hex = hexToRgb(color);
  if (hex) return `{rgb,255:red,${hex.r};green,${hex.g};blue,${hex.b}}`;
  return color;
}

/** Normalizes a TikZ color option value for storage in the IR. */
export function colorFromTikz(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^\{([\s\S]*)\}$/u, '$1')
    .trim();
  const rgb = parseRgb255(trimmed);
  return rgb ? rgbToHex(rgb) : trimmed;
}
