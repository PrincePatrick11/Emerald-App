/**
 * Dashboards (table `dashboards`): views over entries by filter rules. One
 * rule for "which entries does a dashboard show" — `matchesFilter` — and
 * everything that follows from it: the lists of Journal, Wiki and
 * Operations, which category a new entry there starts in, and the kind an
 * entry counts as (`entryKindOf`), since an entry has no type of its own.
 *
 * The filters are evaluated in memory: every entry is in the store anyway,
 * and the lists read only from there. Filters on field values of blocks
 * (`blocks.data`) will need SQL; that translation starts from here.
 *
 * Pure and store-free, like the rest of `lib/` that scripts use.
 */
import type {
  BuiltinDashboard, Dashboard, DashboardFilter, DashboardSort, Entry, EntryKind,
} from '../types';

export const BUILTIN_DASHBOARD_KEYS: readonly BuiltinDashboard[] = ['all', 'journal', 'wiki', 'operations'];

/** The built-in dashboards that stand for a module of the rail, with the kind their entries count as. */
export const MODULE_DASHBOARD_KINDS: Readonly<Record<Exclude<BuiltinDashboard, 'all'>, EntryKind>> = {
  journal: 'journal',
  operations: 'operation',
  wiki: 'wiki',
};

/**
 * The kind of an entry that no module dashboard shows — no category, or one
 * that no filter names. It opens in the wiki view until "All entries"
 * becomes a view of its own.
 */
export const FALLBACK_ENTRY_KIND: EntryKind = 'wiki';

const DEFAULT_SORT: DashboardSort = { by: 'updated', dir: 'desc' };

const MAX_FILTER_IDS = 1000;

function idList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.slice(0, MAX_FILTER_IDS).filter((v): v is string => typeof v === 'string' && v !== ''))];
}

function jsonObject(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A filter from JSON (row, backup, sync): unknown keys and non-ID values drop out. */
export function parseDashboardFilter(raw: unknown): DashboardFilter {
  const value = jsonObject(raw);
  const filter: DashboardFilter = {};
  const categories = idList(value.categories);
  if (categories) filter.categories = categories;
  const tags = idList(value.tags);
  if (tags) filter.tags = tags;
  return filter;
}

export function parseDashboardSort(raw: unknown): DashboardSort {
  const value = jsonObject(raw);
  const by = value.by === 'created' || value.by === 'title' || value.by === 'updated' ? value.by : DEFAULT_SORT.by;
  const dir = value.dir === 'asc' || value.dir === 'desc' ? value.dir : DEFAULT_SORT.dir;
  return { by, dir };
}

export function parseDashboardDisplay(raw: unknown): Record<string, unknown> {
  return jsonObject(raw);
}

export function isBuiltinDashboard(value: unknown): value is BuiltinDashboard {
  return (BUILTIN_DASHBOARD_KEYS as readonly unknown[]).includes(value);
}

/** Does the entry pass the filter? A missing rule does not narrow. */
export function matchesFilter(entry: Pick<Entry, 'category_id' | 'tags'>, filter: DashboardFilter): boolean {
  if (filter.categories && !(entry.category_id !== null && filter.categories.includes(entry.category_id))) return false;
  if (filter.tags && filter.tags.length && !entry.tags.some((tag) => filter.tags!.includes(tag))) return false;
  return true;
}

/** The comparison of a sort — ties fall back to the number, so the order is stable. */
export function compareEntries(sort: DashboardSort): (a: Entry, b: Entry) => number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const key = sort.by === 'created' ? 'created_at' : sort.by === 'updated' ? 'updated_at' : 'title';
  return (a, b) => sign * a[key].localeCompare(b[key]) || (a.entry_number ?? 0) - (b.entry_number ?? 0);
}

/** The entries a dashboard shows, in its order. */
export function dashboardEntries(entries: readonly Entry[], dashboard: Pick<Dashboard, 'filter' | 'sort'>): Entry[] {
  return entries.filter((e) => matchesFilter(e, dashboard.filter)).sort(compareEntries(dashboard.sort));
}

/**
 * The category a new entry created in the dashboard starts in: the first of
 * its filter that still exists — `null` if it filters by none.
 */
export function firstCategoryOf(
  dashboard: Pick<Dashboard, 'filter'> | undefined,
  existing: ReadonlySet<string>,
): string | null {
  return dashboard?.filter.categories?.find((id) => existing.has(id)) ?? null;
}

/** The live module dashboards in their order — what `entryKindOf` walks. */
export function moduleDashboards(dashboards: readonly Dashboard[]): Dashboard[] {
  return dashboards
    .filter((d) => d.deleted_at === null && d.builtin !== null && d.builtin !== 'all')
    .sort((a, b) => a.position - b.position);
}

/**
 * The kind an entry counts as: that of the first module dashboard (in the
 * order of the rail) whose filter it passes, otherwise `FALLBACK_ENTRY_KIND`.
 * `modules` is `moduleDashboards(...)`.
 */
export function entryKindOf(entry: Pick<Entry, 'category_id' | 'tags'>, modules: readonly Dashboard[]): EntryKind {
  for (const dashboard of modules) {
    if (dashboard.builtin && dashboard.builtin !== 'all' && matchesFilter(entry, dashboard.filter)) {
      return MODULE_DASHBOARD_KINDS[dashboard.builtin];
    }
  }
  return FALLBACK_ENTRY_KIND;
}

export type EntriesByKind = Record<EntryKind, Entry[]>;

/**
 * Every entry under exactly one kind (`entryKindOf`) — for what lists all
 * entries labelled by module: search, link picker, counts. Order is kept.
 */
export function partitionByKind(entries: readonly Entry[], modules: readonly Dashboard[]): EntriesByKind {
  const byKind: EntriesByKind = { journal: [], wiki: [], operation: [] };
  for (const entry of entries) byKind[entryKindOf(entry, modules)].push(entry);
  return byKind;
}
