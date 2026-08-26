/**
 * Full-database backup (.emeralddb) — export and import.
 *
 * Export: queries the active vault and serialises all selected tables to a
 * self-contained JSON file with embedded base64 images.
 *
 * Import modes:
 *   replace  — wipe the current vault and restore from backup
 *   merge    — insert all backup rows with a date-based ID prefix (no overwrites)
 *   add-vault — create a new vault from the backup and switch to it
 */

import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { getDb } from './db';
import {
  addVault,
  getActiveDbFile,
  getActiveVaultId,
  invalidateVaultCache,
  joinPath,
  newVaultRecord,
} from './vaultManager';
import { imageRefsInHtml, isStoredImage, readImageAsBase64, saveImage } from './images';
import { clearSearchTextCache } from './searchText';
import { IMAGE_FIELDS, imageColumns } from './schema';
import { useVaultStore } from '../store/vaultStore';
import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useTagStore } from '../store/tagStore';
import { useRoutineStore } from '../store/routineStore';
import { useAltarStore } from '../store/altarStore';
import { useTaskStore } from '../store/taskStore';
import { useUIStore } from '../store/uiStore';
import { resumeEditorSaves, suspendEditorSaves } from './editorLock';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface BackupOptions {
  includeJournal: boolean;
  includeWiki: boolean;
  includeOperations: boolean;
  includeRoutines: boolean;
  includeAltars: boolean;
  includeTasks: boolean;
  includeTags: boolean;
  dateFrom: string;       // ISO date string, '' = no lower bound
  dateTo: string;         // ISO date string, '' = no upper bound
  includeDeleted: boolean;
}

export type ImportMode = 'replace' | 'merge' | 'add-vault';

export interface BackupCategoryEntry {
  id: string;
  name: string;
  emoji: string;
  is_builtin: number;
}

export interface BackupPreview {
  exportedAt: string;
  journalCount: number;
  wikiCount: number;
  opsCount: number;
  routinesCount: number;
  altarsCount: number;
  taskCount: number;
  taskCategoriesCount: number;
  wikiCategories: BackupCategoryEntry[];
  opCategories: BackupCategoryEntry[];
}

/** Which top-level content types to import. */
export interface ImportTypeFilters {
  includeJournal: boolean;
  includeWiki: boolean;
  includeOperations: boolean;
  includeRoutines: boolean;
  includeAltars: boolean;
  includeTasks: boolean;
  includeTags: boolean;
}

/** Category IDs to exclude during import. Empty set = import all. */
export interface ImportCategoryFilters {
  excludedWikiCategoryIds: Set<string>;
  excludedOpCategoryIds: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * '1' = vor der Schema-Vereinheitlichung (`wiki_articles.category`,
 * `altar_items.category` mit dem Kategorie-*Namen*), '2' = danach, '3' = seit
 * Bilder als Dateiname statt als absoluter Pfad referenziert werden.
 */
const BACKUP_VERSION = '3' as const;

/**
 * Hebt eine Sicherung im alten Format auf das aktuelle.
 *
 * Ohne diesen Schritt wuerde `insertRows` die unbekannt gewordene Spalte
 * `category` still verwerfen — jeder Artikel aus einer älteren Sicherung
 * landete kommentarlos in der Default-Kategorie. Der Filter dort schuetzt vor
 * präparierten Dateien und kann nicht zwischen bösartig und veraltet
 * unterscheiden; also wird hier übersetzt, bevor er greift.
 */
export function migrateBackupPayload(backup: BackupFile): void {
  // Eine Version, die diese App noch nicht kennt, wird zurückgewiesen statt
  // umgestempelt — sonst liefe eine Datei aus einer neueren Version durch den
  // Import, als wäre sie verstanden worden. `.emerald` hält es ebenso.
  if (backup.version > BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${backup.version}`);
  }

  // v2 → v3 braucht keinen Schritt: geaendert hat sich nur, dass Bilder als
  // Dateiname statt als absoluter Pfad referenziert werden, und `restoreImages`
  // uebersetzt die Schluessel der Datei so oder so.
  if (backup.version !== '1') {
    backup.version = BACKUP_VERSION;
    return;
  }

  for (const row of backup.data.wikiArticles ?? []) {
    if (row.category_id === undefined && row.category !== undefined) {
      row.category_id = row.category;
    }
    delete row.category;
  }

  // altar_items hielt früher den Kategorie-*Namen*. Erst gegen die Kategorien
  // aus derselben Sicherung aufloesen, sonst auf 'other'.
  const byName = new Map<string, string>(
    (backup.data.altarCategories ?? []).map((c) => [String(c.name), String(c.id)])
  );
  const byId = new Set((backup.data.altarCategories ?? []).map((c) => String(c.id)));
  for (const row of backup.data.altarItems ?? []) {
    if (row.category_id === undefined) {
      const raw = row.category === undefined ? '' : String(row.category);
      row.category_id = byId.has(raw) ? raw : (byName.get(raw) ?? 'other');
    }
    delete row.category;
  }

  for (const row of backup.data.journalEntries ?? []) {
    row.linked_operation_ids = row.linked_operation_ids ?? '[]';
    row.linked_wiki_ids = row.linked_wiki_ids ?? '[]';
  }

  backup.version = BACKUP_VERSION;
}

interface BackupFile {
  version: '1' | '2' | '3';
  type: 'backup';
  exportedAt: string;
  filters: BackupOptions;
  data: {
    journalEntries?: Row[];
    wikiArticles?: Row[];
    wikiCategories?: Row[];
    operations?: Row[];
    operationCategories?: Row[];
    tags?: Row[];
    routines?: Row[];
    altars?: Row[];
    altarCategories?: Row[];
    altarItems?: Row[];
    altarPlacements?: Row[];
    tasks?: Row[];
    taskCategories?: Row[];
    taskLinks?: Row[];
    links?: Row[];
  };
  images: Record<string, string>;  // gespeicherter Dateiname → data-URL (in v1/v2: absoluter Pfad)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traegt jeden Bildverweis der Zeilen in `into` ein.
 *
 * Die Spaltenliste kommt aus `IMAGE_FIELDS`, damit sie dieselbe ist, die
 * Migration v35 und die Aufraeum-Aktion benutzen. Vorher stand sie hier
 * dreimal von Hand — und `doReplace` und `doMerge` waren fuer `altars` bereits
 * auseinandergelaufen.
 */
function collectImageRefs(table: string, rows: Row[] | undefined, into: Set<string>): void {
  const fields = IMAGE_FIELDS.find((f) => f.table === table);
  if (!fields || !rows) return;
  for (const row of rows) {
    for (const column of fields.html) {
      const value = row[column];
      if (typeof value === 'string') imageRefsInHtml(value).forEach((ref) => into.add(ref));
    }
    for (const column of [...fields.plain, ...fields.legacy]) {
      const value = row[column];
      if (isStoredImage(value as string)) into.add(value as string);
    }
  }
}

/**
 * Builds a created_at filter clause with positional params.
 *
 * Note: placeholders start at $1, so callers must append this clause before
 * adding any other positional parameters to the same query.
 */
function buildDateFilter(dateFrom: string, dateTo: string): { clause: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (dateFrom) {
    parts.push('created_at >= $1');
    params.push(dateFrom);
  }
  if (dateTo) {
    parts.push(`created_at <= $${params.length + 1}`);
    params.push(`${dateTo}T23:59:59`);
  }
  return {
    clause: parts.length ? `AND ${parts.join(' AND ')}` : '',
    params,
  };
}

function deletedFilter(includeDeleted: boolean): string {
  return includeDeleted ? '' : 'AND deleted_at IS NULL';
}

/**
 * Höchstzahl gebundener Werte pro Abfrage. SQLite verträgt weit mehr, aber ein
 * fester Schnitt macht die Abfrage unabhängig von der Größe des Vaults.
 */
const IN_CHUNK = 400;

/**
 * Führt eine Abfrage mit einer `IN (...)`-Liste aus, ohne die Werte in den
 * SQL-String zu schreiben.
 *
 * Der Vorgänger baute die Liste per String-Konkatenation. Die IDs darin sind
 * nicht zwingend von der App vergeben: Ein Backup-Import übernimmt sie wörtlich
 * aus der Datei, und beim nächsten Export landeten sie ungebunden in
 * `db.select`. sqlx zerlegt SQL an `;` und führt jede Anweisung aus
 * (`sqlx-sqlite/src/statement/virtual.rs`), womit eine präparierte
 * `.emeralddb` beliebiges SQL ausführen konnte — eine Injection zweiter
 * Ordnung, ausgelöst erst durch eine spätere, harmlos aussehende Aktion.
 */
async function selectWhereIn(
  db: Awaited<ReturnType<typeof getDb>>,
  buildSql: (placeholders: string) => string,
  rows: Row[],
  field: string = 'id',
): Promise<Row[]> {
  const ids = rows.map((r) => String(r[field]));
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const placeholders = chunk.map((_, n) => `$${n + 1}`).join(',');
    out.push(...(await db.select<Row[]>(buildSql(placeholders), chunk)));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/** Resolves to `false` when the save dialog was cancelled — nichts wurde
 *  geschrieben, und die Oberflaeche darf dann auch keinen Erfolg melden. */
export async function exportDatabase(options: BackupOptions): Promise<boolean> {
  const db = await getDb();
  const data: BackupFile['data'] = {};
  const allImagePaths = new Set<string>();

  const { clause: dateClause, params: dateParams } = buildDateFilter(options.dateFrom, options.dateTo);
  const deletedClause = deletedFilter(options.includeDeleted);

  // ── Journal ──────────────────────────────────────────────────────────────
  if (options.includeJournal) {
    data.journalEntries = await db.select<Row[]>(
      `SELECT * FROM journal_entries WHERE 1=1 ${dateClause} ${deletedClause}`,
      dateParams,
    );
    const lnks = await selectWhereIn(
      db,
      (ph) => `SELECT * FROM links WHERE source_type='journal' AND source_id IN (${ph})`,
      data.journalEntries,
    );
    if (lnks.length) data.links = [...(data.links ?? []), ...lnks];
    collectImageRefs('journal_entries', data.journalEntries, allImagePaths);
  }

  // ── Wiki ─────────────────────────────────────────────────────────────────
  if (options.includeWiki) {
    data.wikiArticles = await db.select<Row[]>(
      `SELECT * FROM wiki_articles WHERE 1=1 ${dateClause} ${deletedClause}`,
      dateParams,
    );
    data.wikiCategories = await db.select<Row[]>(
      // Auch soft-geloeschte Kategorien: ihre Artikel werden mitexportiert und
      // brauchen ihr Gegenstueck, sonst scheitert der Import am Foreign Key.
      `SELECT * FROM wiki_categories`
    );
    const lnks = await selectWhereIn(
      db,
      (ph) => `SELECT * FROM links WHERE source_type='wiki' AND source_id IN (${ph})`,
      data.wikiArticles,
    );
    if (lnks.length) data.links = [...(data.links ?? []), ...lnks];
    collectImageRefs('wiki_articles', data.wikiArticles, allImagePaths);
  }

  // ── Operations ───────────────────────────────────────────────────────────
  if (options.includeOperations) {
    data.operations = await db.select<Row[]>(
      `SELECT * FROM operations WHERE 1=1 ${dateClause} ${deletedClause}`,
      dateParams,
    );
    data.operationCategories = await db.select<Row[]>(
      `SELECT * FROM operation_categories`
    );
    const lnks = await selectWhereIn(
      db,
      (ph) => `SELECT * FROM links WHERE source_type='operation' AND source_id IN (${ph})`,
      data.operations,
    );
    if (lnks.length) data.links = [...(data.links ?? []), ...lnks];
    collectImageRefs('operations', data.operations, allImagePaths);
  }

  // ── Routines ─────────────────────────────────────────────────────────────
  if (options.includeRoutines) {
    data.routines = await db.select<Row[]>(
      `SELECT * FROM routines WHERE 1=1 ${dateClause}`,
      dateParams,
    );
  }

  // ── Altars ───────────────────────────────────────────────────────────────
  if (options.includeAltars) {
    data.altars = await db.select<Row[]>(
      `SELECT * FROM altars WHERE 1=1 ${dateClause}`,
      dateParams,
    );
    // altar_categories has no deleted_at column; export all rows
    data.altarCategories = await db.select<Row[]>(`SELECT * FROM altar_categories`);
    // Only export items and placements that belong to the filtered altars
    if (!data.altars.length) {
      data.altarItems = [];
      data.altarPlacements = [];
    } else {
      data.altarPlacements = await selectWhereIn(
        db,
        (ph) => `SELECT * FROM altar_placements WHERE altar_id IN (${ph})`,
        data.altars,
      );
      // altar_items aren't directly tied to an altar (linked via placements)
      const placedItems = await selectWhereIn(
        db,
        (ph) => `SELECT DISTINCT item_id FROM altar_placements WHERE altar_id IN (${ph})`,
        data.altars,
      );
      data.altarItems = await selectWhereIn(
        db,
        (ph) => `SELECT * FROM altar_items WHERE id IN (${ph})`,
        placedItems,
        'item_id',
      );
    }
    collectImageRefs('altars', data.altars, allImagePaths);
    collectImageRefs('altar_items', data.altarItems, allImagePaths);
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  if (options.includeTags) {
    data.tags = await db.select<Row[]>(`SELECT * FROM tags WHERE deleted_at IS NULL`);
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  if (options.includeTasks) {
    data.taskCategories = await db.select<Row[]>(
      `SELECT * FROM task_categories`
    );
    data.tasks = await db.select<Row[]>(
      `SELECT * FROM tasks WHERE 1=1 ${dateClause} ${deletedClause}`,
      dateParams,
    );
    data.taskLinks = await selectWhereIn(
      db,
      (ph) => `SELECT * FROM task_links WHERE task_id IN (${ph})`,
      data.tasks ?? [],
    );
  }

  // ── Embed images ─────────────────────────────────────────────────────────
  const images: Record<string, string> = {};
  for (const path of allImagePaths) {
    try {
      images[path] = await readImageAsBase64(path);
    } catch {
      // Image file missing — skip silently
    }
  }

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    type: 'backup',
    exportedAt: new Date().toISOString(),
    filters: options,
    data,
    images,
  };

  // Der Dialog oeffnet im `backup/`-Ordner des aktiven Vaults — bei Bedarf
  // eben angelegt. Scheitert das (Vault-Ordner gerade nicht erreichbar),
  // bleibt es beim blossen Dateinamen und der Dialog oeffnet, wo das
  // Betriebssystem will; der Export selbst haengt nicht daran.
  const filename = `emerald-backup-${new Date().toISOString().slice(0, 10)}.emeralddb`;
  // Eine Kette, ein catch: stuende `getActiveVaultId()` als eigenes await im
  // Argument, entkaeme seine Ablehnung dem `.catch` und risse den Export mit.
  const backupDir = await getActiveVaultId()
    .then((vaultId) => invoke<string>('ensure_backup_dir', { vaultId }))
    .catch(() => null);

  const savePath = await save({
    defaultPath: backupDir ? joinPath(backupDir, filename) : filename,
    filters: [{ name: 'Emerald Backup', extensions: ['emeralddb'] }],
  });
  if (!savePath) return false;

  await invoke('write_file', { path: savePath, content: JSON.stringify(backup) });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse + preview
// ─────────────────────────────────────────────────────────────────────────────

export async function openBackupFile(): Promise<{ path: string; backup: BackupFile; preview: BackupPreview } | null> {
  const selected = await open({
    filters: [{ name: 'Emerald Backup', extensions: ['emeralddb'] }],
    multiple: false,
  });
  if (!selected) return null;
  const filePath = typeof selected === 'string' ? selected : selected[0];

  const raw = await invoke<string>('read_file', { path: filePath });
  const backup = JSON.parse(raw) as BackupFile;
  if (backup.type !== 'backup') throw new Error('Not an Emerald backup file');
  migrateBackupPayload(backup);

  // Only show categories that are actually used by entries in this backup
  const usedWikiCatIds = new Set((backup.data.wikiArticles ?? []).map((r) => r.category_id as string));
  const usedOpCatIds = new Set((backup.data.operations ?? []).map((r) => r.category_id as string));

  const preview: BackupPreview = {
    exportedAt: backup.exportedAt,
    journalCount: backup.data.journalEntries?.length ?? 0,
    wikiCount: backup.data.wikiArticles?.length ?? 0,
    opsCount: backup.data.operations?.length ?? 0,
    routinesCount: backup.data.routines?.length ?? 0,
    altarsCount: backup.data.altars?.length ?? 0,
    taskCount: backup.data.tasks?.length ?? 0,
    taskCategoriesCount: backup.data.taskCategories?.length ?? 0,
    wikiCategories: (backup.data.wikiCategories ?? []).filter((c) => usedWikiCatIds.has(c.id as string)) as BackupCategoryEntry[],
    opCategories: (backup.data.operationCategories ?? []).filter((c) => usedOpCatIds.has(c.id as string)) as BackupCategoryEntry[],
  };

  return { path: filePath, backup, preview };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image restore helpers
// ─────────────────────────────────────────────────────────────────────────────

async function restoreImages(backup: BackupFile): Promise<Map<string, string>> {
  const pathMap = new Map<string, string>();
  for (const [oldPath, dataUrl] of Object.entries(backup.images)) {
    try {
      pathMap.set(oldPath, await saveImage(dataUrl));
    } catch {
      // skip
    }
  }
  return pathMap;
}

function remapPaths(value: unknown, pathMap: Map<string, string>): unknown {
  if (typeof value !== 'string') return value;
  let result = value;
  for (const [oldPath, newPath] of pathMap) {
    result = result.split(oldPath).join(newPath);
  }
  return result;
}

function remapRow(row: Row, fields: string[], pathMap: Map<string, string>): Row {
  const out = { ...row };
  for (const f of fields) {
    if (out[f] != null) out[f] = remapPaths(out[f], pathMap);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert helpers (used by both replace and merge)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rows come from a parsed backup file (untrusted JSON) — their keys must never
 * be concatenated into SQL as-is. We only allow columns that PRAGMA table_info
 * reports for the real (hardcoded) target table, so a crafted backup can at
 * worst omit/skip a column, never inject SQL through the column list.
 */
async function insertRows(
  db: Awaited<ReturnType<typeof getDb>>,
  table: string,
  rows: Row[],
  orIgnore = false,
): Promise<void> {
  if (!rows.length) return;
  const tableInfo = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  const validColumns = new Set(tableInfo.map((c) => c.name));
  const cols = Object.keys(rows[0]).filter((c) => validColumns.has(c));
  if (!cols.length) return;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  for (const row of rows) {
    await db.execute(sql, cols.map((c) => row[c]));
  }
}

/**
 * `tasks.parent_task_id` zeigt auf dieselbe Tabelle. Steht ein Kind in der
 * Sicherung vor seinem Elternteil, schlägt der Foreign Key beim INSERT fehl.
 * Deshalb erst ohne Elternbezug einfügen und ihn danach nachtragen — dann
 * existieren garantiert alle Zeilen.
 */
async function insertTasks(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: Row[],
): Promise<void> {
  if (!rows.length) return;
  const parents = rows
    .filter((r) => r.parent_task_id)
    .map((r) => [String(r.id), String(r.parent_task_id)] as const);

  await insertRows(db, 'tasks', rows.map((r) => ({ ...r, parent_task_id: null })));

  for (const [id, parentId] of parents) {
    await db.execute(
      'UPDATE tasks SET parent_task_id=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM tasks WHERE id=$1)',
      [parentId, id],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Replace import
// ─────────────────────────────────────────────────────────────────────────────

function applyTypeFilters(d: BackupFile['data'], f: ImportTypeFilters): BackupFile['data'] {
  const keptContentIds = new Set<string>([
    ...(f.includeJournal ? (d.journalEntries ?? []).map((r) => r.id as string) : []),
    ...(f.includeWiki    ? (d.wikiArticles   ?? []).map((r) => r.id as string) : []),
    ...(f.includeOperations ? (d.operations ?? []).map((r) => r.id as string) : []),
    ...(f.includeRoutines   ? (d.routines    ?? []).map((r) => r.id as string) : []),
    ...(f.includeAltars     ? (d.altars      ?? []).map((r) => r.id as string) : []),
    ...(f.includeTasks      ? (d.tasks       ?? []).map((r) => r.id as string) : []),
  ]);
  return {
    ...d,
    journalEntries:     f.includeJournal    ? d.journalEntries    : [],
    wikiArticles:       f.includeWiki       ? d.wikiArticles      : [],
    wikiCategories:     f.includeWiki       ? d.wikiCategories    : [],
    operations:         f.includeOperations ? d.operations        : [],
    operationCategories:f.includeOperations ? d.operationCategories : [],
    routines:           f.includeRoutines   ? d.routines          : [],
    altars:             f.includeAltars     ? d.altars            : [],
    altarCategories:    f.includeAltars     ? d.altarCategories   : [],
    altarItems:         f.includeAltars     ? d.altarItems        : [],
    altarPlacements:    f.includeAltars     ? d.altarPlacements   : [],
    tasks:              f.includeTasks      ? d.tasks             : [],
    taskCategories:     f.includeTasks      ? d.taskCategories    : [],
    taskLinks:          f.includeTasks      ? d.taskLinks         : [],
    tags:               f.includeTags       ? d.tags              : [],
    links:            (d.links ?? []).filter((r) => keptContentIds.has(r.source_id as string)),
  };
}

function applyCategoryFilters(d: BackupFile['data'], filters: ImportCategoryFilters): BackupFile['data'] {
  if (!filters.excludedWikiCategoryIds.size && !filters.excludedOpCategoryIds.size) return d;

  const filteredWiki = filters.excludedWikiCategoryIds.size
    ? (d.wikiArticles ?? []).filter((r) => !filters.excludedWikiCategoryIds.has(r.category_id as string))
    : d.wikiArticles;
  const filteredOps = filters.excludedOpCategoryIds.size
    ? (d.operations ?? []).filter((r) => !filters.excludedOpCategoryIds.has(r.category_id as string))
    : d.operations;

  const keptIds = new Set([
    ...(filteredWiki ?? []).map((r) => r.id as string),
    ...(filteredOps ?? []).map((r) => r.id as string),
    ...(d.journalEntries ?? []).map((r) => r.id as string),
    ...(d.routines ?? []).map((r) => r.id as string),
    ...(d.altars ?? []).map((r) => r.id as string),
    ...(d.tasks ?? []).map((r) => r.id as string),
  ]);

  return {
    ...d,
    wikiArticles: filteredWiki,
    operations: filteredOps,
    links: (d.links ?? []).filter((r) => keptIds.has(r.source_id as string)),
  };
}

/**
 * Prüft, ob jede Kategorie-Referenz der Nutzlast auflösbar ist — entweder aus
 * der Sicherung selbst oder aus dem Bestand des Ziel-Vaults.
 *
 * Muss **vor** dem ersten DELETE laufen. `doReplace` leert den Vault, bevor es
 * einfügt, und eine Transaktion steht hier nicht zur Verfügung (siehe
 * `normalizeSchema.ts`). Ohne diese Vorprüfung würde eine Sicherung mit einer
 * unauflösbaren Kategorie erst beim INSERT am Foreign Key scheitern — mit
 * bereits geleertem Vault und ohne Weg zurück.
 */
async function assertPayloadReferencesResolve(
  db: Awaited<ReturnType<typeof getDb>>,
  d: BackupFile['data'],
  options: { keepsExistingRows?: boolean } = {},
): Promise<void> {
  // `survivesReplace` sagt, ob doReplace die Kategorien dieser Tabelle stehen
  // lässt. Bei wiki und operations werden nur die selbst angelegten gelöscht
  // (`WHERE is_builtin=0`), die eingebauten bleiben und duerfen deshalb als
  // Ziel zaehlen. task_categories und altar_categories werden komplett geleert
  // — was dort heute im Vault steht, ist nach dem DELETE weg.
  const checks = [
    ['wikiArticles', 'wikiCategories', 'wiki_categories', 'Wiki-Artikel', 'is_builtin=1'],
    ['operations', 'operationCategories', 'operation_categories', 'Operationen', 'is_builtin=1'],
    ['tasks', 'taskCategories', 'task_categories', 'Aufgaben', null],
    ['altarItems', 'altarCategories', 'altar_categories', 'Altar-Objekte', null],
  ] as const;

  for (const [rowsKey, catsKey, table, label, survivesReplace] of checks) {
    const rows = d[rowsKey] ?? [];
    if (!rows.length) continue;

    const known = new Set((d[catsKey] ?? []).map((c) => String(c.id)));
    if (options.keepsExistingRows) {
      for (const row of await db.select<Row[]>(`SELECT id FROM ${table}`)) {
        known.add(String(row.id));
      }
    } else if (survivesReplace) {
      for (const row of await db.select<Row[]>(
        `SELECT id FROM ${table} WHERE ${survivesReplace}`
      )) {
        known.add(String(row.id));
      }
    }

    const missing = new Set<string>();
    for (const row of rows) {
      const id = row.category_id == null ? '' : String(row.category_id);
      if (!known.has(id)) missing.add(id || '(leer)');
    }
    if (missing.size) {
      throw new Error(
        `Die Sicherung verweist bei ${label} auf Kategorien, die weder in der ` +
          `Datei noch in diesem Vault existieren: ${[...missing].join(', ')}. ` +
          'Der Import wurde abgebrochen, bevor etwas geändert wurde.'
      );
    }
  }
}

async function doReplace(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile, filters: ImportCategoryFilters): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = applyCategoryFilters(backup.data, filters);

  await assertPayloadReferencesResolve(db, d);

  // Remap image paths — Spalten aus `IMAGE_FIELDS`, nicht von Hand gepflegt.
  const IMAGE_FIELDS_JOURNAL = imageColumns('journal_entries');
  const IMAGE_FIELDS_WIKI = imageColumns('wiki_articles');
  const IMAGE_FIELDS_OP = imageColumns('operations');
  const IMAGE_FIELDS_ALTAR = imageColumns('altars');
  const IMAGE_FIELDS_ITEM = imageColumns('altar_items');

  const journalEntries = (d.journalEntries ?? []).map((r) => remapRow(r, IMAGE_FIELDS_JOURNAL, pathMap));
  const wikiArticles = (d.wikiArticles ?? []).map((r) => remapRow(r, IMAGE_FIELDS_WIKI, pathMap));
  const operations = (d.operations ?? []).map((r) => remapRow(r, IMAGE_FIELDS_OP, pathMap));
  const altars = (d.altars ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ALTAR, pathMap));
  const altarItems = (d.altarItems ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ITEM, pathMap));

  // Delete only the content types present in the backup (so a partial backup
  // replacing only Journal data won't wipe wiki/ops).
  const hasJournal = (d.journalEntries?.length ?? 0) > 0;
  const hasWiki = (d.wikiArticles?.length ?? 0) > 0;
  const hasOps = (d.operations?.length ?? 0) > 0;
  const hasRoutines = (d.routines?.length ?? 0) > 0;
  const hasAltars = (d.altars?.length ?? 0) > 0;
  const hasTasks = (d.tasks?.length ?? 0) > 0 || (d.taskCategories?.length ?? 0) > 0;
  const hasAny = hasJournal || hasWiki || hasOps || hasTasks || hasRoutines;

  // Links: delete only for present entry types
  if (hasJournal) {
    await db.execute(`DELETE FROM links WHERE source_type='journal'`);
  }
  if (hasWiki) {
    await db.execute(`DELETE FROM links WHERE source_type='wiki'`);
  }
  if (hasOps) {
    await db.execute(`DELETE FROM links WHERE source_type='operation'`);
  }
  if (hasAltars) {
    await db.execute('DELETE FROM altar_placements');
    await db.execute('DELETE FROM altar_items');
    await db.execute('DELETE FROM altars');
    await db.execute('DELETE FROM altar_categories');
  }
  if (hasTasks) {
    await db.execute('DELETE FROM task_links');
    await db.execute('DELETE FROM tasks');
    await db.execute('DELETE FROM task_categories');
  }
  if (hasRoutines) await db.execute('DELETE FROM routines');
  if (hasOps) {
    await db.execute('DELETE FROM operations');
    await db.execute('DELETE FROM operation_categories WHERE is_builtin=0');
  }
  if (hasJournal) await db.execute('DELETE FROM journal_entries');
  if (hasWiki) {
    await db.execute('DELETE FROM wiki_articles');
    await db.execute('DELETE FROM wiki_categories WHERE is_builtin=0');
  }
  if (hasAny && d.tags) await db.execute('DELETE FROM tags');

  // Re-insert
  if (d.wikiCategories) await insertRows(db, 'wiki_categories', d.wikiCategories, true);
  if (d.operationCategories) await insertRows(db, 'operation_categories', d.operationCategories, true);
  if (d.tags) await insertRows(db, 'tags', d.tags, true);
  await insertRows(db, 'journal_entries', journalEntries);
  await insertRows(db, 'wiki_articles', wikiArticles);
  await insertRows(db, 'operations', operations);
  if (d.routines) await insertRows(db, 'routines', d.routines);
  await insertRows(db, 'altars', altars);
  if (d.altarCategories) await insertRows(db, 'altar_categories', d.altarCategories, true);
  await insertRows(db, 'altar_items', altarItems);
  if (d.altarPlacements) await insertRows(db, 'altar_placements', d.altarPlacements);
  if (d.taskCategories) await insertRows(db, 'task_categories', d.taskCategories, true);
  await insertTasks(db, d.tasks ?? []);
  if (d.taskLinks) await insertRows(db, 'task_links', d.taskLinks);
  if (d.links) await insertRows(db, 'links', d.links, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge import (ID-prefix strategy)
// ─────────────────────────────────────────────────────────────────────────────

async function doMerge(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile, filters: ImportCategoryFilters): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = applyCategoryFilters(backup.data, filters);

  // Merge loescht zwar nichts, bricht aber mitten im Einfuegen ab, wenn eine
  // Kategorie fehlt — und lässt dann halb importierte Daten zurück. Hier
  // zählt der Bestand des Vaults vollstaendig als Quelle, weil er erhalten
  // bleibt.
  await assertPayloadReferencesResolve(db, d, { keepsExistingRows: true });

  // Prefix = base36 encoding of current timestamp (8 chars, unique per merge)
  const prefix = Date.now().toString(36).slice(-8);
  const pid = (id: string) => `${prefix}-${id}`;

  // Build id maps for every entity type
  const allOldIds = new Set<string>([
    ...(d.journalEntries ?? []).map((r: Row) => r.id as string),
    ...(d.wikiArticles ?? []).map((r: Row) => r.id as string),
    ...(d.operations ?? []).map((r: Row) => r.id as string),
    ...(d.routines ?? []).map((r: Row) => r.id as string),
    ...(d.altars ?? []).map((r: Row) => r.id as string),
    ...(d.altarItems ?? []).map((r: Row) => r.id as string),
    ...(d.tasks ?? []).map((r: Row) => r.id as string),
  ]);

  function remapId(id: unknown): unknown {
    if (typeof id === 'string' && allOldIds.has(id)) return pid(id);
    return id;
  }

  function remapJsonIds(jsonStr: unknown): unknown {
    if (typeof jsonStr !== 'string') return jsonStr;
    try {
      const arr = JSON.parse(jsonStr) as unknown[];
      if (!Array.isArray(arr)) return jsonStr;
      const remapped = arr.map((v) => (typeof v === 'string' && allOldIds.has(v) ? pid(v) : v));
      return JSON.stringify(remapped);
    } catch {
      return jsonStr;
    }
  }

  /**
   * Seit v33 steht `entry_number` wirklich in der Datenbank, statt beim Lesen
   * aus der ROWID erzeugt zu werden. Beim Merge muessen die Nummern deshalb
   * hinter den Bestand geschoben werden — sonst zeigen zwei Eintraege dieselbe
   * `#n`.
   */
  async function entryNumberOffset(table: string): Promise<number> {
    const rows = await db.select<{ n: number }[]>(
      `SELECT COALESCE(MAX(entry_number), 0) AS n FROM ${table}`
    );
    return rows[0]?.n ?? 0;
  }
  const offsets = {
    journal_entries: await entryNumberOffset('journal_entries'),
    wiki_articles: await entryNumberOffset('wiki_articles'),
    operations: await entryNumberOffset('operations'),
  };

  function remapEntry(
    row: Row,
    imagePaths: string[],
    idFields: string[],
    jsonIdFields: string[],
    entryNumberTable?: keyof typeof offsets,
  ): Row {
    const out = remapRow(row, imagePaths, pathMap);
    out.id = pid(out.id as string);
    if (entryNumberTable && out.entry_number != null) {
      out.entry_number = Number(out.entry_number) + offsets[entryNumberTable];
    }
    for (const f of idFields) {
      if (out[f] != null) out[f] = remapId(out[f]);
    }
    for (const f of jsonIdFields) {
      if (out[f] != null) out[f] = remapJsonIds(out[f]);
    }
    return out;
  }

  const journalEntries = (d.journalEntries ?? []).map((r: Row) =>
    remapEntry(r, ['content'], ['paradigm_id', 'bannung_type_wiki_id', 'meditation_type_wiki_id'], ['linked_operation_ids', 'linked_wiki_ids'], 'journal_entries')
  );
  const wikiArticles = (d.wikiArticles ?? []).map((r: Row) => {
    const row = remapEntry(r, ['content', 'icon', 'cover_image'], [], [], 'wiki_articles');
    // slug has a UNIQUE constraint — prefix it to avoid collisions on merge
    if (typeof row.slug === 'string') row.slug = `${prefix}-${row.slug}`;
    return row;
  });
  const operations = (d.operations ?? []).map((r: Row) =>
    remapEntry(r, ['content', 'icon', 'cover_image', 'drawing_data', 'thumbnail_data'], ['charging_technique_wiki_id'], [], 'operations')
  );
  const routines = (d.routines ?? []).map((r: Row) =>
    remapEntry(r, [], [], ['operation_ids', 'wiki_ids'])
  );
  const altars = (d.altars ?? []).map((r: Row) =>
    // Dieselben drei Spalten wie in doReplace. Solange thumbnail_data und
    // icon_data Data-URLs halten, ist der Unterschied folgenlos — aber der
    // Export sammelt beide ein, sobald sie einen Dateinamen tragen, und dann
    // wäre merge die Variante, die ihn nicht mitzieht.
    remapEntry(r, ['background_image_data', 'thumbnail_data', 'icon_data'], [], [])
  );
  const altarItems = (d.altarItems ?? []).map((r: Row) =>
    remapEntry(r, ['image_data'], [], [])
  );
  const altarPlacements = (d.altarPlacements ?? []).map((r: Row) => ({
    ...r,
    id: pid(r.id as string),
    altar_id: remapId(r.altar_id),
    item_id: remapId(r.item_id),
  }));
  const tasks = (d.tasks ?? []).map((r: Row) =>
    remapEntry(r, [], ['parent_task_id'], [])
  );
  const taskLinks = (d.taskLinks ?? []).map((r: Row) => ({
    ...r,
    id: pid(r.id as string),
    task_id: remapId(r.task_id),
    target_id: remapId(r.target_id),
  }));
  const links = (d.links ?? []).map((r: Row) => ({
    ...r,
    source_id: remapId(r.source_id),
    target_id: remapId(r.target_id),
  }));

  // Categories and tags: INSERT OR IGNORE (no prefix — shared by name/fixed ID)
  if (d.wikiCategories) await insertRows(db, 'wiki_categories', d.wikiCategories, true);
  if (d.operationCategories) await insertRows(db, 'operation_categories', d.operationCategories, true);
  if (d.altarCategories) await insertRows(db, 'altar_categories', d.altarCategories, true);
  if (d.taskCategories) await insertRows(db, 'task_categories', d.taskCategories, true);
  if (d.tags) await insertRows(db, 'tags', d.tags, true);

  // Content: plain INSERT with prefixed IDs (no conflicts possible)
  await insertRows(db, 'journal_entries', journalEntries);
  await insertRows(db, 'wiki_articles', wikiArticles);
  await insertRows(db, 'operations', operations);
  await insertRows(db, 'routines', routines);
  await insertRows(db, 'altars', altars);
  await insertRows(db, 'altar_items', altarItems);
  await insertRows(db, 'altar_placements', altarPlacements);
  await insertTasks(db, tasks);
  await insertRows(db, 'task_links', taskLinks, true);
  await insertRows(db, 'links', links, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public import entry point
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TYPES_INCLUDED: ImportTypeFilters = {
  includeJournal: true, includeWiki: true, includeOperations: true,
  includeRoutines: true, includeAltars: true, includeTasks: true, includeTags: true,
};

export async function importDatabase(
  backup: BackupFile,
  mode: ImportMode,
  /** Nur fuer `add-vault`: Name und — wenn der Nutzer einen gewaehlt hat —
   *  Zielordner des neuen Vaults. Ohne `path` greift der Rueckfall aus
   *  `newVaultRecord` (`{appDataDir}/vaults/{id}`). */
  newVault?: { name: string; path?: string },
  categoryFilters?: ImportCategoryFilters,
  typeFilters?: ImportTypeFilters,
): Promise<void> {
  const filters: ImportCategoryFilters = categoryFilters ?? {
    excludedWikiCategoryIds: new Set(),
    excludedOpCategoryIds: new Set(),
  };

  // replace behaelt die Original-IDs und add-vault wechselt den Vault: ein
  // offener Editor, den die Navigation dabei unmountet, wuerde seinen
  // VOR-Import-Stand ueber die frisch importierten Zeilen speichern. Fuer die
  // Dauer des Imports sind die automatischen Editor-Saves deshalb gesperrt;
  // merge vergibt neue IDs und braucht das nicht.
  const suspendSaves = mode !== 'merge';
  if (suspendSaves) suspendEditorSaves();
  try {

  // Apply type-level filtering first, then subcategory filtering
  const filteredBackup: BackupFile = {
    ...backup,
    data: applyCategoryFilters(applyTypeFilters(backup.data, typeFilters ?? ALL_TYPES_INCLUDED), filters),
  };

  if (mode === 'add-vault') {
    // 1. Create a new vault record
    const vaultRecord = await newVaultRecord(newVault?.name ?? 'Imported Vault', {
      path: newVault?.path,
    });
    const vaultId = vaultRecord.id;

    // 2. Register vault (writes to vaults.json)
    await addVault(vaultRecord);
    invalidateVaultCache();

    // 3. Switch to it (resets DB cache + runs migrations on new empty DB)
    await useVaultStore.getState().loadVaults();
    await useVaultStore.getState().switchVault(vaultId);

    // 4. Fill the new (empty) vault with the backup data
    const db = await getDb();
    await doReplace(db, filteredBackup, filters);
  } else {
    const db = await getDb();
    if (mode === 'replace') {
      await doReplace(db, filteredBackup, filters);
    } else {
      await doMerge(db, filteredBackup, filters);
    }
  }

  // Reload all store data from the (now modified) active vault
  console.log(`[backup] import complete (${mode}) into ${await getActiveDbFile()}`);

  if (mode === 'replace') {
    useUIStore.getState().setActiveView({ type: 'home' });
  }

  // Die globale Suche merkt sich den Klartext eines Eintrags unter (id,
  // updated_at). Beide Haelften stehen so in der Sicherungsdatei: eine Datei,
  // die ein Paar wiederverwendet und nur den Inhalt aendert, erbte sonst den
  // alten Text — der neue waere bis zum Neustart unauffindbar.
  clearSearchTextCache();

  await useTagStore.getState().fetchTags();
  await Promise.all([
    useWikiStore.getState().fetchCategories(),
    useOperationStore.getState().fetchAll(),
  ]);
  await Promise.all([
    useJournalStore.getState().fetchEntries(),
    useWikiStore.getState().fetchArticles(),
    useRoutineStore.getState().fetchRoutines(),
    useAltarStore.getState().fetchAltars(),
    useTaskStore.getState().fetchAll(),
  ]);
  } finally {
    if (suspendSaves) resumeEditorSaves();
  }
}

// Re-export BackupFile type for use in UI
export type { BackupFile };
