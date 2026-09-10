import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { getDragItem, setDragItem, subscribeDrag } from '../../lib/dragState';
import { getRoutineDragItem, setRoutineDragItem, subscribeRoutineDrag, type RoutineDragItem } from '../../lib/routineDragState';
import { useLinkItems } from '../../hooks/useLinkItems';
import { toInternalLinkChip } from '../../lib/internalLinkHtml';
import type { EntryLinkRequest } from '../../lib/links';
import type { SuggestionItem } from './SuggestionList';

interface PointerDropOptions {
  enabled: boolean;
  /** Die Editoren der Textblöcke, in Reihenfolge. */
  getEditors: () => Editor[];
  /** Die Fläche, die als Ziel zählt — auch zwischen den Editoren. */
  getContainer: () => HTMLElement | null;
  /** Link anhängen, mit dem Editor unter dem Zeiger als bevorzugtem Ziel. */
  appendLink: (item: EntryLinkRequest, preferred: Editor) => void;
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
 * zum Link-Chip, eine Routine zu Text plus Link-Blöcken. Beide Drags laufen
 * über `lib/dragState` bzw. `routineDragState` statt über HTML5-Drag-and-drop
 * (das kann der WebView nicht) und enden mit einem `pointerup` irgendwo im
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
export function useEditorPointerDrops({ enabled, getEditors, getContainer, appendLink }: PointerDropOptions): boolean {
  const optionsRef = useRef({ getEditors, getContainer, appendLink });
  optionsRef.current = { getEditors, getContainer, appendLink };

  const linkItems = useLinkItems();
  const itemsRef = useRef<SuggestionItem[]>([]);
  itemsRef.current = linkItems;

  const [linkDrag, setLinkDrag] = useState<SuggestionItem | null>(null);
  const [routineDrag, setRoutineDrag] = useState<RoutineDragItem | null>(null);
  useEffect(() => subscribeDrag(setLinkDrag), []);
  useEffect(() => subscribeRoutineDrag(setRoutineDrag), []);
  const active = !!(linkDrag || routineDrag);

  useEffect(() => {
    if (!active) return;

    const handlePointerUp = (e: PointerEvent) => {
      const link = getDragItem();
      const routine = getRoutineDragItem();
      if (link) setDragItem(null);
      if (routine) setRoutineDragItem(null);
      if (!enabled) return;

      const { getEditors, getContainer, appendLink } = optionsRef.current;
      const target = dropTarget(getEditors(), getContainer(), e.clientX, e.clientY);
      if (!target) return;
      const { editor } = target;
      const pos = editor.view.posAtCoords({ left: target.x, top: target.y });
      if (!pos) return;

      if (link) {
        editor.chain()
          .focus()
          .insertContentAt(pos.pos, { type: 'internalLink', attrs: toInternalLinkChip(link) })
          .run();
      }

      if (routine) {
        // Markdown parsen, bereinigen, als formatiertes HTML einsetzen.
        const rawHtml = (marked.parse(routine.content || '') as string) || '<p></p>';
        const html = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
        editor.chain().focus().insertContentAt(pos.pos, html).run();

        // Die Operationen und Wiki-Artikel der Routine landen als Link-Blöcke
        // unten im Textblock — dort, wo das Verlinkungs-Feld der Seitenleiste
        // sie auch wieder findet. Schon verlinkte Ziele überspringt `appendLink`.
        for (const ref of [
          ...routine.operation_ids.map((id) => ({ id, entryType: 'operation' as const })),
          ...routine.wiki_ids.map((id) => ({ id, entryType: 'wiki' as const })),
        ]) {
          const item = itemsRef.current.find((i) => i.entryType === ref.entryType && i.id === ref.id);
          if (item) appendLink(item, editor);
        }

        // Tags bleiben Sache der View — sie besitzt den lokalen Tag-State.
        if (routine.tags.length > 0) {
          document.dispatchEvent(new CustomEvent('routine-drop', { detail: { tags: routine.tags } }));
        }
      }
    };

    document.addEventListener('pointerup', handlePointerUp);
    return () => document.removeEventListener('pointerup', handlePointerUp);
  }, [active, enabled]);

  return active && enabled;
}
