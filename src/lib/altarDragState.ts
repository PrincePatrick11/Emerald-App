import type { AltarItem } from '../types';

let _item: AltarItem | null = null;
const _listeners = new Set<(item: AltarItem | null) => void>();

export function setAltarDragItem(item: AltarItem | null) {
  _item = item;
  _listeners.forEach((fn) => fn(item));
}

export function getAltarDragItem(): AltarItem | null { return _item; }

export function subscribeAltarDrag(fn: (item: AltarItem | null) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
