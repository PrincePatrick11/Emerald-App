/**
 * Migration v49 — `journal_entries`, `wiki_articles` und `operations` werden
 * eine Tabelle `entries` mit einer Spalte `type`.
 *
 * Seit Status, Sigillen, Paradigma und Verlinkungen Blöcke im Inhalt sind,
 * hatten die drei Tabellen denselben Kern; der Rest waren Spalten, die niemand
 * mehr las (siehe `schemaV48.ts`). Sie fallen hier weg, ebenso `slug` (nie
 * gelesen) und `moon_phase` (folgt aus `created_at`, `entryMoonPhase`).
 *
 * Wie die anderen Umbauten ohne Transaktion (warum, steht im Kopf von
 * `normalizeSchema.ts`), aber ohne Umbenennen und ohne Marke: jede alte
 * Tabelle wird für sich kopiert und erst gelöscht, wenn jede ihrer Zeilen in
 * `entries` steht. Ein abgebrochener Lauf setzt deshalb einfach wieder an —
 * die Kopie überspringt, was schon drüben ist, und eine Tabelle, die schon weg
 * ist, ist fertig. Keine andere Tabelle hat einen Fremdschlüssel auf die drei
 * (`task_links` ist polymorph), das Löschen reißt also nichts mit.
 *
 * Vorher holt es die Sigillen nach, deren Zeichnung v42 nicht als Datei
 * speichern konnte (bis v48 versuchte `getDb` das bei jedem Öffnen): danach
 * gäbe es die Spalte nicht mehr, in der sie wartet. Gelingt es wieder nicht,
 * bricht v49 ab und versucht es beim nächsten Öffnen erneut — lieber ein
 * Vault, der sich erst später öffnet, als eine verlorene Zeichnung.
 *
 * Eine ID, die in zwei der alten Tabellen stand — ein Typwechsel, der früher
 * mittendrin abbrach (`entryTypeChange` verschob Zeilen zwischen Tabellen) —,
 * kommt nur einmal an: in der Reihenfolge unten gewinnt die erste. Die andere
 * Zeile war eine Kopie desselben Eintrags; sie bleibt in der Sicherung
 * `.pre-v49.bak` und wird im Log genannt.
 */
import type Database from './sqlite';
import { ENTRIES_INDEX_DDL_V49, TABLE_DDL, ddlIfNotExists } from './schema';
import { assertForeignKeysIntact, backupDatabaseFile, createIndexesIfMissing, tableExists } from './dbRebuild';
import { convertLegacySigils } from './migrateLegacySigils';
import type { EntryType } from '../types';

/** Die alten Tabellen und ihre Spalten in `entries`. Literal, weil in SQL interpoliert. */
const SOURCES: readonly { table: string; type: EntryType; categorized: boolean }[] = [
  { table: 'journal_entries', type: 'journal', categorized: false },
  { table: 'wiki_articles', type: 'wiki', categorized: true },
  { table: 'operations', type: 'operation', categorized: true },
];

async function copyInto(db: Database, { table, type, categorized }: (typeof SOURCES)[number]): Promise<void> {
  // Das Journal hatte weder Kategorie noch Icon oder Titelbild.
  const extra = categorized ? 'o.category_id, o.icon, o.cover_image' : 'NULL, NULL, NULL';
  await db.execute(
    `INSERT INTO entries (id, type, title, content, category_id, icon, cover_image,
                          entry_number, tags, created_at, updated_at, deleted_at)
     SELECT o.id, '${type}', o.title, o.content, ${extra},
            o.entry_number, o.tags, o.created_at, o.updated_at, o.deleted_at
       FROM ${table} o
      WHERE o.id NOT IN (SELECT id FROM entries)`
  );

  // Was jetzt noch fehlt, stand schon unter einem anderen Typ in `entries`.
  const skipped = await db.select<{ id: string }[]>(
    `SELECT o.id FROM ${table} o JOIN entries e ON e.id = o.id WHERE e.type != '${type}'`
  );
  for (const { id } of skipped) {
    console.warn(`[db] v49: ${table}.${id} stand schon in einer anderen Tabelle — die Kopie bleibt nur in der Sicherung`);
  }
  const [missing] = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE id NOT IN (SELECT id FROM entries)`
  );
  if ((missing?.n ?? 0) > 0) {
    throw new Error(`[db] v49: ${missing.n} Zeile(n) aus ${table} fehlen in entries — ${table} bleibt stehen`);
  }
}

export async function unifyEntries(db: Database): Promise<void> {
  const remaining: (typeof SOURCES)[number][] = [];
  for (const source of SOURCES) {
    if (await tableExists(db, source.table)) remaining.push(source);
  }

  if (remaining.length > 0) {
    if (await tableExists(db, 'operations')) {
      const { failed } = await convertLegacySigils(db, { includeSigilCategory: false });
      if (failed > 0) {
        throw new Error(`[db] v49: ${failed} Sigillen-Zeichnung(en) ließen sich nicht speichern — v49 wartet, bis das gelingt`);
      }
    }
    await backupDatabaseFile(db, 'v49');
    await db.execute(ddlIfNotExists(TABLE_DDL.entries));
    for (const source of remaining) {
      await copyInto(db, source);
      // Die Indizes der alten Tabelle gehen mit.
      await db.execute(`DROP TABLE ${source.table}`);
    }
  }

  await createIndexesIfMissing(db, ENTRIES_INDEX_DDL_V49);
  await assertForeignKeysIntact(db, 'v49');
}
