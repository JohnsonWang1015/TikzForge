'use client';

import { create } from 'zustand';
import type { Diagnostic } from '@tikzforge/graphic-ir';
import { useProjectStore } from './project-store';

interface CompilerState {
  status: 'idle' | 'compiling' | 'success' | 'error';
  svg?: string;
  log: string;
  compileTime?: number;
  errors: Diagnostic[];
  compile: () => Promise<void>;
  clear: () => void;
}

export const useCompilerStore = create<CompilerState>((set) => ({
  status: 'idle',
  log: '',
  errors: [],
  compile: async () => {
    set({ status: 'compiling', errors: [], log: '' });
    const source = useProjectStore.getState().source;
    try {
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const body = (await response.json()) as {
        success?: boolean;
        svg?: string;
        log?: string;
        compileTime?: number;
        errors?: Diagnostic[];
      };
      if (!response.ok || !body.success) {
        set({
          status: 'error',
          errors: body.errors ?? [
            { severity: 'error', message: 'Compiler request failed.', line: 1, column: 1 },
          ],
          log: body.log ?? '',
        });
        return;
      }
      set({
        status: 'success',
        svg: body.svg,
        compileTime: body.compileTime,
        log: body.log ?? '',
        errors: [],
      });
    } catch (error) {
      set({
        status: 'error',
        errors: [
          {
            severity: 'error',
            message: error instanceof Error ? error.message : 'Compiler request failed.',
            line: 1,
            column: 1,
          },
        ],
      });
    }
  },
  clear: () => set({ status: 'idle', svg: undefined, log: '', compileTime: undefined, errors: [] }),
}));
