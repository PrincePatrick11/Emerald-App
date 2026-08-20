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
import { getActiveDbName, addVault, invalidateVaultCache, newVaultRecord } from './vaultManager';
import { useVaultStore } from '../store/vaultStore';
import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useTagStore } from '../store/tagStore';
import { useRoutineStore } from '../store/routineStore';
import { useAltarStore } from '../store/altarStore';
import { useTaskStore } from '../store/taskStore';
import { useUIStore } from '../store/uiStore';

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

interface BackupFile {
  version: '1';
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
  images: Record<string, string>;  // absolute file path → data-URL
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_PATH_RE = /src="([^"]+)"/g;

function extractImagePaths(html: string): string[] {
  const paths: string[] = [];
  LOCAL_PATH_RE.lastIndex = 0;
  let m;
  while ((m = LOCAL_PATH_RE.exec(html)) !== null) {
    const src = m[1];
    if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('blob:')) {
      paths.push(src);
    }
  }
  return paths;
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

/** Builds a quoted comma-separated id list for use inside a SQL IN(...) clause. */
function idsInClause(rows: Row[], field: string = 'id'): string {
  return rows.map((r) => `'${r[field]}'`).join(',');
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export async function exportDatabase(options: BackupOptions): Promise<void> {
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
    const ids = idsInClause(data.journalEntries);
    if (ids) {
      const lnks = await db.select<Row[]>(
        `SELECT * FROM links WHERE source_type='journal' AND source_id IN (${ids})`
      );
      data.links = [...(data.links ?? []), ...lnks];
    }
    for (const r of data.journalEntries) {
      if (r.content) extractImagePaths(r.content as string).forEach((p) => allImagePaths.add(p));
    }
  }

  // ── Wiki ─────────────────────────────────────────────────────────────────
  if (options.includeWiki) {
    data.wikiArticles = await db.select<Row[]>(
      `SELECT * FROM wiki_articles WHERE 1=1 ${dateClause} ${deletedClause}`,
      dateParams,
    );
    data.wikiCategories = await db.select<Row[]>(
      `SELECT * FROM wiki_categories WHERE deleted_at IS NULL`
    );
    const ids = idsInClause(data.wikiArticles);
    if (ids) {
      const lnks = await db.select<Row[]>(
        `SELECT * FROM links WHERE source_type='wiki' AND source_id IN (${ids})`
      );
      data.links = [...(data.links ?? []), ...lnks];
    }
    for (const r of data.wikiArticles) {
      if (r.content) extractImagePaths(r.content as string).forEach((p) => allImagePaths.add(p));
      if (r.icon && !r.icon.startsWith('data:') && !r.icon.startsWith('http')) allImagePaths.add(r.icon as string);
      if (r.cover_image && !r.cover_image.startsWith('data:') && !r.cover_image.startsWith('http')) allImagePaths.add(r.cover_image as string);
    }
  }

  // ── Operations ───────────────────────────────────────────────────────────
  if (options.includeOperations) {
    data.operations = await db.select<Row[]>(
      `SELECT * FROM operations WHERE 1=1 ${dateClause} ${deletedClause}`,
      dateParams,
    );
    data.operationCategories = await db.select<Row[]>(
      `SELECT * FROM operation_categories WHERE deleted_at IS NULL`
    );
    const ids = idsInClause(data.operations);
    if (ids) {
      const lnks = await db.select<Row[]>(
        `SELECT * FROM links WHERE source_type='operation' AND source_id IN (${ids})`
      );
      data.links = [...(data.links ?? []), ...lnks];
    }
    for (const r of data.operations) {
      if (r.content) extractImagePaths(r.content as string).forEach((p) => allImagePaths.add(p));
      if (r.icon && !r.icon.startsWith('data:') && !r.icon.startsWith('http')) allImagePaths.add(r.icon as string);
      if (r.cover_image && !r.cover_image.startsWith('data:') && !r.cover_image.startsWith('http')) allImagePaths.add(r.cover_image as string);
      if (r.drawing_data && !r.drawing_data.startsWith('data:')) allImagePaths.add(r.drawing_data as string);
      if (r.thumbnail_data && !r.thumbnail_data.startsWith('data:')) allImagePaths.add(r.thumbnail_data as string);
    }
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
    const altarIds = idsInClause(data.altars);
    if (!altarIds) {
      data.altarItems = [];
      data.altarPlacements = [];
    } else {
      // altar_items aren't directly tied to an altar (linked via placements)
      const placedItemIds = altarIds
        ? idsInClause(
            await db.select<Row[]>(`SELECT DISTINCT item_id FROM altar_placements WHERE altar_id IN (${altarIds})`),
            'item_id',
          )
        : '';
      data.altarPlacements = altarIds
        ? await db.select<Row[]>(`SELECT * FROM altar_placements WHERE altar_id IN (${altarIds})`)
        : [];
      data.altarItems = placedItemIds
        ? await db.select<Row[]>(`SELECT * FROM altar_items WHERE id IN (${placedItemIds})`)
        : [];
    }
    for (const r of data.altars) {
      if (r.background_image_data && !r.background_image_data.startsWith('data:') && !r.background_image_data.startsWith('http')) {
        allImagePaths.add(r.background_image_data as string);
      }
      if (r.thumbnail_data && !r.thumbnail_data.startsWith('data:') && !r.thumbnail_data.startsWith('http')) {
        allImagePaths.add(r.thumbnail_data as string);
      }
      if (r.icon_data && !r.icon_data.startsWith('data:') && !r.icon_data.startsWith('http')) {
        allImagePaths.add(r.icon_data as string);
      }
    }
    for (const r of data.altarItems) {
      if (r.image_data && !r.image_data.startsWith('data:') && !r.image_data.startsWith('http')) {
        allImagePaths.add(r.image_data as string);
      }
    }
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  if (options.includeTags) {
    data.tags = await db.select<Row[]>(`SELECT * FROM tags WHERE deleted_at IS NULL`);
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  if (options.includeTasks) {
    data.taskCategories = await db.select<Row[]>(
      `SELECT * FROM task_categories WHERE deleted_at IS NULL`
    );
    data.tasks = await db.select<Row[]>(
      `SELECT * FROM tasks WHERE 1=1 ${dateClause} ${deletedClause}`,
      dateParams,
    );
    const taskIds = idsInClause(data.tasks ?? []);
    if (taskIds) {
      data.taskLinks = await db.select<Row[]>(
        `SELECT * FROM task_links WHERE task_id IN (${taskIds})`
      );
    } else {
      data.taskLinks = [];
    }
  }

  // ── Embed images ─────────────────────────────────────────────────────────
  const images: Record<string, string> = {};
  for (const path of allImagePaths) {
    try {
      const dataUrl = await invoke<string>('read_image_as_base64', { path });
      images[path] = dataUrl;
    } catch {
      // Image file missing — skip silently
    }
  }

  const backup: BackupFile = {
    version: '1',
    type: 'backup',
    exportedAt: new Date().toISOString(),
    filters: options,
    data,
    images,
  };

  const savePath = await save({
    defaultPath: `emerald-backup-${new Date().toISOString().slice(0, 10)}.emeralddb`,
    filters: [{ name: 'Emerald Backup', extensions: ['emeralddb'] }],
  });
  if (!savePath) return;

  await invoke('write_file', { path: savePath, content: JSON.stringify(backup) });
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

  // Only show categories that are actually used by entries in this backup
  const usedWikiCatIds = new Set((backup.data.wikiArticles ?? []).map((r) => r.category as string));
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
      const newPath = await invoke<string>('save_image', { dataUrl });
      pathMap.set(oldPath, newPath);
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
    ? (d.wikiArticles ?? []).filter((r) => !filters.excludedWikiCategoryIds.has(r.category as string))
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

async function doReplace(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile, filters: ImportCategoryFilters): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = applyCategoryFilters(backup.data, filters);

  // Remap image paths
  const IMAGE_FIELDS_JOURNAL = ['content'];
  const IMAGE_FIELDS_WIKI = ['content', 'icon', 'cover_image'];
  const IMAGE_FIELDS_OP = ['content', 'icon', 'cover_image', 'drawing_data', 'thumbnail_data'];
  const IMAGE_FIELDS_ALTAR = ['background_image_data', 'thumbnail_data', 'icon_data'];
  const IMAGE_FIELDS_ITEM = ['image_data'];

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
  await insertRows(db, 'tasks', d.tasks ?? []);
  if (d.taskLinks) await insertRows(db, 'task_links', d.taskLinks);
  if (d.links) await insertRows(db, 'links', d.links, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge import (ID-prefix strategy)
// ─────────────────────────────────────────────────────────────────────────────

async function doMerge(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile, filters: ImportCategoryFilters): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = applyCategoryFilters(backup.data, filters);

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

  function remapEntry(row: Row, imagePaths: string[], idFields: string[], jsonIdFields: string[]): Row {
    const out = remapRow(row, imagePaths, pathMap);
    out.id = pid(out.id as string);
    for (const f of idFields) {
      if (out[f] != null) out[f] = remapId(out[f]);
    }
    for (const f of jsonIdFields) {
      if (out[f] != null) out[f] = remapJsonIds(out[f]);
    }
    return out;
  }

  const journalEntries = (d.journalEntries ?? []).map((r: Row) =>
    remapEntry(r, ['content'], ['paradigm_id', 'bannung_type_wiki_id', 'meditation_type_wiki_id'], ['linked_operation_ids', 'linked_wiki_ids'])
  );
  const wikiArticles = (d.wikiArticles ?? []).map((r: Row) => {
    const row = remapEntry(r, ['content', 'icon', 'cover_image'], [], []);
    // slug has a UNIQUE constraint — prefix it to avoid collisions on merge
    if (typeof row.slug === 'string') row.slug = `${prefix}-${row.slug}`;
    return row;
  });
  const operations = (d.operations ?? []).map((r: Row) =>
    remapEntry(r, ['content', 'icon', 'cover_image', 'drawing_data', 'thumbnail_data'], ['charging_technique_wiki_id'], [])
  );
  const routines = (d.routines ?? []).map((r: Row) =>
    remapEntry(r, [], [], ['operation_ids', 'wiki_ids'])
  );
  const altars = (d.altars ?? []).map((r: Row) =>
    remapEntry(r, ['background_image_data'], [], [])
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
  await insertRows(db, 'tasks', tasks);
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
  newVaultName?: string,
  categoryFilters?: ImportCategoryFilters,
  typeFilters?: ImportTypeFilters,
): Promise<void> {
  const filters: ImportCategoryFilters = categoryFilters ?? {
    excludedWikiCategoryIds: new Set(),
    excludedOpCategoryIds: new Set(),
  };

  // Apply type-level filtering first, then subcategory filtering
  const filteredBackup: BackupFile = {
    ...backup,
    data: applyCategoryFilters(applyTypeFilters(backup.data, typeFilters ?? ALL_TYPES_INCLUDED), filters),
  };

  if (mode === 'add-vault') {
    // 1. Create a new vault record
    const newVault = newVaultRecord(newVaultName ?? 'Imported Vault');
    const vaultId = newVault.id;

    // 2. Register vault (writes to vaults.json)
    await addVault(newVault);
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
  const dbName = await getActiveDbName();
  console.log(`[backup] import complete (${mode}) into ${dbName}`);

  if (mode === 'replace') {
    useUIStore.getState().setActiveView({ type: 'home' });
  }

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
}

// Re-export BackupFile type for use in UI
export type { BackupFile };
