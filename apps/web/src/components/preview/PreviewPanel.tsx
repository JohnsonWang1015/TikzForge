'use client';

import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { sanitizeSvg } from '@tikzforge/svg-renderer';
import { useCompilerStore } from '@/stores/compiler-store';
import { useUiStore } from '@/stores/ui-store';

export function PreviewPanel() {
  const setModal = useUiStore((state) => state.setModal);
  const status = useCompilerStore((state) => state.status);
  const svg = useCompilerStore((state) => state.svg);
  const log = useCompilerStore((state) => state.log);
  const errors = useCompilerStore((state) => state.errors);
  const renderer = useCompilerStore((state) => state.renderer);
  const latex = renderer === 'tectonic';
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>Compile & export</h2>
          <button className="button button-icon button-ghost" onClick={() => setModal(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          {status === 'compiling' && <div className="empty-inspector">Compiling…</div>}
          {status === 'error' && (
            <div className="diagnostic-strip">
              <AlertTriangle size={14} />
              {errors.map((error, index) => (
                <div key={`${error.message}-${index}`}>
                  Line {error.line}: {error.message}
                </div>
              ))}
            </div>
          )}
          {status === 'success' && (
            <>
              <div className="status-items">
                <span className="status-ok">
                  <CheckCircle2 size={14} />{' '}
                  {latex ? 'LaTeX (Tectonic) preview ready' : 'Fast preview ready'}
                </span>
                <span>{log}</span>
              </div>
              {svg && (
                <iframe
                  title="TikzForge SVG preview"
                  srcDoc={sanitizeSvg(svg)}
                  style={{
                    width: '100%',
                    height: 360,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    // Tectonic output is dark ink on a transparent page.
                    background: latex ? '#ffffff' : '#0b1020',
                    marginTop: 14,
                  }}
                  sandbox="allow-same-origin"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
