/**
 * Legt Kategorien aus mehreren Quellen zu einer Liste zusammen — die eine
 * Regel dafür, wie aus den vier Modul-Tabellen von vor v38 die globale
 * `categories`-Tabelle wird. Drei Aufrufer teilen sie sich: die Migration v38,
 * der Baseline-Seed frischer Vaults (Builtins + Starter-Set) und das Heben
 * alter Sicherungen in `dbBackup.migrateBackupPayload`.
 *
 * Bewusst pur: kein Tauri, kein React, keine i18n. Namen kommen hier schon
 * übersetzt an — wer eine eingebaute Kategorie von früher einspeist, hat sie
 * vorher über ihren Locale-Key aufgelöst (siehe `legacyBuiltinLabelKey`).
 */
import { FALLBACK_CATEGORY_ID, SIGIL_CATEGORY_ID, BUILTIN_CATEGORIES, type CategorySeedRow } from './schema';

export interface CategorySourceRow {
  id: string;
  name: string;
  emoji: string;
  deleted_at?: string | null;
}

export interface CategorySource {
  /** Präfix im idMap-Schlüssel — eine der vier Legacy-Tabellen (`wiki_categories` …) oder `starter`. */
  table: string;
  /** In Anzeigereihenfolge — sie wird zur Reihenfolge der Ergebnisliste. */
  rows: CategorySourceRow[];
}

export type MergedCategory = CategorySeedRow;

export interface MergeOptions {
  /** Anzeigename der beiden Builtins in der aktuellen Sprache — eine gleichnamige eigene Kategorie geht darin auf. */
  builtinName: (id: typeof FALLBACK_CATEGORY_ID | typeof SIGIL_CATEGORY_ID) => string;
  /** Meldet jedes Paar, das zusammengelegt wurde. */
  log?: (message: string) => void;
}

export interface MergeResult {
  rows: MergedCategory[];
  /** `${table}:${oldId}` → ID in `rows`. Enthält jede Quellzeile, auch die, die ihre ID behielt. */
  idMap: Map<string, string>;
}

/**
 * Vergleichsschlüssel für Kategorienamen: getrimmt und kleingeschrieben. Auch
 * der Store und der Import prüfen Eindeutigkeit damit — ein „Kraut" und ein
 * „kraut" sind dieselbe Kategorie.
 */
export function categoryKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Ob eine Quellzeile das Sammelbecken meint: `other` in jeder Tabelle, `general` bei Tasks. */
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
  for (const [id, name, emoji] of BUILTIN_CATEGORIES) {
    builtin.set(id, register({
      id, name, emoji, sort_order: 0, is_builtin: true, deleted_at: null,
    }));
    // Der Schlüssel läuft über den *übersetzten* Namen: Was der Nutzer als
    // „Sonstiges" angelegt hat, ist dasselbe wie das eingebaute Sonstiges.
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
        // Aktiv gewinnt: eine noch benutzte Kategorie darf durch das
        // Zusammenlegen nicht im Papierkorb landen.
        if (!row.deleted_at) target.deleted_at = null;
        else if (target.deleted_at && row.deleted_at > target.deleted_at) target.deleted_at = row.deleted_at;
        continue;
      }

      // Eigene Zeile. Die ID bleibt, solange sie nicht schon einer anderen
      // Kategorie gehört — dann gibt es eine frische, und die Inhalte werden
      // über idMap umgehängt.
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

  // Sigillen vorn, Sonstiges hinten, alles andere in Einspeisereihenfolge.
  const rows = [
    builtin.get(SIGIL_CATEGORY_ID)!,
    ...order.filter((r) => !r.is_builtin),
    builtin.get(FALLBACK_CATEGORY_ID)!,
  ].map((row, i) => ({ ...row, sort_order: i }));

  return { rows, idMap };
}
