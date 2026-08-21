/**
 * Prüft, dass frische und migrierte Vaults beim identischen Schema landen.
 *
 * Das ist der Test, ohne den der Baseline-Squash nicht zu verantworten ist:
 * `db.ts` hat zwei Wege zum Schema — das DDL aus `schema.ts` für frische
 * Dateien, und 33 Migrationsschritte für bestehende. Laufen die auseinander,
 * merkt es sonst niemand, bis ein Nutzer eine Fehlermeldung sieht.
 *
 * Läuft gegen `node:sqlite` statt gegen die App, damit der Durchlauf Sekunden
 * dauert und keine Tauri-Umgebung braucht.
 *
 *   npm run check:schema
 */
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const workDir = mkdtempSync(join(tmpdir(), 'emerald-schema-'));

/* ------------------------------------------------------------------ *
 * Adapter: node:sqlite hinter der Schnittstelle von tauri-plugin-sql
 * ------------------------------------------------------------------ */

/**
 * Das Plugin benutzt `$1`-Platzhalter. node:sqlite bindet die nicht positionell
 * ("column index out of range"), SQLites eigene `?1`-Form dagegen schon — auch
 * wenn derselbe Platzhalter mehrfach vorkommt, wie in `trashStore.emptyTrash`.
 */
function toIndexedPlaceholders(sql) {
  return sql.replace(/\$(\d+)/g, '?$1');
}

class HarnessDb {
  constructor(path) {
    this.raw = new DatabaseSync(path);
  }

  async execute(sql, params = []) {
    if (!params.length) {
      // exec() verkraftet PRAGMA und VACUUM, prepare().run() nicht durchgängig.
      this.raw.exec(sql);
      return { rowsAffected: 0 };
    }
    const stmt = this.raw.prepare(toIndexedPlaceholders(sql));
    const info = stmt.run(...params);
    return { rowsAffected: Number(info.changes ?? 0) };
  }

  async select(sql, params = []) {
    const stmt = this.raw.prepare(toIndexedPlaceholders(sql));
    return stmt.all(...params);
  }

  close() {
    this.raw.close();
  }
}

/* ------------------------------------------------------------------ *
 * Bundle bauen — die Tauri-Module gibt es in node nicht
 * ------------------------------------------------------------------ */

const STUBS = {
  '@tauri-apps/plugin-sql': `
    export default class Database {
      static async load() { throw new Error('Database.load wird im Harness nicht benutzt'); }
    }`,
  '@tauri-apps/api/core': `
    export async function invoke(cmd) {
      // vaultManager liest vaults.json und legt es beim ersten Fehlschlag an.
      if (cmd === 'read_file') throw new Error('ENOENT (Harness)');
      // Ein Vault ist ein Verzeichnis; im Harness ist das schlicht das
      // Arbeitsverzeichnis, damit die Sicherung aus v33 dort landet.
      if (cmd === 'migrate_vault_layout' || cmd === 'default_vault_dir') {
        return process.env.EMERALD_HARNESS_DIR;
      }
      return undefined;
    }`,
  '@tauri-apps/api/path': `
    export async function appDataDir() { return process.env.EMERALD_HARNESS_DIR; }`,
};

const stubPlugin = {
  name: 'tauri-stubs',
  setup(b) {
    const filter = new RegExp(
      `^(${Object.keys(STUBS).map((k) => k.replace(/[/@-]/g, '\\$&')).join('|')})$`
    );
    b.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents: STUBS[args.path],
      loader: 'js',
    }));
  },
};

const entry = join(workDir, 'entry.ts');
writeFileSync(
  entry,
  `export { runMigrations, MIGRATIONS } from '${process.cwd().replace(/\\/g, '/')}/src/lib/db';
   export { TABLES, TABLE_DDL, ddlIfNotExists, checkIntegrity, reassignCategoryContent, collectUsedImageFilenames } from '${process.cwd().replace(/\\/g, '/')}/src/lib/schema';
   export { invalidateVaultCache } from '${process.cwd().replace(/\\/g, '/')}/src/lib/vaultManager';`
);

const bundlePath = join(workDir, 'bundle.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  plugins: [stubPlugin],
  logLevel: 'warning',
});

process.env.EMERALD_HARNESS_DIR = workDir;
const {
  runMigrations, MIGRATIONS, TABLES, TABLE_DDL,
  ddlIfNotExists, checkIntegrity, reassignCategoryContent,
  collectUsedImageFilenames, invalidateVaultCache,
} = await import(pathToFileURL(bundlePath).href);

/* ------------------------------------------------------------------ *
 * Schema auslesen und vergleichen
 * ------------------------------------------------------------------ */

/**
 * `ALTER TABLE ... RENAME` schreibt den Tabellennamen in sqlite_master
 * gequotet zurück, ein direktes CREATE nicht. Für den Vergleich ist das
 * bedeutungslos, also raus damit — zusammen mit der Einrückung aus dem DDL.
 */
function normalizeSql(sql) {
  return (sql ?? '')
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readSchema(db) {
  const out = {};
  for (const table of TABLES) {
    const [master] = await db.select(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
      [table]
    );
    out[table] = {
      sql: normalizeSql(master?.sql),
      columns: (await db.select(`PRAGMA table_info(${table})`)).map((c) => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull,
        dflt: c.dflt_value,
        pk: c.pk,
      })),
      foreignKeys: (await db.select(`PRAGMA foreign_key_list(${table})`))
        .map((f) => ({ table: f.table, from: f.from, to: f.to, onDelete: f.on_delete }))
        .sort((a, b) => `${a.from}`.localeCompare(`${b.from}`)),
    };
  }
  out._indexes = (
    await db.select(
      "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY name"
    )
  ).map((i) => ({ name: i.name, table: i.tbl_name, sql: normalizeSql(i.sql) }));
  return out;
}

/* ------------------------------------------------------------------ *
 * Die zwei Wege zum Schema
 * ------------------------------------------------------------------ */

function freshDb(name) {
  // Jeder Durchlauf bekommt sein eigenes Verzeichnis, sonst kollidieren die
  // Snapshots, die v33 unter einem festen Namen ablegt.
  //
  // `invalidateVaultCache()` ist dafuer noetig, seit `vaultManager` den
  // Vault-Pfad zwischenspeichert: ohne den Reset behaelt der erste Durchlauf
  // sein Verzeichnis fuer alle weiteren, und die Trennung hier waere wirkungslos
  // — sichtbar daran, dass v33 „Sicherung eines frueheren Versuchs liegt
  // bereits unter …" meldet, obwohl es eine frische Datei ist.
  const dir = join(workDir, name.replace(/\.db$/, ''));
  mkdirSync(dir, { recursive: true });
  process.env.EMERALD_HARNESS_DIR = dir;
  invalidateVaultCache();
  return new HarnessDb(join(dir, name));
}

/** Der Baseline-Pfad: unberührte Datei. */
async function buildViaBaseline() {
  const db = freshDb('baseline.db');
  await runMigrations(db);
  return db;
}

/**
 * Der Kettenpfad: spielt v1–v32 so ab, wie eine bestehende Datenbank sie
 * gelaufen ist — inklusive des Schluckens von „already applied"-Fehlern, an dem
 * v4 scheitert. Danach übernimmt runMigrations und wendet v33 an.
 */
async function buildViaChain(name, seed) {
  const db = freshDb(name);
  await db.execute(ddlIfNotExists(TABLE_DDL.schema_version));

  for (const m of MIGRATIONS) {
    if (m.version > 32) break;
    try {
      await m.up(db);
    } catch (err) {
      if (!/duplicate column name|already exists/i.test(String(err.message))) throw err;
    }
    await db.execute(
      'INSERT INTO schema_version (version, name, applied_at) VALUES ($1,$2,$3)',
      [m.version, m.name, new Date().toISOString()]
    );
  }

  if (seed) await seed(db);
  await runMigrations(db); // wendet v33 an
  return db;
}

/* ------------------------------------------------------------------ *
 * Testdaten für den Rebuild
 * ------------------------------------------------------------------ */

const now = new Date().toISOString();

/** Bildet genau die Zustände ab, die v33 reparieren muss. */
/** Ein gueltiger Bildname: 64 Hex-Zeichen plus Endung. */
const LEGACY_IMAGE = `${'a1b2c3d4e5f60718'.repeat(4)}.png`;

/**
 * Bildverweise, wie sie vor v35 in der Datenbank standen: ein absoluter Pfad
 * im HTML einer Journal-Zeile, einer direkt in einer Altar-Spalte, und daneben
 * je eine Data-URL, die v35 nicht anfassen darf.
 *
 * Eigene Datenbank statt seedLegacyData, weil ein hier eingefuegter Altar die
 * Pruefung „v33 legt genau einen Default-Altar an" aushebeln wuerde.
 */
async function seedImageRefs(db) {
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags)
     VALUES ('j1','Eintrag',$2,$1,$1,'[]')`,
    [now, `<p>x</p><img src="C:\\Users\\x\\Roaming\\app\\images\\${LEGACY_IMAGE}"><img src="data:image/png;base64,AAAA">`]
  );
  await db.execute(
    `INSERT INTO altars (id,title,intention,background_preset,background_image_data,icon_data,created_at,updated_at)
     VALUES ('a1','Altar','','custom',$2,'data:image/png;base64,BBBB',$1,$1)`,
    [now, `/home/x/.local/share/app/images/${LEGACY_IMAGE}`]
  );
}

async function seedLegacyData(db) {
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_wiki_ids)
     VALUES ('j1','Eintrag','',$1,$1,'[]',NULL)`,
    [now]
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w1','Artikel','artikel','','ritual',$1,$1,'[]')`,
    [now]
  );
  // Artikel, dessen Kategorie hart gelöscht wurde — der stille Altbestand.
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w2','Waise','waise','','geloescht',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o1','Operation','','sigils',$1,$1,'[]')`,
    [now]
  );
  // Legacy-creations-Zeile: muss als Operation überleben.
  await db.execute(
    `INSERT INTO creations (id,title,description,created_at,updated_at,tags,intention_text)
     VALUES ('c1','Alte Kreation','Beschreibung',$1,$1,'[]','Absicht')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,created_at,updated_at,tags)
     VALUES ('t1','Aufgabe','','general',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,parent_task_id,created_at,updated_at,tags)
     VALUES ('t2','Unteraufgabe','','general','t1',$1,$1,'[]')`,
    [now]
  );
  // Doppelter task_link — das neue UNIQUE verträgt ihn nicht.
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl1','t1','w1','wiki')`
  );
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl2','t1','w1','wiki')`
  );
  // Altar-Item mit Kategorie-*Namen* statt ID, plus eine Platzierung ohne Altar:
  // genau der v4-Schaden.
  await db.execute(
    `INSERT INTO altar_items (id,name,emoji,category,note,created_at)
     VALUES ('i1','Kerze','🕯️','Candle','',$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_placements (id,item_id,x,y) VALUES ('p1','i1',10,20)`
  );
}

/* ------------------------------------------------------------------ *
 * Ausführung
 * ------------------------------------------------------------------ */

const failures = [];
function check(label, ok, detail) {
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.log(`  FEHLT ${label}`);
    if (detail) console.log(String(detail).split('\n').map((l) => `        ${l}`).join('\n'));
    failures.push(label);
  }
}

console.log('\n1. Baseline gegen Migrationskette\n');

const baseline = await buildViaBaseline();
const chain = await buildViaChain('chain.db');

const schemaA = await readSchema(baseline);
const schemaB = await readSchema(chain);

for (const table of TABLES) {
  const a = schemaA[table];
  const b = schemaB[table];
  const same = JSON.stringify(a) === JSON.stringify(b);
  check(
    `${table}`,
    same,
    same
      ? null
      : `baseline: ${JSON.stringify(a, null, 1)}\nkette:    ${JSON.stringify(b, null, 1)}`
  );
}
check(
  'Indizes',
  JSON.stringify(schemaA._indexes) === JSON.stringify(schemaB._indexes),
  `baseline: ${JSON.stringify(schemaA._indexes)}\nkette:    ${JSON.stringify(schemaB._indexes)}`
);

const droppedCheck = await chain.select(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('creations','altar_intentions','custom_properties') OR name LIKE '%_old'"
);
check('Altlasten und _old-Tabellen entfernt', droppedCheck.length === 0, JSON.stringify(droppedCheck));

console.log('\n2. Foreign Keys\n');
for (const [label, db] of [['baseline', baseline], ['kette', chain]]) {
  const violations = await db.select('PRAGMA foreign_key_check');
  check(`${label}: foreign_key_check leer`, violations.length === 0, JSON.stringify(violations));
}

console.log('\n3. Rebuild auf Echtdaten\n');

const seeded = await buildViaChain('seeded.db', seedLegacyData);

const rows = async (sql) => (await seeded.select(sql))[0];

check(
  'creations-Zeile ist als Operation erhalten',
  (await rows("SELECT COUNT(*) n FROM operations WHERE id='c1'")).n === 1
);
check(
  'Operationen vollständig (1 eigene + 1 aus creations)',
  (await rows('SELECT COUNT(*) n FROM operations')).n === 2
);
check(
  'altar_items.category_id hält jetzt die ID',
  (await rows("SELECT category_id c FROM altar_items WHERE id='i1'")).c === 'candle'
);
check(
  'verwaister Artikel auf Default-Kategorie umgehängt',
  (await rows("SELECT category_id c FROM wiki_articles WHERE id='w2'")).c === 'other'
);
check(
  'Artikel mit gültiger Kategorie unverändert',
  (await rows("SELECT category_id c FROM wiki_articles WHERE id='w1'")).c === 'ritual'
);
check(
  'kein Journal-Eintrag verloren',
  (await rows('SELECT COUNT(*) n FROM journal_entries')).n === 1
);
check(
  'NULL-JSON-Spalte wurde zu []',
  (await rows("SELECT linked_wiki_ids v FROM journal_entries WHERE id='j1'")).v === '[]'
);
check(
  'doppelter task_link entfernt',
  (await rows('SELECT COUNT(*) n FROM task_links')).n === 1
);
check(
  'Unteraufgabe behält ihren Elternteil',
  (await rows("SELECT parent_task_id p FROM tasks WHERE id='t2'")).p === 't1'
);
check(
  'heimatlose Platzierung hat einen Altar bekommen',
  (await rows("SELECT COUNT(*) n FROM altar_placements WHERE altar_id IS NOT NULL")).n === 1
);
check(
  'Default-Altar wurde nachgeholt (v4-Schaden)',
  (await rows('SELECT COUNT(*) n FROM altars')).n === 1
);
const seededViolations = await seeded.select('PRAGMA foreign_key_check');
check('Echtdaten: foreign_key_check leer', seededViolations.length === 0, JSON.stringify(seededViolations));

const orphans = await checkIntegrity(seeded);
check(
  'checkIntegrity: keine Waisen in den polymorphen Tabellen',
  orphans.length === 0,
  JSON.stringify(orphans)
);

console.log('\n4. checkIntegrity findet, was Foreign Keys nicht abdecken\n');

{
  // Die polymorphen Tabellen und die JSON-Arrays lassen sich nicht per
  // Constraint absichern. checkIntegrity ist der Ersatz — dieser Test stellt
  // sicher, dass es tatsächlich anschlägt und nicht nur leer zurückkommt.
  const db = freshDb('integrity.db');
  await runMigrations(db);
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_wiki_ids)
     VALUES ('j1','Eintrag','',$1,$1,'[]','["gibt-es-nicht"]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO routines (id,name,content,created_at,updated_at,operation_ids)
     VALUES ('r1','Routine','',$1,$1,'["auch-nicht"]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO links (source_id,source_type,target_id,target_type)
     VALUES ('fehlt','journal','fehlt-auch','wiki')`
  );

  const found = await checkIntegrity(db);
  const hit = (table, column) => found.some((o) => o.table === table && o.column === column);

  check('Waise in linked_wiki_ids erkannt', hit('journal_entries', 'linked_wiki_ids'));
  check('Waise in routines.operation_ids erkannt', hit('routines', 'operation_ids'));
  check('Waise in links erkannt', hit('links', 'source_id') || hit('links', 'target_id'));
  check(
    'PRAGMA foreign_key_check sieht davon nichts',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  db.close();
}

console.log('\n5. Kategorie löschen verliert keine Einträge\n');

{
  const db = baseline;
  await db.execute(
    `INSERT INTO wiki_categories (id,name,emoji,sort_order,is_builtin)
     VALUES ('temporaer','Temporär','🧪',99,0)`
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category_id,created_at,updated_at,tags)
     VALUES ('a1','Wichtiger Artikel','wichtig','Inhalt','temporaer',$1,$1,'[]')`,
    [now]
  );

  // Ohne Umhängen muss ON DELETE RESTRICT das Löschen verweigern — sonst
  // entstünde wieder eine category_id ohne Gegenstück.
  let blocked = false;
  try {
    await db.execute("DELETE FROM wiki_categories WHERE id='temporaer'");
  } catch {
    blocked = true;
  }
  check('RESTRICT verweigert das Löschen einer belegten Kategorie', blocked);

  const moved = await reassignCategoryContent(db, 'wiki_articles', 'temporaer');
  check('reassignCategoryContent hat den Artikel umgehängt', moved === 1);

  await db.execute("DELETE FROM wiki_categories WHERE id='temporaer'");

  const [article] = await db.select("SELECT title, category_id FROM wiki_articles WHERE id='a1'");
  check('Artikel existiert nach der Kategorielöschung weiter', article !== undefined);
  check('Artikel hat jetzt die Default-Kategorie', article?.category_id === 'other');
  check('Artikelinhalt unverändert', article?.title === 'Wichtiger Artikel');
}

console.log('\n6. Einfügereihenfolge beim Import\n');

{
  // Ein Backup-Import fügt Zeile für Zeile ein. Mit aktiven Foreign Keys
  // muss die Elternzeile vorher da sein — und `tasks.parent_task_id` zeigt auf
  // dieselbe Tabelle, ein Kind kann in der Datei also vor seinem Elternteil
  // stehen. dbBackup löst das mit insertTasks(): erst ohne Elternbezug
  // einfuegen, dann nachtragen. Hier wird genau das nachgestellt.
  const db = freshDb('import.db');
  await runMigrations(db);

  const kind = [
    { id: 'kind', title: 'Unteraufgabe', parent_task_id: 'eltern' },
    { id: 'eltern', title: 'Aufgabe', parent_task_id: null },
  ];

  let naiveFailed = false;
  try {
    for (const t of kind) {
      await db.execute(
        `INSERT INTO tasks (id,title,description,category_id,parent_task_id,created_at,updated_at,tags)
         VALUES ($1,$2,'','general',$3,$4,$4,'[]')`,
        [t.id, t.title, t.parent_task_id, now]
      );
    }
  } catch {
    naiveFailed = true;
  }
  check('naives Einfügen in Dateireihenfolge scheitert am Foreign Key', naiveFailed);

  await db.execute('DELETE FROM tasks');
  for (const t of kind) {
    await db.execute(
      `INSERT INTO tasks (id,title,description,category_id,parent_task_id,created_at,updated_at,tags)
       VALUES ($1,$2,'','general',NULL,$3,$3,'[]')`,
      [t.id, t.title, now]
    );
  }
  for (const t of kind.filter((x) => x.parent_task_id)) {
    await db.execute(
      'UPDATE tasks SET parent_task_id=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM tasks WHERE id=$1)',
      [t.parent_task_id, t.id]
    );
  }
  const [child] = await db.select("SELECT parent_task_id FROM tasks WHERE id='kind'");
  check('Nachtragen des Elternbezugs funktioniert (insertTasks)', child?.parent_task_id === 'eltern');
  check(
    'Import-Reihenfolge lässt keine Verletzung zurück',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  db.close();
}

console.log('\n7. Sicherung und Wiederaufnahme\n');

const chainDir = join(workDir, 'chain');
const backups = readdirSync(chainDir).filter((f) => f.includes('.pre-v33'));
check(`v33 hat genau eine Sicherung angelegt (${backups.length})`, backups.length === 1, backups.join(', '));
if (backups.length) {
  const restored = new HarnessDb(join(chainDir, backups[0]));
  const hasOld = await restored.select(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='creations'"
  );
  check('Sicherung enthält den Zustand *vor* dem Rebuild', hasOld.length === 1);
  restored.close();
}

{
  // Der Rebuild kann zwischen dropOldTables und dem Stempeln abbrechen: die
  // *_old-Tabellen sind dann schon weg, v33 ist aber ungestempelt. Ohne die
  // alreadyRebuilt-Prüfung liefe repairLegacyDamage beim nächsten Start gegen
  // das bereits umbenannte Schema ("no such column: category") — und weil v33
  // kein legacy-Flag trägt, ließe sich der Vault nie wieder öffnen.
  // Über die Kette gebaut, damit v1–v32 gestempelt bleiben: Nach dem Entfernen
  // der v33-Zeile steht der Stand auf 32 und genau v33 läuft erneut — der
  // Zustand, den ein Absturz kurz vor dem Stempeln hinterlässt.
  const db = await buildViaChain('resume.db');
  await db.execute('DELETE FROM schema_version WHERE version = 33');

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('abgebrochener Rebuild bricht beim nächsten Start nicht', resumed, message);
  check(
    'Schema nach der Wiederaufnahme unverändert',
    (await db.select(
      "SELECT COUNT(*) AS n FROM pragma_table_info('wiki_articles') WHERE name='category_id'"
    ))[0].n === 1
  );
  check(
    'Wiederaufnahme hinterlässt keine FK-Verletzung',
    (await db.select('PRAGMA foreign_key_check')).length === 0
  );
  db.close();
}

console.log('\n8. Migration v35: Bildverweise\n');

{
  const v35 = await buildViaChain('v35.db', seedImageRefs);
  const [entry] = await v35.select("SELECT content FROM journal_entries WHERE id='j1'");
  const [altar] = await v35.select("SELECT background_image_data, icon_data FROM altars WHERE id='a1'");

  check(
    'absoluter Pfad im HTML wurde auf den Dateinamen reduziert',
    entry.content.includes(`src="${LEGACY_IMAGE}"`) && !entry.content.includes('AppData'),
    entry.content
  );
  check(
    'die Data-URL daneben blieb unangetastet',
    entry.content.includes('src="data:image/png;base64,AAAA"'),
    entry.content
  );
  check(
    'absoluter Pfad in einer plain-Spalte wurde reduziert',
    altar.background_image_data === LEGACY_IMAGE,
    altar.background_image_data
  );
  check(
    'eine legacy-Spalte wurde NICHT umgeschrieben',
    altar.icon_data === 'data:image/png;base64,BBBB',
    altar.icon_data
  );

  // Das ist die Eigenschaft, an der die Aufraeum-Aktion haengt: was die
  // Migration kennt, muss auch das Used-Set kennen, sonst loescht die
  // Bereinigung eine noch referenzierte Datei.
  const used = await collectUsedImageFilenames(v35);
  check(
    'collectUsedImageFilenames findet den Verweis wieder',
    used.has(LEGACY_IMAGE),
    [...used].join(', ')
  );
  v35.close();
}

/* ------------------------------------------------------------------ *
 * Konstanten, die es zweimal gibt — einmal in TypeScript, einmal in Rust
 * ------------------------------------------------------------------ */

console.log('\n9. Gespiegelte Konstanten\n');

{
  const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
  const imagesRs = read('src-tauri/src/images.rs');
  const imagesTs = read('src/lib/images.ts');
  const schemaTs = read('src/lib/schema.ts');
  const vaultRs = read('src-tauri/src/vault.rs');
  const vaultManagerTs = read('src/lib/vaultManager.ts');
  const tauriConf = read('src-tauri/tauri.conf.json');

  // Bewusst wortwoertliche Vergleiche statt geparster Werte: wer eine dieser
  // Konstanten aendert, soll hier scheitern und gezwungen sein, die andere
  // Seite mitzuziehen. Ein Kommentar "Mirrors X in Y" leistet das nicht.

  // Der Dateiname eines gespeicherten Bildes ist die Grenze zwischen dem
  // URI-Schema und dem Dateisystem. Laufen die Pruefungen auseinander,
  // akzeptiert eine Seite etwas, das die andere ablehnt.
  check(
    'Bild-Endungen: images.rs kennt dieselben sechs wie schema.ts',
    imagesRs.includes('["png", "jpg", "jpeg", "gif", "webp", "svg"]') &&
      schemaTs.includes('(?:png|jpe?g|gif|webp|svg)')
  );
  check(
    'Hash-Laenge im Dateinamen ist beidseitig 64',
    imagesRs.includes('stem.len() == 64') && schemaTs.includes('[0-9a-f]{64}')
  );

  // Der Datenbankname baut auf der einen Seite den Connection-String, auf der
  // anderen den Guard in delete_vault_files.
  check(
    'DB_FILE stimmt in vault.rs und vaultManager.ts ueberein',
    vaultRs.includes('pub const DB_FILE: &str = "emerald.db"') &&
      vaultManagerTs.includes("const DB_FILE = 'emerald.db'")
  );
  check(
    'Der Bildordner heisst images (Rust ist die einzige Quelle)',
    vaultRs.includes('pub const IMAGES_SUBDIR: &str = "images"')
  );

  // Das Schema steht an drei Stellen: Handler, URL-Bau und CSP. Fehlt eine der
  // beiden URL-Formen in der CSP, bricht genau eine Plattform — und zwar erst
  // im Build fuer sie.
  check(
    'emerald-img: Handler und URL-Bau nennen dasselbe Schema',
    imagesRs.includes('"emerald-img"') &&
      imagesTs.includes('emerald-img://localhost/') &&
      imagesTs.includes('http://emerald-img.localhost/')
  );
  check(
    'img-src erlaubt beide URL-Formen des Schemas',
    tauriConf.includes('emerald-img:') && tauriConf.includes('http://emerald-img.localhost')
  );
}

/* ------------------------------------------------------------------ */

baseline.close();
chain.close();
seeded.close();

console.log('');

if (failures.length) {
  console.error(`\n${failures.length} Prüfung(en) fehlgeschlagen:`);
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error(`\nArbeitsverzeichnis zur Nachschau: ${workDir}\n`);
  process.exit(1);
}

rmSync(workDir, { recursive: true, force: true });
console.log('Alle Prüfungen bestanden.\n');
