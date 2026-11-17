import { create } from 'zustand';


interface PendingImportChoice {
  title: string;
  resolve: (dashboardId: string | null) => void;
}

interface ImportState {
  pending: PendingImportChoice | null;
  /** Opens the destination picker and resolves with the chosen dashboard's ID, or null on cancel. */
  askDestination: (title: string) => Promise<string | null>;
  choose: (dashboardId: string) => void;
  cancel: () => void;
}

export const useImportStore = create<ImportState>((set, get) => ({
  pending: null,

  askDestination: (title) => {
    return new Promise((resolve) => {
      set({ pending: { title, resolve } });
    });
  },

  choose: (dashboardId) => {
    get().pending?.resolve(dashboardId);
    set({ pending: null });
  },

  cancel: () => {
    get().pending?.resolve(null);
    set({ pending: null });
  },
}));
