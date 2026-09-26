import { describe, expect, it } from 'vitest';
import type { GroupElement, NodeElement } from '@tikzforge/graphic-ir';
import { parseTikz } from './index';
import { reconcileParsedProject } from './reconcile';

const before = String.raw`\begin{tikzpicture}
  \node[draw] (a) at (0,0) {A};
  \node[draw] at (3,0) {unnamed};
  \node[draw] (b) at (0,-2) {B};
  \draw[->] (a) -- (b);
\end{tikzpicture}`;

/**
 * Parses `source` as the current state, then gives it canvas-side details a parse cannot know
 * (a canvas edge id, a lock, a group, a title) and reconciles the edited text against it.
 */
function edit(source: string, from: string, to: string) {
  const current = parseTikz(source);
  const canvasId = (id: string) => (id === 'edge_04' ? 'edge_canvas' : id);
  const group: GroupElement = {
    id: 'group_01',
    type: 'group',
    name: 'Group',
    children: ['a', 'b', 'gone'],
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    layer: 'nodes',
    visible: true,
    locked: false,
    rotation: 0,
  };
  const project = {
    ...current.project,
    metadata: { ...current.project.metadata, title: 'My diagram' },
    elements: [
      ...current.project.elements.map((element) => ({
        ...element,
        id: canvasId(element.id),
        locked: element.id === 'a' ? true : element.locked,
      })),
      group,
    ],
  };
  const currentMap = Object.fromEntries(
    Object.entries(current.sourceMap).map(([id, range]) => [canvasId(id), range]),
  );
  const next = source.replace(from, to);
  return reconcileParsedProject({
    current: project,
    currentMap,
    previousSource: source,
    parsed: parseTikz(next),
    source: next,
  });
}

describe('reconcileParsedProject', () => {
  it('keeps ids of unnamed statements and IR-only state across a text edit', () => {
    const { project, sourceMap } = edit(before, '{B}', '{Bee}');
    expect(project.metadata.title).toBe('My diagram');
    const ids = project.elements.map((element) => element.id);
    expect(ids).toEqual(['a', 'node_02', 'b', 'edge_canvas', 'group_01']);
    expect(project.elements.find((element) => element.id === 'a')?.locked).toBe(true);
    const group = project.elements.find((element) => element.id === 'group_01') as GroupElement;
    expect(group.children).toEqual(['a', 'b']);
    expect(Object.keys(sourceMap).sort()).toEqual(['a', 'b', 'edge_canvas', 'node_02']);
  });

  it('follows statements that move because text was inserted above them', () => {
    const { project, sourceMap } = edit(
      before,
      '  \\node[draw] (a)',
      '  \\node (extra) at (5,5) {X};\n  \\node[draw] (a)',
    );
    expect(project.elements.map((element) => element.id)).toContain('edge_canvas');
    const arrow = project.elements.find((element) => element.id === 'edge_canvas');
    expect(arrow).toMatchObject({ from: 'a', to: 'b' });
    expect(sourceMap.edge_canvas).toBeDefined();
  });

  it('keeps an uploaded picture when the image statement is edited as text', () => {
    const source = String.raw`\begin{tikzpicture}
  \node[inner sep=0pt] at (0,0) {\includegraphics[width=2cm,height=1cm]{fig.png}};
\end{tikzpicture}`;
    const current = parseTikz(source);
    const image = current.project.elements[0] as NodeElement;
    expect(image).toMatchObject({ type: 'image', source: 'fig.png', sizeMode: 'fixed' });
    const href =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
    const next = source.replace('width=2cm', 'width=4cm');
    const { project } = reconcileParsedProject({
      current: { ...current.project, elements: [{ ...image, href }] },
      currentMap: current.sourceMap,
      previousSource: source,
      parsed: parseTikz(next),
      source: next,
    });
    expect(project.elements[0]).toMatchObject({ type: 'image', href, width: 200 });
  });

  it('keeps \\includegraphics text it cannot size as ordinary node text', () => {
    for (const content of [
      String.raw`\includegraphics[width=2cm]{fig.png}`,
      String.raw`\includegraphics[scale=2,width=1cm,height=1cm]{fig.png}`,
      String.raw`\includegraphics[width=1cm,height=1cm]{../fig.png}`,
    ]) {
      const parsed = parseTikz(
        `\\begin{tikzpicture}\\node at (0,0) {${content}};\\end{tikzpicture}`,
      );
      expect(parsed.project.elements[0]?.type, content).toBe('rectangle');
    }
  });
});
