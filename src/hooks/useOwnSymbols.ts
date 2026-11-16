import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSymbolStore } from '../store/symbolStore';
import { removeSymbolWithUndo } from '../store/symbolActions';
import { userSymbolId } from '../lib/userSymbols';
import type { CanvasSymbolLibrary } from '../components/editors/canvas';

/** The vault's own symbols as the canvas editor's library takes them; removing one offers undo. */
export function useOwnSymbols(): CanvasSymbolLibrary {
  const { t } = useTranslation();
  const symbols = useSymbolStore((s) => s.symbols);
  return useMemo(() => ({
    own: symbols.map((s) => ({ id: userSymbolId(s.id), name: s.name, d: s.d, ...(s.solid ? { solid: s.solid } : {}), weight: s.weight })),
    save: async (symbol) => { await useSymbolStore.getState().addSymbol(symbol); },
    remove: (id) => removeSymbolWithUndo(id, t),
  }), [symbols, t]);
}
