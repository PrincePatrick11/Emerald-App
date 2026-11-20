import { create } from 'zustand';
import { useUIStore } from './uiStore';

/** What "This entry" means when the menu opens: the entry or template on screen, if any. */
export type ExportTarget = { kind: 'entry' | 'template'; id: string } | null;

/**
 * The export menu, opened by the title bar's Export and mounted by
 * `LeftSidebarRail`. Each opening has a `seq` of its own, so the menu starts
 * afresh with the view on screen then.
 */
interface ExportMenuStore {
  request: { seq: number; target: ExportTarget } | null;
  open: () => void;
  close: () => void;
}

let seq = 0;

export const useExportMenuStore = create<ExportMenuStore>((set, get) => ({
  request: null,
  open: () => {
    // Already open — perhaps writing: a second click must not start it afresh beneath a running export.
    if (get().request) return;
    const view = useUIStore.getState().activeView;
    const target: ExportTarget = view.type === 'entry' && view.id ? { kind: 'entry', id: view.id }
      : view.type === 'templates' && view.id ? { kind: 'template', id: view.id }
      : null;
    set({ request: { seq: ++seq, target } });
  },
  close: () => set({ request: null }),
}));
