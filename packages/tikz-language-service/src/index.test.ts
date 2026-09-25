import { describe, expect, it } from 'vitest';
import { tikzLanguageService } from './index';

describe('TikZ language service', () => {
  it('offers option completion inside brackets', () => {
    const items = tikzLanguageService.completions('\\node[', 6);
    expect(items.some((item) => item.label === 'rounded corners')).toBe(true);
  });

  it('offers snippets outside option lists', () => {
    expect(tikzLanguageService.completions('\\', 1).some((item) => item.label === 'node')).toBe(
      true,
    );
  });
});
