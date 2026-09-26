'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { sanitizeSvg } from '@tikzforge/svg-renderer';
import { useCompilerStore } from '@/stores/compiler-store';

/** Centers the SVG in the frame and scales it down to fit, whatever its intrinsic size. */
function previewDocument(svg: string): string {
  return `<!doctype html><html><head><style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%;width:auto;height:auto}</style></head><body>${svg}</body></html>`;
}

/** Compile status, errors and the rendered preview, for whichever renderer produced it. */
export function CompilePreview({ height = 360 }: { height?: number }) {
  const status = useCompilerStore((state) => state.status);
  const svg = useCompilerStore((state) => state.svg);
  const log = useCompilerStore((state) => state.log);
  const errors = useCompilerStore((state) => state.errors);
  const renderer = useCompilerStore((state) => state.renderer);
  const latex = renderer === 'tectonic';
  return (
    <>
      {status === 'compiling' && <p className="brand-subtitle">Compiling…</p>}
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
      {status === 'success' && svg && (
        <>
          <div className="status-items" data-testid="preview-ready">
            <span className="status-ok">
              <CheckCircle2 size={14} />{' '}
              {latex ? 'LaTeX (Tectonic) preview ready' : 'Fast preview ready'}
            </span>
            <span className="brand-subtitle">{log}</span>
          </div>
          <iframe
            title="TikzForge SVG preview"
            srcDoc={previewDocument(sanitizeSvg(svg))}
            style={{
              width: '100%',
              height,
              border: '1px solid var(--border)',
              borderRadius: 8,
              // Tectonic output is dark ink on a transparent page.
              background: latex ? '#ffffff' : '#0b1020',
              marginTop: 10,
            }}
            sandbox="allow-same-origin"
          />
        </>
      )}
    </>
  );
}
