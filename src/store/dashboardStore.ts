/**
 * The dashboards (table `dashboards`): the rail's views over entries, in
 * their order. Built-in ones (`all`, `journal`, `practice`, `knowledge`) and
 * the user's own; all but "All entries" can be renamed, filtered and deleted
 * (into the trash). The store also keeps the category IDs in their filters
 * in step with the categories.
 *
 * Create, update, delete and reorder: a failed write puts the state back (or
 * never sets it) and reports through `saveNoticeStore` instead of throwing.
 * Restore and permanent delete throw — the trash and undo handle their errors.
 *
 * Import rule: imports no other store except the leaf `saveNoticeStore`.
 */
import { create } from 'zustand';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import { reportSaveError } from './saveNoticeStore';
import { DEFAULT_DISPLAY, normalizeFilter } from '../lib/dashboards';
import type { Dashboard, DashboardDisplay, DashboardFilter, DashboardSort } from '../types';

/** What can be changed on a dashboard. */
interface DashboardPatch {
  name?: string;
  icon?: string;
  filter?: DashboardFilter;
  sort?: DashboardSort;
  display?: DashboardDisplay;
}

interface DashboardState {
  /** The active dashboards in their order. */
  dashboards: Dashboard[];
  fetchDashboards: () => Promise<void>;
  /** `null` if it could not be saved. */
  createDashboard: (name: string) => Promise<Dashboard | null>;
  updateDashboard: (id: string, patch: DashboardPatch) => Promise<void>;
  /** Into the trash — "All entries" cannot go. `false` if nothing was deleted or it could not be saved. */
  deleteDashboard: (id: string) => Promise<boolean>;
  /** Out of the trash — to the end of the rail, or with `keepPlace` (Undo) where it was. */
  restoreDashboard: (id: string, options?: { keepPlace?: boolean }) => Promise<void>;
  permanentlyDeleteDashboard: (id: string) => Promise<void>;
  /** The new order of the dashboards; `ids` in rail order. */
  reorderDashboards: (ids: string[]) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  dashboards: [],

  fetchDashboards: async () => {
    const db = await getDb();
    const rows = await db.select<DbRow[]>('SELECT * FROM dashboards WHERE deleted_at IS NULL ORDER BY position ASC, id ASC');
    set({ dashboards: rows.map(fromRow.dashboard) });
  },

  createDashboard: async (name) => {
    try {
      const db = await getDb();
      const now = nowIso();
      // After every row.
      const [{ max }] = await db.select<{ max: number | null }[]>('SELECT MAX(position) AS max FROM dashboards');
      const dashboard: Dashboard = {
        id: generateId(),
        builtin: null,
        name: name.trim(),
        icon: '',
        position: (max ?? 0) + 1,
        filter: {},
        sort: { by: 'updated', dir: 'desc' },
        display: DEFAULT_DISPLAY,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      await db.execute(
        `INSERT INTO dashboards (id, builtin, name, icon, position, filter, sort, display, created_at, updated_at)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [dashboard.id, dashboard.name, dashboard.icon, dashboard.position, JSON.stringify(dashboard.filter),
          JSON.stringify(dashboard.sort), JSON.stringify(dashboard.display), now],
      );
      // Only after the write: a dashboard that is not in the database must not show.
      set((s) => ({ dashboards: [...s.dashboards, dashboard] }));
      return dashboard;
    } catch (err) {
      reportSaveError(err, 'dashboards');
      return null;
    }
  },

  updateDashboard: async (id, patch) => {
    const current = get().dashboards.find((d) => d.id === id);
    if (!current) return;
    const next: Dashboard = {
      ...current,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() : current.name,
      // "All entries" shows everything; nothing narrows it.
      filter: current.builtin === 'all' ? {} : (patch.filter ? normalizeFilter(patch.filter) : current.filter),
      updated_at: nowIso(),
    };
    // First in memory: sort and layout buttons answer at once.
    set((s) => ({ dashboards: s.dashboards.map((d) => (d.id === id ? next : d)) }));
    try {
      const db = await getDb();
      await db.execute(
        'UPDATE dashboards SET name=$1, icon=$2, filter=$3, sort=$4, display=$5, updated_at=$6 WHERE id=$7',
        [next.name, next.icon, JSON.stringify(next.filter), JSON.stringify(next.sort), JSON.stringify(next.display), next.updated_at, id],
      );
    } catch (err) {
      // Back to what the database still holds — unless a later change has replaced `next` meanwhile.
      set((s) => ({ dashboards: s.dashboards.map((d) => (d === next ? current : d)) }));
      reportSaveError(err, 'dashboards');
    }
  },

  deleteDashboard: async (id) => {
    const dashboard = get().dashboards.find((d) => d.id === id);
    if (!dashboard || dashboard.builtin === 'all') return false;
    try {
      const db = await getDb();
      await db.execute('UPDATE dashboards SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
      set((s) => ({ dashboards: s.dashboards.filter((d) => d.id !== id) }));
      return true;
    } catch (err) {
      reportSaveError(err, 'dashboards');
      return false;
    }
  },

  restoreDashboard: async (id, { keepPlace = false } = {}) => {
    const db = await getDb();
    if (keepPlace) {
      // Undo right after deleting: its place is still free.
      await db.execute('UPDATE dashboards SET deleted_at=NULL WHERE id=$1', [id]);
    } else {
      // From the trash, back at the end of the rail: its old place may be taken by now.
      await db.execute(
        'UPDATE dashboards SET deleted_at=NULL, position=(SELECT COALESCE(MAX(position), 0) + 1 FROM dashboards WHERE deleted_at IS NULL) WHERE id=$1',
        [id],
      );
    }
    await get().fetchDashboards();
  },

  permanentlyDeleteDashboard: async (id) => {
    const db = await getDb();
    // "All entries" never leaves, even if a row of it reached the trash somehow.
    await db.execute("DELETE FROM dashboards WHERE id=$1 AND deleted_at IS NOT NULL AND (builtin IS NULL OR builtin <> 'all')", [id]);
  },

  reorderDashboards: async (ids) => {
    const before = get().dashboards;
    const byId = new Map(before.map((d) => [d.id, d]));
    const ordered = ids.map((id) => byId.get(id)).filter((d): d is Dashboard => !!d);
    if (ordered.length !== before.length) return;
    const positioned = ordered.map((d, position) => ({ ...d, position }));
    set({ dashboards: positioned });
    try {
      const db = await getDb();
      await db.batch(positioned.map((d) => ['UPDATE dashboards SET position=$1 WHERE id=$2', [d.position, d.id]] as const));
    } catch (err) {
      // Back to the old order — unless a later change has replaced it meanwhile.
      if (get().dashboards === positioned) set({ dashboards: before });
      reportSaveError(err, 'dashboards');
    }
  },
}));

/** A live dashboard by ID — `undefined` if it is deleted or unknown. */
export function dashboardById(dashboards: readonly Dashboard[], id: string | undefined): Dashboard | undefined {
  return id === undefined ? undefined : dashboards.find((d) => d.id === id);
}

/** A live dashboard by ID — "All entries" if it is deleted or unknown, which is what such a page shows. */
export function dashboardOrAll(dashboards: readonly Dashboard[], id: string): Dashboard | undefined {
  return dashboardById(dashboards, id) ?? dashboardById(dashboards, 'all');
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
      // An empty list stays: the dashboard then shows nothing, as in the database.
      return { ...d, filter: { ...d.filter, categories: next } };
    });
    return changed ? { dashboards } : {};
  });
}
