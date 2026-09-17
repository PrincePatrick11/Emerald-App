import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Umsortieren per Griff, ohne Animation — die platzierten Elemente des Altars
 * und die Block-Verwaltung der Seitenleiste. Solange gezogen wird, zeigt
 * `visualItems` die Liste mit der Zeile an ihrem neuen Platz; losgelassen,
 * bekommt `onDrop` die neue Reihenfolge (nur, wenn sie sich geändert hat).
 *
 * Die Zielposition misst jedes Kind von `listRef` an seinem ersten Kind (der
 * Zeile, ohne aufgeklappten Inhalt darunter) — die Liste darf also nur die
 * Zeilen-Wrapper als Kinder haben.
 */
export function usePointerReorder<T extends { id: string }>(items: readonly T[], onDrop: (ordered: T[]) => void) {
  const [dragState, setDragState] = useState<{ fromId: string; overIndex: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visualItems = useMemo(() => {
    if (!dragState) return items;
    const list = [...items];
    const fromIdx = list.findIndex((item) => item.id === dragState.fromId);
    if (fromIdx < 0) return items;
    const [item] = list.splice(fromIdx, 1);
    list.splice(Math.min(dragState.overIndex, list.length), 0, item);
    return list;
  }, [dragState, items]);

  // Hält die Closures der Listener aktuell, ohne sie neu zu hängen.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const visualItemsRef = useRef(visualItems);
  visualItemsRef.current = visualItems;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  // Ein Drag, der beim Abbau noch läuft, darf nichts mehr fallen lassen —
  // `onDrop` gehörte dann zu einer Liste, die es nicht mehr gibt.
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const startDrag = useCallback((e: ReactPointerEvent, fromId: string) => {
    e.preventDefault();
    const fromIndex = itemsRef.current.findIndex((item) => item.id === fromId);
    if (fromIndex < 0) return;
    stopRef.current?.();
    // Losgelassen außerhalb des Fensters kommt `pointerup` sonst nie an.
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ohne Capture wie bisher */ }
    setDragState({ fromId, overIndex: fromIndex });

    const getOverIndex = (clientY: number): number => {
      if (!listRef.current) return fromIndex;
      const wrappers = Array.from(listRef.current.children) as HTMLElement[];
      let best = 0, bestDist = Infinity;
      wrappers.forEach((wrapper, i) => {
        const row = (wrapper.firstElementChild as HTMLElement | null) ?? wrapper;
        const rect = row.getBoundingClientRect();
        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      return best;
    };

    const stop = () => {
      stopRef.current = null;
      setDragState(null);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', stop);
    };
    const onMove = (ev: PointerEvent) => {
      setDragState((prev) => (prev ? { ...prev, overIndex: getOverIndex(ev.clientY) } : null));
    };
    const onUp = () => {
      const finalOrder = [...visualItemsRef.current];
      const current = itemsRef.current;
      stop();
      if (finalOrder.some((item, i) => item.id !== current[i]?.id)) onDropRef.current(finalOrder);
    };
    stopRef.current = stop;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    // Vom System abgebrochen (Fenster verloren, Touch-Geste): zurück, ohne Umsortieren.
    document.addEventListener('pointercancel', stop);
  }, []);

  return { listRef, visualItems, draggingId: dragState?.fromId ?? null, startDrag };
}
