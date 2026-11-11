import { useTranslation } from 'react-i18next';
import { generateId } from '../lib/helpers';
import { useUIStore } from '../store/uiStore';
import { useUndoStore } from '../store/undoStore';

interface Options {
  /** The library view the page belongs to. */
  viewType: 'blocks' | 'templates' | 'lexicon';
  remove: (id: string) => Promise<unknown>;
  restore: (id: string) => Promise<unknown>;
  /** Only once the delete worked: nothing is lost if it fails. */
  clearDraft?: (id: string) => void;
  undoKey: string;
  logTag: string;
}

/**
 * Moving an item of a library view to the trash, without a question and with
 * undo. Back to the list only if its page is still open: whoever discarded via
 * the question on leaving has meanwhile gone elsewhere and stays there.
 */
export function useLibraryItemRemove({ viewType, remove, restore, clearDraft, undoKey, logTag }: Options) {
  const { t } = useTranslation();
  return async (id: string): Promise<void> => {
    try {
      await remove(id);
    } catch (err) {
      console.error(`[${logTag}] deleting failed:`, err);
      return;
    }
    clearDraft?.(id);
    const { activeView, setActiveView } = useUIStore.getState();
    if (activeView.id === id) setActiveView({ type: viewType });
    useUndoStore.getState().push({ id: generateId(), description: t(undoKey), undo: async () => { await restore(id); } });
  };
}
