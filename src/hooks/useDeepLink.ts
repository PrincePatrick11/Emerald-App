import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '../store/uiStore';
import type { ViewId } from '../lib/modules';

interface DeepLinkOptions<T extends { id: string }> {
  /** The view whose deep links (`{ type, id }`) arrive here. */
  type: ViewId;
  /** Where the id is looked up. A deep link that finds the store still empty
   *  takes effect as soon as the list arrives. */
  items: readonly T[];
  /** The attribute that carries the id on the row, e.g. `data-task-id`. */
  rowAttribute: string;
  block?: ScrollLogicalPosition;
  /** Clears away whatever could hide the row (search, filters, collapsed
   *  groups) — runs once per deep link, before scrolling. */
  onOpen: (target: T) => void;
}

/**
 * The deep link from global search for views without their own detail page:
 * `{ type, id }` brings the row into view.
 *
 * It is triggered by the `activeView` *object*, not by the id inside it:
 * `setActiveView` creates a fresh one on every navigation, so the same hit
 * works twice in a row. `handledView` remembers which object was already
 * handled — so `items` may stay in the dependencies without a later change
 * clearing the user's filters.
 *
 * Scrolling happens in a separate effect one frame later, because the row is
 * only rendered after what `onOpen` clears away. The scroll effect
 * deliberately does not depend on the cleared states — otherwise every later
 * expand or collapse would throw the user back. `onOpen` runs through a ref
 * (as in `useEditActions`) so the caller does not have to memoize it.
 *
 * `scrollTo(id)` scrolls without a deep link — e.g. to a row that was just created.
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
