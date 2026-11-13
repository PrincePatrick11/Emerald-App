import { CATEGORY_MODULE_IDS, type CategoryModuleId } from './modules';

/** A translator — `i18n.t`, the `t` from useTranslation or a prop passed down. */
export type Translate = (key: string) => string;

export interface LabelableCategory {
  id: string;
  name: string;
  is_builtin: boolean;
}

/**
 * Display name of a category: builtins (`sigils`, `altars`) via the
 * locale key `categories.builtin.<id>`, all others via the stored
 * name.
 */
export function categoryLabel(
  t: Translate,
  cat: LabelableCategory | null | undefined,
  fallback = '',
): string {
  if (!cat) return fallback;
  return cat.is_builtin ? t(`categories.builtin.${cat.id}`) : cat.name;
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

/** How often a category is used per module. */
export type CategoryUsage = Record<CategoryModuleId, number>;

/** The entry lists from which a category's usage is derived. */
export type CategorySources = Record<CategoryModuleId, readonly { category_id: string | null }[]>;

export const emptyCategoryUsage = (): CategoryUsage => ({ wiki: 0, operations: 0, tasks: 0 });

/**
 * How many entries per module point to each category — one pass per
 * list instead of one filter per category. Categories without a single
 * entry are missing from the map; `emptyCategoryUsage()` is their fallback value.
 *
 * One truth for the categories view (shows all three numbers) and the
 * global search (takes only the largest of them). Otherwise a fourth
 * categorized module would leave two places to maintain, and the two would contradict each other
 * about the same category.
 */
export function categoryUsageCounts(sources: CategorySources): Map<string, CategoryUsage> {
  const counts = new Map<string, CategoryUsage>();
  for (const module of CATEGORY_MODULE_IDS) {
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
 * The module that uses a category the most — undefined if none does.
 * On a tie the one earlier in `ENTRY_MODULE_IDS` wins.
 */
export function dominantCategoryModule(usage: CategoryUsage | undefined): CategoryModuleId | undefined {
  if (!usage) return undefined;
  return CATEGORY_MODULE_IDS.reduce((best, id) => (usage[id] > usage[best] ? id : best));
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
