/**
 * Das Lexikon: die Sprachen (Tabelle `languages`, seit v45) und ihre Vokabeln
 * (`lexicon_entries`). Ein Store für beides, weil die Vokabeln ohne ihre
 * Sprache nichts sind und jede Ansicht immer beide braucht — das Dashboard
 * zählt sie, die Sprachseite listet sie, das Übersetzen-Feld liest sie.
 *
 * Gespeichert wird sofort, nicht erst mit „Fertig": eine Vokabelzeile ist ein
 * Paar aus zwei Feldern, kein Entwurf. Die Sprachseite braucht deshalb keinen
 * `draftStore` wie die Blöcke- und Vorlagenseite.
 *
 * Löschen: eine Sprache wandert in den Papierkorb (Soft-Delete, ihre Vokabeln
 * bleiben an ihr hängen), eine einzelne Vokabel ist sofort weg — mit
 * Rückgängig über `undoStore`, das sie unter derselben ID zurückschreibt.
 *
 * Import-Regel wie `blockDefinitionStore`: keine Inhalts-Stores.
 */
import { create } from 'zustand';
import type Database from '../lib/sqlite';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor } from '../lib/stamp';
import { fromRow, type DbRow } from '../lib/row';
import { serialized, serialKey } from '../lib/serialize';
import { DEFAULT_LANGUAGE_ICON, alphabetToJson } from '../lib/lexicon';
import {
  insertEntryRow, insertLanguageRow, languageById, nextEntrySortOrder, nextLanguageSortOrder,
} from '../lib/lexiconRows';
import i18n from '../i18n';
import type { Language, LexiconEntry } from '../types';

export type LanguagePatch = Partial<Pick<Language, 'name' | 'icon' | 'alphabet'>>;
export type EntryPatch = Partial<Pick<LexiconEntry, 'term' | 'translation' | 'pronunciation' | 'note'>>;

interface LexiconState {
  /** Aktive Sprachen in Anzeigereihenfolge. */
  languages: Language[];
  /** Die Vokabeln aller Sprachen — die Ansichten filtern selbst (`entriesOfLanguage`). */
  entries: LexiconEntry[];

  fetchLexicon: () => Promise<void>;
  createLanguage: (name: string, init?: Omit<LanguagePatch, 'name'>) => Promise<Language>;
  updateLanguage: (id: string, patch: LanguagePatch) => Promise<void>;
  duplicateLanguage: (id: string) => Promise<Language | undefined>;
  /** Soft-Delete. Die Vokabeln bleiben an der Sprache und kommen mit ihr zurück. */
  deleteLanguage: (id: string) => Promise<void>;
  restoreLanguage: (id: string) => Promise<void>;
  permanentlyDeleteLanguage: (id: string) => Promise<void>;

  addEntry: (languageId: string, init?: EntryPatch) => Promise<LexiconEntry>;
  updateEntry: (id: string, patch: EntryPatch) => Promise<void>;
  /** Sofort weg. Rückgängig macht `restoreEntry` mit der zurückgegebenen Zeile. */
  deleteEntry: (id: string) => Promise<LexiconEntry | undefined>;
  restoreEntry: (entry: LexiconEntry) => Promise<void>;
}

/** Sprachen und Vokabeln schreiben unter einem Schlüssel: ein Löschen betrifft beide Tabellen. */
const WRITE_KEY = serialKey('language', '*');

async function selectActive(db: Database): Promise<Language[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM languages WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC',
  );
  return rows.map(fromRow.language);
}

/**
 * Die Vokabeln der aktiven Sprachen. Die einer gelöschten bleiben in der
 * Datenbank, aber aus dem Speicher heraus — sonst zählte das Übersetzen-Feld
 * Wörter mit, zu denen es keine Sprache mehr gibt.
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

  updateLanguage: (id, patch) => serialized(WRITE_KEY, async () => {
    const current = get().languages.find((l) => l.id === id);
    if (!current || !needsWrite(current, patch)) return;
    const updated: Language = {
      ...current,
      ...patch,
      name: (patch.name ?? current.name).trim(),
      updated_at: stampFor(current.updated_at),
    };
    const db = await getDb();
    await db.execute(
      'UPDATE languages SET name=$1, icon=$2, alphabet=$3, updated_at=$4 WHERE id=$5',
      [updated.name, updated.icon, alphabetToJson(updated.alphabet), updated.updated_at, id],
    );
    set((s) => ({ languages: s.languages.map((l) => (l.id === id ? updated : l)) }));
  }),

  duplicateLanguage: async (id) => {
    const source = get().languages.find((l) => l.id === id);
    if (!source) return undefined;
    const copy = await get().createLanguage(source.name + i18n.t('common.copySuffix'), {
      icon: source.icon,
      alphabet: source.alphabet,
    });
    // Die Vokabeln kommen mit: eine Sprache ohne sie wäre nur ein Name.
    const db = await getDb();
    const now = nowIso();
    const entries = get().entries
      .filter((e) => e.language_id === id)
      .map<LexiconEntry>((e) => ({ ...e, id: generateId(), language_id: copy.id, created_at: now, updated_at: now }));
    for (const entry of entries) await insertEntryRow(db, entry);
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
    // Ans Ende der Liste: der alte Platz ist inzwischen womöglich vergeben.
    await db.execute(
      'UPDATE languages SET deleted_at=NULL, sort_order=$1 WHERE id=$2',
      [await nextLanguageSortOrder(db), id],
    );
    const [languages, entries] = await Promise.all([selectActive(db), selectEntries(db)]);
    set({ languages, entries });
  }),

  permanentlyDeleteLanguage: async (id) => {
    const db = await getDb();
    // Nur aus dem Papierkorb erreichbar. ON DELETE CASCADE nimmt die Vokabeln mit.
    await db.execute('DELETE FROM languages WHERE id=$1', [id]);
  },

  addEntry: (languageId, init = {}) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    const now = nowIso();
    const entry: LexiconEntry = {
      id: generateId(),
      language_id: languageId,
      term: init.term ?? '',
      translation: init.translation ?? '',
      pronunciation: init.pronunciation ?? '',
      note: init.note ?? '',
      sort_order: await nextEntrySortOrder(db, languageId),
      created_at: now,
      updated_at: now,
    };
    await insertEntryRow(db, entry);
    set((s) => ({ entries: [...s.entries, entry] }));
    return entry;
  }),

  updateEntry: (id, patch) => serialized(WRITE_KEY, async () => {
    const current = get().entries.find((e) => e.id === id);
    if (!current || !needsWrite(current, patch)) return;
    const updated: LexiconEntry = { ...current, ...patch, updated_at: stampFor(current.updated_at) };
    const db = await getDb();
    await db.execute(
      `UPDATE lexicon_entries
          SET term=$1, translation=$2, pronunciation=$3, note=$4, updated_at=$5
        WHERE id=$6`,
      [updated.term, updated.translation, updated.pronunciation, updated.note, updated.updated_at, id],
    );
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? updated : e)) }));
  }),

  deleteEntry: (id) => serialized(WRITE_KEY, async () => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return undefined;
    const db = await getDb();
    await db.execute('DELETE FROM lexicon_entries WHERE id=$1', [id]);
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    return entry;
  }),

  restoreEntry: (entry) => serialized(WRITE_KEY, async () => {
    const db = await getDb();
    // Die Sprache kann inzwischen im Papierkorb liegen — dann liefe das INSERT
    // zwar durch (die Zeile existiert noch), die Vokabel gehörte aber zu einer
    // Sprache, die der Store nicht hält. Lieber gar nicht.
    if (!get().languages.some((l) => l.id === entry.language_id)) return;
    await insertEntryRow(db, entry);
    set((s) => ({ entries: [...s.entries, entry] }));
  }),
}));
