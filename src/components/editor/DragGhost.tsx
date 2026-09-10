import { useEffect, useState } from 'react';
import { subscribeDrag } from '../../lib/dragState';
import { subscribeRoutineDrag, type RoutineDragItem } from '../../lib/routineDragState';
import type { SuggestionItem } from './SuggestionList';

/**
 * Das schwebende Schild am Mauszeiger, während ein Eintrag aus der linken
 * Liste oder eine Routine in den Editor gezogen wird. Einmal pro geöffnetem
 * Eintrag (am `BlockStack`), nicht pro Textblock — sonst lägen mehrere
 * deckungsgleiche Schilder übereinander.
 */
export default function DragGhost() {
  const [linkItem, setLinkItem] = useState<SuggestionItem | null>(null);
  const [routineItem, setRoutineItem] = useState<RoutineDragItem | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => subscribeDrag(setLinkItem), []);
  useEffect(() => subscribeRoutineDrag(setRoutineItem), []);

  const active = !!(linkItem || routineItem);
  useEffect(() => {
    if (!active) {
      setPos(null);
      return;
    }
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    document.addEventListener('pointermove', move);
    return () => document.removeEventListener('pointermove', move);
  }, [active]);

  if (!active || !pos) return null;

  return (
    <div
      className="fixed pointer-events-none z-50 flex items-center gap-1.5 px-2 py-1
                 bg-stone-800 border border-stone-600 rounded shadow-lg opacity-90"
      style={{ left: pos.x + 12, top: pos.y + 12 }}
    >
      {routineItem ? (
        <>
          <span className="text-sm">{routineItem.emoji}</span>
          <span className="text-xs text-jade-400">{routineItem.name}</span>
        </>
      ) : linkItem ? (
        <>
          {/* `category` trägt in jedem Modul das Kategorie-Emoji. */}
          {linkItem.category ? <span className="text-sm">{linkItem.category}</span> : null}
          <span className="text-xs text-jade-400">{linkItem.label}</span>
        </>
      ) : null}
    </div>
  );
}
