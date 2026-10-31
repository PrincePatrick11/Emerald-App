import { CATEGORY_MODULE_IDS, type CategoryModuleId } from './modules';
import { LEGACY_ALTAR_CATEGORIES, LEGACY_WIKI_CATEGORIES } from './schemaV37';

/** A translator — `i18n.t`, the `t` from useTranslation or a prop passed down. */
export type Translate = (key: string) => string;

export interface LabelableCategory {
  id: string;
  name: string;
  is_builtin: boolean;
}

/**
 * Display name of a category: builtins (`other`, `sigils`) via the
 * locale key `categories.builtin.<id>`, all others via the stored
 * name. Since v38 the one rule for all four modules.
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

/** The four entry lists from which a category's usage is derived. */
export type CategorySources = Record<CategoryModuleId, readonly { category_id: string | null }[]>;

export const emptyCategoryUsage = (): CategoryUsage => ({ wiki: 0, operations: 0, tasks: 0, altar: 0 });

/**
 * How many entries per module point to each category — one pass per
 * list instead of one filter per category. Categories without a single
 * entry are missing from the map; `emptyCategoryUsage()` is their fallback value.
 *
 * One truth for the categories view (shows all four numbers) and the
 * global search (takes only the largest of them). Otherwise a fifth
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

// ─────────────────────────────────────────────────────────────────────────────
// Before v38: categories per module with module-specific locale keys. Needed by
// migrations v36–v38, which run on old vaults before the merge,
// and by the lifting of old backups and `.emerald` files. The keys
// `wiki.categories.*`, `operations.categories.*`, `altar.categories.*`
// stay in the locales for exactly that.
// ─────────────────────────────────────────────────────────────────────────────

export type LegacyCategoryTable =
  | 'wiki_categories'
  | 'operation_categories'
  | 'task_categories'
  | 'altar_categories';

const LEGACY_LABEL_MODULE: Record<LegacyCategoryTable, string | null> = {
  wiki_categories: 'wiki',
  operation_categories: 'operations',
  task_categories: null,
  altar_categories: 'altar',
};

/** Locale key of a built-in category from before v38 — null where there was none (tasks). */
export function legacyBuiltinLabelKey(table: LegacyCategoryTable, id: string): string | null {
  const module = LEGACY_LABEL_MODULE[table];
  return module ? `${module}.categories.${id}` : null;
}

const LEGACY_ALTAR_SEED_NAMES = new Map(LEGACY_ALTAR_CATEGORIES.map(([id, name]) => [id, name]));

/**
 * The display name a category had up to v38: builtins via their
 * locale key in the current app language (v36 chose the same way),
 * custom ones via the stored name. Altar builtins carry no flag — there
 * it matters whether the seed name still stands unchanged. One rule for migration
 * v38 and the lifting of old backups, so both end up with the same name.
 */
export function legacyDisplayName(
  i18n: { t: Translate; exists: (key: string) => boolean },
  table: LegacyCategoryTable,
  row: { id: string; name: string; is_builtin?: number | boolean | null },
): string {
  const builtin = table === 'altar_categories'
    ? LEGACY_ALTAR_SEED_NAMES.get(row.id) === row.name
    : !!row.is_builtin;
  if (!builtin) return row.name;
  const key = legacyBuiltinLabelKey(table, row.id);
  return key && i18n.exists(key) ? i18n.t(key) : row.name;
}

/** Display name of a wiki/operations category in the pre-v38 schema. */
export function legacyCategoryLabel(
  t: Translate,
  module: 'wiki' | 'operations',
  cat: LabelableCategory | null | undefined,
  fallback = '',
): string {
  if (!cat) return fallback;
  return cat.is_builtin ? t(`${module}.categories.${cat.id}`) : cat.name;
}

const LEGACY_WIKI_EMOJI = new Map(LEGACY_WIKI_CATEGORIES.map(([id, , emoji]) => [id, emoji]));

/** Emoji of a built-in wiki category from before v38, when its row is not at hand. */
export function legacyWikiCategoryEmoji(id: string): string {
  return LEGACY_WIKI_EMOJI.get(id) ?? '📄';
}
