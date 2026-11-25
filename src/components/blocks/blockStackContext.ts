import { createContext } from 'react';

/** Carries out one of a block's actions (`BlockTypeDef.actions`). */
export type BlockActionHandler = () => void;

/**
 * What a block needs from the surrounding `BlockStack`, without every
 * block component getting its own props for it: a text block's placeholder,
 * and where a view registers how it carries out its type's actions
 * (`useBlockAction`). A text editor reports itself to the stack's text
 * editor host (`TextEditor`'s `hostKey`).
 */
export interface BlockStackContextValue {
  placeholderFor: (blockId: string) => string;
  /** Registers the handler of an action of the block; returns the unregister. */
  registerAction: (blockId: string, actionId: string, handler: BlockActionHandler) => () => void;
}

export const BlockStackContext = createContext<BlockStackContextValue | null>(null);
