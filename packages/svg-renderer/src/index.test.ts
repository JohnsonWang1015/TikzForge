import { describe, expect, it } from 'vitest';
import { createStarterProject } from '@tikzforge/graphic-ir';
import { renderProjectToSvg, sanitizeSvg } from './index';

describe('SVG renderer', () => {
  it('renders starter IR as an SVG document', () => {
    const svg = renderProjectToSvg(createStarterProject());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Input');
    expect(svg).toContain('marker-end');
  });

  it('removes executable SVG content', () => {
    expect(sanitizeSvg('<svg><script>alert(1)</script><rect onclick="bad()" /></svg>')).toBe(
      '<svg><rect /></svg>',
    );
  });
});
