/**
 * Modulweiter Kanal für HTML5-Drag-Payloads, die nicht durch dataTransfer
 * passen (React-Objekte). dragState/altarDragState/routineDragState sind
 * dünne Adapter hierüber und behalten ihre benannten Exporte.
 */
export interface DragChannel<T> {
  set: (item: T | null) => void;
  get: () => T | null;
  subscribe: (fn: (item: T | null) => void) => () => void;
}

export function createDragChannel<T>(): DragChannel<T> {
  let item: T | null = null;
  const listeners = new Set<(item: T | null) => void>();
  return {
    set: (next) => {
      item = next;
      listeners.forEach((fn) => fn(next));
    },
    get: () => item,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
