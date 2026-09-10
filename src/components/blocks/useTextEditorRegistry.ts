import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { BlockInstance } from '../../lib/blocks/types';

/**
 * Buchführung über die Editoren der Textblöcke eines Stapels: wer existiert,
 * in welcher Reihenfolge, wer zuletzt den Fokus hatte — und daraus, welcher
 * Editor die Toolbar bekommt und welcher Bitten von außen (Link aus der
 * Seitenleiste, Datei-Drop) annimmt.
 *
 * Eine Regel für beides: der zuletzt fokussierte Textblock, und solange noch
 * keiner fokussiert war (oder der fokussierte verschwand), der letzte. Der
 * letzte, weil Angehängtes dort ohnehin landen würde — ans Ende des Eintrags.
 */
export function useTextEditorRegistry(getBlocks: () => BlockInstance[]) {
  const getBlocksRef = useRef(getBlocks);
  getBlocksRef.current = getBlocks;

  const editorsRef = useRef(new Map<string, { editor: Editor; onFocus: () => void }>());
  const lastFocusedRef = useRef<string | null>(null);
  const focusOnMountRef = useRef<string | null>(null);
  const [toolbarEditor, setToolbarEditor] = useState<Editor | null>(null);

  /** Die Editoren der Textblöcke in Blockreihenfolge. */
  const orderedEditors = useCallback((): Editor[] => {
    const out: Editor[] = [];
    for (const block of getBlocksRef.current()) {
      const entry = editorsRef.current.get(block.id);
      if (entry) out.push(entry.editor);
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
      // Zwei Signale für „hier wird gearbeitet": der Fokus, und jede
      // Cursorbewegung. Das `focus`-Ereignis allein reicht nicht — hat das
      // Fenster selbst keinen Fokus, feuert der Browser es nicht, obwohl der
      // Cursor im Editor steht.
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

    // Die Toolbar bleibt beim fokussierten Editor, solange es ihn gibt; sonst
    // folgt sie derselben Regel wie die Bitten von außen.
    setToolbarEditor((current) =>
      lastFocusedRef.current && current && current !== previous?.editor ? current : targetEditor());
  }, [targetEditor]);

  /** Der Textblock `blockId` bekommt den Fokus, sobald sein Editor steht — für frisch eingefügte Blöcke. */
  const focusOnMount = useCallback((blockId: string) => { focusOnMountRef.current = blockId; }, []);

  return { registerTextEditor, orderedEditors, targetEditor, toolbarEditor, focusOnMount };
}
