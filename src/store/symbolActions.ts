import type { TFunction } from 'i18next';
import { generateId } from '../lib/helpers';
import { useSymbolStore } from './symbolStore';
import { useUndoStore } from './undoStore';

/**
 * Removes one of the vault's own symbols at once and offers undo — symbols
 * have no Trash. The one path for the canvas library and the Symbols view.
 */
export function removeSymbolWithUndo(id: string, t: TFunction): void {
  void useSymbolStore.getState().removeSymbol(id).then((removed) => {
    if (!removed) return;
    useUndoStore.getState().push({
      id: generateId(),
      description: t('symbols.removed'),
      undo: () => useSymbolStore.getState().restoreSymbol(removed),
    });
  }).catch((err: unknown) => console.error('[symbols] removing the symbol failed:', err));
}
