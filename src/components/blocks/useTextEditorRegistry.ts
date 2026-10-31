import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { activeElements, FIELDS_BLOCK_TYPE, parseFields } from '../../lib/blocks/fields';
import type { BlockInstance } from '../../lib/blocks/types';

/**
 * Bookkeeping of the editors of a stack's text blocks: which exist,
 * in what order, which one had focus last, and from that, which
 * editor gets the toolbar and which one accepts requests from outside (a link from the
 * sidebar, a file drop).
 *
 * One rule for both: the most recently focused text block, and as long as none
 * has been focused yet (or the focused one disappeared), the last one. The
 * last, because anything appended would land there anyway, at the end of the entry.
 *
 * Registration is under the block ID, a custom block's text element
 * under `<block ID>:<element ID>`; it counts like a text block at the position
 * of its block.
 */
export function useTextEditorRegistry(getBlocks: () => BlockInstance[]) {
  const getBlocksRef = useRef(getBlocks);
  getBlocksRef.current = getBlocks;

  const editorsRef = useRef(new Map<string, { editor: Editor; onFocus: () => void }>());
  const lastFocusedRef = useRef<string | null>(null);
  const focusOnMountRef = useRef<string | null>(null);
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null);

  /** The editors of the text blocks (and text elements) in block order. */
  const orderedEditors = useCallback((): Editor[] => {
    const out: Editor[] = [];
    const editors = editorsRef.current;
    for (const block of getBlocksRef.current()) {
      const own = editors.get(block.id);
      if (own) out.push(own.editor);
      if (block.type !== FIELDS_BLOCK_TYPE) continue;
      // Text elements in the order of the block, not of registration.
      for (const element of activeElements(parseFields(block))) {
        const part = element.kind === 'text' ? editors.get(`${block.id}:${element.id}`) : undefined;
        if (part) out.push(part.editor);
      }
    }
    return out;
  }, []);

  const targetEditor = useCallback((): Editor | null => {
    const focused = lastFocusedRef.current && editorsRef.current.get(lastFocusedRef.current);
    if (focused) return focused.editor;
    const editors = orderedEditors();
    return editors[editors.length - 1] ?? null;
  }, [orderedEditors]);

  const registerTextEditor = useCallback((blockId: string, editor: Editor | null) => {
    const map = editorsRef.current;
    const previous = map.get(blockId);
    if (previous) {
      previous.editor.off('focus', previous.onFocus);
      previous.editor.off('selectionUpdate', previous.onFocus);
      map.delete(blockId);
    }

    if (editor) {
      const onFocus = () => {
        if (lastFocusedRef.current === blockId) return;
        lastFocusedRef.current = blockId;
        setToolbarEditor(editor);
      };
      // Two signals for "work is happening here": focus, and every
      // cursor movement. The `focus` event alone is not enough: if the
      // window itself has no focus, the browser does not fire it even though the
      // cursor is in the editor.
      editor.on('focus', onFocus);
      editor.on('selectionUpdate', onFocus);
      map.set(blockId, { editor, onFocus });
      if (focusOnMountRef.current === blockId) {
        focusOnMountRef.current = null;
        editor.commands.focus('end');
      }
    } else if (lastFocusedRef.current === blockId) {
      lastFocusedRef.current = null;
    }

    // The toolbar stays with the focused editor as long as there is one; otherwise
    // it follows the same rule as requests from outside.
    setToolbarEditor((current) =>
      lastFocusedRef.current && current && current !== previous?.editor ? current : targetEditor());
  }, [targetEditor]);

  /** The text block `blockId` gets focus as soon as its editor exists; for freshly inserted blocks. */
  const focusOnMount = useCallback((blockId: string) => { focusOnMountRef.current = blockId; }, []);

  return { registerTextEditor, orderedEditors, targetEditor, toolbarEditor, focusOnMount };
}
