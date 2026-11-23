import type Database from './sqlite';
import { fromRow, type DbRow } from './row';
import { WORD_FIELDS, alphabetToJson, isEmptyWord, type WordDraft } from './lexicon';
import { stampFor } from './stamp';
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

/** The INSERT of a word, for `db.batch`. */
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

/**
 * What "Done" on a language page writes for its word list, worked out against
 * the words of the language as stored (`stored`): a draft word with an unknown
 * id is inserted at the end (`firstOrder` onwards), a changed one updated, an
 * empty one dropped. Only ids in `removable` — the words the page started
 * with — are ever deleted: a word that arrived since (a merge import) is not
 * the user's to lose just because their draft never saw it.
 */
export function wordChanges({ languageId, stored, words, removable, firstOrder, now }: {
  languageId: string;
  stored: readonly LexiconEntry[];
  words: readonly WordDraft[];
  removable: ReadonlySet<string>;
  firstOrder: number;
  now: string;
}): { statements: [string, unknown[]][]; changed: LexiconEntry[]; added: LexiconEntry[]; removed: Set<string> } {
  const byId = new Map(stored.map((e) => [e.id, e]));
  const kept = words.filter((word) => !isEmptyWord(word));
  const keptIds = new Set(kept.map((word) => word.id));
  const statements: [string, unknown[]][] = [];
  const changed: LexiconEntry[] = [];
  const added: LexiconEntry[] = [];
  let order = firstOrder;
  for (const word of kept) {
    const before = byId.get(word.id);
    if (!before) {
      const entry: LexiconEntry = { ...word, language_id: languageId, sort_order: order++, created_at: now, updated_at: now };
      statements.push(insertEntryStatement(entry));
      added.push(entry);
    } else if (WORD_FIELDS.some((key) => word[key] !== before[key])) {
      const entry: LexiconEntry = { ...before, ...word, updated_at: stampFor(before.updated_at) };
      statements.push([
        'UPDATE lexicon_entries SET term=$1, translation=$2, pronunciation=$3, note=$4, updated_at=$5 WHERE id=$6',
        [entry.term, entry.translation, entry.pronunciation, entry.note, entry.updated_at, entry.id],
      ]);
      changed.push(entry);
    }
  }
  const removed = new Set([...byId.keys()].filter((id) => removable.has(id) && !keptIds.has(id)));
  for (const id of removed) statements.push(['DELETE FROM lexicon_entries WHERE id=$1', [id]]);
  return { statements, changed, added, removed };
}

/** A language by ID — also from the trash, unlike the store, which only holds the active ones. */
export async function languageById(db: Database, id: string): Promise<Language | undefined> {
  const [row] = await db.select<DbRow[]>('SELECT * FROM languages WHERE id=$1', [id]);
  return row ? fromRow.language(row) : undefined;
}
