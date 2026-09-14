import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { getDragItem, setDragItem, subscribeDrag } from '../../lib/dragState';
import { toInternalLinkChip } from '../../lib/internalLinkHtml';
import type { SuggestionItem } from './SuggestionList';

interface PointerDropOptions {
  enabled: boolean;
  /** Die Editoren der Textblöcke, in Reihenfolge. */
  getEditors: () => Editor[];
  /** Die Fläche, die als Ziel zählt — auch zwischen den Editoren. */
  getContainer: () => HTMLElement | null;
}

/** Der Editor unter dem Punkt — oder, liegt der Punkt zwischen den Editoren
 *  (Rahmenkopf, Einfügelinie, Abstand), der vertikal nächste. `null` nur, wenn
 *  der Punkt ganz außerhalb des Stapels liegt. */
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
  // In den Editor hineinziehen, damit `posAtCoords` eine Stelle findet — an
  // seinem oberen oder unteren Rand, je nachdem, von wo der Zeiger kam.
  const { rect } = nearest;
  return {
    editor: nearest.editor,
    x: Math.min(Math.max(x, rect.left + 1), rect.right - 1),
    y: Math.min(Math.max(y, rect.top + 1), rect.bottom - 1),
  };
}

/**
 * Drops per Zeiger in einen Textblock: ein Eintrag aus der linken Liste wird
 * zum Link-Chip. Der Drag läuft über `lib/dragState` statt über HTML5-Drag-and-drop
 * (das kann der WebView nicht) und endet mit einem `pointerup` irgendwo im
 * Fenster.
 *
 * EIN Zuhörer pro Eintrag: er sucht den Editor am Zeiger und räumt den Drag in
 * jedem Fall ab — so wie früher der einzelne Editor. Hinge jeder Textblock
 * selbst am `document`, nähme der erste Zuhörer dem zweiten den Drag weg, oder
 * niemand räumte ihn, wenn der Zeiger neben allen Blöcken landet.
 *
 * Gibt zurück, ob gerade ein Drag läuft, der hier landen könnte — für die
 * Markierung des Stapels.
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
