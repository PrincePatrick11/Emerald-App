/**
 * The dashboards (table `dashboards`): which entries Journal, Wiki and
 * Operations show, and the kind an entry counts as (`entryKindOf`).
 * Building them yourself, renaming and deleting come later; for now the
 * store reads them and keeps the category IDs in their filters in step with
 * the categories.
 *
 * Import rule: imports no other store.
 */
import { create } from 'zustand';
import { getDb } from '../lib/db';
import { fromRow, type DbRow } from '../lib/row';
import { entryKindOf, moduleDashboards } from '../lib/dashboards';
import type { BuiltinDashboard, Dashboard, Entry, EntryKind } from '../types';

interface DashboardState {
  /** The active dashboards in their order. */
  dashboards: Dashboard[];
  /** The live module dashboards in their order — what `entryKindOf` walks. */
  modules: Dashboard[];
  fetchDashboards: () => Promise<void>;
}

function withModules(dashboards: Dashboard[]): Pick<DashboardState, 'dashboards' | 'modules'> {
  return { dashboards, modules: moduleDashboards(dashboards) };
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboards: [],
  modules: [],

  fetchDashboards: async () => {
    const db = await getDb();
    const rows = await db.select<DbRow[]>('SELECT * FROM dashboards WHERE deleted_at IS NULL ORDER BY position ASC, id ASC');
    set(withModules(rows.map(fromRow.dashboard)));
  },
}));

/** A built-in dashboard by key — `undefined` if it is deleted. */
export function builtinDashboard(dashboards: readonly Dashboard[], key: BuiltinDashboard): Dashboard | undefined {
  return dashboards.find((d) => d.builtin === key);
}

/** The kind of an entry under the dashboards loaded now — outside of React. */
export function kindOfEntry(entry: Pick<Entry, 'category_id' | 'tags'>): EntryKind {
  return entryKindOf(entry, useDashboardStore.getState().modules);
}

/**
 * The same change to the loaded dashboards as `reassignCategoryContent` made
 * in the database: category IDs out of the filters (`to` null) or moved to
 * `to`.
 */
export function reassignDashboardCategoriesInMemory(ids: ReadonlySet<string>, to: string | null): void {
  useDashboardStore.setState((s) => {
    let changed = false;
    const dashboards = s.dashboards.map((d) => {
      const categories = d.filter.categories;
      if (!categories?.some((c) => ids.has(c))) return d;
      changed = true;
      const next = [...new Set(categories.map((c) => (ids.has(c) ? to : c)).filter((c): c is string => c !== null))];
      return { ...d, filter: { ...d.filter, categories: next } };
    });
    return changed ? withModules(dashboards) : {};
  });
}
