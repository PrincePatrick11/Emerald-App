export interface RoutineDragItem {
  id: string;
  name: string;
  emoji: string;
  content: string;
  tags: string[];
  operation_ids: string[];
  wiki_ids: string[];
}

let _item: RoutineDragItem | null = null;
const _listeners = new Set<(item: RoutineDragItem | null) => void>();

export function setRoutineDragItem(item: RoutineDragItem | null) {
  _item = item;
  _listeners.forEach((fn) => fn(item));
}

export function getRoutineDragItem(): RoutineDragItem | null { return _item; }

export function subscribeRoutineDrag(fn: (item: RoutineDragItem | null) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
