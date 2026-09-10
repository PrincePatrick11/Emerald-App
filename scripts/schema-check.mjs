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
    export async function invoke(cmd, args) {
      // vaultManager liest vaults.json und legt es beim ersten Fehlschlag an.
      if (cmd === 'read_file') throw new Error('ENOENT (Harness)');
      // Migration v42 speichert Sigillen-Zeichnungen als Datei: ein fester
      // Name, und ein erzwungener Fehlschlag, wenn die Data-URL „FAIL" trägt.
      if (cmd === 'save_image') {
        if (String(args?.dataUrl ?? '').includes('FAIL')) throw new Error('save_image failed (Harness)');
        return '${'c'.repeat(64)}.png';
      }
      // Ohne vaults.json entscheidet dieses Command, ob ein Erststart vorliegt
      // (leere Vault-Liste) oder eine Altinstallation adoptiert wird. Der
      // Harness braucht den zweiten Fall: eine leere Liste hiesse kein aktiver
      // Vault, und v33 sichert die Datenbankdatei ueber getActiveDbFile().
      if (cmd === 'legacy_default_db_exists') return true;
      // Ein Vault ist ein Verzeichnis; im Harness ist das schlicht das
      // Arbeitsverzeichnis, damit die Sicherung aus v33 dort landet.
      if (cmd === 'migrate_vault_layout' || cmd === 'default_vault_dir' || cmd === 'new_vault_base_dir') {
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
   export { copyTable } from '${process.cwd().replace(/\\/g, '/')}/src/lib/dbRebuild';
   export { assertPayloadReferencesResolve } from '${process.cwd().replace(/\\/g, '/')}/src/lib/dbBackup';
   export { invalidateVaultCache } from '${process.cwd().replace(/\\/g, '/')}/src/lib/vaultManager';
   export { convertLegacySigils } from '${process.cwd().replace(/\\/g, '/')}/src/lib/migrateLegacySigils';`
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

// `dbBackup` zieht über die Volltext-Extraktion `DOMParser` herein, den Node
// nicht kennt. Der Harness parst nie HTML — er prüft Schema und Referenzen —,
// also reicht ein Platzhalter, damit der Import durchgeht.
globalThis.DOMParser ??= class {
  parseFromString() {
    throw new Error('DOMParser wird im Schema-Harness nicht unterstützt');
  }
};

// Ebenso `localStorage`: i18n liest daraus die gespeicherte Sprache. Leer ist
// die richtige Antwort — der Harness läuft englisch, und genau das erwarten
// die Kategorie-Namensprüfungen weiter unten.
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
const {
  runMigrations, MIGRATIONS, TABLES, TABLE_DDL,
  ddlIfNotExists, checkIntegrity, reassignCategoryContent,
  collectUsedImageFilenames, invalidateVaultCache, copyTable,
  assertPayloadReferencesResolve, convertLegacySigils,
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
 * Spielt v1–v32 so ab, wie eine bestehende Datenbank sie gelaufen ist —
 * inklusive des Schluckens von „already applied"-Fehlern, an dem v4 scheitert.
 * Danach steht das Schema von vor dem Rebuild; `seed` darf es befüllen.
 */
async function chainTo32(name, seed) {
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
  return db;
}

/** Der Kettenpfad: v1–v32, dann übernimmt runMigrations und wendet v33–v38 an. */
async function buildViaChain(name, seed) {
  const db = await chainTo32(name, seed);
  await runMigrations(db);
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

/**
 * Journal-Verknuepfungen, wie sie vor v36 in den Spalten standen: eine
 * Operation und ein Wiki-Artikel, davon einer zusaetzlich schon als Chip im
 * Text (darf nicht doppelt angehaengt werden), plus eine Zeile mit kaputtem
 * JSON, die die Migration in Ruhe lassen muss.
 *
 * Eigene Datenbank statt seedLegacyData, damit die Zaehl-Pruefungen dort nicht
 * verrutschen.
 */
async function seedLinkedIds(db) {
  const chip = '<span data-type="internalLink" class="internal-link" data-id="w1" data-entry-type="wiki" data-label="Artikel">Artikel</span>';
  // j1: der Normalfall — eine Operation und ein Artikel, beide nur in den Spalten.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_operation_ids,linked_wiki_ids)
     VALUES ('j1','Eintrag','<p>Bestehender Text</p>',$1,$1,'[]','["o1"]','["w1"]')`,
    [now]
  );
  // j2: kaputtes JSON.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_operation_ids)
     VALUES ('j2','Zweiter','<p>Zweiter</p>',$1,$1,'[]','{oops')`,
    [now]
  );
  // j3: w1 steht schon als Chip im Text (kein zweiter Block), w2 gibt es nicht.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_wiki_ids)
     VALUES ('j3','Dritter',$2,$1,$1,'[]','["w1","w2"]')`,
    [now, `<p>${chip}</p>`]
  );
  // j4: noch leerer Eintrag — der erste Block kommt ohne Trennlinie.
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,linked_operation_ids)
     VALUES ('j4','Vierter','<p></p>',$1,$1,'[]','["o1"]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w1','Artikel','artikel','','ritual',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o1','Operation','','sigils',$1,$1,'[]')`,
    [now]
  );
}

/**
 * Die drei festen Journal-Felder, wie sie vor v37 in den Spalten standen:
 * einmal vollstaendig mit Artikeln und Dauer, einmal ein gesetztes is_bannung
 * ohne Artikel (den Haken gab es vor der Auswahl dahinter), einmal ein
 * Paradigma, dessen Artikel nicht mehr existiert.
 */
async function seedJournalFields(db) {
  for (const [id, title, category] of [
    ['w1', 'Chaos', 'paradigm'],
    ['w2', 'LBRP', 'bannung'],
    ['w3', 'Stilles Sitzen', 'meditation'],
  ]) {
    await db.execute(
      `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
       VALUES ($1,$2,$1,'',$3,$4,$4,'[]')`,
      [id, title, category, now]
    );
  }
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,
       paradigm_id,is_bannung,bannung_type_wiki_id,is_meditation,meditation_type_wiki_id,meditation_duration)
     VALUES ('j1','Eintrag','<p>Bestehender Text</p>',$1,$1,'[]','w1',1,'w2',1,'w3',20)`,
    [now]
  );
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,is_bannung)
     VALUES ('j2','Zweiter','<p></p>',$1,$1,'[]',1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO journal_entries (id,title,content,created_at,updated_at,tags,paradigm_id)
     VALUES ('j3','Dritter','<p>Text</p>',$1,$1,'[]','weg')`,
    [now]
  );
}

/**
 * Kategorien, wie v38 sie zusammenlegen muss — gegen das Schema von vor v33
 * gesetzt, damit sie die ganze Kette durchlaufen: eine eigene Wiki-Kategorie
 * „candle" (kleingeschrieben) gegen das eingebaute Altar-„Candle", eine eigene
 * Operations-Kategorie „Ritual" gegen das eingebaute Wiki-„ritual", ein
 * gelöschtes Wiki-„Foo" gegen ein aktives Tasks-„foo", eine Aufgabe in
 * „general" — und an jeder Kategorie ein Inhalt, dazu Platzierungen und
 * Aufgaben-Verknüpfungen, die den Umbau der Kind-Tabellen überleben müssen.
 */
async function seedCategoryMerge(db) {
  await db.execute(
    `INSERT INTO wiki_categories (id,name,emoji,sort_order,is_builtin) VALUES ('wc1','candle','🔥',50,0)`
  );
  await db.execute(
    `INSERT INTO wiki_categories (id,name,emoji,sort_order,is_builtin,deleted_at) VALUES ('wc2','Foo','🅵',51,0,$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO operation_categories (id,name,emoji,sort_order,is_builtin) VALUES ('oc1','Ritual','🪄',5,0)`
  );
  await db.execute(
    `INSERT INTO task_categories (id,name,emoji,sort_order,is_builtin) VALUES ('tc1','foo','🅵',1,0)`
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w1','Kerzenkunde','kerzenkunde','','wc1',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('w2','Ritualaufbau','ritualaufbau','','ritual',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o1','Abendritual','','oc1',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('o2','Sigill','','sigils',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,created_at,updated_at,tags)
     VALUES ('t1','Allgemeines','','general',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,parent_task_id,created_at,updated_at,tags)
     VALUES ('t2','Foo-Aufgabe','','tc1','t1',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO task_links (id,task_id,target_id,target_type) VALUES ('tl1','t1','w1','wiki')`
  );
  await db.execute(
    `INSERT INTO altars (id,title,intention,background_preset,created_at,updated_at)
     VALUES ('a1','Altar','','midnight',$1,$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_items (id,name,emoji,category,note,created_at) VALUES ('i1','Kerze','🕯️','Candle','',$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_items (id,name,emoji,category,note,created_at) VALUES ('i2','Ding','✨','Other','',$1)`,
    [now]
  );
  await db.execute(
    `INSERT INTO altar_placements (id,altar_id,item_id,x,y) VALUES ('p1','a1','i1',10,20)`
  );
  await db.execute(
    `INSERT INTO altar_placements (id,altar_id,item_id,x,y) VALUES ('p2','a1','i2',30,40)`
  );
}

/**
 * Operationen, wie v41 sie vorfindet: eine inaktive mit Text, eine aktive mit
 * Enddatum und Version ohne Text, eine im Normalzustand, die unberührt bleiben muss.
 * Bewusst nicht in „Sigillen" — dort legt v42 danach das Sigillen-Set davor.
 */
async function seedOperationStatus(db) {
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,is_active,end_date,version)
     VALUES ('s1','Ruhend','<p>Text</p>','other',$1,$1,'[]',0,NULL,NULL)`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,is_active,end_date,version)
     VALUES ('s2','Befristet','','other',$1,$1,'[]',1,'2026-03-01','1.2')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('s3','Normal','<p>unberührt</p>','other',$1,$1,'[]')`,
    [now]
  );
}

/**
 * Sigillen, wie v42 sie vorfindet: eine vollständige (Zeichnung, Absicht,
 * Buchstaben, geladen, Datum, Ladetechnik, Notizen), eine, deren Zeichnung
 * sich nicht speichern lässt, eine leere in der Kategorie und eine
 * gewöhnliche Operation mit Notizen.
 */
async function seedSigils(db) {
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category,created_at,updated_at,tags)
     VALUES ('wt1','Ekstase','ekstase','','other',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,description,intention_text,
       letter_bank,implemented_letters,drawing_data,is_loaded,target_reveal_date,charging_technique_wiki_id)
     VALUES ('g1','Stärke','','sigils',$1,$1,'[]','Notiz','Ich bin stark','["I","C"]','["I"]',
       'data:image/png;base64,AAAA',1,'2099-01-01','wt1')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,drawing_data)
     VALUES ('g2','Klemmt','','sigils',$1,$1,'[]','data:image/png;base64,FAIL')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('g3','Leer','','sigils',$1,$1,'[]')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,description)
     VALUES ('g4','Gewöhnlich','<p>Text</p>','other',$1,$1,'[]','Nur Notiz')`,
    [now]
  );
  // Ausgeblendete Zeichnung, eine Zeichnung, die kein Bild ist, und eine
  // Operation, die schon Sigillen-Blöcke trägt (ein abgebrochener v42-Lauf).
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,drawing_data,show_sigil)
     VALUES ('g5','Versteckt','','sigils',$1,$1,'[]','data:image/png;base64,CCCC',0)`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,drawing_data)
     VALUES ('g6','Kein Bild','','sigils',$1,$1,'[]','data:text/html;base64,PHNjcmlwdD4=')`,
    [now]
  );
  await db.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
     VALUES ('g7','Schon Blöcke','<section data-block="core.sigil.calc" data-block-id="x1"></section>','sigils',$1,$1,'[]')`,
    [now]
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
  `SELECT name FROM sqlite_master WHERE type='table' AND name IN (
     'creations','altar_intentions','custom_properties',
     'wiki_categories','operation_categories','task_categories','altar_categories','_category_id_map'
   ) OR name LIKE '%_old'`
);
check('Altlasten, alte Kategorie-Tabellen und _old-Tabellen entfernt', droppedCheck.length === 0, JSON.stringify(droppedCheck));

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
  // v38 hängt eine unbekannte Kategorie auf `other` um — das ist der Stand,
  // den v39 danach vorfindet, es hängt selbst nichts um.
  'verwaister Artikel beim v38-Aufstieg auf „other" umgehängt',
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
    `INSERT INTO categories (id,name,emoji,sort_order,is_builtin)
     VALUES ('temporaer','Temporär','🧪',99,0)`
  );
  await db.execute(
    `INSERT INTO wiki_articles (id,title,slug,content,category_id,created_at,updated_at,tags)
     VALUES ('a1','Wichtiger Artikel','wichtig','Inhalt','temporaer',$1,$1,'[]')`,
    [now]
  );
  // Dieselbe Kategorie hält seit v38 auch Inhalte der anderen Module.
  await db.execute(
    `INSERT INTO tasks (id,title,description,category_id,created_at,updated_at,tags)
     VALUES ('a1t','Aufgabe','','temporaer',$1,$1,'[]')`,
    [now]
  );

  // Ohne Umhängen muss ON DELETE RESTRICT das Löschen verweigern — sonst
  // entstünde wieder eine category_id ohne Gegenstück.
  let blocked = false;
  try {
    await db.execute("DELETE FROM categories WHERE id='temporaer'");
  } catch {
    blocked = true;
  }
  check('RESTRICT verweigert das Löschen einer belegten Kategorie', blocked);

  const moved = await reassignCategoryContent(db, 'temporaer');
  check('reassignCategoryContent hat Artikel und Aufgabe umgehängt', moved === 2);

  await db.execute("DELETE FROM categories WHERE id='temporaer'");

  const [article] = await db.select("SELECT title, category_id FROM wiki_articles WHERE id='a1'");
  check('Artikel existiert nach der Kategorielöschung weiter', article !== undefined);
  // Seit v39 gibt es kein Sammelbecken mehr: die Inhalte werden kategorielos.
  check('Artikel ist jetzt ohne Kategorie', article?.category_id === null);
  check('Artikelinhalt unverändert', article?.title === 'Wichtiger Artikel');
}

console.log('\n5b. Sicherung mit Einträgen ohne Kategorie\n');

{
  // Die Vorabprüfung des Backup-Imports las `category_id = NULL` als
  // unauflösbare Referenz und brach den ganzen Import ab — also genau bei dem
  // Zustand, mit dem seit v39 jeder neue Eintrag anfängt. Sie läuft vor dem
  // ersten DELETE, die Sicherung war damit schlicht nicht einspielbar.
  const db = freshDb('nullcat.db');
  await runMigrations(db);

  const payload = {
    categories: [{ id: 'sigils', name: 'Sigils' }],
    wikiArticles: [{ id: 'a', title: 'Ohne', category_id: null }],
    operations: [{ id: 'o', title: 'Ohne', category_id: null }],
    tasks: [{ id: 't', title: 'Ohne', category_id: null }],
    altarItems: [{ id: 'i', name: 'Ohne', category_id: null }],
  };

  let accepted = true;
  let message = '';
  try {
    await assertPayloadReferencesResolve(db, payload);
  } catch (err) {
    accepted = false;
    message = String(err?.message ?? err);
  }
  check('Einträge ohne Kategorie blockieren den Import nicht', accepted, message);

  // Ein leerer *String* bleibt ein Treffer ins Leere und muss weiter auffallen.
  let rejected = false;
  try {
    await assertPayloadReferencesResolve(db, { wikiArticles: [{ id: 'b', category_id: '' }] });
  } catch {
    rejected = true;
  }
  check('eine leere Kategorie-ID gilt weiter als kaputte Referenz', rejected);

  // Und eine echte Referenz ins Nichts ebenso.
  let unknownRejected = false;
  try {
    await assertPayloadReferencesResolve(db, { tasks: [{ id: 'c', category_id: 'gibtsnicht' }] });
  } catch {
    unknownRejected = true;
  }
  check('eine unbekannte Kategorie-ID gilt weiter als kaputte Referenz', unknownRejected);
  db.close();
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
         VALUES ($1,$2,'',NULL,$3,$4,$4,'[]')`,
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
       VALUES ($1,$2,'',NULL,NULL,$3,$3,'[]')`,
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
  // Nachgestellt, wie es passiert: v1–v32 gestempelt, v33 einmal durchgelaufen,
  // aber nicht gestempelt — dann übernimmt runMigrations mit v33 erneut.
  const db = await chainTo32('resume.db');
  await MIGRATIONS.find((m) => m.version === 33).up(db);

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('abgebrochener v33-Rebuild bricht beim nächsten Start nicht', resumed, message);
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

{
  // Dasselbe für v38: fertig umgebaut, aber ungestempelt. Beim nächsten Start
  // erkennt contentRebuilt den Stand und holt nur das Aufräumen nach.
  const db = await buildViaChain('resume38.db');
  await db.execute('DELETE FROM schema_version WHERE version = 38');

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('abgebrochener v38-Rebuild bricht beim nächsten Start nicht', resumed, message);
  check(
    'Schema nach der v38-Wiederaufnahme unverändert',
    JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA)
  );
  db.close();
}

{
  // Der gefährliche Moment in v39: Die neuen Tabellen stehen und sind gefüllt,
  // das Aufräumen der *_old hat begonnen — `task_links_old` und
  // `altar_placements_old` sind weg, `tasks_old` und `altar_items_old` noch da.
  // Ohne Marke räumte der nächste Start das fertige `tasks` weg, und dessen
  // ON DELETE CASCADE nähme die ebenfalls fertigen `task_links` mit.
  const db = await buildViaChain('resume39.db', seedLegacyData);
  const before = {
    links: (await db.select('SELECT COUNT(*) n FROM task_links'))[0].n,
    placements: (await db.select('SELECT COUNT(*) n FROM altar_placements'))[0].n,
  };
  check('Ausgangslage: Kind-Tabellen sind gefüllt', before.links > 0 && before.placements > 0,
    JSON.stringify(before));

  // Den Abbruch nachstellen: v39 entstempeln, den Rebuild von Hand bis kurz
  // vor Schluss nachbauen. Die Stempel danach (v40–v42) mit: ein Abbruch in
  // v39 kommt nie bis zu ihnen, und der Lauf setzt beim höchsten Stempel an.
  await db.execute('DELETE FROM schema_version WHERE version >= 39');
  for (const t of ['task_links', 'altar_placements', 'tasks', 'altar_items', 'operations', 'wiki_articles']) {
    await db.execute(`ALTER TABLE ${t} RENAME TO ${t}_old`);
  }
  for (const t of ['wiki_articles', 'operations', 'altar_items', 'tasks', 'altar_placements', 'task_links']) {
    await db.execute(TABLE_DDL[t]);
    await copyTable(db, t, `${t}_old`);
  }
  await db.execute('CREATE TABLE IF NOT EXISTS _v39_content_rebuilt (done INTEGER)');
  await db.execute('DROP TABLE task_links_old');
  await db.execute('DROP TABLE altar_placements_old');

  let resumed = true;
  let message = '';
  try {
    await runMigrations(db);
  } catch (err) {
    resumed = false;
    message = String(err?.message ?? err);
  }
  check('abgebrochenes v39-Aufräumen bricht beim nächsten Start nicht', resumed, message);
  check(
    'Wiederaufnahme hat die Kind-Tabellen nicht per CASCADE geleert',
    (await db.select('SELECT COUNT(*) n FROM task_links'))[0].n === before.links &&
      (await db.select('SELECT COUNT(*) n FROM altar_placements'))[0].n === before.placements,
    JSON.stringify({
      before,
      links: (await db.select('SELECT COUNT(*) n FROM task_links'))[0].n,
      placements: (await db.select('SELECT COUNT(*) n FROM altar_placements'))[0].n,
    })
  );
  check(
    'Marke und *_old-Tabellen sind aufgeräumt',
    (await db.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name='_v39_content_rebuilt' OR name LIKE '%_old')"
    )).length === 0
  );
  check(
    'Indizes stehen auch nach der Wiederaufnahme',
    (await db.select(
      "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='idx_wiki_articles_category'"
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

console.log('\n8b. Migration v36: Journal-Verknuepfungen in den Inhalt\n');

{
  const v36 = await buildViaChain('v36.db', seedLinkedIds);
  const [entry] = await v36.select(
    "SELECT content, linked_operation_ids, linked_wiki_ids FROM journal_entries WHERE id='j1'"
  );
  const [broken] = await v36.select(
    "SELECT content, linked_operation_ids FROM journal_entries WHERE id='j2'"
  );
  const links = await v36.select("SELECT target_id, target_type FROM links WHERE source_id='j1'");

  check(
    'die Operation steht als Link-Chip im Inhalt',
    entry.content.includes('data-id="o1"') && entry.content.includes('data-entry-type="operation"'),
    entry.content
  );
  check(
    'der Wiki-Artikel ebenso',
    entry.content.includes('data-id="w1"') && entry.content.includes('data-entry-type="wiki"'),
    entry.content
  );
  check(
    'jeder Link bekam Trennlinie und Kategorie-Ueberschrift',
    (entry.content.match(/<hr>/g) ?? []).length === 2 && (entry.content.match(/<h3>/g) ?? []).length === 2,
    entry.content
  );
  check(
    'der vorhandene Text blieb davor stehen',
    entry.content.startsWith('<p>Bestehender Text</p>'),
    entry.content
  );
  check(
    'die beiden Spalten sind geleert',
    entry.linked_operation_ids === '[]' && entry.linked_wiki_ids === '[]',
    `${entry.linked_operation_ids} / ${entry.linked_wiki_ids}`
  );
  // Die Migration schreibt an den Stores vorbei und muss den Spiegel selbst
  // nachziehen — sonst fehlen dem Eintrag seine Rueckverweise.
  check(
    'die links-Tabelle wurde nachgezogen',
    links.length === 2 && links.some((l) => l.target_id === 'o1' && l.target_type === 'operation'),
    JSON.stringify(links)
  );
  // Kaputtes JSON darf die Spalte nicht leeren: der Originalwert waere sonst
  // unwiederbringlich weg.
  check(
    'kaputtes JSON laesst die Zeile unangetastet',
    broken.linked_operation_ids === '{oops' && broken.content === '<p>Zweiter</p>',
    `${broken.linked_operation_ids} / ${broken.content}`
  );

  const [third] = await v36.select(
    "SELECT content, linked_wiki_ids FROM journal_entries WHERE id='j3'"
  );
  check(
    'ein bereits im Text verlinktes Ziel wird nicht doppelt angehaengt',
    (third.content.match(/data-id="w1"/g) ?? []).length === 1 && !third.content.includes('<hr>'),
    third.content
  );
  check(
    'ein nicht mehr existierendes Ziel wird uebersprungen, die Spalte trotzdem geleert',
    !third.content.includes('data-id="w2"') && third.linked_wiki_ids === '[]',
    `${third.content} / ${third.linked_wiki_ids}`
  );

  const [fourth] = await v36.select("SELECT content FROM journal_entries WHERE id='j4'");
  check(
    'im leeren Eintrag bleibt die Trennlinie weg',
    !fourth.content.includes('<hr>') && fourth.content.includes('data-id="o1"'),
    fourth.content
  );

  v36.close();
}

console.log('\n8c. Migration v37: Paradigma/Bannung/Meditation in den Inhalt\n');

{
  const v37 = await buildViaChain('v37.db', seedJournalFields);
  const [entry] = await v37.select(
    `SELECT content, paradigm_id, is_bannung, bannung_type_wiki_id,
            is_meditation, meditation_type_wiki_id, meditation_duration
       FROM journal_entries WHERE id='j1'`
  );
  const links = await v37.select("SELECT target_id, target_type FROM links WHERE source_id='j1'");

  check(
    'alle drei Felder stehen als Link-Chip im Inhalt',
    ['w1', 'w2', 'w3'].every((id) => entry.content.includes(`data-id="${id}"`)),
    entry.content
  );
  check(
    'jedes bekam Trennlinie und Kategorie-Ueberschrift',
    (entry.content.match(/<hr>/g) ?? []).length === 3 && (entry.content.match(/<h3>/g) ?? []).length === 3,
    entry.content
  );
  // Die Dauer hat kein Link-Ziel und wuerde ohne den Textzusatz verschwinden.
  check(
    'die Meditationsdauer steht als Text hinter ihrem Chip',
    /data-id="w3"[\s\S]*?<\/span> \(20 min\)/.test(entry.content),
    entry.content
  );
  check(
    'der vorhandene Text blieb davor stehen',
    entry.content.startsWith('<p>Bestehender Text</p>'),
    entry.content
  );
  check(
    'alle sechs Spalten sind geleert',
    entry.paradigm_id === null && entry.is_bannung === 0 && entry.bannung_type_wiki_id === null &&
      entry.is_meditation === 0 && entry.meditation_type_wiki_id === null && entry.meditation_duration === null,
    JSON.stringify(entry)
  );
  check(
    'die links-Tabelle wurde nachgezogen',
    links.length === 3 && links.every((l) => l.target_type === 'wiki'),
    JSON.stringify(links)
  );

  const [flagOnly] = await v37.select("SELECT content, is_bannung FROM journal_entries WHERE id='j2'");
  // Ein Haken ohne Artikel kann keinen Chip ergeben — der Name der Kategorie
  // bleibt als Text, sonst waere die Angabe ersatzlos weg.
  check(
    'ein gesetztes is_bannung ohne Artikel wird zu Text, im leeren Eintrag ohne Trennlinie',
    /<p>🚫 .+<\/p>/.test(flagOnly.content) && !flagOnly.content.includes('<hr>') &&
      !flagOnly.content.includes('data-type="internalLink"') && flagOnly.is_bannung === 0,
    flagOnly.content
  );

  const [gone] = await v37.select("SELECT content, paradigm_id FROM journal_entries WHERE id='j3'");
  check(
    'ein nicht mehr existierender Artikel wird uebersprungen, die Spalte trotzdem geleert',
    gone.content === '<p>Text</p>' && gone.paradigm_id === null,
    `${gone.content} / ${gone.paradigm_id}`
  );

  v37.close();
}

console.log('\n8d. Migration v38: vier Kategorie-Tabellen werden eine\n');

{
  const v38 = await buildViaChain('v38.db', seedCategoryMerge);
  const one = async (sql) => (await v38.select(sql))[0];
  const cats = await v38.select('SELECT id, name, emoji, is_builtin, deleted_at, sort_order FROM categories ORDER BY sort_order');
  const byId = new Map(cats.map((c) => [c.id, c]));

  check(
    'die vier alten Tabellen sind weg, die eine ist da',
    (await v38.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('wiki_categories','operation_categories','task_categories','altar_categories','_category_id_map')"
    )).length === 0 && byId.size > 0
  );
  check(
    'genau ein „Sonstiges" — die drei „other" und das Tasks-„general" gingen darin auf',
    cats.filter((c) => c.name.toLowerCase() === 'other' || c.id === 'general').length === 1,
    JSON.stringify(cats)
  );
  check(
    // v38 legt es als Builtin an, v39 nimmt ihm das wieder: als gewöhnliche
    // Kategorie behält es seine Inhalte und lässt sich umbenennen und löschen.
    'v39: „other" ist eine gewöhnliche Kategorie mit übersetztem Namen',
    byId.get('other')?.is_builtin === 0 && byId.get('other')?.name === 'Other',
    JSON.stringify(cats)
  );
  check('„sigils" bleibt eingebaut', byId.get('sigils')?.is_builtin === 1);
  check(
    'eigene Wiki-„candle" und eingebaute Altar-„Candle" sind eine Kategorie (Wiki gewinnt)',
    byId.has('wc1') && !byId.has('candle') && byId.get('wc1').emoji === '🔥',
    JSON.stringify(cats)
  );
  check(
    'das Altar-Element hängt jetzt an der zusammengelegten Kategorie',
    (await one("SELECT category_id c FROM altar_items WHERE id='i1'")).c === 'wc1'
  );
  check(
    'eigene Operations-„Ritual" ging im Wiki-„ritual" auf, die Operation folgt',
    !byId.has('oc1') && byId.has('ritual') &&
      (await one("SELECT category_id c FROM operations WHERE id='o1'")).c === 'ritual'
  );
  check(
    'ehemalige Builtins sind normale Kategorien mit übersetztem Namen',
    byId.get('ritual')?.is_builtin === 0 && byId.get('ritual')?.name === 'Ritual'
  );
  check(
    'gelöschtes Wiki-„Foo" und aktives Tasks-„foo" sind eine aktive Kategorie',
    byId.has('wc2') && byId.get('wc2').deleted_at === null && !byId.has('tc1') &&
      (await one("SELECT category_id c FROM tasks WHERE id='t2'")).c === 'wc2'
  );
  check(
    'Aufgabe aus „general" liegt in „other"',
    (await one("SELECT category_id c FROM tasks WHERE id='t1'")).c === 'other'
  );
  check(
    'Unteraufgabe behält ihren Elternteil',
    (await one("SELECT parent_task_id p FROM tasks WHERE id='t2'")).p === 't1'
  );
  check(
    'Artikel unverändert an ihren Kategorien',
    (await one("SELECT category_id c FROM wiki_articles WHERE id='w1'")).c === 'wc1' &&
      (await one("SELECT category_id c FROM wiki_articles WHERE id='w2'")).c === 'ritual'
  );
  // Die Falle des Umbaus: das Umbenennen von altar_items/tasks biegt die
  // Fremdschlüssel der Kind-Tabellen um — ohne den Mit-Umbau nähme das DROP
  // der *_old-Tabellen alle Platzierungen und Aufgaben-Verknüpfungen mit.
  check(
    'Altar-Platzierungen haben den Umbau überlebt',
    (await one('SELECT COUNT(*) n FROM altar_placements')).n === 2
  );
  check(
    'Aufgaben-Verknüpfungen haben den Umbau überlebt',
    (await one('SELECT COUNT(*) n FROM task_links')).n === 1
  );
  check(
    // Die Reihenfolge stammt aus v38; v39 sortiert nicht um.
    'Sigillen vorn, Sonstiges hinten',
    cats[0].id === 'sigils' && cats[cats.length - 1].id === 'other'
  );
  const v38Violations = await v38.select('PRAGMA foreign_key_check');
  check('v38: foreign_key_check leer', v38Violations.length === 0, JSON.stringify(v38Violations));
  check(
    'v38: Schema identisch mit der Baseline',
    JSON.stringify(await readSchema(v38)) === JSON.stringify(schemaA)
  );

  const v38Backups = readdirSync(join(workDir, 'v38')).filter((f) => f.includes('.pre-v38'));
  check(`v38 hat genau eine Sicherung angelegt (${v38Backups.length})`, v38Backups.length === 1, v38Backups.join(', '));
  if (v38Backups.length) {
    const restored = new HarnessDb(join(workDir, 'v38', v38Backups[0]));
    const hasOld = await restored.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_categories'"
    );
    check('v38-Sicherung enthält den Zustand *vor* dem Zusammenlegen', hasOld.length === 1);
    restored.close();
  }
  v38.close();
}

console.log('\n8e. Frischer Vault: Builtins und Starter-Set\n');

{
  const cats = await baseline.select('SELECT id, name, is_builtin, sort_order FROM categories ORDER BY sort_order');
  check(
    // Seit v39 nur noch eines. `other` wird gar nicht mehr angelegt: es war
    // der Standard für neue Einträge, und die haben jetzt schlicht keine.
    'genau ein Builtin, „sigils", und kein „other"',
    cats.filter((c) => c.is_builtin === 1).length === 1 &&
      cats[0].id === 'sigils' && !cats.some((c) => c.id === 'other'),
    JSON.stringify(cats)
  );
  check(
    'Starter-Set als normale Kategorien, übersetzt (Harness: en)',
    cats.some((c) => c.id === 'herbs' && c.is_builtin === 0 && c.name === 'Herbs'),
    JSON.stringify(cats)
  );
}

console.log('\n8f. Migration v41: Status, Enddatum und Version werden ein Block\n');

{
  const v41 = await buildViaChain('v41.db', seedOperationStatus);
  const op = async (id) => (await v41.select('SELECT content, is_active, end_date, version, updated_at FROM operations WHERE id=?1', [id]))[0];
  const [s1, s2, s3] = [await op('s1'), await op('s2'), await op('s3')];
  const defs = await v41.select("SELECT id, elements FROM block_definitions WHERE id='core-status'");

  check(
    'die inaktive Operation hat den Status-Block vor ihrem Text',
    // Mit zwei Blöcken bekommt auch der Text seinen Wrapper.
    s1.content.startsWith('<section data-block="core.fields"') && s1.content.includes('data-block-origin="core-status"') &&
      s1.content.endsWith('<p>Text</p></section>'),
    s1.content
  );
  check('Enddatum und Version stehen im Block', s2.content.includes('2026-03-01') && s2.content.includes('1.2'), s2.content);
  check(
    'die drei Spalten sind geleert',
    [s1, s2].every((r) => r.is_active === 1 && r.end_date === null && r.version === null),
    JSON.stringify([s1, s2])
  );
  check('eine Operation ohne Altstatus bleibt unberührt', s3.content === '<p>unberührt</p>', s3.content);
  check('updated_at bleibt, wie es war', [s1, s2, s3].every((r) => r.updated_at === now));
  check(
    'die Definition „Status" gibt es genau einmal, mit drei Elementen',
    defs.length === 1 && JSON.parse(defs[0].elements).length === 3,
    JSON.stringify(defs)
  );
  // Über die Kette, nicht die Baseline: nur dort läuft v41 überhaupt.
  const plain = await buildViaChain('v41-plain.db', async (db) => {
    await db.execute(
      `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags)
       VALUES ('p1','Normal','<p>x</p>','other',$1,$1,'[]')`,
      [now]
    );
  });
  check(
    'ohne Altstatus legt v41 keine Definition an',
    (await plain.select('SELECT COUNT(*) AS n FROM block_definitions'))[0].n === 0
  );
  plain.close();
  check('v41: Schema identisch mit der Baseline', JSON.stringify(await readSchema(v41)) === JSON.stringify(schemaA));
  v41.close();
}

console.log('\n8g. Migration v42: Sigillen werden Blöcke\n');

{
  const v42 = await buildViaChain('v42.db', seedSigils);
  const op = async (id) => (await v42.select(
    'SELECT content, drawing_data, intention_text, is_loaded, description, updated_at FROM operations WHERE id=?1', [id]
  ))[0];
  const [g1, g2, g3, g4] = [await op('g1'), await op('g2'), await op('g3'), await op('g4')];
  const image = `${'c'.repeat(64)}.png`;

  check(
    'vollständige Sigille: Rechner, Zeichnung (als Datei), Ladung, Notizen',
    g1.content.startsWith('<section data-block="core.sigil.calc"') && g1.content.includes(`src="${image}"`) &&
      g1.content.includes('data-block="core.sigil.charge"') && g1.content.includes('data-id="wt1"') &&
      g1.content.includes('<p>Notiz</p>') && g1.content.includes('Ich bin stark'),
    g1.content
  );
  check('keine Base64-Zeichnung im Inhalt', !g1.content.includes('base64'));
  check(
    'die Sigillen-Spalten sind geleert',
    g1.drawing_data === null && g1.intention_text === '' && g1.is_loaded === 0 && g1.description === '',
    JSON.stringify(g1)
  );
  check(
    'die Ladetechnik steht in der links-Tabelle',
    (await v42.select("SELECT COUNT(*) AS n FROM links WHERE source_id='g1' AND target_id='wt1'"))[0].n === 1
  );
  check(
    'scheitert das Speichern der Zeichnung, bleibt die Zeile unberührt',
    g2.drawing_data === 'data:image/png;base64,FAIL' && g2.content === '',
    JSON.stringify(g2)
  );
  check(
    'die leere Operation der Kategorie bekommt das Sigillen-Set',
    ['core.sigil.calc', 'core.sigil.canvas', 'core.sigil.charge'].every((t) => g3.content.includes(`data-block="${t}"`)),
    g3.content
  );
  check(
    'eine gewöhnliche Operation mit Notizen bekommt nur den Textblock',
    g4.content.includes('Nur Notiz') && g4.content.includes('<p>Text</p>') && !g4.content.includes('core.sigil'),
    g4.content
  );
  check('updated_at bleibt, wie es war', [g1, g2, g3, g4].every((r) => r.updated_at === now));
  check(
    'v42 hat vorher eine Sicherung angelegt',
    readdirSync(join(workDir, 'v42')).some((f) => f.includes('.pre-v42'))
  );

  // Nachholen beim Öffnen: nur Zeilen mit Altdaten — eine Sigille, der der
  // Nutzer die Blöcke genommen hat, bekommt sie nicht zurück.
  await v42.execute("UPDATE operations SET content='<p>ohne</p>' WHERE id='g3'");
  await v42.execute("UPDATE operations SET drawing_data='data:image/png;base64,BBBB' WHERE id='g2'");
  const retry = await convertLegacySigils(v42, { includeSigilCategory: false });
  const [g2b, g3b] = [await op('g2'), await op('g3')];
  check('das Nachholen wandelt die gescheiterte Zeile um', retry.converted === 1 && g2b.content.includes(`src="${image}"`), JSON.stringify(retry));
  check('das Nachholen fügt einer geleerten Sigille nichts hinzu', g3b.content === '<p>ohne</p>', g3b.content);

  const [g5, g6, g7] = [await op('g5'), await op('g6'), await op('g7')];
  check(
    '`show_sigil = 0` ohne Ladung: der Zeichnungs-Block ist ausgeblendet',
    /<section data-block="core\.sigil\.canvas"[^>]*data-block-hidden="1"/.test(g5.content),
    g5.content
  );
  check(
    'eine Zeichnung, die kein Bild ist, wird verworfen statt endlos wiederholt',
    g6.drawing_data === null && g6.content.includes('core.sigil.calc') && !g6.content.includes('src='),
    JSON.stringify(g6)
  );
  check(
    'trägt der Inhalt schon Sigillen-Blöcke, kommt kein zweites Set dazu',
    g7.content.split('core.sigil.calc').length === 2,
    g7.content
  );

  // Import: nur die eingefügten Zeilen, samt leerer Operationen der Kategorie.
  await v42.execute(
    `INSERT INTO operations (id,title,content,category_id,created_at,updated_at,tags,intention_text)
     VALUES ('h1','Importiert','','sigils',?1,?1,'[]','A'), ('h2','Fremd','','other',?1,?1,'[]','B'),
            ('h3','Leer importiert','','sigils',?1,?1,'[]','')`,
    [now]
  );
  const imported = await convertLegacySigils(v42, { includeSigilCategory: true, ids: new Set(['h1', 'h3']) });
  const [h1, h2, h3] = [await op('h1'), await op('h2'), await op('h3')];
  check(
    'Import: nur die eingefügten Zeilen werden umgewandelt',
    imported.converted === 2 && h1.content.includes('core.sigil.calc') && h3.content.includes('core.sigil.charge') && h2.content === '',
    JSON.stringify(imported)
  );

  check('v42: Schema identisch mit der Baseline', JSON.stringify(await readSchema(v42)) === JSON.stringify(schemaA));
  v42.close();
}

console.log('\n8h. Umstempeln: Blöcke-Migrationen mit alter Zählung (v39–v41)\n');

{
  // Der Blöcke-Zweig zählte block_definitions/Status/Sigillen zuerst als
  // v39–v41; v39 ging danach an category_optional. Einen solchen
  // Entwicklungs-Vault nachstellen: Stempel zurückdrehen, v39 fehlt.
  const db = await buildViaChain('renumber.db', async () => {});
  await db.execute("DELETE FROM schema_version WHERE name = 'category_optional'");
  await db.execute("UPDATE schema_version SET version = 39 WHERE name = 'block_definitions'");
  await db.execute("UPDATE schema_version SET version = 40 WHERE name = 'operation_status_to_blocks'");
  await db.execute("UPDATE schema_version SET version = 41 WHERE name = 'sigils_to_blocks'");
  await runMigrations(db);
  const stamps = Object.fromEntries(
    (await db.select('SELECT name, version FROM schema_version WHERE version >= 39')).map((r) => [r.name, r.version])
  );
  check(
    'alte Zählung wird umgestempelt und v39 nachgeholt',
    stamps.category_optional === 39 && stamps.block_definitions === 40 &&
      stamps.operation_status_to_blocks === 41 && stamps.sigils_to_blocks === 42,
    JSON.stringify(stamps)
  );
  check('umgestempelter Vault: Schema identisch mit der Baseline', JSON.stringify(await readSchema(db)) === JSON.stringify(schemaA));
  db.close();
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
