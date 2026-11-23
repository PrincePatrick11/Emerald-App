/**
 * The lexicon: the languages (table `languages`) and their vocabulary
 * (`lexicon_entries`). One store for both, because the vocabulary is nothing
 * without its language and every view always needs both — the dashboard
 * counts them, the language page lists them, the translate field reads them.
 *
 * Saving happens with "Done" on the language page, like an entry: the page
 * edits a draft (`useLanguageDraftStore`) of name, icon, alphabet and words,
 * and `saveLanguage` writes what changed in one go.
 *
 * Deleting: a language moves to the trash (soft delete, its vocabulary
 * stays attached to it and comes back with it).
 *
 * Import rule as in `blockDefinitionStore`: no content stores.
 */
import { create } from 'zustand';
import type Database from '../lib/sqlite';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor } from '../lib/stamp';
import { fromRow, type DbRow } from '../lib/row';
import { serialized, serialKey } from '../lib/serialize';
import { DEFAULT_LANGUAGE_ICON, alphabetToJson, isFilledPair, type LanguageDraft } from '../lib/lexicon';
import {
  insertEntryStatement, insertLanguageRow, languageById, nextEntrySortOrder, nextLanguageSortOrder, wordChanges,
} from '../lib/lexiconRows';
import i18n from '../i18n';
import type { Language, LexiconEntry } from '../types';

type LanguagePatch = Partial<Pick<Language, 'name' | 'icon' | 'alphabet'>>;

interface LexiconState {
  /** Active languages in display order. */
  languages: Language[];
  /** The vocabulary of all languages — the views filter themselves (`entriesOfLanguage`). */
  entries: LexiconEntry[];

  fetchLexicon: () => Promise<void>;
  createLanguage: (name: string, init?: Omit<LanguagePatch, 'name'>) => Promise<Language>;
  /**
   * "Done" on the language page: writes the changed parts of its draft in one
   * batch. With `words`: new ids are inserted, changed words updated, empty
   * ones dropped, and those of `removable` (the words the page opened with)
   * that are missing deleted — see `wordChanges`.
   */
  saveLanguage: (id: string, changes: Partial<LanguageDraft>, removable?: readonly string[]) => Promise<void>;
  duplicateLanguage: (id: string) => Promise<Language | undefined>;
  /** Soft delete. The vocabulary stays with the language and comes back with it. */
  deleteLanguage: (id: string) => Promise<void>;
  restoreLanguage: (id: string) => Promise<void>;
  permanentlyDeleteLanguage: (id: string) => Promise<void>;
}

/** Languages and vocabulary write under one key: a delete affects both tables. */
const WRITE_KEY = serialKey('language', '*');

async function selectActive(db: Database): Promise<Language[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM languages WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC',
  );
  return rows.map(fromRow.language);
}

/**
 * The vocabulary of the active languages. That of a deleted one stays in the
 * database but out of memory — otherwise the translate field would count
 * words for which there is no language any more.
 */
async function selectEntries(db: Database): Promise<LexiconEntry[]> {
  const rows = await db.select<DbRow[]>(
    `SELECT e.* FROM lexicon_entries e
       JOIN languages l ON l.id = e.language_id
      WHERE l.deleted_at IS NULL
      ORDER BY e.sort_order ASC`,
  );
  return rows.map(fromRow.lexiconEntry);
}

export const useLexiconStore = create<LexiconState>((set, get) => ({
  languages: [],
  entries: [],

  fetchLexicon: async () => {
    const db = await getDb();
    const [languages, entries] = await Promise.all([selectActive(db), selectEntries(db)]);
    set({ languages, entries });
  },

  createLanguage: (name, init = {}) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    const now = nowIso();
    const language: Language = {
      id: generateId(),
      name: name.trim(),
      icon: init.icon ?? DEFAULT_LANGUAGE_ICON,
      alphabet: init.alphabet ?? [],
      sort_order: await nextLanguageSortOrder(db),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await insertLanguageRow(db, language);
    set((s) => ({ languages: [...s.languages, language] }));
    return language;
  }),

  saveLanguage: (id, changes, removable = []) => serialized(WRITE_KEY, async () => {
    const current = get().languages.find((l) => l.id === id);
    if (!current) return;
    const db = await getDb();

    const words = changes.words
      ? wordChanges({
          languageId: id,
          stored: get().entries.filter((e) => e.language_id === id),
          words: changes.words,
          removable: new Set(removable),
          firstOrder: await nextEntrySortOrder(db, id),
          now: nowIso(),
        })
      : null;
    const statements = words?.statements ?? [];

    const { words: _words, ...rest } = changes;
    const patch: LanguagePatch = { ...rest };
    if (patch.name !== undefined) patch.name = patch.name.trim();
    if (patch.alphabet) patch.alphabet = patch.alphabet.filter(isFilledPair).map(({ from, to }) => ({ from, to }));
    // A changed word counts as a change of its language: the list sorts by it.
    if (statements.length === 0 && !needsWrite(current, patch)) return;
    const updated: Language = { ...current, ...patch, updated_at: stampFor(current.updated_at) };
    statements.push([
      'UPDATE languages SET name=$1, icon=$2, alphabet=$3, updated_at=$4 WHERE id=$5',
      [updated.name, updated.icon, alphabetToJson(updated.alphabet), updated.updated_at, id],
    ]);
    await db.batch(statements);
    set((s) => {
      const languages = s.languages.map((l) => (l.id === id ? updated : l));
      if (!words) return { languages };
      // Applied to the entries as they are now, not to a copy from before the awaits.
      const changed = new Map(words.changed.map((e) => [e.id, e]));
      const entries = [
        ...s.entries.filter((e) => !words.removed.has(e.id)).map((e) => changed.get(e.id) ?? e),
        ...words.added,
      ];
      return { languages, entries };
    });
  }),

  duplicateLanguage: async (id) => {
    const source = get().languages.find((l) => l.id === id);
    if (!source) return undefined;
    const copy = await get().createLanguage(source.name + i18n.t('common.copySuffix'), {
      icon: source.icon,
      alphabet: source.alphabet,
    });
    // The vocabulary comes along: a language without it would be just a name.
    const db = await getDb();
    const now = nowIso();
    const entries = get().entries
      .filter((e) => e.language_id === id)
      .map<LexiconEntry>((e) => ({ ...e, id: generateId(), language_id: copy.id, created_at: now, updated_at: now }));
    await db.batch(entries.map(insertEntryStatement));
    set((s) => ({ entries: [...s.entries, ...entries] }));
    return copy;
  },

  deleteLanguage: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    await db.execute('UPDATE languages SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({
      languages: s.languages.filter((l) => l.id !== id),
      entries: s.entries.filter((e) => e.language_id !== id),
    }));
  }),

  restoreLanguage: (id) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    const language = await languageById(db, id);
    if (!language) return;
    // To the end of the list: the old slot may have been taken in the meantime.
    await db.execute(
      'UPDATE languages SET deleted_at=NULL, sort_order=$1 WHERE id=$2',
      [await nextLanguageSortOrder(db), id],
    );
    const [languages, entries] = await Promise.all([selectActive(db), selectEntries(db)]);
    set({ languages, entries });
  }),

  permanentlyDeleteLanguage: async (id) => {
    const db = await getDb();
    // Reachable only from the trash. ON DELETE CASCADE takes the vocabulary along.
    await db.execute('DELETE FROM languages WHERE id=$1', [id]);
  },
}));
