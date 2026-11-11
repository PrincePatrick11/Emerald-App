import { useAltarStore } from './altarStore';
import { isInEdit, useUIStore } from './uiStore';
import { registerEditProbe } from './leaveGuardStore';
import { drainSerialized } from '../lib/serialize';
import { getDb } from '../lib/db';
import type { AltarPlacement, AltarRecord } from '../types';

/**
 * The altar as it was when "Edit" was pressed — including its
 * placements. Unlike an entry, the altar saves every action immediately
 * (placing, dragging, background, grid …); without this snapshot there would
 * be nothing for Cancel to go back to.
 *
 * Like the baseline of the entries (`entryEdit`), it lives outside the
 * component: the edit survives a look at another tab. A snapshot lives as long
 * as any tab shows the altar in edit mode — the reconciliation below reads
 * that off the `uiStore`. In memory only.
 *
 * The library is not part of the snapshot: an item belongs to all altars,
 * and what is changed on it stays. If an item has been deleted in the
 * meantime, its placement does not come back with Cancel.
 */
interface AltarSnapshot {
  altar: AltarRecord;
  placements: AltarPlacement[];
  /**
   * The items that were in the trash on entering. Their placements are in
   * no snapshot — if one comes back during the edit, Cancel must still not
   * clear them away.
   */
  trashedItemIds: string[];
}

const snapshots = new Map<string, AltarSnapshot>();

/**
 * Snapshots that the reconciliation below must not clear even though no tab
 * shows the altar in edit mode any more: Cancel is writing back right now —
 * the view has already switched by then — or failed at it and should be able
 * to finish the job next time.
 */
const held = new Set<string>();

/**
 * What is still being written for an altar without hanging in a write
 * chain: "Done" (title, thumbnail) and capturing the thumbnail when
 * switching away. A new snapshot waits for it — otherwise it would remember
 * the title from before the "Done" — and so does Cancel, so that none of it
 * lands after the write-back.
 */
const writing = new Map<string, Promise<unknown>>();

export function trackAltarWrite(id: string, write: Promise<unknown>): void {
  const tracked = Promise.allSettled([writing.get(id), write]).finally(() => {
    if (writing.get(id) === tracked) writing.delete(id);
  });
  writing.set(id, tracked);
}

/**
 * The write-back currently running for an altar. Anyone who presses "Edit"
 * again right after Cancel waits for it: otherwise they would take the old
 * snapshot for their own, and it would vanish when the write-back ends — the
 * new edit would have none.
 */
const restoring = new Map<string, Promise<void>>();

const isEditingAltar = (id: string) => isInEdit(useUIStore.getState(), 'altar', id);

useUIStore.subscribe(() => {
  for (const id of snapshots.keys()) {
    if (!held.has(id) && !isEditingAltar(id)) snapshots.delete(id);
  }
});

/**
 * The placements as they currently are. For the open altar, the active
 * list: it comes fresh from the database, while `previewPlacements` may be
 * missing for an altar.
 */
function currentPlacements(id: string): AltarPlacement[] {
  const { activeAltarId, placements, previewPlacements } = useAltarStore.getState();
  return activeAltarId === id ? placements : previewPlacements[id] ?? [];
}

/** Remembers the altar on entering edit mode. If the edit is already running, its snapshot stays. */
export async function beginAltarEdit(id: string): Promise<void> {
  // If it fails, its snapshot stays — and then also applies to this edit.
  await restoring.get(id)?.catch(() => {});
  await writing.get(id);
  // In the meantime the edit may have ended or the snapshot may already exist.
  if (snapshots.has(id) || !isEditingAltar(id)) return;
  const altar = useAltarStore.getState().altars.find((entry) => entry.id === id);
  if (!altar) return;
  const placements = currentPlacements(id);
  const db = await getDb();
  const trashed = await db.select<{ id: string }[]>('SELECT id FROM altar_items WHERE deleted_at IS NOT NULL');
  if (snapshots.has(id) || !isEditingAltar(id)) return;
  snapshots.set(id, { altar, placements, trashedItemIds: trashed.map((r) => r.id) });
}

/**
 * What counts on an altar when it comes to "changed or not". A field list
 * instead of the whole record: a freshly created one lacks some fields
 * entirely that are called `null` after the next load. Timestamps and
 * thumbnail are missing on purpose — they only follow.
 */
function comparableAltar(altar: AltarRecord, title = altar.title): string {
  return JSON.stringify([
    title,
    altar.background_preset, altar.background_image_data ?? null, altar.background_overlay, altar.background_overlay_color,
    altar.grid_enabled, altar.grid_size, altar.grid_opacity, altar.grid_color,
    altar.snap_to_grid, altar.rotation_snap_enabled, altar.rotation_snap_angle, altar.snap_scale_to_grid,
    altar.resolution, altar.icon_data ?? null,
  ]);
}

/** Only what the placement itself carries — name, emoji and image belong to the library item; a drawn one's look is its own. */
function comparablePlacements(placements: readonly AltarPlacement[]): string {
  return JSON.stringify(
    placements
      .map(({ id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden, shape, text, drawing }) =>
        ({ id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden, shape, text, drawing }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/**
 * Has the altar changed since entering edit mode? `title`: the typed,
 * not yet saved title — the altar only saves it with "Done".
 */
export function altarEditChanged(id: string, title?: string): boolean {
  const snapshot = snapshots.get(id);
  if (!snapshot) return false;
  const altar = useAltarStore.getState().altars.find((entry) => entry.id === id);
  if (!altar) return false;
  return comparableAltar(altar, title?.trim() || altar.title) !== comparableAltar(snapshot.altar)
    || comparablePlacements(currentPlacements(id)) !== comparablePlacements(snapshot.placements);
}

/**
 * Does the altar's edit carry anything that would warrant asking on leaving?
 * A new, never confirmed one always; a deleted one never. The guard of the
 * open page and the probe for background tabs both ask here.
 */
export function altarEditDirty(id: string, isNew: boolean, title?: string): boolean {
  if (!useAltarStore.getState().altars.some((altar) => altar.id === id)) return false;
  return isNew || altarEditChanged(id, title);
}

/**
 * Vault switch and replacing from a backup: no snapshot applies any more. Not
 * even a held one — the ids of a replaced vault come back, and Cancel would
 * then write the old altar over the restored one.
 */
export function clearAltarEdits(): void {
  held.clear();
  snapshots.clear();
}

/** "Done": the edit is confirmed, its snapshot is no longer needed. */
export function endAltarEdit(id: string): void {
  held.delete(id);
  snapshots.delete(id);
}

/**
 * Cancel: writes the remembered snapshot back — even if only the timestamp and
 * thumbnail differ, so the altar sits in the lists where it was.
 * If the write fails, it throws and the snapshot stays for a second
 * attempt: the next "Edit" builds on it, the next Cancel
 * finishes the job.
 */
export function restoreAltarEdit(id: string): Promise<void> {
  // Before the first await: the view switches right away, and the reconciliation
  // above would clear the snapshot while we are still waiting here.
  const snapshot = snapshots.get(id);
  if (!snapshot) return Promise.resolve();
  held.add(id);
  const restore = writeBack(id, snapshot).finally(() => {
    if (restoring.get(id) === restore) restoring.delete(id);
  });
  restoring.set(id, restore);
  return restore;
}

async function writeBack(id: string, snapshot: AltarSnapshot): Promise<void> {
  // Finish whatever is still in flight (a thumbnail, a slider) first —
  // otherwise it would land after the write-back.
  await writing.get(id);
  await drainSerialized();
  const altar = useAltarStore.getState().altars.find((entry) => entry.id === id);
  const untouched = !!altar && !altarEditChanged(id)
    && altar.updated_at === snapshot.altar.updated_at
    && (altar.thumbnail_data ?? null) === (snapshot.altar.thumbnail_data ?? null);
  if (!untouched) await useAltarStore.getState().restoreAltarSnapshot(snapshot.altar, snapshot.placements, snapshot.trashedItemIds);
  endAltarEdit(id);
}

// For background tabs: does the edit there carry changes (`leaveGuardStore`)?
registerEditProbe((view) =>
  view.type === 'altar' && view.mode === 'edit' && !!view.id && snapshots.has(view.id)
    && altarEditDirty(view.id, !!view.isNew));
