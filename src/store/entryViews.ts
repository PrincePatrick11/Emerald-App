/**
 * Where an entry opens, and the entries by dashboard and by kind. An entry has
 * no type: the view follows from its kind under the dashboards loaded now
 * (`entryKindOf`) — and an entry that is not loaded (in the trash) opens in
 * the view of the fallback kind.
 *
 * Import rule: reads the entry and dashboard stores, none of them imports back.
 */
import { useEntryStore } from './entryStore';
import { kindOfEntry, useDashboardStore } from './dashboardStore';
import { dashboardEntries, FALLBACK_ENTRY_KIND, partitionByKind, type EntriesByKind } from '../lib/dashboards';
import { viewTypeForKind, type EntryModuleId } from '../lib/modules';
import type { Dashboard, Entry, LinkTargetKind } from '../types';

/** The module view an entry opens in. */
export function viewOfEntry(entry: Pick<Entry, 'category_id' | 'tags'> | undefined): Exclude<EntryModuleId, 'tasks'> {
  return viewTypeForKind(entry ? kindOfEntry(entry) : FALLBACK_ENTRY_KIND) as Exclude<EntryModuleId, 'tasks'>;
}

/** The module view the entry `id` opens in. */
export function viewOfEntryId(id: string): Exclude<EntryModuleId, 'tasks'> {
  return viewOfEntry(useEntryStore.getState().getEntry(id));
}

/** The view a link target opens in — the tasks, or the entry's module. */
export function viewOfLinkTarget(kind: LinkTargetKind | string, id: string): EntryModuleId {
  return kind === 'task' ? 'tasks' : viewOfEntryId(id);
}

/**
 * One result per list of entries and second key: every view that shows a
 * dashboard filters and sorts once per change, and gets the same array back as
 * long as neither changed — zustand needs stable snapshots, and a list should
 * not re-render for nothing.
 */
function memo2<A extends object, B extends object, R>(cache: WeakMap<A, WeakMap<B, R>>, a: A, b: B, compute: () => R): R {
  let inner = cache.get(a);
  if (!inner) {
    inner = new WeakMap();
    cache.set(a, inner);
  }
  let result = inner.get(b);
  if (result === undefined) {
    result = compute();
    inner.set(b, result);
  }
  return result;
}

const EMPTY: Entry[] = [];
const dashboardCache = new WeakMap<readonly Entry[], WeakMap<Dashboard, Entry[]>>();
const kindCache = new WeakMap<readonly Entry[], WeakMap<readonly Dashboard[], EntriesByKind>>();

/** The entries a dashboard shows, in its order — the same array until entries or dashboard change. */
export function entriesOfDashboard(entries: readonly Entry[], dashboard: Dashboard | undefined): Entry[] {
  if (!dashboard) return EMPTY;
  return memo2(dashboardCache, entries, dashboard, () => dashboardEntries(entries, dashboard));
}

/** `partitionByKind`, once per list of entries and dashboards — the arrays stay the same until one of them changes. */
export function entriesByKind(entries: readonly Entry[], modules: readonly Dashboard[]): EntriesByKind {
  return memo2(kindCache, entries, modules, () => partitionByKind(entries, modules));
}

/** Every entry under its one kind, outside of React. */
export function entriesByKindNow(): EntriesByKind {
  return entriesByKind(useEntryStore.getState().entries, useDashboardStore.getState().modules);
}
