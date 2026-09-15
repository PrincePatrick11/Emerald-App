import { useAltarStore } from '../store/altarStore';
import { useUIStore } from '../store/uiStore';
import type { AltarRecord } from '../types';

/**
 * Der Altar, den die Ansicht gerade zeigt — oder `null`, solange er noch lädt.
 *
 * Maßgeblich ist `activeView.id`, nicht `activeAltarId` allein: `setActiveAltar`
 * lädt die Platzierungen asynchron, und bis dahin steht im Store noch kein
 * oder der vorige Altar (samt dessen `placements`). Wer nur den Store liest,
 * zeigt in dieser Lücke das Dashboard oder den falschen Altar.
 */
export function useDisplayedAltar(): AltarRecord | null {
  const viewAltarId = useUIStore((s) => (s.activeView.type === 'altar' ? s.activeView.id : undefined));
  return useAltarStore((s) =>
    viewAltarId && s.activeAltarId === viewAltarId
      ? s.altars.find((altar) => altar.id === viewAltarId) ?? null
      : null,
  );
}
