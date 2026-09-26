import { describe, expect, it } from 'vitest';
import {
  canvasToTikzPoint,
  createArrow,
  createEmptyProject,
  createNode,
  displayColor,
  edgeGeometry,
  parseTikzColor,
  projectFromJson,
  resolveRelativePositions,
  tikzColor,
  tikzToCanvasPoint,
  type DiagramElement,
} from './index';

const settings = { pixelsPerCm: 50, origin: { x: 100, y: 300 } };

describe('coordinates', () => {
  it('maps canvas pixels to TikZ centimetres with y pointing up', () => {
    expect(canvasToTikzPoint({ x: 200, y: 250 }, settings)).toEqual({ x: 2, y: 1 });
    expect(tikzToCanvasPoint({ x: 2, y: 1 }, settings)).toEqual({ x: 200, y: 250 });
  });

  it('fills in the origin for projects saved before it existed', () => {
    const project = projectFromJson({ settings: { pixelsPerCm: 100 }, elements: [] });
    expect(project.settings.pixelsPerCm).toBe(100);
    expect(project.settings.origin).toEqual({ x: 120, y: 360 });
  });
});

describe('edge geometry', () => {
  const a = createNode('rectangle', { id: 'a', x: 0, y: 0, width: 100, height: 40 });
  const b = createNode('circle', { id: 'b', x: 300, y: 0, width: 60, height: 60 });
  const lookup = (id: string): DiagramElement | undefined =>
    id === 'a' ? a : id === 'b' ? b : undefined;

  it('ends straight edges on node borders so arrow tips stay visible', () => {
    const geometry = edgeGeometry(createArrow('a', 'b'), lookup);
    expect(geometry?.start).toEqual({ x: 50, y: 0 });
    expect(geometry?.end).toEqual({ x: 270, y: 0 });
  });

  it('honours anchors, orthogonal routes and bends', () => {
    const anchored = edgeGeometry({ ...createArrow('a', 'b'), fromAnchor: 'north east' }, lookup);
    expect(anchored?.start).toEqual({ x: 50, y: -20 });
    const routed = edgeGeometry({ ...createArrow('a', 'b'), route: '|-' }, lookup);
    expect(routed?.d).toContain('L 0 0');
    const bent = edgeGeometry({ ...createArrow('a', 'b'), bend: 30 }, lookup);
    expect(bent?.d).toContain(' C ');
    expect(bent?.label.y).toBeLessThan(0);
  });
});

describe('relative positions', () => {
  it('places nodes border to border and follows moved targets', () => {
    const project = createEmptyProject();
    const target = createNode('rectangle', { id: 't', x: 0, y: 0, width: 100, height: 40 });
    const node = createNode('rectangle', {
      id: 'n',
      width: 60,
      height: 40,
      position: { mode: 'relative', relation: 'right', target: 't', distance: 1 },
    });
    project.elements = [target, node];
    const resolved = resolveRelativePositions(project).project;
    expect(resolved.elements[1]).toMatchObject({ x: 130, y: 0 });
    project.elements = [{ ...target, y: 80 }, node];
    expect(resolveRelativePositions(project).project.elements[1]).toMatchObject({ y: 80 });
  });

  it('reports relative nodes whose target is missing', () => {
    const project = createEmptyProject();
    project.elements = [
      createNode('rectangle', {
        id: 'n',
        position: { mode: 'relative', relation: 'below', target: 'gone', distance: 1 },
      }),
    ];
    expect(resolveRelativePositions(project).missingTargets).toEqual(['n']);
  });
});

describe('colors', () => {
  it('evaluates xcolor mix expressions', () => {
    expect(parseTikzColor('blue!20')).toEqual({ r: 204, g: 204, b: 255 });
    expect(parseTikzColor('red!50!black')).toEqual({ r: 127.5, g: 0, b: 0 });
    expect(parseTikzColor('{rgb,255:red,1;green,2;blue,3}')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseTikzColor('mycolor')).toBeUndefined();
  });

  it('shows print colors inverted onto the dark canvas', () => {
    expect(displayColor('white', 'fill')).toBe('#0b1020');
    expect(displayColor('black', 'stroke')).toBe('#e6edf7');
    expect(displayColor('#123456', 'fill')).toBe('#123456');
    expect(displayColor('none', 'fill')).toBe('none');
  });

  it('exports canvas colors as printable TikZ colors', () => {
    expect(tikzColor('#163250', 'fill')).toBe('blue!15');
    expect(tikzColor('#6f83a7', 'stroke')).toBe('black');
    expect(tikzColor('#123456', 'fill')).toBe('{rgb,255:red,18;green,52;blue,86}');
    expect(tikzColor('red!10', 'fill')).toBe('red!10');
    expect(tikzColor('transparent', 'fill')).toBe('none');
  });
});
