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
import { getActiveDbName, addVault, invalidateVaultCache, type Vault } from './vaultManager';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface BackupOptions {
  includeJournal: boolean;
  includeWiki: boolean;
  includeOperations: boolean;
  includeRoutines: boolean;
  includeAltars: boolean;
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
    customProperties?: Row[];
    routines?: Row[];
    altars?: Row[];
    altarItems?: Row[];
    altarPlacements?: Row[];
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

function buildDateFilter(dateFrom: string, dateTo: string): string {
  const parts: string[] = [];
  if (dateFrom) parts.push(`created_at >= '${dateFrom}'`);
  if (dateTo)   parts.push(`created_at <= '${dateTo}T23:59:59'`);
  return parts.length ? `AND ${parts.join(' AND ')}` : '';
}

function deletedFilter(includeDeleted: boolean): string {
  return includeDeleted ? '' : 'AND deleted_at IS NULL';
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export async function exportDatabase(options: BackupOptions): Promise<void> {
  const db = await getDb();
  const data: BackupFile['data'] = {};
  const allImagePaths = new Set<string>();

  const df = buildDateFilter(options.dateFrom, options.dateTo);
  const dd = deletedFilter(options.includeDeleted);

  // ── Journal ──────────────────────────────────────────────────────────────
  if (options.includeJournal) {
    data.journalEntries = await db.select<Row[]>(
      `SELECT * FROM journal_entries WHERE 1=1 ${df} ${dd}`
    );
    const ids = data.journalEntries.map((r) => `'${r.id}'`).join(',');
    if (ids) {
      const props = await db.select<Row[]>(
        `SELECT * FROM custom_properties WHERE entry_type='journal' AND entry_id IN (${ids})`
      );
      data.customProperties = [...(data.customProperties ?? []), ...props];
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
      `SELECT * FROM wiki_articles WHERE 1=1 ${df} ${dd}`
    );
    data.wikiCategories = await db.select<Row[]>(
      `SELECT * FROM wiki_categories WHERE deleted_at IS NULL`
    );
    const ids = data.wikiArticles.map((r) => `'${r.id}'`).join(',');
    if (ids) {
      const props = await db.select<Row[]>(
        `SELECT * FROM custom_properties WHERE entry_type='wiki' AND entry_id IN (${ids})`
      );
      data.customProperties = [...(data.customProperties ?? []), ...props];
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
      `SELECT * FROM operations WHERE 1=1 ${df} ${dd}`
    );
    data.operationCategories = await db.select<Row[]>(
      `SELECT * FROM operation_categories WHERE deleted_at IS NULL`
    );
    const ids = data.operations.map((r) => `'${r.id}'`).join(',');
    if (ids) {
      const props = await db.select<Row[]>(
        `SELECT * FROM custom_properties WHERE entry_type='operation' AND entry_id IN (${ids})`
      );
      data.customProperties = [...(data.customProperties ?? []), ...props];
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
      `SELECT * FROM routines WHERE 1=1 ${df}`
    );
  }

  // ── Altars ───────────────────────────────────────────────────────────────
  if (options.includeAltars) {
    data.altars = await db.select<Row[]>(
      `SELECT * FROM altars WHERE 1=1 ${df}`
    );
    // Only export items and placements that belong to the filtered altars
    const altarIds = data.altars.map((r) => `'${r.id}'`).join(',');
    if (!altarIds) {
      data.altarItems = [];
      data.altarPlacements = [];
    } else {
      // altar_items aren't directly tied to an altar (linked via placements)
      const placedItemIds = altarIds
        ? (await db.select<Row[]>(`SELECT DISTINCT item_id FROM altar_placements WHERE altar_id IN (${altarIds})`))
            .map((r) => `'${r.item_id}'`).join(',')
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

async function insertRows(
  db: Awaited<ReturnType<typeof getDb>>,
  table: string,
  rows: Row[],
  orIgnore = false,
): Promise<void> {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
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
    altarItems:         f.includeAltars     ? d.altarItems        : [],
    altarPlacements:    f.includeAltars     ? d.altarPlacements   : [],
    tags:               f.includeTags       ? d.tags              : [],
    customProperties: (d.customProperties ?? []).filter((r) => keptContentIds.has(r.entry_id as string)),
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
  ]);

  return {
    ...d,
    wikiArticles: filteredWiki,
    operations: filteredOps,
    customProperties: (d.customProperties ?? []).filter((r) => keptIds.has(r.entry_id as string)),
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
  const IMAGE_FIELDS_ALTAR = ['background_image_data'];
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
  const hasAny = hasJournal || hasWiki || hasOps;

  // Links and custom_properties: delete only for present entry types
  if (hasJournal) {
    await db.execute(`DELETE FROM links WHERE source_type='journal'`);
    await db.execute(`DELETE FROM custom_properties WHERE entry_type='journal'`);
  }
  if (hasWiki) {
    await db.execute(`DELETE FROM links WHERE source_type='wiki'`);
    await db.execute(`DELETE FROM custom_properties WHERE entry_type='wiki'`);
  }
  if (hasOps) {
    await db.execute(`DELETE FROM links WHERE source_type='operation'`);
    await db.execute(`DELETE FROM custom_properties WHERE entry_type='operation'`);
  }
  if (hasAltars) {
    await db.execute('DELETE FROM altar_placements');
    await db.execute('DELETE FROM altar_items');
    await db.execute('DELETE FROM altars');
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
  await insertRows(db, 'altar_items', altarItems);
  if (d.altarPlacements) await insertRows(db, 'altar_placements', d.altarPlacements);
  if (d.customProperties) await insertRows(db, 'custom_properties', d.customProperties);
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
  const customProperties = (d.customProperties ?? []).map((r: Row) => ({
    ...r,
    id: pid(r.id as string),
    entry_id: remapId(r.entry_id),
  }));
  const links = (d.links ?? []).map((r: Row) => ({
    ...r,
    source_id: remapId(r.source_id),
    target_id: remapId(r.target_id),
  }));

  // Categories and tags: INSERT OR IGNORE (no prefix — shared by name/fixed ID)
  if (d.wikiCategories) await insertRows(db, 'wiki_categories', d.wikiCategories, true);
  if (d.operationCategories) await insertRows(db, 'operation_categories', d.operationCategories, true);
  if (d.tags) await insertRows(db, 'tags', d.tags, true);

  // Content: plain INSERT with prefixed IDs (no conflicts possible)
  await insertRows(db, 'journal_entries', journalEntries);
  await insertRows(db, 'wiki_articles', wikiArticles);
  await insertRows(db, 'operations', operations);
  await insertRows(db, 'routines', routines);
  await insertRows(db, 'altars', altars);
  await insertRows(db, 'altar_items', altarItems);
  await insertRows(db, 'altar_placements', altarPlacements);
  await insertRows(db, 'custom_properties', customProperties);
  await insertRows(db, 'links', links, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public import entry point
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TYPES_INCLUDED: ImportTypeFilters = {
  includeJournal: true, includeWiki: true, includeOperations: true,
  includeRoutines: true, includeAltars: true, includeTags: true,
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
    const vaultId = crypto.randomUUID();
    const dbName = `emerald-${vaultId}.db`;
    const newVault: Vault = {
      id: vaultId,
      name: newVaultName ?? 'Imported Vault',
      dbName,
      createdAt: new Date().toISOString(),
    };

    // 2. Register vault (writes to vaults.json)
    await addVault(newVault);
    invalidateVaultCache();

    // 3. Switch to it (resets DB cache + runs migrations on new empty DB)
    const { useVaultStore } = await import('../store/vaultStore');
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
  const { useJournalStore } = await import('../store/journalStore');
  const { useWikiStore } = await import('../store/wikiStore');
  const { useOperationStore } = await import('../store/operationStore');
  const { useTagStore } = await import('../store/tagStore');
  const { useRoutineStore } = await import('../store/routineStore');
  const { useAltarStore } = await import('../store/altarStore');

  const dbName = await getActiveDbName();
  console.log(`[backup] import complete (${mode}) into ${dbName}`);

  if (mode === 'replace') {
    const { useUIStore } = await import('../store/uiStore');
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
  ]);
}

// Re-export BackupFile type for use in UI
export type { BackupFile };
