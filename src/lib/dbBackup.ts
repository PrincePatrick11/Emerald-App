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
import { getDb, sweepDanglingLinks } from './db';
import { remapInternalLinks } from './internalLinkHtml';
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
import { clearEntrySummaryCache } from './blocks/entrySummary';
import { DEFAULT_DEFINITION_ICON, definitionToRow, isDefinitionId, type BlockDefinition } from './blocks/definitions';
import { convertLegacyStatusRows, STATUS_DEFINITION_ID } from './blocks/legacyStatus';
import { definitionById, nextDefinitionSortOrder } from './blockDefinitionRows';
import { fromRow } from './row';
import { convertLegacySigils } from './migrateLegacySigils';
import { IMAGE_FIELDS, imageColumns } from './schema';
import { categoryKey, mergeCategoryRows, type CategorySource } from './categoryMerge';
import { legacyDisplayName, type LegacyCategoryTable } from './categories';
import i18n from '../i18n';
import { generateId, nowIso } from './helpers';
import { useVaultStore } from '../store/vaultStore';
import { reloadAllStores } from '../store/moduleWiring';
import { useUIStore } from '../store/uiStore';
import { resumeEditorSaves, suspendEditorSaves } from './editorLock';
import { drainSerialized } from './serialize';

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
  /** Eigener Zähler: die Bibliothek reist unabhängig von den Altären, eine
   *  Datei kann null Altäre und trotzdem Elemente tragen. */
  altarItemsCount: number;
  taskCount: number;
  /** Nur Kategorien, auf die ein Inhalt der Sicherung zeigt. */
  categories: BackupCategoryEntry[];
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

/** Category IDs (aus der Sicherung) to exclude during import. Empty set = import all. */
export interface ImportCategoryFilters {
  excludedCategoryIds: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * '1' = vor der Schema-Vereinheitlichung (`wiki_articles.category`,
 * `altar_items.category` mit dem Kategorie-*Namen*), '2' = danach, '3' = seit
 * Bilder als Dateiname statt als absoluter Pfad referenziert werden, '4' =
 * seit v38 eine Tabelle `categories` die vier Modul-Tabellen ersetzt
 * (`data.categories` statt `wikiCategories`/`operationCategories`/
 * `taskCategories`/`altarCategories`), '5' = seit v39 `category_id` NULL sein
 * darf, '6' = seit v40 reisen die eigenen Blöcke als `data.blockDefinitions`
 * mit, '7' = seit v42 tragen Operationen ihre Sigille als Blöcke im Inhalt
 * statt in eigenen Spalten.
 *
 * Die '5' ist kein Formalismus: Eine so geschriebene Datei enthält Einträge
 * ohne Kategorie, und ein Build von vor v39 hat dort noch eine NOT-NULL-Spalte.
 * Ohne die Erhöhung liefe er in einen Constraint-Fehler mitten im Import —
 * nach den Löschungen des Replace-Modus, ohne Transaktion. Mit ihr weist die
 * Prüfung „neuer als ich" (`backup.version > BACKUP_VERSION`) die Datei ehrlich
 * ab, bevor irgendetwas passiert.
 */
const BACKUP_VERSION = '7' as const;

/** Die vier Kategorie-Arrays von Sicherungen bis Version 3. */
interface LegacyCategoryArrays {
  wikiCategories?: Row[];
  operationCategories?: Row[];
  taskCategories?: Row[];
  altarCategories?: Row[];
}

/**
 * Legt die vier Kategorie-Arrays einer Sicherung bis v3 zu `data.categories`
 * zusammen — dieselbe Regel wie Migration v38 (`mergeCategoryRows`), inklusive
 * der Übersetzung eingebauter Kategorien in die aktuelle App-Sprache — und
 * hängt die vier Inhaltsarrays auf die neuen IDs um.
 */
function mergeLegacyCategoryArrays(data: BackupFile['data'] & LegacyCategoryArrays): void {
  const sources: CategorySource[] = [];
  const legacy: [keyof LegacyCategoryArrays, LegacyCategoryTable][] = [
    ['wikiCategories', 'wiki_categories'],
    ['operationCategories', 'operation_categories'],
    ['taskCategories', 'task_categories'],
    ['altarCategories', 'altar_categories'],
  ];
  for (const [arrayKey, table] of legacy) {
    const rows = data[arrayKey];
    if (!rows) continue;
    sources.push({
      table,
      rows: rows.map((r) => {
        const id = String(r.id);
        const name = String(r.name ?? '');
        return {
          id,
          name: legacyDisplayName(i18n, table, { id, name, is_builtin: !!r.is_builtin }),
          emoji: String(r.emoji ?? '📁'),
          deleted_at: r.deleted_at == null ? null : String(r.deleted_at),
        };
      }),
    });
    delete data[arrayKey];
  }
  if (!sources.length) return;

  const merged = mergeCategoryRows(sources, {
    builtinName: (id) => i18n.t(`categories.builtin.${id}`),
  });
  data.categories = merged.rows.map((r) => ({
    id: r.id, name: r.name, emoji: r.emoji, sort_order: r.sort_order,
    is_builtin: r.is_builtin ? 1 : 0, deleted_at: r.deleted_at,
  }));

  const remap = (rows: Row[] | undefined, table: LegacyCategoryTable) => {
    for (const row of rows ?? []) {
      // Ohne Treffer bleibt der Eintrag kategorielos. Bis v38 fiel er aufs
      // Sammelbecken — das gibt es als Sonderfall nicht mehr, und „ohne" ist
      // ehrlicher als eine Kategorie, die der Nutzer nie gewählt hat.
      row.category_id = merged.idMap.get(`${table}:${String(row.category_id)}`) ?? null;
    }
  };
  remap(data.wikiArticles, 'wiki_categories');
  remap(data.operations, 'operation_categories');
  remap(data.tasks, 'task_categories');
  remap(data.altarItems, 'altar_categories');
}

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
  // Als Zahl: ein String-Vergleich hielte '10' für älter als '4'.
  const version = Number(backup.version);
  if (!Number.isInteger(version) || version < 1 || version > Number(BACKUP_VERSION)) {
    throw new Error(`Unsupported backup version: ${backup.version}`);
  }
  const data = backup.data as BackupFile['data'] & LegacyCategoryArrays;

  if (version === 1) {
    for (const row of data.wikiArticles ?? []) {
      if (row.category_id === undefined && row.category !== undefined) {
        row.category_id = row.category;
      }
      delete row.category;
    }

    // altar_items hielt früher den Kategorie-*Namen*. Erst gegen die Kategorien
    // aus derselben Sicherung aufloesen, sonst auf 'other'.
    const byName = new Map<string, string>(
      (data.altarCategories ?? []).map((c) => [String(c.name), String(c.id)])
    );
    const byId = new Set((data.altarCategories ?? []).map((c) => String(c.id)));
    for (const row of data.altarItems ?? []) {
      if (row.category_id === undefined) {
        const raw = row.category === undefined ? '' : String(row.category);
        // Ohne Treffer bleibt das Element kategorielos statt aufs Sammelbecken
        // zu fallen — dasselbe, was `mergeLegacyCategoryArrays` unten tut.
        row.category_id = byId.has(raw) ? raw : (byName.get(raw) ?? null);
      }
      delete row.category;
    }

    for (const row of data.journalEntries ?? []) {
      row.linked_operation_ids = row.linked_operation_ids ?? '[]';
      row.linked_wiki_ids = row.linked_wiki_ids ?? '[]';
    }
  }

  // v2 → v3 braucht keinen Schritt: geaendert hat sich nur, dass Bilder als
  // Dateiname statt als absoluter Pfad referenziert werden, und `restoreImages`
  // uebersetzt die Schluessel der Datei so oder so.

  // v3 → v4: vier Kategorie-Arrays werden eines. Der Vergleich ist geordnet,
  // nicht „ungleich 4": eine neuere Datei hat die eine Tabelle längst und
  // liefe sonst ein zweites Mal durch das Zusammenlegen.
  if (version < 4) {
    mergeLegacyCategoryArrays(data);
  }

  // v4 → v5 braucht keinen Schritt: `category_id` darf jetzt NULL sein, und
  // eine ältere Datei hat dort überall einen Wert. Andersherum greift die
  // Prüfung oben.

  // v5 → v6 braucht keinen Schritt: neu ist nur das Array `blockDefinitions`,
  // und eine Datei ohne es bringt schlicht keine eigenen Blöcke mit.

  // v6 → v7 braucht keinen Schritt an der Datei: Sigillen-Spalten alter
  // Operationen wandelt der Import nach dem Einfügen um (`convertLegacySigils`).
  backup.sourceVersion = version;
  backup.version = BACKUP_VERSION;
}

interface BackupFile {
  version: '1' | '2' | '3' | '4' | '5' | '6' | '7';
  /** Die Version, mit der die Datei geschrieben wurde — `migrateBackupPayload` setzt `version` auf die aktuelle. */
  sourceVersion?: number;
  type: 'backup';
  exportedAt: string;
  filters: BackupOptions;
  data: {
    journalEntries?: Row[];
    wikiArticles?: Row[];
    operations?: Row[];
    /** Die globale Liste; dabei, sobald eines der vier kategorisierten Module dabei ist. */
    categories?: Row[];
    /** Die eigenen Blöcke (seit '5'); dabei, sobald Journal, Wiki oder Operationen dabei sind. */
    blockDefinitions?: Row[];
    tags?: Row[];
    routines?: Row[];
    altars?: Row[];
    altarItems?: Row[];
    altarPlacements?: Row[];
    tasks?: Row[];
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
    // Die Bibliothek ist eine eigene Sammlung, kein Anhängsel der Altäre:
    // ein Element wird im Dashboard angelegt, sortiert und gepflegt, ohne je
    // auf einer Leinwand zu liegen. Früher nahm der Export nur die
    // *platzierten* Elemente der gefilterten Altäre mit — die übrigen
    // fehlten in der Sicherung, und weil ein Replace-Restore `altar_items`
    // vorher komplett leert, waren sie danach weg. Deshalb vollständig,
    // unabhängig vom Datumsfilter der Altäre und auch dann, wenn gar kein
    // Altar übrig bleibt.
    data.altarItems = await db.select<Row[]>('SELECT * FROM altar_items');
    // Platzierungen bleiben an ihre Altäre gebunden — ohne Altar kein Ort.
    data.altarPlacements = data.altars.length
      ? await selectWhereIn(
          db,
          (ph) => `SELECT * FROM altar_placements WHERE altar_id IN (${ph})`,
          data.altars,
        )
      : [];
    collectImageRefs('altars', data.altars, allImagePaths);
    collectImageRefs('altar_items', data.altarItems, allImagePaths);
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  if (options.includeTags) {
    data.tags = await db.select<Row[]>(`SELECT * FROM tags WHERE deleted_at IS NULL`);
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  if (options.includeTasks) {
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

  // ── Kategorien ───────────────────────────────────────────────────────────
  // Die eine Liste, sobald ein kategorisiertes Modul dabei ist. Auch
  // soft-geloeschte Kategorien: ihre Inhalte werden mitexportiert und
  // brauchen ihr Gegenstueck, sonst scheitert der Import am Foreign Key.
  if (options.includeWiki || options.includeOperations || options.includeTasks || options.includeAltars) {
    data.categories = await db.select<Row[]>(`SELECT * FROM categories`);
  }

  // ── Eigene Blöcke ────────────────────────────────────────────────────────
  // Die Vorlagen der Kopien im Inhalt. Die Kopien kommen ohne sie aus, aber
  // ohne Definition gibt es kein „Aktualisieren" mehr. Ganz, samt Papierkorb —
  // eine Liste, keine Datumsfrage.
  if (options.includeJournal || options.includeWiki || options.includeOperations) {
    data.blockDefinitions = await db.select<Row[]>(`SELECT * FROM block_definitions`);
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
  const usedCatIds = new Set([
    ...(backup.data.wikiArticles ?? []),
    ...(backup.data.operations ?? []),
    ...(backup.data.tasks ?? []),
    ...(backup.data.altarItems ?? []),
  ].map((r) => r.category_id as string));

  const preview: BackupPreview = {
    exportedAt: backup.exportedAt,
    journalCount: backup.data.journalEntries?.length ?? 0,
    wikiCount: backup.data.wikiArticles?.length ?? 0,
    opsCount: backup.data.operations?.length ?? 0,
    routinesCount: backup.data.routines?.length ?? 0,
    altarsCount: backup.data.altars?.length ?? 0,
    altarItemsCount: backup.data.altarItems?.length ?? 0,
    taskCount: backup.data.tasks?.length ?? 0,
    categories: (backup.data.categories ?? []).filter((c) => usedCatIds.has(c.id as string)) as BackupCategoryEntry[],
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
 * Die eigenen Blöcke einer Sicherung: nach ID, `INSERT OR IGNORE` — eine
 * Definition, die es hier schon gibt (auch im Papierkorb), bleibt, wie sie
 * ist; gelöscht wird keine, auch nicht beim Ersetzen. Die Kopien in den
 * Einträgen tragen ihre Elemente selbst, eine abweichende Fassung hier ändert
 * an ihnen nichts. Präparierte `elements`/`display` fängt das Lesen ab
 * (`fromRow.blockDefinition` prüft wie beim Inhalt).
 *
 * Die Datei ist fremd: jede Zeile wird vorher auf die vollständige Spaltenform
 * gebracht — `insertRows` nimmt die Spalten der ersten Zeile, und eine Zeile
 * ohne Pflichtspalte bräche das INSERT ab. Was keine brauchbare ID hat, fällt weg.
 */
async function insertBlockDefinitions(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: unknown,
): Promise<void> {
  if (!Array.isArray(rows)) return;
  const now = nowIso();
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const json = (v: unknown, fallback: string) => (typeof v === 'string' ? v : JSON.stringify(v ?? JSON.parse(fallback)));
  const normalized = rows
    .filter((r): r is Row => typeof r === 'object' && r !== null && isDefinitionId((r as Row).id))
    .map((r) => ({
      id: r.id as string,
      name: text(r.name, ''),
      icon: text(r.icon, '') || DEFAULT_DEFINITION_ICON,
      description: text(r.description, ''),
      elements: json(r.elements, '[]'),
      display: json(r.display, '{}'),
      revision: Number.isInteger(r.revision) && (r.revision as number) > 0 ? r.revision : 1,
      sort_order: Number.isFinite(r.sort_order) ? r.sort_order : 0,
      created_at: text(r.created_at, now),
      updated_at: text(r.updated_at, now),
      deleted_at: typeof r.deleted_at === 'string' ? r.deleted_at : null,
    }));
  await insertRows(db, 'block_definitions', normalized, true);
}

/**
 * Sigillen-Spalten importierter Operationen (Sicherungen von vor v42) in
 * Blöcke umwandeln — derselbe Weg wie Migration v42, nur für die gerade
 * eingefügten Zeilen. Leere Operationen der Kategorie „Sigillen" bekommen das
 * Sigillen-Set nur aus Dateien vor Version 7: in einer neueren hat der Nutzer
 * die Blöcke womöglich bewusst entfernt. Eine Zeichnung, die sich nicht
 * speichern lässt, holt `getDb` beim nächsten Öffnen nach.
 */
async function convertImportedSigils(
  db: Awaited<ReturnType<typeof getDb>>,
  backup: BackupFile,
  operations: Row[],
): Promise<void> {
  if (!operations.length) return;
  await convertLegacySigils(db, {
    includeSigilCategory: (backup.sourceVersion ?? Number(BACKUP_VERSION)) < 7,
    ids: new Set(operations.map((r) => String(r.id))),
  });
}

/**
 * Die „Status"-Definition, nach der alte Operationszeilen umgeschrieben
 * werden: die des Vaults (auch im Papierkorb), sonst die der Datei — wie in
 * Migration v41. Sonst passten die neuen Kopien nicht zu dem „Status", den es
 * danach im Vault gibt, und zeigten sofort „Neuere Version".
 */
async function statusDefinitionForImport(
  db: Awaited<ReturnType<typeof getDb>>,
  fileRows: unknown,
): Promise<BlockDefinition | undefined> {
  const local = await definitionById(db, STATUS_DEFINITION_ID);
  if (local) return local;
  const fromFile = Array.isArray(fileRows)
    ? fileRows.find((r): r is Row => typeof r === 'object' && r !== null && (r as Row).id === STATUS_DEFINITION_ID)
    : undefined;
  return fromFile ? fromRow.blockDefinition(fromFile) : undefined;
}

/**
 * Die Definitionen der Datei, dahinter „Status", wenn die Umwandlung sie neu
 * angelegt hat (es gab sie weder im Vault noch in der Datei) — am Ende der Liste.
 */
async function withStatusDefinition(
  db: Awaited<ReturnType<typeof getDb>>,
  fileRows: unknown,
  used: BlockDefinition | null,
  existing: BlockDefinition | undefined,
): Promise<unknown[]> {
  const rows = Array.isArray(fileRows) ? fileRows : [];
  if (!used || existing) return rows;
  return [...rows, definitionToRow({ ...used, sort_order: await nextDefinitionSortOrder(db) })];
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
  const anyCategorized = f.includeWiki || f.includeOperations || f.includeTasks || f.includeAltars;
  const anyBlocks = f.includeJournal || f.includeWiki || f.includeOperations;
  return {
    ...d,
    blockDefinitions:   anyBlocks           ? d.blockDefinitions  : [],
    journalEntries:     f.includeJournal    ? d.journalEntries    : [],
    wikiArticles:       f.includeWiki       ? d.wikiArticles      : [],
    operations:         f.includeOperations ? d.operations        : [],
    categories:         anyCategorized      ? d.categories        : [],
    routines:           f.includeRoutines   ? d.routines          : [],
    altars:             f.includeAltars     ? d.altars            : [],
    altarItems:         f.includeAltars     ? d.altarItems        : [],
    altarPlacements:    f.includeAltars     ? d.altarPlacements   : [],
    tasks:              f.includeTasks      ? d.tasks             : [],
    taskLinks:          f.includeTasks      ? d.taskLinks         : [],
    tags:               f.includeTags       ? d.tags              : [],
    links:            (d.links ?? []).filter((r) => keptContentIds.has(r.source_id as string)),
  };
}

/**
 * Lässt Inhalte abgewählter Kategorien weg — in allen vier Modulen. Was an
 * ihnen hängt (Platzierungen, Aufgaben-Verknüpfungen, Links), fällt mit.
 */
function applyCategoryFilters(d: BackupFile['data'], filters: ImportCategoryFilters): BackupFile['data'] {
  const excluded = filters.excludedCategoryIds;
  if (!excluded.size) return d;

  const keep = (rows: Row[] | undefined) =>
    (rows ?? []).filter((r) => !excluded.has(r.category_id as string));
  const wikiArticles = keep(d.wikiArticles);
  const operations = keep(d.operations);
  const tasks = keep(d.tasks);
  const altarItems = keep(d.altarItems);
  const keptItemIds = new Set(altarItems.map((r) => r.id as string));
  const keptTaskIds = new Set(tasks.map((r) => r.id as string));

  const keptIds = new Set([
    ...wikiArticles.map((r) => r.id as string),
    ...operations.map((r) => r.id as string),
    ...(d.journalEntries ?? []).map((r) => r.id as string),
    ...(d.routines ?? []).map((r) => r.id as string),
    ...(d.altars ?? []).map((r) => r.id as string),
    ...tasks.map((r) => r.id as string),
  ]);

  return {
    ...d,
    wikiArticles,
    operations,
    tasks,
    altarItems,
    altarPlacements: (d.altarPlacements ?? []).filter((r) => keptItemIds.has(r.item_id as string)),
    taskLinks: (d.taskLinks ?? []).filter((r) => keptTaskIds.has(r.task_id as string)),
    links: (d.links ?? []).filter((r) => keptIds.has(r.source_id as string)),
  };
}

/**
 * Übersetzt die Kategorien einer Sicherung in die dieses Vaults: gleiche ID
 * (die beiden Builtins) oder gleicher Name (ohne Groß/Klein) → lokale Zeile,
 * sonst neu angelegt. Liefert die Zuordnung Sicherungs-ID → lokale ID, mit
 * der die vier Inhaltsarrays umgehängt werden (`remapCategoryIds`).
 *
 * Kategorien werden nie gelöscht, auch nicht beim Ersetzen: Eine Kategorie
 * ist seit v38 modulübergreifend, und ein Teil-Replace (nur Wiki) darf den
 * Aufgaben nicht die Kategorien unter den Füßen wegziehen.
 */
async function resolveImportedCategories(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: Row[],
): Promise<Map<string, string>> {
  const local = await db.select<Row[]>('SELECT id, name, deleted_at, sort_order FROM categories');
  const localById = new Map(local.map((r) => [String(r.id), r]));
  const localByKey = new Map(local.map((r) => [categoryKey(String(r.name)), r]));
  let nextSort = local.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), -1) + 1;

  const map = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id);
    // Eine eingebaute Kategorie trägt in der Spalte nur ihren englischen Seed
    // („Other", „Sigils"); angezeigt wurde sie über ihren Locale-Key. Aus einer
    // v4-Sicherung käme sie sonst als „Other" neben dem lokalen „Sonstiges" an,
    // statt darin aufzugehen — dieselbe Auflösung, die `mergeCategoryRows` über
    // `builtinName` vornimmt.
    const name = row.is_builtin
      ? i18n.t(`categories.builtin.${id}`, { defaultValue: String(row.name ?? '') })
      : String(row.name ?? '');
    const key = categoryKey(name);
    const match = (row.is_builtin ? localById.get(id) : undefined) ?? localByKey.get(key);
    if (match) {
      map.set(id, String(match.id));
      // Eine importierte aktive Kategorie holt ihr lokales Gegenstück aus dem Papierkorb.
      if (match.deleted_at != null && row.deleted_at == null) {
        await db.execute('UPDATE categories SET deleted_at=NULL WHERE id=$1', [match.id]);
        match.deleted_at = null;
      }
      continue;
    }
    const newId = localById.has(id) ? generateId() : id;
    const inserted: Row = {
      id: newId, name, emoji: String(row.emoji ?? '📁'), sort_order: nextSort++,
      is_builtin: 0, deleted_at: row.deleted_at ?? null,
    };
    await db.execute(
      'INSERT INTO categories (id, name, emoji, sort_order, is_builtin, deleted_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [inserted.id, inserted.name, inserted.emoji, inserted.sort_order, inserted.is_builtin, inserted.deleted_at]
    );
    localById.set(newId, inserted);
    localByKey.set(key, inserted);
    map.set(id, newId);
  }
  return map;
}

/**
 * Nur die Kategorien, auf die ein Inhalt der (schon gefilterten) Nutzlast
 * zeigt. Der Export schickt die ganze Tabelle mit; was hier niemand braucht —
 * abgewählte Typen, ausgeschlossene Kategorien, Ungenutztes — soll im Vault
 * keine Zeile werden.
 */
function usedCategoryRows(d: BackupFile['data']): Row[] {
  const used = new Set(
    [...(d.wikiArticles ?? []), ...(d.operations ?? []), ...(d.tasks ?? []), ...(d.altarItems ?? [])]
      .filter((r) => r.category_id != null)
      .map((r) => String(r.category_id))
  );
  return (d.categories ?? []).filter((c) => used.has(String(c.id)));
}

function remapCategoryIds(rows: Row[], map: Map<string, string>): Row[] {
  return rows.map((r) => ({
    ...r,
    category_id: map.get(String(r.category_id)) ?? r.category_id,
  }));
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
export async function assertPayloadReferencesResolve(
  db: Awaited<ReturnType<typeof getDb>>,
  d: BackupFile['data'],
): Promise<void> {
  // Kategorien überleben jeden Import (siehe resolveImportedCategories) — der
  // Bestand des Vaults zählt deshalb in beiden Modi als Ziel.
  const known = new Set((d.categories ?? []).map((c) => String(c.id)));
  for (const row of await db.select<Row[]>('SELECT id FROM categories')) {
    known.add(String(row.id));
  }

  const checks = [
    ['wikiArticles', 'Wiki-Artikel'],
    ['operations', 'Operationen'],
    ['tasks', 'Aufgaben'],
    ['altarItems', 'Altar-Objekte'],
  ] as const;

  for (const [rowsKey, label] of checks) {
    const missing = new Set<string>();
    for (const row of d[rowsKey] ?? []) {
      // Seit v39 ist „ohne Kategorie" ein gültiger Zustand — und der, mit dem
      // jeder neue Eintrag anfängt. Ihn als unauflösbare Referenz zu lesen
      // ließ jede Sicherung scheitern, in der auch nur ein Eintrag keine
      // Kategorie hatte. Ein leerer *String* bleibt ein Treffer ins Leere.
      if (row.category_id == null) continue;
      const id = String(row.category_id);
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

  // Kategorien zuerst: Die Inhalte bekommen die lokalen IDs, bevor sie
  // eingefügt werden. Gelöscht wird bei Kategorien nie (siehe dort).
  const catMap = await resolveImportedCategories(db, usedCategoryRows(d));

  const journalEntries = (d.journalEntries ?? []).map((r) => remapRow(r, IMAGE_FIELDS_JOURNAL, pathMap));
  const wikiArticles = remapCategoryIds((d.wikiArticles ?? []).map((r) => remapRow(r, IMAGE_FIELDS_WIKI, pathMap)), catMap);
  // Sicherungen bis v40 tragen Status/Enddatum/Version noch in den Spalten.
  const replaceStatus = await statusDefinitionForImport(db, d.blockDefinitions);
  const replaceOps = convertLegacyStatusRows(
    remapCategoryIds((d.operations ?? []).map((r) => remapRow(r, IMAGE_FIELDS_OP, pathMap)), catMap),
    i18n.t, nowIso(), replaceStatus,
  );
  const operations = replaceOps.rows;
  const altars = (d.altars ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ALTAR, pathMap));
  const altarItems = remapCategoryIds((d.altarItems ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ITEM, pathMap)), catMap);
  const tasks = remapCategoryIds(d.tasks ?? [], catMap);

  // Eigene Blöcke wie Kategorien: nie gelöscht, Fehlendes nach ID ergänzt,
  // Vorhandenes bleibt. VOR dem ersten DELETE — scheitert hier etwas an einer
  // präparierten Datei, ist noch nichts verloren (keine Transaktion, s. o.).
  await insertBlockDefinitions(db, await withStatusDefinition(db, d.blockDefinitions, replaceOps.definition, replaceStatus));

  // Delete only the content types present in the backup (so a partial backup
  // replacing only Journal data won't wipe wiki/ops).
  const hasJournal = (d.journalEntries?.length ?? 0) > 0;
  const hasWiki = (d.wikiArticles?.length ?? 0) > 0;
  const hasOps = (d.operations?.length ?? 0) > 0;
  const hasRoutines = (d.routines?.length ?? 0) > 0;
  const hasAltars = (d.altars?.length ?? 0) > 0;
  const hasTasks = (d.tasks?.length ?? 0) > 0;
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
  // Die Bibliothek hängt an `hasAltars`, obwohl der Export sie inzwischen
  // unabhängig von den Altären mitnimmt: `altar_placements.item_id` ist
  // ON DELETE CASCADE, ein Leeren von `altar_items` risse also den Altären
  // des Bestands ihre Platzierungen weg — genau denen, die diese Datei gar
  // nicht ersetzt. Ohne Altäre in der Datei wird die Bibliothek deshalb
  // ergänzt statt ersetzt (siehe insertRows unten).
  if (hasAltars) {
    await db.execute('DELETE FROM altar_placements');
    await db.execute('DELETE FROM altar_items');
    await db.execute('DELETE FROM altars');
  }
  if (hasTasks) {
    await db.execute('DELETE FROM task_links');
    await db.execute('DELETE FROM tasks');
  }
  if (hasRoutines) await db.execute('DELETE FROM routines');
  if (hasOps) await db.execute('DELETE FROM operations');
  if (hasJournal) await db.execute('DELETE FROM journal_entries');
  if (hasWiki) await db.execute('DELETE FROM wiki_articles');
  if (hasAny && d.tags) await db.execute('DELETE FROM tags');

  // Re-insert
  if (d.tags) await insertRows(db, 'tags', d.tags, true);
  await insertRows(db, 'journal_entries', journalEntries);
  await insertRows(db, 'wiki_articles', wikiArticles);
  await insertRows(db, 'operations', operations);
  if (d.routines) await insertRows(db, 'routines', d.routines);
  await insertRows(db, 'altars', altars);
  // OR IGNORE, wenn oben nicht geleert wurde: die Datei kann eine Bibliothek
  // ohne Altäre tragen (Datumsfilter, oder ein Vault, der nur Elemente hat),
  // und ein blanker INSERT liefe dann in den Primärschlüssel — mitten in
  // einem Restore, der schon gelöscht hat und keine Transaktion kennt. Der
  // Preis: eine in der Datei geänderte Fassung eines vorhandenen Elements
  // bleibt in diesem einen Fall außen vor.
  const keepExistingLibrary = !hasAltars;
  await insertRows(db, 'altar_items', altarItems, keepExistingLibrary);
  if (d.altarPlacements) await insertRows(db, 'altar_placements', d.altarPlacements);
  await insertTasks(db, tasks);
  if (d.taskLinks) await insertRows(db, 'task_links', d.taskLinks);
  if (d.links) await insertRows(db, 'links', d.links, true);

  await convertImportedSigils(db, backup, operations);

  // Ein Teil-Replace (z. B. nur Tasks) kann Verknüpfungen des Bestands auf
  // gerade ersetzte Ziele verwaisen lassen — und importierte links/task_links
  // können auf abgewählte Typen zeigen. Gleicher Sweep wie beim Papierkorb.
  await sweepDanglingLinks(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge import (ID-prefix strategy)
// ─────────────────────────────────────────────────────────────────────────────

async function doMerge(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile, filters: ImportCategoryFilters): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = applyCategoryFilters(backup.data, filters);

  // Merge loescht zwar nichts, bricht aber mitten im Einfuegen ab, wenn eine
  // Kategorie fehlt — und lässt dann halb importierte Daten zurück.
  await assertPayloadReferencesResolve(db, d);
  const catMap = await resolveImportedCategories(db, usedCategoryRows(d));

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

  /**
   * Die Ziel-IDs der internen Link-Chips IM `content` mitziehen. `remapEntry`
   * behandelt `content` nur als Bildpfad-Feld; die `data-id`-Attribute darin
   * blieben sonst auf den alten, hier umbenannten IDs stehen — und weil die
   * `links`-Tabelle weiter unten sehr wohl umgeschrieben wird, widersprächen
   * sich Tabelle und Text. Der erste Speichervorgang ließe dann `syncLinks`
   * über den veralteten Inhalt laufen und die richtigen Zeilen löschen.
   *
   * Bewusst immer eine ID zurückgeben: `null` würde den Chip durch seinen Text
   * ersetzen, und beim Merge existiert das Ziel ja. `remapId` lässt unbekannte
   * IDs unverändert — dieselbe Konvention wie `remapJsonIds`. Kein `label`:
   * der Titel des Ziels ändert sich beim Merge nicht.
   *
   * Ein Inhalt MIT Chips läuft dabei einmal durch Parsen und Serialisieren und
   * kann danach minimal anders formatiert sein (Anführungszeichen, leere
   * Elemente); einer ohne bleibt Byte für Byte gleich. Bewusst in Kauf
   * genommen: das Markup stammt von TipTap, das es ohnehin bei jedem Speichern
   * neu schreibt.
   */
  const withContentLinks = (row: Row): Row => {
    if (typeof row.content !== 'string') return row;
    return {
      ...row,
      content: remapInternalLinks(row.content, (link) => ({ id: String(remapId(link.id)) })),
    };
  };

  const journalEntries = (d.journalEntries ?? []).map((r: Row) =>
    withContentLinks(remapEntry(r, ['content'], ['paradigm_id', 'bannung_type_wiki_id', 'meditation_type_wiki_id'], ['linked_operation_ids', 'linked_wiki_ids'], 'journal_entries'))
  );
  const wikiArticles = remapCategoryIds((d.wikiArticles ?? []).map((r: Row) => {
    const row = withContentLinks(remapEntry(r, ['content', 'icon', 'cover_image'], [], [], 'wiki_articles'));
    // slug has a UNIQUE constraint — prefix it to avoid collisions on merge
    if (typeof row.slug === 'string') row.slug = `${prefix}-${row.slug}`;
    return row;
  }), catMap);
  const mergeStatus = await statusDefinitionForImport(db, d.blockDefinitions);
  const mergeOps = convertLegacyStatusRows(remapCategoryIds((d.operations ?? []).map((r: Row) =>
    withContentLinks(remapEntry(r, ['content', 'icon', 'cover_image', 'drawing_data', 'thumbnail_data'], ['charging_technique_wiki_id'], [], 'operations'))
  ), catMap), i18n.t, nowIso(), mergeStatus);
  const operations = mergeOps.rows;
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
  const altarItems = remapCategoryIds((d.altarItems ?? []).map((r: Row) =>
    remapEntry(r, ['image_data'], [], [])
  ), catMap);
  const altarPlacements = (d.altarPlacements ?? []).map((r: Row) => ({
    ...r,
    id: pid(r.id as string),
    altar_id: remapId(r.altar_id),
    item_id: remapId(r.item_id),
  }));
  const tasks = remapCategoryIds((d.tasks ?? []).map((r: Row) =>
    remapEntry(r, [], ['parent_task_id'], [])
  ), catMap);
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

  // Kategorien sind schon aufgelöst (resolveImportedCategories oben); Tags:
  // INSERT OR IGNORE (no prefix — shared by name)
  if (d.tags) await insertRows(db, 'tags', d.tags, true);
  // Ohne Präfix: die Kopien im Inhalt nennen ihre Definition über genau diese ID.
  await insertBlockDefinitions(db, await withStatusDefinition(db, d.blockDefinitions, mergeOps.definition, mergeStatus));

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

  await convertImportedSigils(db, backup, operations);

  // Importierte links/task_links können auf Ziele zeigen, die der
  // Typ-/Kategorie-Filter gerade abgewählt hat — wie in doReplace ausfegen.
  await sweepDanglingLinks(db);
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
  const filters: ImportCategoryFilters = categoryFilters ?? { excludedCategoryIds: new Set<string>() };

  // replace behaelt die Original-IDs und add-vault wechselt den Vault: ein
  // offener Editor, den die Navigation dabei unmountet, wuerde seinen
  // VOR-Import-Stand ueber die frisch importierten Zeilen speichern. Fuer die
  // Dauer des Imports sind die automatischen Editor-Saves deshalb gesperrt;
  // merge vergibt neue IDs und braucht das nicht.
  const suspendSaves = mode !== 'merge';
  if (suspendSaves) suspendEditorSaves();
  try {

  // Die Sperre stoppt nur künftige Saves — bereits eingereihte Store-Writes
  // erst zu Ende laufen lassen, bevor replace/add-vault die Zeilen austauscht.
  if (suspendSaves) await drainSerialized();

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

  // replace tauscht die Zeilen unter den offenen Tabs weg — deren Eintrags-IDs
  // stammen aus dem Stand vor dem Import. merge behaelt bestehende Zeilen, da
  // bleiben die Tabs gueltig; add-vault laeuft ueber switchVault und raeumt dort.
  if (mode === 'replace') {
    useUIStore.getState().closeAllTabs();
  }

  // Die globale Suche merkt sich den Klartext eines Eintrags unter (id,
  // updated_at). Beide Haelften stehen so in der Sicherungsdatei: eine Datei,
  // die ein Paar wiederverwendet und nur den Inhalt aendert, erbte sonst den
  // alten Text — der neue waere bis zum Neustart unauffindbar.
  clearSearchTextCache();
  clearEntrySummaryCache();

  await reloadAllStores();
  } finally {
    if (suspendSaves) resumeEditorSaves();
  }
}

// Re-export BackupFile type for use in UI
export type { BackupFile };
