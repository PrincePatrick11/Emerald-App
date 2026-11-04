import { useEffect, useState } from 'react';
import { subscribeDrag } from '../../../lib/dragState';
import type { SuggestionItem } from './SuggestionList';

/**
 * The floating tag at the mouse pointer while an entry from the left
 * list is dragged into the editor. Once per opened
 * entry (at the `BlockStack`), not per text block; otherwise several
 * congruent tags would lie on top of each other.
 */
export default function DragGhost() {
  const [linkItem, setLinkItem] = useState<SuggestionItem | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => subscribeDrag(setLinkItem), []);

  const active = !!linkItem;
  useEffect(() => {
    if (!active) {
      setPos(null);
      return;
    }
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    document.addEventListener('pointermove', move);
    return () => document.removeEventListener('pointermove', move);
  }, [active]);

  if (!linkItem || !pos) return null;

  return (
    <div
      className="fixed pointer-events-none z-50 flex items-center gap-1.5 px-2 py-1
                 bg-well-solid border border-edge-strong rounded-md shadow-menu opacity-90"
      style={{ left: pos.x + 12, top: pos.y + 12 }}
    >
      {/* `category` carries the category emoji in every module. */}
      {linkItem.category ? <span className="text-sm">{linkItem.category}</span> : null}
      <span className="text-xs text-accent">{linkItem.label}</span>
    </div>
  );
}
