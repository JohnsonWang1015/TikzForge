import type { Point } from '@tikzforge/graphic-ir';

/** Plots are serialized inline as `coordinates {...}`, so imports stay a reasonable size. */
export const MAX_PLOT_POINTS = 5000;

function cells(line: string): string[] {
  const separator = line.includes('\t')
    ? '\t'
    : line.includes(';')
      ? ';'
      : line.includes(',')
        ? ','
        : /\s+/u;
  return line
    .split(separator)
    .map((cell) => cell.trim().replace(/^"(.*)"$/u, '$1'))
    .filter((cell, index, all) => cell !== '' || index < all.length - 1);
}

function numeric(cell: string | undefined): number | undefined {
  if (cell === undefined || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/iu.test(cell))
    return undefined;
  return Number(cell);
}

/**
 * Reads x,y points from CSV/TSV/whitespace-separated text. Header rows, comments (`#`, `%`) and
 * rows without numbers are skipped; a single numeric column becomes y with x = 1, 2, 3, ...
 */
export function parseCsvPoints(text: string): Point[] {
  const points: Point[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('%')) continue;
    const row = cells(line);
    const first = numeric(row[0]);
    const second = numeric(row[1]);
    if (first === undefined) continue;
    points.push(
      second === undefined ? { x: points.length + 1, y: first } : { x: first, y: second },
    );
    if (points.length >= MAX_PLOT_POINTS) break;
  }
  return points;
}
