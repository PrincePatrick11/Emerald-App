import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { getDragItem, setDragItem, subscribeDrag } from '../../../lib/dragState';
import { toInternalLinkChip } from '../../../lib/internalLinkHtml';
import { caretSpot, editorAtPoint, lineSpot, type DropSpot } from './dropSpot';
import { editorHas } from './hostContext';
import { getImageDrag, setImageDrag, subscribeImageDrag, type ImageDrag } from './imageDrag';

interface PointerDropOptions {
  enabled: boolean;
  /** The host's editors, in order. */
  getEditors: () => Editor[];
  /** The area that counts as a target, also between the editors. */
  getContainer: () => HTMLElement | null;
  /** Where the running drag would land, for the indicator; `null` when nowhere. */
  onSpot: (spot: DropSpot | null) => void;
}

type Drag = { kind: 'link' } | { kind: 'image'; image: ImageDrag };

/**
 * Pointer-based drops into the host's editors: an entry from the left list
 * becomes a link chip at the caret, an image of one of the editors moves
 * between blocks, also into another editor of the host. The drags run via
 * drag channels instead of HTML5 drag-and-drop (which the WebView cannot do)
 * and end with a `pointerup` anywhere in the window.
 *
 * ONE listener per host: it finds the editor at the pointer and clears the drag in
 * every case. If each editor hung on the `document` itself, the first listener
 * would take the drag away from the second, or nobody would clear it if the
 * pointer lands beside all editors.
 *
 * Returns whether a drag is currently running that could land here, for the
 * highlighting of the host.
 */
export function useEditorPointerDrops({ enabled, getEditors, getContainer, onSpot }: PointerDropOptions): boolean {
  const optionsRef = useRef({ getEditors, getContainer, onSpot });
  optionsRef.current = { getEditors, getContainer, onSpot };

  const [drag, setDrag] = useState<Drag | null>(null);
  useEffect(() => {
    const offLink = subscribeDrag((item) => setDrag(item ? { kind: 'link' } : null));
    const offImage = subscribeImageDrag((image) => setDrag(image ? { kind: 'image', image } : null));
    return () => { offLink(); offImage(); };
  }, []);

  // Only an image of one of this host's editors moves here.
  const ours = drag?.kind === 'link' || (drag?.kind === 'image' && getEditors().includes(drag.image.editor));
  const running = !!drag && ours;

  useEffect(() => {
    // Also while reading: the drag must be cleared, only nothing lands.
    if (!running || !drag) return;

    /** The spot under the pointer, among the editors that take this kind of content. */
    const spotAt = (x: number, y: number): DropSpot | null => {
      if (!enabled) return null;
      const { getEditors, getContainer } = optionsRef.current;
      const kind = drag.kind === 'link' ? 'internalLink' : 'image';
      const target = editorAtPoint(getEditors().filter((ed) => editorHas(ed, kind)), getContainer(), x, y);
      if (!target) return null;
      return drag.kind === 'link' ? caretSpot(target.editor, target.x, target.y) : lineSpot(target.editor, target.y);
    };

    const handlePointerMove = (e: PointerEvent) => optionsRef.current.onSpot(spotAt(e.clientX, e.clientY));

    const handlePointerUp = (e: PointerEvent) => {
      optionsRef.current.onSpot(null);
      const spot = spotAt(e.clientX, e.clientY);
      if (drag.kind === 'link') {
        const link = getDragItem();
        setDragItem(null);
        if (!link || !spot) return;
        spot.editor.chain()
          .focus()
          .insertContentAt(spot.pos, { type: 'internalLink', attrs: toInternalLinkChip(link) })
          .run();
        return;
      }
      const image = getImageDrag();
      setImageDrag(null);
      if (image && spot) moveImage(image, spot);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      optionsRef.current.onSpot(null);
    };
  }, [running, drag, enabled]);

  return running && enabled;
}

/**
 * Move the image to the spot. Within one editor a single transaction, so one
 * undo step brings it back; into another editor first inserted there, then
 * removed at the source. The moved image ends up selected.
 */
function moveImage(image: ImageDrag, spot: DropSpot): void {
  const from = image.getPos();
  const source = image.editor;
  if (from === undefined || source.isDestroyed) return;
  const node = source.state.doc.nodeAt(from);
  if (!node || node.type.name !== 'image') return;

  if (spot.editor === source) {
    // Onto itself: before or right after its own position changes nothing.
    if (spot.pos === from || spot.pos === from + node.nodeSize) return;
    const tr = source.state.tr.delete(from, from + node.nodeSize);
    const to = tr.mapping.map(spot.pos);
    tr.insert(to, node);
    tr.setSelection(NodeSelection.create(tr.doc, to));
    source.view.dispatch(tr.scrollIntoView());
    source.view.focus();
    return;
  }

  const target = spot.editor;
  const tr = target.state.tr.insert(spot.pos, target.schema.nodeFromJSON(node.toJSON()));
  tr.setSelection(NodeSelection.create(tr.doc, spot.pos));
  target.view.dispatch(tr.scrollIntoView());
  source.view.dispatch(source.state.tr.delete(from, from + node.nodeSize));
  target.view.focus();
}
