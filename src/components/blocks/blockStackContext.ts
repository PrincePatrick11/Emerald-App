import { createContext } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Was ein Textblock vom umgebenden `BlockStack` braucht, ohne dass jede
 * Block-Komponente dafür eigene Props bekommt: seine Editor-Instanz anmelden
 * (der Stapel entscheidet darüber, wer Toolbar, Link-Bitten und Datei-Drops
 * bekommt) und seinen Platzhalter.
 */
export interface BlockStackContextValue {
  /** `blockId` — oder `<Block-ID>:<Element-ID>` für das Text-Element eines eigenen Blocks. */
  registerTextEditor: (blockId: string, editor: Editor | null) => void;
  placeholderFor: (blockId: string) => string;
}

export const BlockStackContext = createContext<BlockStackContextValue | null>(null);
