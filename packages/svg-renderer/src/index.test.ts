import { describe, expect, it } from 'vitest';
import {
  createArrow,
  createEmptyProject,
  createNode,
  createStarterProject,
} from '@tikzforge/graphic-ir';
import { renderProjectToSvg, sanitizeSvg } from './index';

describe('SVG renderer', () => {
  it('renders starter IR as an SVG document', () => {
    const svg = renderProjectToSvg(createStarterProject());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Input');
    expect(svg).toContain('marker-end');
  });

  it('crops to the drawing when fitting to content', () => {
    const project = createEmptyProject();
    project.elements = [
      createNode('rectangle', { id: 'a', x: 500, y: 400, width: 100, height: 40 }),
      createNode('rectangle', { id: 'b', x: 800, y: 400, width: 100, height: 40 }),
      createArrow('a', 'b'),
    ];
    const svg = renderProjectToSvg(project, { fitToContent: true });
    expect(svg).toContain('viewBox="426 356 448 88"');
    expect(svg).toContain('d="M 550 400 L 750 400"');
  });

  it('draws raw TikZ previews', () => {
    const project = createEmptyProject();
    project.elements = [
      {
        id: 'raw_01',
        type: 'raw-tikz',
        layer: 'overlays',
        visible: true,
        locked: true,
        rotation: 0,
        source: '\\draw (0,0) -- (1,0);',
        reason: 'test',
        editable: false,
        preview: [
          {
            id: 'p',
            type: 'preview-path',
            d: 'M 0 0 L 50 0',
            stroke: 'black',
            fill: 'none',
            lineWidth: 1,
            dashed: false,
            arrowStart: false,
            arrowEnd: true,
          },
        ],
      },
    ];
    expect(renderProjectToSvg(project)).toContain('d="M 0 0 L 50 0"');
  });

  it('removes executable SVG content', () => {
    expect(sanitizeSvg('<svg><script>alert(1)</script><rect onclick="bad()" /></svg>')).toBe(
      '<svg><rect /></svg>',
    );
  });
});
