'use client';

import { X } from 'lucide-react';
import { templates, createTemplateProject } from '@/lib/templates';
import { useProjectStore } from '@/stores/project-store';
import { useUiStore } from '@/stores/ui-store';

export function TemplateGallery() {
  const setModal = useUiStore((state) => state.setModal);
  const setProject = useProjectStore((state) => state.setProject);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>Template gallery</h2>
          <button className="button button-icon button-ghost" onClick={() => setModal(null)}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="template-cards">
            {templates.map((template) => (
              <button
                className="template-card"
                key={template.id}
                onClick={() => {
                  setProject(createTemplateProject(template.id), `Use ${template.name} template`);
                  setModal(null);
                }}
              >
                <strong>{template.name}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
