import { create } from 'zustand';

export interface UndoAction {
  id: string;
  description: string;
  undo: () => Promise<void>;
}

/**
 * The one undo: the most recent action, as long as its notice is up. A
 * new one replaces it — older ones can be reached via the trash.
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

  /** Also on vault switch: the action restores rows by ID in the currently open DB. */
  dismiss: () => set({ active: null }),
}));
