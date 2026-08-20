import { BUILTIN_WIKI_CATEGORIES } from '../../lib/schema';

/**
 * Ersatz-Emoji für eine eingebaute Wiki-Kategorie, wenn deren Zeile gerade nicht
 * zur Hand ist. Wird aus `schema.ts` abgeleitet, damit die Liste nicht wie ihre
 * Vorgängerin hinter dem Seeding zurückbleibt.
 */
const BUILTIN_CATEGORY_EMOJI: Record<string, string> = Object.fromEntries(
  BUILTIN_WIKI_CATEGORIES.map(([id, , emoji]) => [id, emoji]),
);

export function getCategoryEmoji(category: string): string {
  return BUILTIN_CATEGORY_EMOJI[category] ?? '📄';
}
