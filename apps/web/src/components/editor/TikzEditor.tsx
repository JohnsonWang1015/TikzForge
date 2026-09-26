'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { tikzLanguageService } from '@tikzforge/tikz-language-service';
import { useProjectStore } from '@/stores/project-store';

const Monaco = dynamic(() => import('@monaco-editor/react').then((module) => module.default), {
  ssr: false,
  loading: () => <textarea className="editor-fallback" readOnly value="Loading TikZ editor…" />,
});

export function TikzEditor() {
  const source = useProjectStore((state) => state.source);
  const setSource = useProjectStore((state) => state.setSource);
  const diagnostics = useProjectStore((state) => state.diagnostics);
  const applySource = useProjectStore((state) => state.applySource);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userEditRef = useRef(false);
  const applyingStoreEditRef = useRef(false);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  function onMount(
    editor: MonacoEditor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ): void {
    editorRef.current = editor;
    monacoRef.current = monaco;
    const latest = useProjectStore.getState().source;
    if (editor.getValue() !== latest) {
      applyingStoreEditRef.current = true;
      editor.setValue(latest);
      applyingStoreEditRef.current = false;
    }
    if (!monaco.languages.getLanguages().some((language) => language.id === 'tikzforge-tikz')) {
      monaco.languages.register({ id: 'tikzforge-tikz', extensions: ['.tikz', '.tex'] });
      monaco.languages.setMonarchTokensProvider('tikzforge-tikz', {
        tokenizer: {
          root: [
            [/\\(?:begin|end|node|draw|path|coordinate|filldraw|fill|clip|addplot)\b/, 'keyword'],
            [/%.*$/, 'comment'],
            [/[{}()[\]]/, 'delimiter.bracket'],
            [/-?(?:\d+\.\d*|\.\d+|\d+)/, 'number'],
            [/\b(?:draw|fill|rounded corners|dashed|above|below|left|right)\b/, 'attribute.name'],
          ],
        },
      });
      monaco.languages.registerCompletionItemProvider('tikzforge-tikz', {
        triggerCharacters: ['[', '\\', ','],
        provideCompletionItems: (model, position) => {
          const offset = model.getOffsetAt(position);
          const items = tikzLanguageService.completions(model.getValue(), offset);
          return {
            suggestions: items.map((item) => ({
              label: item.label,
              kind:
                item.kind === 'snippet'
                  ? monaco.languages.CompletionItemKind.Snippet
                  : monaco.languages.CompletionItemKind.Keyword,
              detail: item.detail,
              insertText: item.insertText ?? item.label,
              insertTextRules:
                item.kind === 'snippet'
                  ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            })),
          };
        },
      });
    }
  }

  // Canvas edits patch the store's source; mirror them into Monaco as one minimal edit so the
  // cursor, selection and scroll position outside the changed statement stay where they were.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    const current = model.getValue();
    if (current === source) return;
    let start = 0;
    const shortest = Math.min(current.length, source.length);
    while (start < shortest && current[start] === source[start]) start += 1;
    let end = 0;
    while (
      end < shortest - start &&
      current[current.length - 1 - end] === source[source.length - 1 - end]
    )
      end += 1;
    const from = model.getPositionAt(start);
    const to = model.getPositionAt(current.length - end);
    applyingStoreEditRef.current = true;
    editor.executeEdits('tikzforge-canvas', [
      {
        range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
        text: source.slice(start, source.length - end),
      },
    ]);
    editor.pushUndoStop();
    applyingStoreEditRef.current = false;
  }, [source]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = diagnostics.map((item) => ({
      severity:
        item.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : item.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
      message: item.message,
      startLineNumber: item.line,
      startColumn: item.column,
      endLineNumber: item.endLine ?? item.line,
      endColumn: item.endColumn ?? item.column + 1,
    }));
    monaco.editor.setModelMarkers(model, 'tikzforge', markers);
  }, [diagnostics]);

  function handleChange(value: string | undefined): void {
    if (applyingStoreEditRef.current) return;
    const next = value ?? '';
    userEditRef.current = true;
    setSource(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (userEditRef.current) {
        userEditRef.current = false;
        applySource();
      }
    }, 350);
  }

  // Info diagnostics (raw TikZ kept as source) stay as editor markers, not in the problem strip.
  const problems = diagnostics.filter((item) => item.severity !== 'info');

  return (
    <section className="editor-panel">
      <div className="editor-header">
        <div className="editor-title">
          <span className="status-ok">●</span> TikZ Source <span>live subset parser</span>
        </div>
        <span className="brand-subtitle">Monaco</span>
      </div>
      <div className="editor-body">
        <Monaco
          height="100%"
          language="tikzforge-tikz"
          theme="vs-dark"
          defaultValue={source}
          onChange={handleChange}
          onMount={onMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineHeight: 19,
            padding: { top: 10, bottom: 10 },
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            bracketPairColorization: { enabled: true },
            suggest: { showMethods: true },
          }}
        />
      </div>
      {problems.length > 0 && (
        <div className="diagnostic-strip">
          {problems.slice(0, 4).map((item, index) => (
            <div key={`${item.code ?? item.message}-${index}`}>
              Line {item.line}, Col {item.column}: {item.message}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
