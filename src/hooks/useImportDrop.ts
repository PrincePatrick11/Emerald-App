import { useFileDrop } from './useFileDrop';
import { hasOpenModal } from '../components/ui/Modal';
import { isImportPath } from '../lib/importPaths';
import { useImportWindowStore } from '../store/importWindowStore';
import { useVaultPickerStore } from '../store/vaultPickerStore';

/**
 * Files dragged into the app window that the import window takes (by their
 * ending, as its open dialog) open it with them. Over the open import window
 * every drop is its own: it says itself when a file is not one it takes.
 * Under another dialog, and over the start page, nothing happens. Pictures
 * are the text editors', a canvas's and "Images"' — they leave import files alone.
 */
export function useImportDrop(enabled: boolean): void {
  useFileDrop(enabled, (paths) => {
    // macOS passes on drags of things that are no files (text, a link) without paths.
    if (paths.length === 0) return;
    const store = useImportWindowStore.getState();
    if (store.open) {
      store.drop(paths);
      return;
    }
    if (hasOpenModal() || useVaultPickerStore.getState().open) return;
    const files = paths.filter(isImportPath);
    if (files.length > 0) store.drop(files);
  });
}
