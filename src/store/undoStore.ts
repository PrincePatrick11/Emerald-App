import { create } from 'zustand';

export interface UndoAction {
  id: string;
  description: string;
  undo: () => Promise<void>;
}

/**
 * Das eine Rückgängig: die jüngste Aktion, solange ihr Hinweis steht. Eine
 * neue ersetzt sie — zurück an ältere kommt man über den Papierkorb.
 */
interface UndoState {
  active: UndoAction | null;
  push: (action: UndoAction) => void;
  executeUndo: () => Promise<void>;
  dismiss: () => void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  active: null,

  push: (action) => set({ active: action }),

  executeUndo: async () => {
    const { active } = get();
    if (!active) return;
    set({ active: null });
    await active.undo();
  },

  /** Auch beim Vault-Wechsel: die Aktion stellt Zeilen per ID in der gerade offenen DB wieder her. */
  dismiss: () => set({ active: null }),
}));
