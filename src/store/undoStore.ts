import { create } from 'zustand';

export interface UndoAction {
  id: string;
  description: string;
  undo: () => Promise<void>;
}

interface UndoState {
  stack: UndoAction[];
  activeToast: UndoAction | null;
  toastVisible: boolean;
  push: (action: UndoAction) => void;
  executeUndo: () => Promise<void>;
  dismissToast: () => void;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  activeToast: null,
  toastVisible: false,

  push: (action) => {
    set((s) => ({
      stack: [action, ...s.stack].slice(0, 20),
      activeToast: action,
      toastVisible: true,
    }));
  },

  executeUndo: async () => {
    const { stack } = get();
    if (stack.length === 0) return;
    const [top, ...rest] = stack;
    set({ stack: rest, toastVisible: false, activeToast: null });
    await top.undo();
  },

  dismissToast: () => {
    set({ toastVisible: false });
  },
}));
