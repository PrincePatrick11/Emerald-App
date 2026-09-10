/**
 * Migration v39 — macht `category_id` in den vier Inhaltstabellen nullable und
 * nimmt `other` den Sonderstatus.
 *
 * Bis v38 war die Spalte `NOT NULL DEFAULT 'other'`: jeder Eintrag *musste*
 * eine Kategorie haben, und wer keine wählte, bekam das Sammelbecken. „Ohne
 * Kategorie" gab es nur als Unfall — ein Eintrag, dessen Kategorie im
 * Papierkorb lag. Seit v39 ist es der Normalfall eines neuen Eintrags, und die
 * Spalte darf NULL sein.
 *
 * `other` selbst bleibt stehen, verliert aber sein `is_builtin`: wer Inhalte
 * bewusst dort abgelegt hat, behält sie, und wer die Kategorie nicht will,
 * benennt sie um oder löscht sie wie jede andere. Frische Vaults legen sie gar
 * nicht mehr an (`BUILTIN_CATEGORIES` in `schema.ts`).
 *
 * Dabei muss ihr *Name* mit: Eine eingebaute Kategorie heißt nach ihrem
 * Locale-Key (`categoryLabel`), ihre `name`-Spalte trägt nur den englischen
 * Seed „Other". Ohne das Flag stünde ab sofort genau der da — ein deutscher
 * Vault verlöre „Sonstiges". Der Lauf schreibt den übersetzten Namen deshalb
 * in die Zeile, so wie v38 es für die alten Modul-Builtins tat, und lässt ihn
 * in Ruhe, wenn der Name schon vergeben ist.
 *
 * Ein Rebuild wie v33 und v38 — SQLite kann eine Spalte nicht nachträglich
 * nullable machen — und damit mit derselben Foreign-Key-Falle: `ALTER TABLE
 * tasks RENAME TO tasks_old` schreibt den Verweis in `task_links` auf
 * `tasks_old` um, ein späteres `DROP TABLE tasks_old` nähme per CASCADE alle
 * Verknüpfungen mit. Deshalb werden die beiden Kind-Tabellen mitgebaut:
 * **Kinder zuerst** umbenennen und löschen, Eltern zuerst anlegen und kopieren.
 *
 * Die Daten ändern sich dabei nicht — jede `category_id` wird unverändert
 * übernommen. Eine Marke wie in v38 braucht es trotzdem, aber aus einem
 * anderen Grund: Sobald die neuen Tabellen gefüllt sind und das Aufräumen
 * beginnt, darf nicht mehr zurückgerollt werden. Stirbt der Prozess mitten im
 * Löschen der `*_old` — nachdem `task_links_old` und `altar_placements_old`
 * weg sind, aber `tasks_old` noch steht —, dann fände der nächste Start ein
 * `tasks_old` vor, würfe dafür das fertige `tasks` weg, und dessen
 * `ON DELETE CASCADE` nähme die ebenfalls fertigen `task_links` mit. Dasselbe
 * für `altar_items` und die Platzierungen. Die Marke sagt „ab hier nur noch
 * aufräumen".
 */
import type Database from '@tauri-apps/plugin-sql';
import i18n, { savedAppLanguage } from '../i18n';
// INDEX_DDL_V38, nicht INDEX_DDL: in der Kette fehlen hier noch die Tabellen
// späterer Migrationen (`block_definitions` kommt mit v40).
import { TABLE_DDL, INDEX_DDL_V38, FALLBACK_CATEGORY_ID } from './schema';
import { categoryKey } from './categoryMerge';
import {
  assertForeignKeysIntact,
  backupDatabaseFile,
  copyTable,
  createIndexesIfMissing,
  tableExists,
} from './dbRebuild';

/** Umbenennen und Löschen: Kinder vor Eltern. */
const REBUILT_CHILDREN_FIRST = [
  'task_links',
  'altar_placements',
  'tasks',
  'altar_items',
  'operations',
  'wiki_articles',
] as const;

/** Anlegen und Kopieren: Eltern vor Kindern. */
const REBUILT_PARENTS_FIRST = [...REBUILT_CHILDREN_FIRST].reverse();

/**
 * Steht diese Tabelle, sind alle sechs Inhaltstabellen kopiert und es fehlt
 * nur das Aufräumen. Eine echte Tabelle, keine TEMP-Tabelle: die hinge an
 * einer Verbindung aus dem Pool und wäre für die nächste Anweisung womöglich
 * weg (dieselbe Überlegung wie bei v38s `_category_id_map`).
 */
const REBUILT_MARK_TABLE = '_v39_content_rebuilt';

/**
 * Ist `category_id` schon nullable? Ein Vault, der von vor v38 kommt, hat die
 * Tabellen gerade erst aus dem aktuellen `TABLE_DDL` bekommen und braucht den
 * Rebuild nicht noch einmal.
 */
async function alreadyNullable(db: Database): Promise<boolean> {
  const rows = await db.select<{ name: string; notnull: number }[]>('PRAGMA table_info(wiki_articles)');
  const column = rows.find((r) => r.name === 'category_id');
  return !!column && column.notnull === 0;
}

async function rollbackPartialRebuild(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    if (!(await tableExists(db, `${table}_old`))) continue;
    console.warn(`[db] v39: Reste eines abgebrochenen Laufs für ${table} werden zurückgerollt`);
    if (await tableExists(db, table)) await db.execute(`DROP TABLE ${table}`);
    await db.execute(`ALTER TABLE ${table}_old RENAME TO ${table}`);
  }
}

async function dropOldTables(db: Database): Promise<void> {
  for (const table of REBUILT_CHILDREN_FIRST) {
    await db.execute(`DROP TABLE IF EXISTS ${table}_old`);
  }
}

/**
 * Nimmt `other` das `is_builtin` und friert seinen bis dahin übersetzten Namen
 * in der Zeile ein. Ist der schon von einer anderen Kategorie belegt, bleibt
 * der alte stehen — zwei gleichnamige wären verwirrender als ein englisches
 * „Other", und umbenennen kann der Nutzer sie jetzt selbst.
 *
 * Der Name wird nur geschrieben, wenn die aktive Sprache die gespeicherte ist.
 * `main.tsx` rendert nach spätestens zwei Sekunden auch dann, wenn der
 * Locale-Chunk noch nicht da ist — träfe die Migration dieses Fenster, brennte
 * sie einem deutschen Vault dauerhaft „Other" statt „Sonstiges" ein. Das Flag
 * fällt trotzdem, nur der Name bleibt dann der englische Seed.
 */
/**
 * Die gespeicherte Sprache — oder die aktive, wo es keinen `localStorage`
 * gibt. Das ist der Schema-Check, der die Migration in Node fährt: dort ist
 * Englisch aktiv und richtig, und die Prüfung unten soll nicht daran
 * scheitern, dass es keinen Browser gibt.
 */
function storedLanguage(): string {
  try {
    return savedAppLanguage();
  } catch {
    return i18n.language;
  }
}

async function demoteFallbackCategory(db: Database): Promise<void> {
  const rows = await db.select<{ id: string; name: string; is_builtin: number }[]>(
    'SELECT id, name, is_builtin FROM categories WHERE id = $1',
    [FALLBACK_CATEGORY_ID]
  );
  const row = rows[0];
  if (!row || !row.is_builtin) return;

  const localeReady = i18n.language === storedLanguage();
  const translated = localeReady ? i18n.t(`categories.builtin.${FALLBACK_CATEGORY_ID}`) : '';
  if (!localeReady) {
    console.warn('[db] v39: Locale noch nicht geladen — „other" behält seinen gespeicherten Namen');
  }
  const others = await db.select<{ name: string }[]>(
    'SELECT name FROM categories WHERE id != $1',
    [FALLBACK_CATEGORY_ID]
  );
  const taken = new Set(others.map((c) => categoryKey(c.name)));
  const name = translated && !taken.has(categoryKey(translated)) ? translated : row.name;

  await db.execute(
    'UPDATE categories SET is_builtin = 0, name = $1 WHERE id = $2',
    [name, FALLBACK_CATEGORY_ID]
  );
  console.info(`[db] v39: „${name}" ist jetzt eine gewöhnliche Kategorie`);
}

export async function makeCategoryOptional(db: Database): Promise<void> {
  const rebuilt = await tableExists(db, REBUILT_MARK_TABLE);

  if (rebuilt) {
    console.info('[db] v39: Rebuild lag bereits vor, nur Aufräumen und Prüfung werden nachgeholt');
  } else {
    await rollbackPartialRebuild(db);

    if (!(await alreadyNullable(db))) {
      await backupDatabaseFile(db, 'v39');

      for (const table of REBUILT_CHILDREN_FIRST) {
        await db.execute(`ALTER TABLE ${table} RENAME TO ${table}_old`);
      }
      for (const table of REBUILT_PARENTS_FIRST) {
        await db.execute(TABLE_DDL[table]);
        // `tasks` samt `parent_task_id` in einem INSERT … SELECT: SQLite prüft
        // Foreign Keys am Ende der Anweisung, ein Kind darf im Ergebnis also vor
        // seinem Elternteil stehen (v33 und v38 kopieren genauso).
        await copyTable(db, table, `${table}_old`);
      }
      // Ab hier darf nichts mehr zurückgerollt werden (siehe Kopf).
      await db.execute(`CREATE TABLE IF NOT EXISTS ${REBUILT_MARK_TABLE} (done INTEGER)`);
    }
  }

  await dropOldTables(db);
  // Außerhalb des Rebuild-Zweigs: ein Absturz zwischen dem Löschen der
  // `*_old` und dem Anlegen der Indizes ließe sie sonst dauerhaft fehlen,
  // während sich die Migration als erledigt stempelt. v38 hält es genauso.
  await createIndexesIfMissing(db, INDEX_DDL_V38);
  await db.execute(`DROP TABLE IF EXISTS ${REBUILT_MARK_TABLE}`);

  // Getrennt vom Rebuild, damit es auch für einen Vault greift, der die
  // Tabellen schon in der neuen Form bekam (Aufstieg von vor v38).
  await demoteFallbackCategory(db);

  await assertForeignKeysIntact(db, 'v39');
}
