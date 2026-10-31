import { viewTypeForEntryType, type ViewId } from '../lib/modules';
import { isInEdit, useUIStore } from './uiStore';
import { guardKey, registerEditProbe } from './leaveGuardStore';
import { useEntryStore } from './entryStore';
import { retypeInternalLinks } from '../lib/internalLinkHtml';
import type { Entry, EntryType } from '../types';

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
 * A type change does not end the edit: the baseline moves along into the
 * new view (`carryBaseline`) and remembers where the entry came from — Cancel
 * brings it back there (`revertEntryType`).
 */
export interface EditBaseline {
  scope: ViewId;
  id: string;
  patch: BaselineFields;
  /** "Last modified" on entering — Cancel restores it along with the rest. */
  stamp: string | undefined;
  /** The saved state, in the shape of `patch` — `null` if the entry no longer exists. */
  stored: () => unknown;
  /** Only after a type change: what the entry was on entering. `patch` then has the shape of that view. */
  origin?: EditOrigin;
}

/** What a baseline holds: an excerpt of the entry — for the journal only the first three fields. */
export type BaselineFields = Partial<Pick<Entry, 'title' | 'content' | 'tags' | 'category_id' | 'icon' | 'cover_image'>>;

/** Type and number of an entry before it changed type during the edit. */
export interface EditOrigin {
  type: EntryType;
  entry_number: number | undefined;
}

export const baselines = new Map<string, EditBaseline>();

export const baselineKey = guardKey;

/**
 * Does an edit carry changes? The one rule for the guard of the
 * open page and the probe in the background: a deleted entry
 * (`stored === null`) has nothing left to preserve; a new, never confirmed one,
 * one with a pending autosave or with a changed type always does; otherwise
 * what counts is whether the saved state differs from the baseline.
 */
export function editIsDirty(stored: unknown, baseline: EditBaseline | undefined, isNew: boolean, pending = false): boolean {
  if (stored === null) return false;
  if (isNew || pending || baseline?.origin) return true;
  return baseline !== undefined && JSON.stringify(stored) !== JSON.stringify(baseline.patch);
}

/**
 * The baseline of the edit of `id` — under whichever view it currently
 * sits: after a type change that is no longer the one in which
 * "Edit" was pressed.
 */
export function baselineOf(id: string): EditBaseline | undefined {
  for (const baseline of baselines.values()) {
    if (baseline.id === id) return baseline;
  }
  return undefined;
}

/** Where the entry came from, if it has already changed type in this edit. */
export function originOfEdit(id: string, type: EntryType): EditOrigin | undefined {
  return baselines.get(baselineKey(viewTypeForEntryType(type), id))?.origin;
}

/**
 * Carries the baseline along into the view of the new type on a type change.
 * On the first change it remembers `source` as the origin; if the change leads
 * back there, it is an ordinary edit again. Must run
 * before the tabs move (`retypeEntryViews`) — the reconciliation below would
 * otherwise clear the baseline.
 *
 * `stored` used to read through the old view and would no longer find the entry
 * there ("deleted"). Until the new view is mounted and installs its reader
 * (`useEntryEditor`), it only says whether the entry exists — in a tab that
 * went to the background beforehand, it stays that way.
 */
export function carryBaseline(id: string, from: EntryType, to: EntryType, source: EditOrigin): void {
  const fromKey = baselineKey(viewTypeForEntryType(from), id);
  const baseline = baselines.get(fromKey);
  if (!baseline) return;
  const origin = baseline.origin ?? source;
  const scope = viewTypeForEntryType(to);
  baselines.delete(fromKey);
  baselines.set(baselineKey(scope, id), {
    ...baseline,
    scope,
    origin: origin.type === to ? undefined : origin,
    // `{}` matches no baseline — with `origin` the edit counts as changed anyway.
    stored: () => (useEntryStore.getState().getEntry(id, to) ? {} : null),
  });
}

/**
 * An entry has changed type: the chips pointing at it in the baselines of
 * OTHER running edits move along. `entryTypeChange` rewrites the saved
 * contents; a Cancel there would otherwise write the chip with the old type
 * back — and that leads nowhere any more.
 */
export function retypeBaselineLinks(id: string, to: EntryType): void {
  for (const baseline of baselines.values()) {
    const content = baseline.patch.content;
    if (baseline.id === id || !content) continue;
    const next = retypeInternalLinks(content, id, to);
    if (next !== content) baseline.patch = { ...baseline.patch, content: next };
  }
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
 * type revert also beyond that, until their next edit
 * begins: the views are only being torn down then. Whatever a view would
 * still save now — the debounce, the save on navigating away or on
 * teardown — would write the discarded input over the restored
 * entry. Per entry and not per view: when Cancel reverts a type change,
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
