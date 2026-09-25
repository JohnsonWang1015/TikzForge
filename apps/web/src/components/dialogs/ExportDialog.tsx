'use client';

import { Download, X } from 'lucide-react';
import { exportProject, type ExportFormat } from '@/lib/export';
import { useProjectStore } from '@/stores/project-store';
import { useUiStore } from '@/stores/ui-store';
import { useCompilerStore } from '@/stores/compiler-store';
import { sanitizeSvg } from '@tikzforge/svg-renderer';
import { TemplateGallery } from './TemplateGallery';
import { AiGenerator } from './AiGenerator';
import { HistoryPanel } from '../history/HistoryPanel';

const formats: Array<{ id: ExportFormat; label: string; description: string }> = [
  { id: 'tikz', label: 'TikZ', description: 'Editable TikZ picture' },
  { id: 'latex', label: 'LaTeX', description: 'Standalone compilable document' },
  { id: 'svg', label: 'SVG', description: 'Fast vector preview' },
  { id: 'pdf', label: 'PDF', description: 'Local vector PDF export' },
  { id: 'png', label: 'PNG', description: 'Rasterized canvas export' },
  { id: 'json', label: 'Project JSON', description: 'Portable .tikzproject IR' },
];

export function ExportDialog() {
  const project = useProjectStore((state) => state.project);
  const setModal = useUiStore((state) => state.setModal);
  const compile = useCompilerStore((state) => state.compile);
  const status = useCompilerStore((state) => state.status);
  const svg = useCompilerStore((state) => state.svg);
  const errors = useCompilerStore((state) => state.errors);
  const log = useCompilerStore((state) => state.log);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>Export</h2>
          <button className="button button-icon button-ghost" onClick={() => setModal(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="template-cards">
            {formats.map((format) => (
              <button
                className="template-card"
                key={format.id}
                onClick={() => {
                  void exportProject(project, format.id);
                }}
              >
                <strong>
                  <Download size={13} /> {format.label}
                </strong>
                <span>{format.description}</span>
              </button>
            ))}
          </div>
          {status === 'compiling' && (
            <p className="brand-subtitle">Compiling supported TikZ subset…</p>
          )}
          {status === 'error' && (
            <div className="diagnostic-strip">
              {errors.map((error, index) => (
                <div key={`${error.message}-${index}`}>
                  Line {error.line}: {error.message}
                </div>
              ))}
            </div>
          )}
          {status === 'success' && svg && (
            <>
              <p className="status-ok" data-testid="preview-ready">
                ● Fast preview ready <span className="brand-subtitle">{log}</span>
              </p>
              <iframe
                title="TikzForge SVG preview"
                srcDoc={sanitizeSvg(svg)}
                style={{
                  width: '100%',
                  height: 260,
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: '#0b1020',
                }}
                sandbox="allow-same-origin"
              />
            </>
          )}
          <div className="modal-actions">
            <button
              className="button button-primary"
              onClick={() => {
                void compile();
              }}
            >
              <Download size={14} /> Refresh preview
            </button>
            <button className="button button-ghost" onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModalLayer() {
  const modal = useUiStore((state) => state.modal);
  if (modal === 'templates') return <TemplateGallery />;
  if (modal === 'ai') return <AiGenerator />;
  if (modal === 'history') return <HistoryPanel />;
  if (modal === 'export') return <ExportDialog />;
  return null;
}
