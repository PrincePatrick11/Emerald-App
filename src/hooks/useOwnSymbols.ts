import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSymbolStore } from '../store/symbolStore';
import { useUndoStore } from '../store/undoStore';
import { userSymbolId } from '../lib/userSymbols';
import { generateId } from '../lib/helpers';
import type { CanvasSymbolLibrary } from '../components/editors/canvas';

/** The vault's own symbols as the canvas editor's library takes them; removing one offers undo. */
export function useOwnSymbols(): CanvasSymbolLibrary {
  const { t } = useTranslation();
  const symbols = useSymbolStore((s) => s.symbols);
  const pushUndo = useUndoStore((s) => s.push);
  return useMemo(() => ({
    own: symbols.map((s) => ({ id: userSymbolId(s.id), name: s.name, d: s.d, ...(s.solid ? { solid: s.solid } : {}), weight: s.weight })),
    save: async (symbol) => { await useSymbolStore.getState().addSymbol(symbol); },
    remove: (id) => {
      void useSymbolStore.getState().removeSymbol(id).then((removed) => {
        if (removed) pushUndo({ id: generateId(), description: t('symbols.removed'), undo: () => useSymbolStore.getState().restoreSymbol(removed) });
      }).catch(console.error);
    },
  }), [symbols, pushUndo, t]);
}
