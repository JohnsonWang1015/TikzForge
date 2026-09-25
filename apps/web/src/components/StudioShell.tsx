'use client';

import { useEffect } from 'react';
import { ComponentSidebar } from '@/components/sidebar/ComponentSidebar';
import { DiagramCanvas } from '@/components/canvas/DiagramCanvas';
import { TikzEditor } from '@/components/editor/TikzEditor';
import { PropertyInspector } from '@/components/inspector/PropertyInspector';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { ModalLayer } from '@/components/dialogs/ExportDialog';
import { useProjectStore } from '@/stores/project-store';
import { useCompilerStore } from '@/stores/compiler-store';

export function StudioShell() {
  const project = useProjectStore((state) => state.project);
  const selectedIds = useProjectStore((state) => state.selectedIds);
  const selectAll = useProjectStore((state) => state.selectAll);
  const clearSelection = useProjectStore((state) => state.clearSelection);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const deleteSelected = useProjectStore((state) => state.deleteSelected);
  const duplicateSelected = useProjectStore((state) => state.duplicateSelected);
  const copySelected = useProjectStore((state) => state.copySelected);
  const pasteClipboard = useProjectStore((state) => state.pasteClipboard);
  const moveSelected = useProjectStore((state) => state.moveSelected);
  const save = useProjectStore((state) => state.save);
  const load = useProjectStore((state) => state.load);
  const compileStatus = useCompilerStore((state) => state.status);
  const compileTime = useCompilerStore((state) => state.compileTime);
  const compileErrors = useCompilerStore((state) => state.errors);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const timer = setTimeout(() => save(), 500);
    return () => clearTimeout(timer);
  }, [project, save]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        Boolean(
          target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor'),
        );
      if (modifier && key === 's') {
        event.preventDefault();
        save();
        return;
      }
      if (isEditing) return;
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (modifier && key === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }
      if (modifier && key === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (modifier && key === 'c') {
        event.preventDefault();
        const payload = copySelected();
        void navigator.clipboard?.writeText(payload);
        return;
      }
      if (modifier && key === 'v') {
        event.preventDefault();
        const clipboard = navigator.clipboard;
        if (clipboard) {
          void clipboard.readText().then((payload) => {
            if (payload) pasteClipboard(payload);
          });
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedIds.length) {
          event.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (event.key === 'Escape') {
        clearSelection();
        return;
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        moveSelected(
          event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0,
          event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0,
        );
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clearSelection,
    copySelected,
    deleteSelected,
    duplicateSelected,
    moveSelected,
    pasteClipboard,
    redo,
    save,
    selectAll,
    selectedIds.length,
    undo,
  ]);

  const nodeCount = project.elements.filter(
    (element) => 'x' in element && element.type !== 'group' && element.type !== 'plot',
  ).length;
  const edgeCount = project.elements.filter((element) => 'from' in element).length;
  return (
    <main className="studio">
      <Toolbar />
      <div className="workspace">
        <ComponentSidebar />
        <DiagramCanvas />
        <aside className="inspector">
          <TikzEditor />
          <PropertyInspector />
        </aside>
      </div>
      <footer className="bottom-bar">
        <div className="status-items">
          <span className={compileStatus === 'error' ? 'status-error' : 'status-ok'}>
            {compileStatus === 'compiling'
              ? '● Compiling'
              : compileStatus === 'error'
                ? '● Errors'
                : '● TikZ'}
          </span>
          <span>
            {nodeCount} nodes · {edgeCount} edges
          </span>
          <span>{selectedIds.length ? `${selectedIds.length} selected` : 'No selection'}</span>
        </div>
        <div className="status-items">
          <span>{compileTime ? `Compile ${compileTime}ms` : 'Fast preview'}</span>
          {compileErrors.length > 0 && (
            <span className="status-error">{compileErrors.length} diagnostics</span>
          )}
          <span>Graphic IR v1.0</span>
        </div>
      </footer>
      <ModalLayer />
    </main>
  );
}
