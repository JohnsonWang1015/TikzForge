'use client';

import { useRef } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  FilePlus2,
  FolderOpen,
  Group,
  History,
  Play,
  Redo2,
  Save,
  Sparkles,
  Ungroup,
  Undo2,
} from 'lucide-react';
import { createEmptyProject } from '@tikzforge/graphic-ir';
import { parseTikz } from '@tikzforge/tikz-parser';
import { useProjectStore } from '@/stores/project-store';
import { useCompilerStore } from '@/stores/compiler-store';
import { useUiStore } from '@/stores/ui-store';

export function Toolbar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const project = useProjectStore((state) => state.project);
  const replaceProject = useProjectStore((state) => state.replaceProject);
  const save = useProjectStore((state) => state.save);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const past = useProjectStore((state) => state.past);
  const future = useProjectStore((state) => state.future);
  const groupSelected = useProjectStore((state) => state.groupSelected);
  const ungroupSelected = useProjectStore((state) => state.ungroupSelected);
  const compile = useCompilerStore((state) => state.compile);
  const status = useCompilerStore((state) => state.status);
  const setModal = useUiStore((state) => state.setModal);

  async function openProject(file: File): Promise<void> {
    const content = await file.text();
    if (file.name.endsWith('.json') || file.name.endsWith('.tikzproject')) {
      try {
        const parsed = JSON.parse(content) as unknown;
        const { projectFromJson } = await import('@tikzforge/graphic-ir');
        replaceProject(projectFromJson(parsed), 'Open project');
      } catch {
        window.alert('This project JSON is invalid.');
      }
      return;
    }
    const parsed = parseTikz(content);
    if (parsed.valid)
      replaceProject(parsed.project, 'Import TikZ', {
        source: content,
        sourceMap: parsed.sourceMap,
      });
    else window.alert(parsed.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">Tz</div>
        <div>
          <div className="brand-title">TikzForge</div>
          <div className="brand-subtitle">Scientific Diagram IDE</div>
        </div>
      </div>
      <div className="toolbar-group">
        <button
          className="button button-ghost"
          onClick={() => replaceProject(createEmptyProject('Untitled diagram'), 'New project')}
          data-testid="new-project"
        >
          <FilePlus2 size={14} /> New
        </button>
        <button className="button button-ghost" onClick={() => inputRef.current?.click()}>
          <FolderOpen size={14} /> Open
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.tikzproject,.tex,.tikz"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openProject(file);
            event.target.value = '';
          }}
        />
        <button className="button button-ghost" onClick={() => save()} data-testid="save-project">
          <Save size={14} /> Save
        </button>
        <div className="divider" />
        <button
          className="button button-icon button-ghost"
          disabled={!past.length}
          onClick={() => undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          className="button button-icon button-ghost"
          disabled={!future.length}
          onClick={() => redo()}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={15} />
        </button>
        <button className="button button-ghost" onClick={() => setModal('history')}>
          <History size={14} /> History
        </button>
        <button
          className="button button-icon button-ghost"
          onClick={() => groupSelected()}
          title="Group selection"
        >
          <Group size={14} />
        </button>
        <button
          className="button button-icon button-ghost"
          onClick={() => ungroupSelected()}
          title="Ungroup selection"
        >
          <Ungroup size={14} />
        </button>
        <button className="button button-ghost" onClick={() => setModal('ai')}>
          <Sparkles size={14} /> Generate
        </button>
        <button className="button button-ghost" onClick={() => setModal('templates')}>
          Templates
        </button>
      </div>
      <div className="toolbar-group">
        <span className="brand-subtitle">{project.metadata.title}</span>
        <button
          className="button button-primary"
          onClick={() => {
            void compile();
            setModal('export');
          }}
          data-testid="compile-button"
        >
          <Play size={14} /> {status === 'compiling' ? 'Compiling…' : 'Compile'}
        </button>
        <button className="button button-ghost" onClick={() => setModal('export')}>
          <Download size={14} /> Export <ChevronDown size={13} />
        </button>
        {status === 'success' && (
          <Check size={15} color="var(--accent)" aria-label="Compile succeeded" />
        )}
      </div>
    </header>
  );
}
