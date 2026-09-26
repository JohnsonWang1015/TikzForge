import { describe, expect, it } from 'vitest';
import { MAX_PLOT_POINTS, parseCsvPoints } from './csv';

describe('parseCsvPoints', () => {
  it('reads comma, semicolon, tab and whitespace separated columns', () => {
    const expected = [
      { x: 1, y: 2 },
      { x: 3.5, y: -4 },
    ];
    expect(parseCsvPoints('1,2\n3.5,-4')).toEqual(expected);
    expect(parseCsvPoints('1;2\r\n3.5;-4\r\n')).toEqual(expected);
    expect(parseCsvPoints('1\t2\n3.5\t-4')).toEqual(expected);
    expect(parseCsvPoints('  1   2\n3.5 -4')).toEqual(expected);
  });

  it('skips headers, comments and blank lines and ignores extra columns', () => {
    expect(parseCsvPoints('# data\nx,y,z\n\n"0","1e2",9\n% note\n2,3,4')).toEqual([
      { x: 0, y: 100 },
      { x: 2, y: 3 },
    ]);
  });

  it('numbers a single column', () => {
    expect(parseCsvPoints('value\n5\n7')).toEqual([
      { x: 1, y: 5 },
      { x: 2, y: 7 },
    ]);
  });

  it('caps the number of points', () => {
    const text = Array.from({ length: MAX_PLOT_POINTS + 10 }, (_, index) => `${index},1`).join(
      '\n',
    );
    expect(parseCsvPoints(text)).toHaveLength(MAX_PLOT_POINTS);
  });
});
