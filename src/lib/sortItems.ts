import type { SortMode } from '../store/uiStore';

interface BaseSortOptions<T> {
  /** ISO date string of the item — created_at, updated_at or deleted_at, depending on the module. */
  date: (item: T) => string;
  /** Secondary criterion on a tie (tags: name). */
  tiebreak?: (a: T, b: T) => number;
  /** For `count_desc` (tags: number of uses). If missing, every item counts as 0. */
  count?: (item: T) => number;
}

/**
 * The title getter is mandatory as soon as the item has no `title` field — the
 * altar library sorts by `name`. Without this condition such a call would
 * silently fall back to empty titles, and the alpha modes would do nothing at all.
 */
type TitleOption<T> = 'title' extends keyof T
  ? { title?: (item: T) => string }
  : { title: (item: T) => string };

type SortOptions<T> = BaseSortOptions<T> & TitleOption<T>;

/** Byte comparison for ISO 8601 strings — sorts chronologically without building Dates. */
const compareIso = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The one SortMode comparator for all dashboards. Grouping is not done
 *  here, but via its own axis `GroupingMode` — see uiStore. */
export function sortItems<T extends object>(
  items: readonly T[],
  sort: SortMode,
  opts: SortOptions<T>,
): T[] {
  const title = opts.title ?? ((item: T) => (item as { title?: string }).title ?? '');
  const compare = (a: T, b: T): number => {
    if (sort === 'alpha_asc') return title(a).localeCompare(title(b));
    if (sort === 'alpha_desc') return title(b).localeCompare(title(a));
    if (sort === 'date_asc') return compareIso(opts.date(a), opts.date(b));
    if (sort === 'count_desc') return (opts.count?.(b) ?? 0) - (opts.count?.(a) ?? 0);
    return compareIso(opts.date(b), opts.date(a)); // date_desc
  };
  const { tiebreak } = opts;
  return [...items].sort(tiebreak ? (a, b) => compare(a, b) || tiebreak(a, b) : compare);
}
