import type { ViewId } from '../lib/modules';
import { isInEdit, useUIStore } from './uiStore';
import { guardKey, registerEditProbe } from './leaveGuardStore';
import { useEntryStore } from './entryStore';
import type { Entry } from '../types';

/**
 * The baselines of the running edits, per view and entry — how
 * the entry looked when "Edit" was pressed. Outside the
 * component, because an edit outlives its view: anyone who looks at
 * another tab in the middle comes back into the same edit, and Cancel
 * then goes back to its beginning, not just to the tab switch.
 *
 * A baseline lives as long as any tab shows the entry in edit mode.
 * "Done", Cancel, delete, closing the tab and a page change
 * in the same tab end the edit — the reconciliation below reads that off the
 * `uiStore`, no view has to report it. In memory only: a restart
 * begins with what is saved.
 *
 * Moving the entry to another module (`EntryAreaField`) does not end the
 * edit: the baseline moves along into the new view (`carryBaseline`) and
 * remembers the view the edit began in — Cancel restores the category and
 * brings the tab back there.
 */
export interface EditBaseline {
  scope: ViewId;
  id: string;
  patch: BaselineFields;
  /** "Last modified" on entering — Cancel restores it along with the rest. */
  stamp: string | undefined;
  /** The saved state, in the shape of `patch` — `null` if the entry no longer exists. */
  stored: () => unknown;
  /** Only after a move to another module: the view the edit began in. */
  origin?: ViewId;
}

/** What a baseline holds: an excerpt of the entry. */
export type BaselineFields = Partial<Pick<Entry, 'title' | 'content' | 'tags' | 'category_id' | 'icon' | 'cover_image'>>;

export const baselines = new Map<string, EditBaseline>();

export const baselineKey = guardKey;

/**
 * Does an edit carry changes? The one rule for the guard of the
 * open page and the probe in the background: a deleted entry
 * (`stored === null`) has nothing left to preserve; a new, never confirmed one,
 * one with a pending autosave or moved to another module always does; otherwise
 * what counts is whether the saved state differs from the baseline.
 */
export function editIsDirty(stored: unknown, baseline: EditBaseline | undefined, isNew: boolean, pending = false): boolean {
  if (stored === null) return false;
  if (isNew || pending || baseline?.origin) return true;
  return baseline !== undefined && JSON.stringify(stored) !== JSON.stringify(baseline.patch);
}

/**
 * The baseline of the edit of `id` — under whichever view it currently
 * sits: after a move to another module that is no longer the one in which
 * "Edit" was pressed.
 */
export function baselineOf(id: string): EditBaseline | undefined {
  for (const baseline of baselines.values()) {
    if (baseline.id === id) return baseline;
  }
  return undefined;
}

/**
 * Carries the baseline along into the view `to` when the entry moves to
 * another module during the edit. It remembers the view the edit began in;
 * a move back there makes it an ordinary edit again. Must run before the
 * tabs move (`moveEntryViews`) — the reconciliation below would otherwise
 * clear the baseline.
 *
 * Until the new view is mounted and installs its reader (`useEntryEditor`),
 * `stored` only says whether the entry exists — in a tab that went to the
 * background beforehand, it stays that way.
 */
export function carryBaseline(id: string, from: ViewId, to: ViewId): void {
  const fromKey = baselineKey(from, id);
  const baseline = baselines.get(fromKey);
  if (!baseline || from === to) return;
  const origin = baseline.origin ?? from;
  baselines.delete(fromKey);
  baselines.set(baselineKey(to, id), {
    ...baseline,
    scope: to,
    origin: origin === to ? undefined : origin,
    // `{}` matches no baseline — with `origin` the edit counts as changed anyway.
    stored: () => (useEntryStore.getState().getEntry(id) ? {} : null),
  });
}

/**
 * Categories were merged or permanently deleted: whatever the baselines
 * still point at them moves along (`null` = no category). Cancel would
 * otherwise write back a category that no longer exists, and fail on the
 * foreign key.
 */
export function reassignBaselineCategories(ids: ReadonlySet<string>, to: string | null): void {
  for (const baseline of baselines.values()) {
    const category = baseline.patch.category_id;
    if (category && ids.has(category)) baseline.patch = { ...baseline.patch, category_id: to };
  }
}

/**
 * The entries whose edit Cancel is discarding right now — after a
 * move back also beyond that, until their next edit
 * begins: the views are only being torn down then. Whatever a view would
 * still save now — the debounce, the save on navigating away or on
 * teardown — would write the discarded input over the restored
 * entry. Per entry and not per view: when Cancel moves an entry back,
 * not only the view in which it was pressed is torn down.
 */
const discarding = new Set<string>();

export const isDiscarding = (id: string): boolean => discarding.has(id);

/** Cancel begins. `endDiscard` lifts it — at the latest the next edit of the entry. */
export function beginDiscard(id: string): void {
  discarding.add(id);
}

export function endDiscard(id: string): void {
  discarding.delete(id);
}

/**
 * A change that only writes after some work of its own — an image icon is
 * shrunk first. Cancel waits for it after `beginDiscard`, and a move to
 * another module before it starts. Dropping a late write is the caller's job: its write
 * checks `isDiscarding` first, or it would land after Cancel's restore.
 */
const pending = new Map<string, Promise<unknown>>();

export function trackEntryWrite(id: string, write: Promise<unknown>): void {
  const tracked = Promise.allSettled([pending.get(id), write]).finally(() => {
    if (pending.get(id) === tracked) pending.delete(id);
  });
  pending.set(id, tracked);
}

export async function pendingEntryWrites(id: string): Promise<void> {
  await pending.get(id);
}

useUIStore.subscribe((s) => {
  for (const [key, { scope, id }] of baselines) {
    if (!isInEdit(s, scope, id)) baselines.delete(key);
  }
});

// For background tabs: does the edit there carry changes? On switching
// away the editor has saved, so the saved state says it all.
registerEditProbe((view) => {
  if (view.mode !== 'edit' || !view.id) return false;
  const baseline = baselines.get(baselineKey(view.type, view.id));
  return !!baseline && editIsDirty(baseline.stored(), baseline, !!view.isNew);
});
