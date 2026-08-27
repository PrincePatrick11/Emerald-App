import type { SortMode } from '../store/uiStore';

interface SortOptions<T> {
  /** ISO-Datumsstring des Items — created_at, updated_at oder deleted_at, je nach Modul. */
  date: (item: T) => string;
  /** Default: `item.title ?? ''`. */
  title?: (item: T) => string;
  /** Anzeigename für 'category'. Fehlt er, fällt 'category' auf date_desc zurück (Altar, Trash, Home). */
  category?: (item: T) => string;
  /** Nachrangiges Kriterium bei Gleichstand (Tasks: sort_order). */
  tiebreak?: (a: T, b: T) => number;
}

/** Byte-Vergleich für ISO-8601-Strings — sortiert chronologisch, ohne Dates zu bauen. */
const compareIso = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Der eine SortMode-Komparator für alle Dashboards. */
export function sortItems<T extends { title?: string }>(
  items: readonly T[],
  sort: SortMode,
  opts: SortOptions<T>,
): T[] {
  const title = opts.title ?? ((item: T) => item.title ?? '');
  const compare = (a: T, b: T): number => {
    if (sort === 'alpha_asc') return title(a).localeCompare(title(b));
    if (sort === 'alpha_desc') return title(b).localeCompare(title(a));
    if (sort === 'category' && opts.category) return opts.category(a).localeCompare(opts.category(b));
    if (sort === 'date_asc') return compareIso(opts.date(a), opts.date(b));
    return compareIso(opts.date(b), opts.date(a)); // date_desc (+ 'category' ohne Getter)
  };
  const { tiebreak } = opts;
  return [...items].sort(tiebreak ? (a, b) => compare(a, b) || tiebreak(a, b) : compare);
}
