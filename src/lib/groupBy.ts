import type { DashboardGroup } from '../components/ui/Dashboard';
import { formatMonthGroup } from './formatDate';

/**
 * Gruppiert eine vorsortierte Liste in Dashboard-Gruppen. Die Gruppenreihenfolge
 * ist die Reihenfolge des ersten Auftretens — chronologisch also nur, wenn die
 * Liste bereits nach Datum sortiert ist.
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

/** Timeline-Gruppierung nach lokalisiertem Monat („August 2026"). */
export function groupByMonth<T>(items: readonly T[], date: (item: T) => string): DashboardGroup<T>[] {
  return groupBy(items, (item) => formatMonthGroup(date(item)));
}
