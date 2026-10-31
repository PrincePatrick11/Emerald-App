import type Database from './sqlite';
import { fromRow, type DbRow } from './row';
import { alphabetToJson } from './lexicon';
import type { Language, LexiconEntry } from '../types';

/**
 * The accesses to `languages` and `lexicon_entries` that the store and import
 * share. Here rather than in the store, because `lib/` modules may not import
 * a store — the same pattern as `blockDefinitionRows` and `templateRows`.
 */

/** The next free slot at the end of the list — also past languages in the trash. */
export async function nextLanguageSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM languages');
  return rows[0]?.n ?? 0;
}

/** The next free slot in a language's word list. */
export async function nextEntrySortOrder(db: Database, languageId: string): Promise<number> {
  const rows = await db.select<{ n: number }[]>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM lexicon_entries WHERE language_id=$1',
    [languageId],
  );
  return rows[0]?.n ?? 0;
}

export async function insertLanguageRow(db: Database, language: Language): Promise<void> {
  await db.execute(
    `INSERT INTO languages
       (id, name, icon, alphabet, sort_order, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      language.id, language.name, language.icon, alphabetToJson(language.alphabet),
      language.sort_order, language.created_at, language.updated_at, language.deleted_at,
    ],
  );
}

export async function insertEntryRow(db: Database, entry: LexiconEntry): Promise<void> {
  await db.execute(...insertEntryStatement(entry));
}

/** The INSERT of a word — for `insertEntryRow` and for many at once (`db.batch`). */
export function insertEntryStatement(entry: LexiconEntry): [string, unknown[]] {
  return [
    `INSERT INTO lexicon_entries
       (id, language_id, term, translation, pronunciation, note, sort_order, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.id, entry.language_id, entry.term, entry.translation, entry.pronunciation, entry.note,
      entry.sort_order, entry.created_at, entry.updated_at,
    ],
  ];
}

/** A language by ID — also from the trash, unlike the store, which only holds the active ones. */
export async function languageById(db: Database, id: string): Promise<Language | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM languages WHERE id=$1', [id]);
  return row ? fromRow.language(row) : undefined;
}
