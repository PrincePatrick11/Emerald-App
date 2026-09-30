/**
 * Eingefrorenes Schema, Stand v48 — die drei Eintragstabellen, bevor v49
 * (`unifyEntries.ts`) sie zu `entries` zusammenlegt.
 *
 * Die Migrationen davor bauen oder lesen diese Tabellen noch: v33 legt
 * `journal_entries` an (`schemaV37.ts` holt sie von hier), v38 und v39 bauen
 * `wiki_articles` und `operations` neu, v35 läuft über ihre Bildspalten, v48
 * über ihre Titel. Aus dem lebenden `schema.ts` sind sie seit v49
 * verschwunden — also stehen sie hier, wie sie bis dahin aussahen.
 * **Nichts hier ändern:** `scripts/schema-check.mjs` beweist, dass die Kette
 * über diesen Stand beim selben Schema landet wie ein frischer Vault.
 */
import { TABLE_DDL, type TableName } from './schema';

export type V48EntryTable = 'journal_entries' | 'wiki_articles' | 'operations';

export const V48_TABLE_DDL: Record<V48EntryTable, string> = {
  // paradigm_id, bannung_type_wiki_id, meditation_type_wiki_id und die beiden
  // linked_*_ids-Arrays verweisen auf Wiki-Artikel bzw. Operationen (seit
  // v36/v37 geleert und ungelesen).
  journal_entries: `
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Entry',
      content TEXT NOT NULL DEFAULT '',
      entry_number INTEGER,
      moon_phase TEXT,
      mood TEXT,
      paradigm_id TEXT,
      linked_operation_ids TEXT NOT NULL DEFAULT '[]',
      linked_wiki_ids TEXT NOT NULL DEFAULT '[]',
      is_bannung INTEGER NOT NULL DEFAULT 0,
      bannung_type_wiki_id TEXT,
      is_meditation INTEGER NOT NULL DEFAULT 0,
      meditation_duration INTEGER,
      meditation_type_wiki_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  wiki_articles: `
    CREATE TABLE wiki_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Article',
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      entry_number INTEGER,
      cover_image TEXT,
      icon TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,

  operations: `
    CREATE TABLE operations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled Operation',
      content TEXT NOT NULL DEFAULT '',
      category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
      entry_number INTEGER,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT,
      cover_image TEXT,
      version TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      end_date TEXT,
      target_reveal_date TEXT,
      charging_technique_wiki_id TEXT,
      is_loaded INTEGER NOT NULL DEFAULT 0,
      intention_text TEXT NOT NULL DEFAULT '',
      letter_bank TEXT NOT NULL DEFAULT '[]',
      implemented_letters TEXT NOT NULL DEFAULT '[]',
      show_intention_in_properties INTEGER NOT NULL DEFAULT 1,
      show_letter_bank_in_properties INTEGER NOT NULL DEFAULT 1,
      show_sigil INTEGER NOT NULL DEFAULT 1,
      drawing_data TEXT,
      thumbnail_data TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
};

/** Das DDL, das eine Migration bis v48 für `table` meint: die eingefrorene Fassung, sonst die lebende. */
export function ddlBeforeV49(table: string): string {
  return (V48_TABLE_DDL as Record<string, string>)[table] ?? TABLE_DDL[table as TableName];
}

/** Die Bildspalten bis v48 — v35 läuft darüber (siehe `IMAGE_FIELDS` in `schema.ts`). */
export const IMAGE_FIELDS_V48: { table: string; html: string[]; plain: string[]; legacy: string[] }[] = [
  { table: 'journal_entries', html: ['content'], plain: [], legacy: [] },
  { table: 'wiki_articles', html: ['content'], plain: [], legacy: ['icon', 'cover_image'] },
  {
    table: 'operations',
    html: ['content'],
    plain: [],
    legacy: ['icon', 'cover_image', 'drawing_data', 'thumbnail_data'],
  },
  { table: 'altars', html: [], plain: ['background_image_data'], legacy: ['thumbnail_data', 'icon_data'] },
  { table: 'altar_items', html: [], plain: [], legacy: ['image_data'] },
];

/** Die Tabellen mit Titel bis v48 — v48 (`untitled_is_empty`) leert ihre Standardtitel. */
export const TITLED_TABLES_V48 = ['journal_entries', 'wiki_articles', 'operations', 'tasks', 'altars'] as const;
