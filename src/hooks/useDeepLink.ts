import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import type { ViewId } from '../lib/modules';

interface DeepLinkOptions<T extends { id: string }> {
  /** Die Ansicht, deren Tiefenlinks (`{ type, id }`) hier ankommen. */
  type: ViewId;
  /** Worin die id gesucht wird. Ein Tiefenlink, der einen noch leeren Store
   *  vorfindet, greift, sobald die Liste nachkommt. */
  items: readonly T[];
  /** Das Attribut, das die Zeile mit der id trägt, z. B. `data-task-id`. */
  rowAttribute: string;
  block?: ScrollLogicalPosition;
  /** Räumt weg, was die Zeile verdecken könnte (Suche, Filter, zugeklappte
   *  Gruppen) — läuft einmal pro Tiefenlink, vor dem Scrollen. */
  onOpen: (target: T) => void;
}

/**
 * Der Tiefenlink aus der globalen Suche für Ansichten ohne eigene
 * Detailseite: `{ type, id }` holt die Zeile in den Blick.
 *
 * Ausgelöst wird das vom `activeView`-*Objekt*, nicht von der id darin:
 * `setActiveView` legt bei jeder Navigation ein frisches an, sodass derselbe
 * Treffer auch zweimal hintereinander wirkt. `handledView` merkt sich, welches
 * Objekt schon dran war — damit darf `items` in den Abhängigkeiten stehen,
 * ohne dass eine spätere Änderung dem Nutzer seine Filter wegräumt.
 *
 * Gescrollt wird in einem eigenen Effekt einen Frame später, weil die Zeile
 * erst nach dem, was `onOpen` aufräumt, gerendert ist. Den hängt nichts an
 * die aufgeräumten Zustände — sonst würfe jedes spätere Auf- oder Zuklappen
 * den Nutzer zurück. `onOpen` läuft über einen Ref (wie in `useEditActions`),
 * damit der Aufrufer ihn nicht memoisieren muss.
 *
 * `scrollTo(id)` scrollt ohne Tiefenlink — etwa zu einer gerade angelegten Zeile.
 */
export function useDeepLink<T extends { id: string }>({
  type, items, rowAttribute, block = 'nearest', onOpen,
}: DeepLinkOptions<T>): { scrollTo: (id: string) => void } {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const activeView = useUIStore((s) => s.activeView);
  const handledView = useRef<typeof activeView | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  useEffect(() => {
    if (activeView.type !== type || !activeView.id) return;
    if (handledView.current === activeView) return;
    const target = items.find((item) => item.id === activeView.id);
    if (!target) return;
    handledView.current = activeView;
    onOpenRef.current(target);
    setPendingScrollId(target.id);
  }, [activeView, type, items]);

  useEffect(() => {
    if (!pendingScrollId) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[${rowAttribute}="${CSS.escape(pendingScrollId)}"]`)
        ?.scrollIntoView({ block });
      setPendingScrollId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingScrollId, rowAttribute, block]);

  return { scrollTo: useCallback((id: string) => setPendingScrollId(id), []) };
}
