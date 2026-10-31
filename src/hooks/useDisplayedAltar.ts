import { useAltarStore } from '../store/altarStore';
import { useUIStore } from '../store/uiStore';
import type { AltarRecord } from '../types';

/**
 * The altar the view is currently showing — or `null` while it is still loading.
 *
 * `activeView.id` is authoritative, not `activeAltarId` alone: `setActiveAltar`
 * loads the placements asynchronously, and until then the store holds no
 * altar or the previous one (with its `placements`). Anyone who reads only
 * the store shows the dashboard or the wrong altar in that gap.
 */
export function useDisplayedAltar(): AltarRecord | null {
  const viewAltarId = useUIStore((s) => (s.activeView.type === 'altar' ? s.activeView.id : undefined));
  return useAltarStore((s) =>
    viewAltarId && s.activeAltarId === viewAltarId
      ? s.altars.find((altar) => altar.id === viewAltarId) ?? null
      : null,
  );
}
