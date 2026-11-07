import { createContext } from 'react';

/**
 * What a text block needs from the surrounding `BlockStack`, without every
 * block component getting its own props for it: its placeholder. Its editor
 * reports itself to the stack's text editor host (`TextEditor`'s `hostKey`).
 */
export interface BlockStackContextValue {
  placeholderFor: (blockId: string) => string;
}

export const BlockStackContext = createContext<BlockStackContextValue | null>(null);
