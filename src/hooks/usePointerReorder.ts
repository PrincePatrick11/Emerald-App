import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Reordering by handle, without animation — the sidebar's block
 * management. While dragging, `visualItems` shows
 * the list with the row in its new place; on release, `onDrop` receives the
 * new order (only if it has changed).
 *
 * The target position measures each child of `listRef` by its first child
 * (the row, without expanded content below it) — so the list may only have
 * the row wrappers as children.
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

  // Keeps the listeners' closures current without re-attaching them.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const visualItemsRef = useRef(visualItems);
  visualItemsRef.current = visualItems;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  // A drag that is still running at teardown must not drop anything any more —
  // `onDrop` would then belong to a list that no longer exists.
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  const startDrag = useCallback((e: ReactPointerEvent, fromId: string) => {
    e.preventDefault();
    const fromIndex = itemsRef.current.findIndex((item) => item.id === fromId);
    if (fromIndex < 0) return;
    stopRef.current?.();
    // Released outside the window, `pointerup` would otherwise never arrive.
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* without capture as before */ }
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
    // Cancelled by the system (window lost, touch gesture): back, without reordering.
    document.addEventListener('pointercancel', stop);
  }, []);

  return { listRef, visualItems, draggingId: dragState?.fromId ?? null, startDrag };
}
