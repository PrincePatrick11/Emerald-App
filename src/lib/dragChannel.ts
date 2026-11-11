/**
 * Module-wide channel for HTML5 drag payloads that do not fit through
 * dataTransfer (React objects). dragState/imageDragState are thin adapters
 * on top of it and keep their named exports.
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
