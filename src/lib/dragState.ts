import type { SuggestionItem } from '../components/editor/SuggestionList';

let _item: SuggestionItem | null = null;
const _listeners = new Set<(item: SuggestionItem | null) => void>();

export function setDragItem(item: SuggestionItem | null) {
  _item = item;
  _listeners.forEach((fn) => fn(item));
}

export function getDragItem(): SuggestionItem | null { return _item; }

export function subscribeDrag(fn: (item: SuggestionItem | null) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
