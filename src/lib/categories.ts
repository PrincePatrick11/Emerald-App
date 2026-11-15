import { CONTENT_MODULE_IDS, type ContentModuleId } from './modules';

/** A translator — `i18n.t`, the `t` from useTranslation or a prop passed down. */
export type Translate = (key: string, options?: { defaultValue?: string }) => string;

export interface LabelableCategory {
  id: string;
  name: string;
  /** Boolean in the stores, 0/1 in a backup row. */
  is_builtin: boolean | number;
}

/**
 * Display name of a category: builtins (`journal`, `sigils`, `altars`) via the
 * locale key `categories.builtin.<id>` — one this version does not know
 * (from a newer backup) by its stored name — all others via the stored name.
 */
export function categoryLabel(
  t: Translate,
  cat: LabelableCategory | null | undefined,
  fallback = '',
): string {
  if (!cat) return fallback;
  return cat.is_builtin ? t(`categories.builtin.${cat.id}`, { defaultValue: cat.name }) : cat.name;
}

/**
 * The categories that appear in a view as chips, groups or tabs:
 * all that at least one entry points to, in the order of the global
 * list. The full list stays for assignment and resolution; a category that
 * is only used in another module should not get an empty header here —
 * not even one just created: it is managed in the
 * categories view and assigned on the entry.
 *
 * Until v39 the catch-all `other` was always included, because every entry had to carry a
 * category and the tab bar needed a target. Entries without a
 * category are now collected by the "Uncategorized" bucket.
 */
export function categoriesUsedBy<C extends { id: string }>(
  all: readonly C[],
  items: readonly { category_id: string | null }[],
): C[] {
  const used = new Set<string>();
  for (const item of items) if (item.category_id) used.add(item.category_id);
  return all.filter((c) => used.has(c.id));
}

/**
 * Lookup with a `category_id` that may be `null`. The result is
 * `undefined` if the entry has no category *or* its category no longer
 * resolves (trash) — the same state for the reader, and `categoryLabel`
 * accepts both.
 */
export function lookupCategory<C>(byId: ReadonlyMap<string, C>, id: string | null | undefined): C | undefined;
export function lookupCategory<C>(byId: Readonly<Record<string, C>>, id: string | null | undefined): C | undefined;
export function lookupCategory<C>(
  byId: ReadonlyMap<string, C> | Readonly<Record<string, C>>,
  id: string | null | undefined,
): C | undefined {
  if (!id) return undefined;
  return byId instanceof Map ? byId.get(id) : (byId as Readonly<Record<string, C>>)[id];
}

/** How often a category is used: by entries and by tasks. */
export type CategoryUsage = Record<ContentModuleId, number>;

/** The lists from which a category's usage is derived. */
export type CategorySources = Record<ContentModuleId, readonly { category_id: string | null }[]>;

export const emptyCategoryUsage = (): CategoryUsage => ({ entries: 0, tasks: 0 });

/**
 * How many entries and tasks point to each category — one pass per list
 * instead of one filter per category. Categories without a single use are
 * missing from the map; `emptyCategoryUsage()` is their fallback value.
 */
export function categoryUsageCounts(sources: CategorySources): Map<string, CategoryUsage> {
  const counts = new Map<string, CategoryUsage>();
  for (const module of CONTENT_MODULE_IDS) {
    for (const item of sources[module]) {
      if (!item.category_id) continue;
      let usage = counts.get(item.category_id);
      if (!usage) counts.set(item.category_id, (usage = emptyCategoryUsage()));
      usage[module] += 1;
    }
  }
  return counts;
}

/**
 * Are there entries without a category? Two cases, the same bucket: the entry
 * carries none at all (`null` — since v39 the normal case for a new one), or its
 * category is in the trash and no longer resolves.
 *
 * These are the ones `groupByCategory` sorts into the "Uncategorized" bucket.
 * The chip list asks here whether the chip is needed at all — the same question
 * as `categoriesUsedBy` next to it, just the other way round.
 */
export function hasUncategorized<C extends { id: string }>(
  all: readonly C[],
  items: readonly { category_id: string | null }[],
): boolean {
  const ids = new Set(all.map((c) => c.id));
  return items.some((item) => !item.category_id || !ids.has(item.category_id));
}

/**
 * The comparison key of a category name. The store and the import check
 * uniqueness with it — an "Herb" and an "herb" are the same category.
 */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}
