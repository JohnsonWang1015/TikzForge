'use client';

import { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useProjectStore } from '@/stores/project-store';
import { useUiStore } from '@/stores/ui-store';

export function AiGenerator() {
  const [prompt, setPrompt] = useState('Input → Conv7x7 → Residual Stage 1 → Classifier');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const replaceProject = useProjectStore((state) => state.replaceProject);
  const setModal = useUiStore((state) => state.setModal);
  async function generate(): Promise<void> {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const body = (await response.json()) as {
        project?: Parameters<typeof replaceProject>[0];
        explanation?: string;
        error?: string;
      };
      if (!response.ok || !body.project) throw new Error(body.error ?? 'Generation failed.');
      replaceProject(body.project, 'AI generate diagram');
      setMessage(body.explanation ?? 'Generated editable Graphic IR.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>
            <Sparkles size={16} color="var(--accent)" /> Generate Diagram
          </h2>
          <button className="button button-icon button-ghost" onClick={() => setModal(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <p className="brand-subtitle">
            Describe a flow, architecture or scientific pipeline. The provider returns validated
            Graphic IR so the result remains visually editable.
          </p>
          <textarea
            className="ai-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Draw a ResNet-18 architecture…"
          />
          {message && <p className="brand-subtitle">{message}</p>}
          <div className="modal-actions">
            <button className="button button-ghost" onClick={() => setModal(null)}>
              Close
            </button>
            <button
              className="button button-primary"
              disabled={busy || !prompt.trim()}
              onClick={() => void generate()}
            >
              {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}{' '}
              {busy ? 'Generating…' : 'Generate IR'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
