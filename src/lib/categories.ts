import { CATEGORY_MODULE_IDS, type CategoryModuleId } from './modules';
import { LEGACY_ALTAR_CATEGORIES, LEGACY_WIKI_CATEGORIES } from './schemaV37';

/** Ein Übersetzer — `i18n.t`, das `t` aus useTranslation oder ein durchgereichtes Prop. */
export type Translate = (key: string) => string;

export interface LabelableCategory {
  id: string;
  name: string;
  is_builtin: boolean;
}

/**
 * Anzeigename einer Kategorie: Builtins (`other`, `sigils`) über den
 * Locale-Key `categories.builtin.<id>`, alle anderen über den gespeicherten
 * Namen. Seit v38 die eine Regel für alle vier Module.
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
 * Die Kategorien, die in einer Ansicht als Chips, Gruppen oder Tabs stehen:
 * alle, auf die mindestens ein Eintrag zeigt, in der Reihenfolge der globalen
 * Liste. Die Volliste bleibt für Zuweisung und Auflösung; eine Kategorie, die
 * nur in einem anderen Modul benutzt wird, soll hier keinen leeren Kopf
 * bekommen — auch eine gerade angelegte nicht: verwaltet wird in der
 * Kategorien-Ansicht, zugewiesen am Eintrag.
 *
 * Bis v39 war das Sammelbecken `other` immer dabei, weil jeder Eintrag eine
 * Kategorie tragen musste und die Tab-Leiste ein Ziel brauchte. Einträge ohne
 * Kategorie sammelt jetzt der „Ohne Kategorie"-Bucket.
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
 * Nachschlagen mit einer `category_id`, die `null` sein darf. Ergebnis ist
 * `undefined`, wenn der Eintrag keine Kategorie hat *oder* seine nicht mehr
 * auflöst (Papierkorb) — für den Leser derselbe Zustand, und `categoryLabel`
 * nimmt beides entgegen.
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

/** Wie oft eine Kategorie je Modul benutzt wird. */
export type CategoryUsage = Record<CategoryModuleId, number>;

/** Die vier Eintragslisten, aus denen sich die Nutzung einer Kategorie ergibt. */
export type CategorySources = Record<CategoryModuleId, readonly { category_id: string | null }[]>;

export const emptyCategoryUsage = (): CategoryUsage => ({ wiki: 0, operations: 0, tasks: 0, altar: 0 });

/**
 * Wie viele Einträge je Modul auf jede Kategorie zeigen — ein Durchlauf je
 * Liste statt einer Filterung je Kategorie. Kategorien ohne einen einzigen
 * Eintrag fehlen in der Map; `emptyCategoryUsage()` ist ihr Ersatzwert.
 *
 * Eine Wahrheit für die Kategorien-Ansicht (zeigt alle vier Zahlen) und die
 * globale Suche (nimmt nur die größte davon). Sonst gäbe ein fünftes
 * kategorisiertes Modul zwei Stellen zu pflegen, und beide widersprächen sich
 * über dieselbe Kategorie.
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
 * Das Modul, das eine Kategorie am meisten benutzt — undefined, wenn keines.
 * Bei Gleichstand gewinnt das in `ENTRY_MODULE_IDS` frühere.
 */
export function dominantCategoryModule(usage: CategoryUsage | undefined): CategoryModuleId | undefined {
  if (!usage) return undefined;
  return CATEGORY_MODULE_IDS.reduce((best, id) => (usage[id] > usage[best] ? id : best));
}

/**
 * Gibt es Einträge ohne Kategorie? Zwei Fälle, derselbe Bucket: Der Eintrag
 * trägt gar keine (`null` — seit v39 der Normalfall eines neuen), oder seine
 * Kategorie liegt im Papierkorb und löst nicht mehr auf.
 *
 * Das sind die, die `groupByCategory` in den „Ohne Kategorie"-Bucket sortiert.
 * Die Chip-Liste fragt hier, ob es den Chip überhaupt braucht — dieselbe Frage
 * wie `categoriesUsedBy` daneben, nur andersherum.
 */
export function hasUncategorized<C extends { id: string }>(
  all: readonly C[],
  items: readonly { category_id: string | null }[],
): boolean {
  const ids = new Set(all.map((c) => c.id));
  return items.some((item) => !item.category_id || !ids.has(item.category_id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Vor v38: Kategorien je Modul mit modulbezogenen Locale-Keys. Gebraucht von
// den Migrationen v36–v38, die auf alten Vaults vor dem Zusammenlegen laufen,
// und vom Heben alter Sicherungen und `.emerald`-Dateien. Die Keys
// `wiki.categories.*`, `operations.categories.*`, `altar.categories.*`
// bleiben genau dafür in den Locales.
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

/** Locale-Key einer eingebauten Kategorie von vor v38 — null, wo es keine gab (Tasks). */
export function legacyBuiltinLabelKey(table: LegacyCategoryTable, id: string): string | null {
  const module = LEGACY_LABEL_MODULE[table];
  return module ? `${module}.categories.${id}` : null;
}

const LEGACY_ALTAR_SEED_NAMES = new Map(LEGACY_ALTAR_CATEGORIES.map(([id, name]) => [id, name]));

/**
 * Der Anzeigename, den eine Kategorie bis v38 hatte: Builtins über ihren
 * Locale-Key in der aktuellen App-Sprache (v36 hat denselben Weg gewählt),
 * eigene über den gespeicherten Namen. Altar-Builtins tragen kein Flag — dort
 * zählt, ob der Seed-Name noch unverändert dasteht. Eine Regel für Migration
 * v38 und das Heben alter Sicherungen, damit beide beim selben Namen landen.
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

/** Anzeigename einer Wiki-/Operations-Kategorie im Schema von vor v38. */
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

/** Emoji einer eingebauten Wiki-Kategorie von vor v38, wenn ihre Zeile nicht zur Hand ist. */
export function legacyWikiCategoryEmoji(id: string): string {
  return LEGACY_WIKI_EMOJI.get(id) ?? '📄';
}
