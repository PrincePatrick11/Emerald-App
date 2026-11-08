import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Bookkeeping of a host's text editors: which exist, in what order, which
 * one had focus last, and from that, which editor gets the toolbar and which
 * one accepts requests from outside (a link from the sidebar, a file drop).
 *
 * One rule for both: the most recently focused editor, and as long as none
 * has been focused yet (or the focused one disappeared), the last one. The
 * last, because anything appended would land there anyway, at the end of the document.
 *
 * Editors register under a key of the host's choosing; `getOrder` lists the
 * keys in document order. A key missing from it is never a target.
 */
export function useTextEditorRegistry(getOrder: () => string[]) {
  const getOrderRef = useRef(getOrder);
  getOrderRef.current = getOrder;

  const editorsRef = useRef(new Map<string, { editor: Editor; onFocus: () => void }>());
  const lastFocusedRef = useRef<string | null>(null);
  const focusOnMountRef = useRef<string | null>(null);
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null);

  /** The registered editors in document order, not in order of registration. */
  const orderedEditors = useCallback((): Editor[] => {
    const editors = editorsRef.current;
    return getOrderRef.current().flatMap((key) => {
      const entry = editors.get(key);
      return entry ? [entry.editor] : [];
    });
  }, []);

  const targetEditor = useCallback((): Editor | null => {
    const focused = lastFocusedRef.current && editorsRef.current.get(lastFocusedRef.current);
    if (focused) return focused.editor;
    const editors = orderedEditors();
    return editors[editors.length - 1] ?? null;
  }, [orderedEditors]);

  const registerTextEditor = useCallback((key: string, editor: Editor | null) => {
    const map = editorsRef.current;
    const previous = map.get(key);
    if (previous) {
      previous.editor.off('focus', previous.onFocus);
      previous.editor.off('selectionUpdate', previous.onFocus);
      map.delete(key);
    }

    if (editor) {
      const onFocus = () => {
        if (lastFocusedRef.current === key) return;
        lastFocusedRef.current = key;
        setToolbarEditor(editor);
      };
      // Two signals for "work is happening here": focus, and every
      // cursor movement. The `focus` event alone is not enough: if the
      // window itself has no focus, the browser does not fire it even though the
      // cursor is in the editor.
      editor.on('focus', onFocus);
      editor.on('selectionUpdate', onFocus);
      map.set(key, { editor, onFocus });
      if (focusOnMountRef.current === key) {
        focusOnMountRef.current = null;
        editor.commands.focus('end');
      }
    } else if (lastFocusedRef.current === key) {
      lastFocusedRef.current = null;
    }

    // The toolbar stays with the focused editor as long as there is one; otherwise
    // it follows the same rule as requests from outside.
    setToolbarEditor((current) =>
      lastFocusedRef.current && current && current !== previous?.editor ? current : targetEditor());
  }, [targetEditor]);

  /** The editor `key` gets focus as soon as it exists; for freshly inserted ones. */
  const focusOnMount = useCallback((key: string) => { focusOnMountRef.current = key; }, []);

  return { registerTextEditor, orderedEditors, targetEditor, toolbarEditor, focusOnMount };
}
