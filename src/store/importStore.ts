import { create } from 'zustand';

export type ImportDestinationType = 'journal' | 'wiki' | 'operations';

interface PendingImportChoice {
  title: string;
  resolve: (type: ImportDestinationType | null) => void;
}

interface ImportState {
  pending: PendingImportChoice | null;
  /** Opens the destination picker and resolves once the user picks a type or cancels (null). */
  askDestination: (title: string) => Promise<ImportDestinationType | null>;
  choose: (type: ImportDestinationType) => void;
  cancel: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  pending: null,

  askDestination: (title) => {
    return new Promise((resolve) => {
      set({ pending: { title, resolve } });
    });
  },

  choose: (type) => {
    get().pending?.resolve(type);
    set({ pending: null });
  },

  cancel: () => {
    get().pending?.resolve(null);
    set({ pending: null });
  },
}));
