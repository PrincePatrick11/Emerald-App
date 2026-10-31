import { createContext } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * What a text block needs from the surrounding `BlockStack`, without every
 * block component getting its own props for it: registering its editor instance
 * (the stack decides who gets toolbar, link requests and file drops)
 * and its placeholder.
 */
export interface BlockStackContextValue {
  /** `blockId`, or `<block ID>:<element ID>` for the text element of a custom block. */
  registerTextEditor: (blockId: string, editor: Editor | null) => void;
  placeholderFor: (blockId: string) => string;
}

export const BlockStackContext = createContext<BlockStackContextValue | null>(null);
