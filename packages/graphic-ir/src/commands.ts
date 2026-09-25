import {
  cloneElement,
  isEdgeElement,
  patchElement,
  removeElements,
  type DiagramElement,
  type Project,
} from './index';

/** Command Pattern contract for reversible diagram mutations. Commands store focused diffs, not full project snapshots. */
export interface DiagramCommand {
  readonly label: string;
  execute(project: Project): Project;
  undo(project: Project): Project;
}

export class UpdateElementCommand implements DiagramCommand {
  readonly label: string;
  private readonly before: DiagramElement;
  private readonly after: DiagramElement;

  constructor(label: string, before: DiagramElement, after: DiagramElement) {
    this.label = label;
    this.before = cloneElement(before, before.id);
    this.after = cloneElement(after, after.id);
  }

  execute(project: Project): Project {
    return patchElement(project, this.after.id, this.after);
  }

  undo(project: Project): Project {
    return patchElement(project, this.before.id, this.before);
  }
}

export class AddElementCommand implements DiagramCommand {
  readonly label: string;
  private readonly element: DiagramElement;

  constructor(label: string, element: DiagramElement) {
    this.label = label;
    this.element = cloneElement(element, element.id);
  }

  execute(project: Project): Project {
    return project.elements.some((element) => element.id === this.element.id)
      ? project
      : {
          ...project,
          elements: [...project.elements, cloneElement(this.element, this.element.id)],
        };
  }

  undo(project: Project): Project {
    return removeElements(project, new Set([this.element.id]));
  }
}

export class DeleteElementsCommand implements DiagramCommand {
  readonly label: string;
  private readonly elements: DiagramElement[];
  private readonly indexes: number[];

  constructor(label: string, project: Project, ids: ReadonlySet<string>) {
    this.label = label;
    this.elements = project.elements
      .filter(
        (element) =>
          ids.has(element.id) ||
          (isEdgeElement(element) && (ids.has(element.from) || ids.has(element.to))),
      )
      .map((element) => cloneElement(element, element.id));
    this.indexes = project.elements
      .map((element, index) =>
        ids.has(element.id) ||
        (isEdgeElement(element) && (ids.has(element.from) || ids.has(element.to)))
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
  }

  execute(project: Project): Project {
    return removeElements(project, new Set(this.elements.map((element) => element.id)));
  }

  undo(project: Project): Project {
    const elements = [...project.elements];
    this.elements.forEach((element, index) =>
      elements.splice(this.indexes[index] ?? elements.length, 0, cloneElement(element, element.id)),
    );
    return { ...project, elements };
  }
}

export class BatchCommand implements DiagramCommand {
  readonly label: string;
  private readonly commands: DiagramCommand[];

  constructor(label: string, commands: DiagramCommand[]) {
    this.label = label;
    this.commands = commands;
  }

  execute(project: Project): Project {
    return this.commands.reduce((current, command) => command.execute(current), project);
  }

  undo(project: Project): Project {
    return [...this.commands]
      .reverse()
      .reduce((current, command) => command.undo(current), project);
  }
}
