/**
 * Merges categories from several sources into one list — the one
 * rule for how the four pre-v38 module tables become the global
 * `categories` table. Three callers share it: migration v38,
 * the baseline seed of fresh vaults (builtins + starter set) and the lifting
 * of old backups in `dbBackup.migrateBackupPayload`.
 *
 * Deliberately pure: no Tauri, no React, no i18n. Names arrive here already
 * translated — whoever feeds in an old built-in category has resolved it
 * beforehand via its locale key (see `legacyBuiltinLabelKey`).
 */
import { FALLBACK_CATEGORY_ID, SIGIL_CATEGORY_ID, type CategorySeedRow } from './schema';

/**
 * The two builtins as v38 knew them — frozen instead of read from
 * `BUILTIN_CATEGORIES`.
 *
 * v39 took the special status away from `other`; the constant in `schema.ts`
 * therefore no longer lists it. This file, however, only converts data from
 * *before* v38, and there it was built in: an upgrading vault must first
 * reach the same state that v38 always produced, so that v39 afterwards
 * demotes it like any other. If the list followed along here, the
 * upgrade would lose the merging of the four modules' "Other" into one row.
 */
const PRE_V39_BUILTINS: readonly [string, string, string][] = [
  [SIGIL_CATEGORY_ID, 'Sigils', '🔯'],
  [FALLBACK_CATEGORY_ID, 'Other', '📦'],
];

export interface CategorySourceRow {
  id: string;
  name: string;
  emoji: string;
  deleted_at?: string | null;
}

export interface CategorySource {
  /** Prefix in the idMap key — one of the four legacy tables (`wiki_categories` …) or `starter`. */
  table: string;
  /** In display order — it becomes the order of the result list. */
  rows: CategorySourceRow[];
}

export type MergedCategory = CategorySeedRow;

export interface MergeOptions {
  /** Display name of the two builtins in the current language — a custom category of the same name is merged into it. */
  builtinName: (id: typeof FALLBACK_CATEGORY_ID | typeof SIGIL_CATEGORY_ID) => string;
  /** Reports each pair that was merged. */
  log?: (message: string) => void;
}

export interface MergeResult {
  rows: MergedCategory[];
  /** `${table}:${oldId}` → ID in `rows`. Contains every source row, including those that kept their ID. */
  idMap: Map<string, string>;
}

/**
 * Comparison key for category names: trimmed and lowercased. The store
 * and the import also check uniqueness with it — an "Herb" and an
 * "herb" are the same category.
 */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether a source row means the catch-all: `other` in every table, `general` for tasks. */
function isFallbackRow(table: string, id: string): boolean {
  return id === FALLBACK_CATEGORY_ID || (id === 'general' && table === 'task_categories');
}

export function mergeCategoryRows(sources: CategorySource[], opts: MergeOptions): MergeResult {
  const byKey = new Map<string, MergedCategory>();
  const byId = new Map<string, MergedCategory>();
  const idMap = new Map<string, string>();
  const order: MergedCategory[] = [];

  const register = (row: MergedCategory): MergedCategory => {
    byKey.set(categoryKey(row.name), row);
    byId.set(row.id, row);
    order.push(row);
    return row;
  };

  const builtin = new Map<string, MergedCategory>();
  for (const [id, name, emoji] of PRE_V39_BUILTINS) {
    builtin.set(id, register({
      id, name, emoji, sort_order: 0, is_builtin: true, deleted_at: null,
    }));
    // The key goes through the *translated* name: what the user created as
    // "Other" is the same as the built-in Other.
    byKey.set(categoryKey(opts.builtinName(id as typeof FALLBACK_CATEGORY_ID)), builtin.get(id)!);
  }

  for (const source of sources) {
    for (const row of source.rows) {
      const mapKey = `${source.table}:${row.id}`;

      let target: MergedCategory | undefined;
      if (isFallbackRow(source.table, row.id)) {
        target = builtin.get(FALLBACK_CATEGORY_ID);
      } else if (row.id === SIGIL_CATEGORY_ID && source.table === 'operation_categories') {
        target = builtin.get(SIGIL_CATEGORY_ID);
      } else {
        target = byKey.get(categoryKey(row.name));
      }

      if (target) {
        idMap.set(mapKey, target.id);
        if (target.id !== row.id) {
          opts.log?.(`Kategorie „${row.name}" (${mapKey}) geht in „${target.name}" (${target.id}) auf`);
        }
        // Active wins: a category still in use must not end up in the trash
        // through the merge.
        if (!row.deleted_at) target.deleted_at = null;
        else if (target.deleted_at && row.deleted_at > target.deleted_at) target.deleted_at = row.deleted_at;
        continue;
      }

      // A row of its own. The ID stays unless it already belongs to another
      // category — then a fresh one is made, and the contents are re-pointed
      // via idMap.
      const id = byId.has(row.id) ? crypto.randomUUID() : row.id;
      register({
        id,
        name: row.name.trim(),
        emoji: row.emoji,
        sort_order: 0,
        is_builtin: false,
        deleted_at: row.deleted_at ?? null,
      });
      idMap.set(mapKey, id);
    }
  }

  // Sigils first, Other last, everything else in feed-in order.
  const rows = [
    builtin.get(SIGIL_CATEGORY_ID)!,
    ...order.filter((r) => !r.is_builtin),
    builtin.get(FALLBACK_CATEGORY_ID)!,
  ].map((row, i) => ({ ...row, sort_order: i }));

  return { rows, idMap };
}
