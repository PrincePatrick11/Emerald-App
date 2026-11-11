import { createContext, useContext } from 'react';
import type { SymbolDef } from './packs';

/**
 * The place's own symbols, beside the ones that come with the app: shown as
 * the pack `own` in the library, made from drawings (`save`), and removed
 * there (`remove`, by the id without `own.`). The canvas editor hands it to
 * its parts through `SymbolLibraryContext`.
 */
export interface CanvasSymbolLibrary {
  /** Ids `own.<id>`, each with its `name`. */
  own: SymbolDef[];
  save: (symbol: { name: string; d: string; solid: string; weight: number }) => Promise<void>;
  remove: (id: string) => void;
}

export const SymbolLibraryContext = createContext<CanvasSymbolLibrary | null>(null);

export const useSymbolLibrary = () => useContext(SymbolLibraryContext);

/** The pack of own symbols. */
export const OWN_PACK = 'own';
