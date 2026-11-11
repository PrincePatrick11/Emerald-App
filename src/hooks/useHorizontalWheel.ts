import { useEffect, type DependencyList, type RefObject } from 'react';

/**
 * A plain (vertical) wheel over the row scrolls it sideways instead of the
 * page, while the row overflows; a sideways gesture (a trackpad) is left to
 * the browser. A listener of its own: React's wheel listener is passive and
 * cannot stop the page. `deps` re-attach it when the element may have been
 * replaced or only now rendered.
 */
export function useHorizontalWheel(ref: RefObject<HTMLElement | null>, deps: DependencyList = []) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's deps decide when to re-attach
  }, deps);
}
