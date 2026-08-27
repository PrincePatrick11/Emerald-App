import type { TFunction } from 'i18next';
import { BUILTIN_ALTAR_CATEGORIES } from './schema';

/**
 * Nur Wiki und Operations haben ein `is_builtin`-Flag mit Locale-Keys
 * (`<module>.categories.<id>`). Bewusst nicht `CategoryModuleId` aus
 * lib/modules: das hier ist eine i18n-Eigenschaft zweier Module, kein
 * Modulbegriff.
 */
export type BuiltinLabelModule = 'wiki' | 'operations';

export interface LabelableCategory {
  id: string;
  name: string;
  is_builtin: boolean;
}

/**
 * Anzeigename einer Wiki-/Operations-Kategorie: Builtins über den Locale-Key,
 * eigene über den gespeicherten Namen. Tasks-Kategorien haben keine
 * Builtin-Keys und zeigen direkt `name`; Altar-Kategorien haben zwar Keys
 * (`altar.categories.*`), aber kein `is_builtin`-Flag — die laufen über
 * altarCategoryLabel().
 */
export function categoryLabel(
  t: TFunction,
  module: BuiltinLabelModule,
  cat: LabelableCategory | null | undefined,
  fallback = '',
): string {
  if (!cat) return fallback;
  return cat.is_builtin ? t(`${module}.categories.${cat.id}`) : cat.name;
}

// Die eingebauten Altar-Kategorien liegen mit englischen Seed-Namen in der DB.
// Solange der Nutzer eine davon nicht umbenannt hat, gewinnt die Übersetzung
// aus altar.categories.*; ein eigener Name gewinnt immer.
// (altar_categories hat keine is_builtin-Spalte, deshalb der Namensvergleich.)
const ALTAR_SEED_NAMES = new Map(BUILTIN_ALTAR_CATEGORIES.map(([id, name]) => [id, name]));

/** Anzeigename einer Altar-Kategorie — Gegenstück zu categoryLabel() für Module ohne is_builtin. */
export function altarCategoryLabel(t: TFunction, cat: { id: string; name: string }): string {
  return ALTAR_SEED_NAMES.get(cat.id) === cat.name ? t(`altar.categories.${cat.id}`) : cat.name;
}
