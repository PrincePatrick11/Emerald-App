/**
 * Where an entry opens, and the entries by dashboard. An entry has no type:
 * it opens on the one entry page (`{ type: 'entry' }`) inside the dashboard
 * it was clicked in — and in "All entries" when it comes from elsewhere
 * (link chip, search, tags, images, tasks).
 *
 * Import rule: imports no store; pure functions over what callers pass.
 */
import { dashboardEntries } from '../lib/dashboards';
import type { ActiveView, Dashboard, Entry, LinkTargetKind } from '../types';

/** The page of entry `id`, shown in dashboard `dashboard` ("All entries" by default). */
export function entryView(id: string, dashboard = 'all', mode: 'view' | 'edit' = 'view'): ActiveView {
  return { type: 'entry', id, dashboard, mode };
}

/** The view a link target opens in — the tasks, or the entry page in "All entries". */
export function viewOfLinkTarget(kind: LinkTargetKind | string, id: string): ActiveView {
  return kind === 'task' ? { type: 'tasks', id, mode: 'view' } : entryView(id);
}

/**
 * One result per list of entries and dashboard: every view that shows a
 * dashboard filters and sorts once per change, and gets the same array back as
 * long as neither changed — zustand needs stable snapshots, and a list should
 * not re-render for nothing.
 */
const dashboardCache = new WeakMap<readonly Entry[], WeakMap<Dashboard, Entry[]>>();

const EMPTY: Entry[] = [];

/** The entries a dashboard shows, in its order — the same array until entries or dashboard change. */
export function entriesOfDashboard(entries: readonly Entry[], dashboard: Dashboard | undefined): Entry[] {
  if (!dashboard) return EMPTY;
  let inner = dashboardCache.get(entries);
  if (!inner) {
    inner = new WeakMap();
    dashboardCache.set(entries, inner);
  }
  let result = inner.get(dashboard);
  if (!result) {
    result = dashboardEntries(entries, dashboard);
    inner.set(dashboard, result);
  }
  return result;
}
