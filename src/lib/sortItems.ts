import type { SortMode } from '../store/uiStore';

interface BaseSortOptions<T> {
  /** ISO-Datumsstring des Items — created_at, updated_at oder deleted_at, je nach Modul. */
  date: (item: T) => string;
  /** Nachrangiges Kriterium bei Gleichstand (Tasks: sort_order). */
  tiebreak?: (a: T, b: T) => number;
  /** Für `count_desc` (Tags: Anzahl Verwendungen). Fehlt er, zählt jedes Item 0. */
  count?: (item: T) => number;
}

/**
 * Der Titel-Getter ist Pflicht, sobald das Item kein Feld `title` hat — die
 * Altar-Bibliothek sortiert nach `name`. Ohne diese Bedingung fiele so ein
 * Aufruf still auf leere Titel zurück, und die Alpha-Modi täten gar nichts.
 */
type TitleOption<T> = 'title' extends keyof T
  ? { title?: (item: T) => string }
  : { title: (item: T) => string };

type SortOptions<T> = BaseSortOptions<T> & TitleOption<T>;

/** Byte-Vergleich für ISO-8601-Strings — sortiert chronologisch, ohne Dates zu bauen. */
const compareIso = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Der eine SortMode-Komparator für alle Dashboards. Gruppiert wird nicht
 *  hier, sondern über die eigene Achse `GroupingMode` — siehe uiStore. */
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
