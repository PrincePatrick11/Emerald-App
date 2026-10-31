import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getDragItem, setDragItem, subscribeDrag } from '../../lib/dragState';
import { toInternalLinkChip } from '../../lib/internalLinkHtml';
import type { SuggestionItem } from './SuggestionList';

interface PointerDropOptions {
  enabled: boolean;
  /** The editors of the text blocks, in order. */
  getEditors: () => Editor[];
  /** The area that counts as a target, also between the editors. */
  getContainer: () => HTMLElement | null;
}

/** The editor under the point, or, if the point lies between the editors
 *  (frame header, insertion line, gap), the vertically nearest one. `null` only if
 *  the point lies entirely outside the stack. */
function dropTarget(editors: Editor[], container: HTMLElement | null, x: number, y: number) {
  let nearest: { editor: Editor; rect: DOMRect; distance: number } | null = null;
  for (const editor of editors) {
    const rect = editor.view.dom.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return { editor, x, y };
    const distance = y < rect.top ? rect.top - y : y - rect.bottom;
    if (!nearest || distance < nearest.distance) nearest = { editor, rect, distance };
  }
  const bounds = container?.getBoundingClientRect();
  if (!nearest || !bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  // Pull into the editor so that `posAtCoords` finds a position, at
  // its top or bottom edge, depending on where the pointer came from.
  const { rect } = nearest;
  return {
    editor: nearest.editor,
    x: Math.min(Math.max(x, rect.left + 1), rect.right - 1),
    y: Math.min(Math.max(y, rect.top + 1), rect.bottom - 1),
  };
}

/**
 * Pointer-based drops into a text block: an entry from the left list becomes
 * a link chip. The drag runs via `lib/dragState` instead of HTML5 drag-and-drop
 * (which the WebView cannot do) and ends with a `pointerup` anywhere in the
 * window.
 *
 * ONE listener per entry: it finds the editor at the pointer and clears the drag in
 * every case, as the single editor used to. If each text block
 * hung on the `document` itself, the first listener would take the drag away from the second, or
 * nobody would clear it if the pointer lands beside all blocks.
 *
 * Returns whether a drag is currently running that could land here, for the
 * highlighting of the stack.
 */
export function useEditorPointerDrops({ enabled, getEditors, getContainer }: PointerDropOptions): boolean {
  const optionsRef = useRef({ getEditors, getContainer });
  optionsRef.current = { getEditors, getContainer };

  const [linkDrag, setLinkDrag] = useState<SuggestionItem | null>(null);
  useEffect(() => subscribeDrag(setLinkDrag), []);
  const active = !!linkDrag;

  useEffect(() => {
    if (!active) return;

    const handlePointerUp = (e: PointerEvent) => {
      const link = getDragItem();
      if (!link) return;
      setDragItem(null);
      if (!enabled) return;

      const { getEditors, getContainer } = optionsRef.current;
      const target = dropTarget(getEditors(), getContainer(), e.clientX, e.clientY);
      if (!target) return;
      const { editor } = target;
      const pos = editor.view.posAtCoords({ left: target.x, top: target.y });
      if (!pos) return;

      editor.chain()
        .focus()
        .insertContentAt(pos.pos, { type: 'internalLink', attrs: toInternalLinkChip(link) })
        .run();
    };

    document.addEventListener('pointerup', handlePointerUp);
    return () => document.removeEventListener('pointerup', handlePointerUp);
  }, [active, enabled]);

  return active && enabled;
}
