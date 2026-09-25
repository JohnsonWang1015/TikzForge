import { describe, expect, it } from 'vitest';
import { createStarterProject, UpdateElementCommand } from './index';

describe('Graphic IR commands', () => {
  it('updates and reverses one element without storing a whole project snapshot', () => {
    const project = createStarterProject();
    const before = project.elements[0];
    if (!before || !('x' in before)) throw new Error('starter node missing');
    const after = { ...before, x: before.x + 80 };
    const command = new UpdateElementCommand('Move node', before, after);
    const moved = command.execute(project);
    expect(moved.elements.find((element) => element.id === before.id)).toMatchObject({
      x: before.x + 80,
    });
    expect(command.undo(moved).elements.find((element) => element.id === before.id)).toMatchObject({
      x: before.x,
    });
  });
});
