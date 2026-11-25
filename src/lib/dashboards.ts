/**
 * Dashboards (table `dashboards`): views over entries by filter rules. One
 * rule for "which entries does a dashboard show" — `matchesFilter` — and
 * everything that follows from it: the lists, and which category a new entry
 * there starts in. An entry has no type of its own and belongs to no
 * dashboard: it opens in whichever dashboard it was clicked in.
 *
 * The filters are evaluated in memory: every entry is in the store anyway,
 * and the lists read only from there. Filters on field values of blocks
 * (`blocks.data`) will need SQL; that translation starts from here.
 *
 * Pure and store-free, like the rest of `lib/` that scripts use.
 */
import type { TFunction } from 'i18next';
import type {
  BuiltinDashboard, Dashboard, DashboardDisplay, DashboardFilter, DashboardSort, Entry,
} from '../types';
import type { SortMode } from '../store/uiStore';
import { asRecord } from './helpers';

const BUILTIN_DASHBOARD_KEYS: readonly BuiltinDashboard[] = ['all', 'journal', 'practice', 'knowledge'];

const DEFAULT_SORT: DashboardSort = { by: 'updated', dir: 'desc' };

/**
 * Only for a `display` that is missing or broken: a fresh vault writes the
 * built-ins' own start values into their rows (`BUILTIN_DASHBOARDS`), and a
 * new dashboard starts with this.
 */
export const DEFAULT_DISPLAY: DashboardDisplay = { view: 'list', grouping: 'flat', info: 'long' };

const DISPLAY_VIEWS: readonly DashboardDisplay['view'][] = ['list', 'cards', 'cards_wide', 'timeline'];

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
  return asRecord(value);
}

/** A filter from JSON (row or backup): unknown keys and non-ID values drop out. */
export function parseDashboardFilter(raw: unknown): DashboardFilter {
  const value = jsonObject(raw);
  // An empty list stays: a rule whose categories or tags are all gone matches
  // nothing — only a filter without the rule shows everything.
  const next: DashboardFilter = {};
  if (Array.isArray(value.categories)) next.categories = idList(value.categories);
  if (Array.isArray(value.tags)) next.tags = idList(value.tags);
  return next;
}

export function parseDashboardSort(raw: unknown): DashboardSort {
  const value = jsonObject(raw);
  const by = value.by === 'created' || value.by === 'title' || value.by === 'updated' ? value.by : DEFAULT_SORT.by;
  const dir = value.dir === 'asc' || value.dir === 'desc' ? value.dir : DEFAULT_SORT.dir;
  return { by, dir };
}

export function parseDashboardDisplay(raw: unknown): DashboardDisplay {
  const value = jsonObject(raw);
  return {
    view: DISPLAY_VIEWS.includes(value.view as DashboardDisplay['view']) ? value.view as DashboardDisplay['view'] : DEFAULT_DISPLAY.view,
    grouping: value.grouping === 'grouped' || value.grouping === 'flat' ? value.grouping : DEFAULT_DISPLAY.grouping,
    info: value.info === 'short' || value.info === 'long' ? value.info : DEFAULT_DISPLAY.info,
  };
}

/** A dashboard's sort; newest first by its date while it has none (a dashboard that is gone). */
export function dashboardSort(dashboard: Pick<Dashboard, 'sort'> | undefined): DashboardSort {
  return dashboard?.sort ?? { by: dashboardDateField(dashboard), dir: 'desc' };
}

/** The toolbar's sort mode for a dashboard's sort: the date modes compare the date the sort names. */
export function sortModeOf(sort: DashboardSort): Exclude<SortMode, 'count_desc' | 'manual'> {
  if (sort.by === 'title') return sort.dir === 'asc' ? 'alpha_asc' : 'alpha_desc';
  return sort.dir === 'asc' ? 'date_asc' : 'date_desc';
}

/**
 * The dashboard's sort for a toolbar sort mode. A date mode keeps the date the
 * dashboard sorts by — `dateField` when it sorted by title until now.
 */
export function sortFromMode(mode: SortMode, current: DashboardSort, dateField: 'created' | 'updated'): DashboardSort {
  if (mode === 'alpha_asc' || mode === 'alpha_desc') return { by: 'title', dir: mode === 'alpha_asc' ? 'asc' : 'desc' };
  return { by: current.by === 'title' ? dateField : current.by, dir: mode === 'date_asc' ? 'asc' : 'desc' };
}

/** The translation key of a built-in dashboard's name, shown while its own `name` is empty. */
const BUILTIN_NAME_KEYS: Record<BuiltinDashboard, string> = {
  all: 'nav.allEntries',
  journal: 'nav.journal',
  practice: 'nav.practice',
  knowledge: 'nav.knowledge',
};

/** The name a dashboard shows: its own, else the built-in's translated name, else "Unnamed dashboard". */
export function dashboardLabel(t: TFunction, dashboard: Pick<Dashboard, 'name' | 'builtin'>): string {
  const name = dashboard.name.trim();
  if (name) return name;
  return t(dashboard.builtin ? BUILTIN_NAME_KEYS[dashboard.builtin] : 'dashboards.unnamed');
}

export function isBuiltinDashboard(value: unknown): value is BuiltinDashboard {
  return (BUILTIN_DASHBOARD_KEYS as readonly unknown[]).includes(value);
}

/** The IDs of the categories and tags that exist (not gone, not in the trash). */
export interface LiveIds {
  categories: ReadonlySet<string>;
  tags: ReadonlySet<string>;
}

/**
 * Does a filter rule have something left to match? A missing rule does not
 * narrow; a rule that names none that still exist (gone, or in the trash)
 * matches nothing.
 */
export function ruleAlive(rule: readonly string[] | undefined, live: ReadonlySet<string>): boolean {
  return !rule || rule.some((id) => live.has(id));
}

/** Can the filter show any entry at all — or are the categories or tags it names all gone? */
export function filterCanMatch(filter: DashboardFilter, live: LiveIds): boolean {
  return ruleAlive(filter.categories, live.categories) && ruleAlive(filter.tags, live.tags);
}

/** The tags an entry carries: its own and those its blocks give it while they are there. */
export function entryTagIds(entry: Pick<Entry, 'tags' | 'block_tags'>): string[] {
  return entry.block_tags?.length ? [...new Set([...entry.tags, ...entry.block_tags])] : entry.tags;
}

/**
 * Does the entry pass the filter? Tags count with those the blocks give
 * (`entryTagIds`). A missing rule does not narrow; a rule that names nothing
 * that still exists (gone, or in the trash — `live` lacks them) matches
 * nothing. Also the export menu's collection (`bulkEntries`).
 */
export function matchesFilter(
  entry: Pick<Entry, 'category_id' | 'tags' | 'block_tags'>,
  filter: DashboardFilter,
  live: LiveIds,
): boolean {
  if (filter.categories) {
    const id = entry.category_id;
    if (id === null || !filter.categories.includes(id) || !live.categories.has(id)) return false;
  }
  if (filter.tags && !entryTagIds(entry).some((tag) => filter.tags!.includes(tag) && live.tags.has(tag))) return false;
  return true;
}

/** The comparison of a sort — ties fall back to the number, so the order is stable. */
function compareEntries(sort: DashboardSort): (a: Entry, b: Entry) => number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const key = sort.by === 'created' ? 'created_at' : sort.by === 'updated' ? 'updated_at' : 'title';
  return (a, b) => sign * a[key].localeCompare(b[key]) || (a.entry_number ?? 0) - (b.entry_number ?? 0);
}

/** The entries a dashboard shows, in its order. */
export function dashboardEntries(
  entries: readonly Entry[],
  dashboard: Pick<Dashboard, 'filter' | 'sort'>,
  live: LiveIds,
): Entry[] {
  return entries.filter((e) => matchesFilter(e, dashboard.filter, live)).sort(compareEntries(dashboard.sort));
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

/**
 * The tag a new entry created in the dashboard starts with: the first of its
 * filter that still exists — `null` if it filters by none. Without it the entry
 * would not pass the tag filter and vanish from the dashboard it was made in.
 */
export function firstTagOf(
  dashboard: Pick<Dashboard, 'filter'> | undefined,
  existing: ReadonlySet<string>,
): string | null {
  return dashboard?.filter.tags?.find((id) => existing.has(id)) ?? null;
}

/**
 * The date a dashboard sorts its entries by — and therefore the one its list,
 * the left list and the entry page's header show: the creation date for a
 * dashboard sorted by it, else "last changed".
 */
export function dashboardDateField(dashboard: Pick<Dashboard, 'sort'> | undefined): 'created' | 'updated' {
  return dashboard?.sort.by === 'created' ? 'created' : 'updated';
}

/** An entry's date under `dashboardDateField`. */
export function entryDateOf(entry: Pick<Entry, 'created_at' | 'updated_at'>, field: 'created' | 'updated'): string {
  return field === 'created' ? entry.created_at : entry.updated_at;
}
