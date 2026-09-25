'use client';

import { Clock3, X } from 'lucide-react';
import { useProjectStore } from '@/stores/project-store';
import { useUiStore } from '@/stores/ui-store';

export function HistoryPanel() {
  const past = useProjectStore((state) => state.past);
  const restoreHistory = useProjectStore((state) => state.restoreHistory);
  const setModal = useUiStore((state) => state.setModal);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>
            <Clock3 size={15} /> History
          </h2>
          <button className="button button-icon button-ghost" onClick={() => setModal(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          {past.length === 0 && (
            <div className="empty-inspector">
              No edits yet. Canvas and source edits will appear here.
            </div>
          )}
          {past
            .slice()
            .reverse()
            .map((entry, reverseIndex) => {
              const index = past.length - 1 - reverseIndex;
              return (
                <button
                  key={`${entry.timestamp}-${index}`}
                  className="template-button"
                  onClick={() => {
                    restoreHistory(index);
                    setModal(null);
                  }}
                >
                  <span>
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>{' '}
                  · {entry.label}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
