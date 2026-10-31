import { create } from 'zustand';
import type { BlockAttrName, BlockInstance } from '../lib/blocks/types';

/**
 * The bridge between the `BlockStack` in the main area and the block management
 * in the right sidebar. The two are sibling trees and do not know
 * each other — the same reason `uiStore.editActions` exists.
 *
 * The stack publishes its block structure here (on every
 * structural change, not per keystroke) and the handles the sidebar uses to
 * operate it. Every change thus runs through the stack and ends up in
 * the content: Cancel reverts it along with the text.
 *
 * In memory only, never persisted — the truth is the entry's content.
 */
export interface BlockStackApi {
  /** Insert a new block from a preset (`BLOCK_PRESETS`) at `index`. */
  insert: (index: number, presetId: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  reorder: (ids: string[]) => void;
  /** Set an instance attribute from `BLOCK_ATTR`; `null` removes it. */
  setAttr: (id: string, name: BlockAttrName, value: string | null) => void;
  /** Replace the whole block — sidebar sections whose type also writes fallback HTML. */
  update: (id: string, next: BlockInstance) => void;
  /** Scroll to the block and highlight it briefly. */
  reveal: (id: string) => void;
  /** The blocks with the live HTML of the text blocks — the session's `blocks` lags behind while typing. */
  liveBlocks: () => BlockInstance[];
  /** Open the stack's template picker — only in a stack with templates (`BlockSession.templates`). */
  openTemplatePicker: () => void;
}

export interface BlockSession {
  /** New per mount of the stack — the sidebar resets its own state with it (Cancel remounts). */
  sessionId: string;
  /** The entry the stack belongs to — the sidebar only shows the matching session. */
  entryId: string;
  /** Structure state; the `html` in it is the state at the last structural change. */
  blocks: BlockInstance[];
  isEditing: boolean;
  /** Can the stack insert templates? Only entries, not a template's page. */
  templates: boolean;
  /** Ineffective after the stack is torn down — a stale call does not reach a foreign entry. */
  api: BlockStackApi;
}

interface BlockSessionState {
  session: BlockSession | null;
  publish: (session: BlockSession) => void;
  /** Clears only if the session still belongs to this stack — a new one may already have taken over. */
  clear: (api: BlockStackApi) => void;
}

export const useBlockSessionStore = create<BlockSessionState>((set, get) => ({
  session: null,
  publish: (session) => set({ session }),
  clear: (api) => {
    if (get().session?.api === api) set({ session: null });
  },
}));
