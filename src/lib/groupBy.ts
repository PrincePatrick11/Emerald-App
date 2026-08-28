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

/** Gruppenschlüssel des Waisen-Buckets — nie als Kategorie-id vergeben. */
export const UNCATEGORIZED_KEY = '__uncategorized__';

/**
 * Kategorie-Gruppierung mit Waisen-Bucket: eine Gruppe je Kategorie (auch
 * leere), dahinter — nur wenn nötig — „Ohne Kategorie" für Einträge, deren
 * Kategorie im Papierkorb liegt. Kategorien behalten ihre Reihenfolge, die
 * Einträge die der übergebenen (vorsortierten) Liste.
 *
 * `forceUncategorized` erzwingt den Waisen-Bucket auch leer — für den Fall,
 * dass der „Ohne Kategorie"-Filterchip ausgewählt ist: dann soll sein Kopf
 * mit Leer-Hinweis erscheinen, wie bei jeder anderen leeren Kategorie.
 */
export function groupByCategory<T, C extends { id: string }>(
  items: readonly T[],
  categories: readonly C[],
  categoryId: (item: T) => string,
  label: (cat: C) => string,
  uncategorizedLabel: string,
  forceUncategorized = false,
): DashboardGroup<T>[] {
  const groups: DashboardGroup<T>[] = categories.map((cat) => ({
    key: cat.id,
    label: label(cat),
    items: items.filter((item) => categoryId(item) === cat.id),
  }));
  const orphans = items.filter((item) => !categories.some((c) => c.id === categoryId(item)));
  if (orphans.length > 0 || forceUncategorized) {
    groups.push({ key: UNCATEGORIZED_KEY, label: uncategorizedLabel, items: orphans });
  }
  return groups;
}
