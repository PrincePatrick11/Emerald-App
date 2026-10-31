import type { DashboardGroup } from '../components/ui/Dashboard';
import { formatMonthGroup } from './formatDate';

/**
 * Groups a presorted list into dashboard groups. The group order
 * is the order of first appearance — so chronological only if the
 * list is already sorted by date.
 */
export function groupBy<T>(items: readonly T[], keyFn: (item: T) => string): DashboardGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries()).map(([label, groupItems]) => ({ label, items: groupItems }));
}

/** Timeline grouping by localized month ("August 2026"). */
export function groupByMonth<T>(items: readonly T[], date: (item: T) => string): DashboardGroup<T>[] {
  // The timeline goes by date, however the list is otherwise sorted:
  // ascending if it already is, otherwise newest first. Name or
  // count would otherwise jumble the months.
  const ascending = items.every((item, i) => i === 0 || date(items[i - 1]) <= date(item));
  const ordered = ascending ? items : [...items].sort((a, b) => (date(a) < date(b) ? 1 : date(a) > date(b) ? -1 : 0));
  return groupBy(ordered, (item) => formatMonthGroup(date(item)));
}

/** Group key of the orphan bucket — never assigned as a category id. */
export const UNCATEGORIZED_KEY = '__uncategorized__';

/** How many entries per key — the counts of the filter list. */
export function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Counts per category, with the same orphan rule as `groupByCategory`:
 * no category, or one that `known` does not (or no longer) recognize, counts under
 * `UNCATEGORIZED_KEY`.
 */
export function countByCategory<T>(
  items: readonly T[],
  known: (id: string) => boolean,
  categoryId: (item: T) => string | null,
): Map<string, number> {
  return countBy(items, (item) => {
    const id = categoryId(item);
    return id && known(id) ? id : UNCATEGORIZED_KEY;
  });
}

/**
 * Category grouping with an orphan bucket: one group per category, followed
 * — only if needed — by "No category" for entries whose category is in the
 * trash. Categories keep their order, the entries that of the
 * passed-in (presorted) list.
 *
 * Empty groups are still produced here; the dashboard drops them when
 * rendering.
 */
export function groupByCategory<T, C extends { id: string }>(
  items: readonly T[],
  categories: readonly C[],
  categoryId: (item: T) => string | null,
  label: (cat: C) => string,
  uncategorizedLabel: string,
): DashboardGroup<T>[] {
  const groups: DashboardGroup<T>[] = categories.map((cat) => ({
    key: cat.id,
    label: label(cat),
    items: items.filter((item) => categoryId(item) === cat.id),
  }));
  // Without a category (null) or with one that is in the trash — both
  // end up in the same bucket, because to the reader they are the same.
  const orphans = items.filter((item) => {
    const id = categoryId(item);
    return !id || !categories.some((c) => c.id === id);
  });
  if (orphans.length > 0) {
    groups.push({ key: UNCATEGORIZED_KEY, label: uncategorizedLabel, items: orphans });
  }
  return groups;
}
