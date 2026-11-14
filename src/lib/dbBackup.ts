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

import { copyBlockStatements, OWNER, type BlockOwnerKind, type CopiedBlock, type Statement } from './blockStore';
import { blockRefs } from './blocks/blockRefs';
import { fromBlockRow, type StoredBlockRow } from './blocks/blockRows';
import { remapBlock, renameAll, type BlockRemap } from './blocks/blockRemap';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { getDb, sweepDanglingTaskLinks } from './db';
import {
  addVault,
  getActiveDbFile,
  getActiveVaultId,
  invalidateVaultCache,
  joinPath,
  newVaultRecord,
} from './vaultManager';
import { imageRefsInHtml, isStoredImage, listImageFiles, readImageAsBase64, saveImage } from './images';
import { clearSearchTextCache } from './searchText';
import { clearEntrySummaryCache } from './blocks/entrySummary';
import {
  DEFAULT_DEFINITION_ICON, definitionImageRefs, isDefinitionId, parseDefinitionElements,
  remapDefinitionDefaults, type LinkDefaultResolver,
} from './blocks/definitions';
import { nextTemplateSortOrder } from './templateRows';
import { nextEntrySortOrder, nextLanguageSortOrder } from './lexiconRows';
import { alphabetToJson, DEFAULT_LANGUAGE_ICON } from './lexicon';
import { readUserSymbol, type UserSymbol } from './userSymbols';
import type { Language } from '../types';
import {
  ALTAR_TEMPLATE_ID, isTemplateId, SIGIL_TEMPLATE_ID, templateToRow,
} from './blocks/templates';
import { isBuiltinDashboard, parseDashboardFilter } from './dashboards';
import { fromRow } from './row';
import { IMAGE_FIELDS, imageColumns, storedImageName, storedImageNamesIn } from './schema';
import { isTagId, rewriteTagRefs, stripTagIds, tagIdList, tagNameKey } from './tagRefs';
import { randomTagColor } from '../store/tagStore';
import { categoryKey } from './categories';
import i18n from '../i18n';
import { generateId, isValidHexColor, nowIso } from './helpers';
import { useVaultStore } from '../store/vaultStore';
import { VAULT_KEY_CANCELLED } from '../store/vaultKeyStore';
import { KEY_ERRORS, keyErrorOf } from './vaultKeys';
import { askBackupSecret, BACKUP_UNLOCK_CANCELLED, endBackupSecret, type BackupSecret } from '../store/backupSecretStore';
import { reloadAllStores } from '../store/moduleWiring';
import { useUIStore } from '../store/uiStore';
import { clearAllDrafts, flushDrafts } from '../store/draftStore';
import { resumeEditorSaves, suspendEditorSaves } from './editorLock';
import { drainSerialized } from './serialize';
import { importViaStaging } from './importStaging';
import { importableSettings, isPlainObject, withSettingsGroups, withoutDeviceKeys, writeVaultSettings, type SettingsGroup } from './vaultSettings';
import { useSettingsStore } from '../store/settingsStore';
import { useDeviceStore } from '../store/deviceStore';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which entries come along, by category — the packing list instead of the
 * former entry types. `categoryIds` null: every category; otherwise only
 * these. `includeUncategorized`: entries without a category, and those whose
 * category is not among the categories at hand (in the trash, or not in the file).
 */
export interface EntrySelection {
  categoryIds: string[] | null;
  includeUncategorized: boolean;
}

export interface BackupOptions extends EntrySelection {
  includeTasks: boolean;
  includeTags: boolean;
  /** The lexicon's languages with their vocabulary — all of it, no date question. */
  includeLexicon: boolean;
  dateFrom: string;       // ISO date string, '' = no lower bound
  dateTo: string;         // ISO date string, '' = no upper bound
  includeDeleted: boolean;
  /** The vault's `settings.json`. */
  includeSettings?: boolean;
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
  entriesCount: number;
  /** How many entries of the file have no category it carries — the "Uncategorized" choice. */
  uncategorizedCount: number;
  /** Entries per category ID of the file. */
  entryCounts: Record<string, number>;
  templatesCount: number;
  taskCount: number;
  /** The lexicon's languages; their vocabulary travels with them. */
  languagesCount: number;
  /** Only categories that some content of the backup points to. */
  categories: BackupCategoryEntry[];
  /** Whether the file brings vault settings along. */
  hasSettings: boolean;
}

/** Which content to import — the entries by category, the rest by kind. */
export interface ImportTypeFilters extends EntrySelection {
  includeTasks: boolean;
  includeTags: boolean;
  includeLexicon: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * The format of a backup. '16' is the first since entries have no type
 * (`FRESH_START_VERSION` in `schema.ts`): all entries in one `data.entries`
 * array; categories with their start template (`template_id`); the
 * dashboards as `data.dashboards`; the blocks of entries and templates as the
 * rows of `blocks` (`data.blocks`); the pictures taken into "Images" as
 * `data.vaultImages`.
 *
 * Only this version is read. An older file comes from before the fresh start
 * and is refused with {@link BACKUP_OUTDATED} before anything happens — its
 * converters are gone with the old migration chain. A newer one is refused
 * with {@link BACKUP_TOO_NEW}: `insertRows` filters every row against
 * `PRAGMA table_info`, so a file this build does not fully understand would
 * be imported *wrongly* rather than fail. Raise the version whenever an older
 * build would otherwise import a file wrongly.
 */
const BACKUP_VERSION = '16' as const;

/** A backup from before the fresh start of the schema: refused, not converted. */
export const BACKUP_OUTDATED = 'BACKUP_OUTDATED';
/** A backup from a newer version of the app. */
export const BACKUP_TOO_NEW = 'BACKUP_TOO_NEW';

/**
 * Checks a parsed file's version, and clears the `category_id` of an entry
 * whose category the file does not carry. Throws {@link BACKUP_OUTDATED} /
 * {@link BACKUP_TOO_NEW} (numerically: a string comparison would consider
 * '10' older than '4').
 */
export function readBackupPayload(backup: BackupFile): void {
  const version = Number(backup.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`Unsupported backup version: ${backup.version}`);
  if (version < Number(BACKUP_VERSION)) throw new Error(BACKUP_OUTDATED);
  if (version > Number(BACKUP_VERSION)) throw new Error(BACKUP_TOO_NEW);
  if (!Array.isArray(backup.data.entries)) backup.data.entries = [];
  // An entry is in a category only if the file carries that category. Without
  // this, a crafted file could count an entry as "uncategorized" in the
  // dialog and still name a category of this vault — whose entries a replace
  // would then delete without being asked.
  const known = new Set((Array.isArray(backup.data.categories) ? backup.data.categories : []).map((c) => String(c?.id)));
  backup.data.entries = backup.data.entries.map((row) => (
    row?.category_id != null && !known.has(String(row.category_id)) ? { ...row, category_id: null } : row
  ));
}

/** Maximum length of a tag name from a foreign source. */
const TAG_NAME_MAX = 100;

/**
 * Writes a backup's tags into the vault and re-points the file's rows
 * to local IDs — for replace as for merge. A tag with the
 * same ID is the same; otherwise a name belongs to one tag (`tagNameKey`):
 * a local one of the same name is used — if it is in the trash and the one from
 * the file is not, it comes back, as when typing it in, without the entries that
 * still carried it (`tagStore`). What remains is added with its ID. An ID
 * without a tag in the file (tags deselected) stays if the tag exists here —
 * otherwise it drops out of the row.
 * Runs in the working copy (`importViaStaging`): if the import fails afterwards,
 * nothing of the tags remains either.
 */
export async function importTagsAndRemap(db: Awaited<ReturnType<typeof getDb>>, d: BackupFile['data']): Promise<BackupFile['data']> {
  const local = await db.select<{ id: string; name: string; deleted_at: string | null }[]>('SELECT id, name, deleted_at FROM tags');
  const byId = new Map(local.map((t) => [t.id, t]));
  const byName = new Map(local.map((t) => [tagNameKey(t.name), t]));
  const idMap = new Map<string, string>();
  for (const row of d.tags ?? []) {
    const id = row.id;
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, TAG_NAME_MAX) : '';
    if (!isTagId(id) || !name) continue;
    const hit = byId.get(id) ?? byName.get(tagNameKey(name));
    if (hit) {
      if (hit.deleted_at && !row.deleted_at) {
        await stripTagIds(db, [hit.id]);
        await db.execute('UPDATE tags SET deleted_at=NULL WHERE id=$1', [hit.id]);
        hit.deleted_at = null;
      }
      idMap.set(id, hit.id);
      continue;
    }
    const tag = { id, name, deleted_at: row.deleted_at == null ? null : String(row.deleted_at) };
    await db.execute(
      'INSERT INTO tags (id, name, color, deleted_at) VALUES ($1, $2, $3, $4)',
      [id, name, typeof row.color === 'string' && isValidHexColor(row.color) ? row.color : randomTagColor(), tag.deleted_at],
    );
    byId.set(id, tag);
    byName.set(tagNameKey(name), tag);
    idMap.set(id, id);
  }
  const remap = (rows: Row[] | undefined) => rows?.map((row) => ({
    ...row,
    tags: JSON.stringify(tagIdList(row.tags).flatMap((id) => idMap.get(id) ?? (byId.has(id) ? [id] : []))),
  }));
  return {
    ...d,
    tags: [],
    entries: remap(d.entries),
    templates: remap(d.templates),
    vaultImages: remap(d.vaultImages),
  };
}

/** After the import: tag IDs without a tag row drop out of every list. */
export async function dropUnknownTagIds(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM tags')).map((r) => r.id));
  await rewriteTagRefs(db, (ids) => ids.filter((id) => known.has(id)));
}

/**
 * The columns of `entries`. Every row gets all of them: `insertRows` takes
 * the column list from the first row, and a row without an icon at the front
 * would otherwise strip the icons from the rows behind it.
 */
const ENTRY_COLUMNS = [
  'id', 'title', 'category_id', 'entry_number', 'icon', 'cover_image',
  'tags', 'created_at', 'updated_at', 'deleted_at',
] as const;

/** The image columns of an entry row at import. */
const IMAGE_FIELDS_ENTRY = imageColumns('entries');

function asEntryRow(row: Row): Row {
  const out: Row = {};
  for (const column of ENTRY_COLUMNS) out[column] = row[column] ?? null;
  out.title ??= '';
  out.tags ??= '[]';
  return out;
}

/** The highest number an imported entry may keep — far above any real vault. */
const MAX_ENTRY_NUMBER = 1_000_000_000;

/**
 * The import's entry rows for `entries`. An ID arrives only once (a crafted
 * file could carry it twice — the first wins), and so does a number: the
 * second holder of a number (`idx_entries_number` is unique), or one out of
 * range, gets none and is numbered afterwards (`numberUnnumbered`).
 */
export function entryRowsForInsert(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const numbers = new Set<number>();
  const out: Row[] = [];
  for (const row of rows) {
    const id = String(row.id);
    if (seen.has(id)) {
      console.warn(`[backup] entry ${id} is in the file twice — skipped`);
      continue;
    }
    seen.add(id);
    const entry = asEntryRow(row);
    const number = Number(entry.entry_number);
    // A number out of range (a crafted 1e20 would make every next number collide) is given afresh.
    if (entry.entry_number != null && (!Number.isSafeInteger(number) || number < 1 || number > MAX_ENTRY_NUMBER || numbers.has(number))) entry.entry_number = null;
    else if (entry.entry_number != null) numbers.add(number);
    out.push(entry);
  }
  return out;
}

/** Gives every entry without a number the next free one, in creation order. */
async function numberUnnumbered(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const rows = await db.select<{ id: string }[]>('SELECT id FROM entries WHERE entry_number IS NULL ORDER BY created_at, id');
  if (!rows.length) return;
  const [{ n }] = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(entry_number), 0) AS n FROM entries');
  await db.batch(rows.map((r, i) => ['UPDATE entries SET entry_number=$1 WHERE id=$2', [n + i + 1, r.id]] as const));
}

/** Does an entry row pass the selection by category? `known`: the category IDs at hand. */
export function entrySelected(row: Row, selection: EntrySelection, known: ReadonlySet<string>): boolean {
  const category = row.category_id == null ? null : String(row.category_id);
  if (category === null || !known.has(category)) return selection.includeUncategorized;
  return selection.categoryIds === null || selection.categoryIds.includes(category);
}

/** Selects every category, with the uncategorized entries. */
export const ALL_ENTRIES: EntrySelection = { categoryIds: null, includeUncategorized: true };

/** Does the selection take any entry at all? */
function selectsEntries(selection: EntrySelection): boolean {
  return selection.includeUncategorized || selection.categoryIds === null || selection.categoryIds.length > 0;
}

interface BackupFile {
  version: typeof BACKUP_VERSION;
  type: 'backup';
  exportedAt: string;
  filters: BackupOptions;
  data: {
    /** The entries, as in the `entries` table. */
    entries?: Row[];
    /** The global list; included as soon as entries or tasks are included. */
    categories?: Row[];
    /** The dashboards; included with the entries. */
    dashboards?: Row[];
    /** The custom blocks; included as soon as entries are included. */
    blockDefinitions?: Row[];
    /** The templates; included as soon as entries are included. */
    templates?: Row[];
    tags?: Row[];
    tasks?: Row[];
    taskLinks?: Row[];
    /** The lexicon's languages. */
    languages?: Row[];
    /** Their vocabulary — worthless without its language, hence always together. */
    lexiconEntries?: Row[];
    /** The vault's own symbols (table `symbols`). */
    symbols?: Row[];
    /** The pictures taken into "Images", with their files in `images`. */
    vaultImages?: Row[];
    /**
     * The blocks of the entries and templates in the file: the rows of
     * `blocks` without `row_id` and `text`, the owner in `entry_id` or
     * `template_id`. `block_refs` does not travel: the import writes it from
     * the blocks.
     */
    blocks?: Row[];
  };
  images: Record<string, string>;  // stored file name → data URL
  /**
   * The vault's settings (`settings.json`), unchecked like everything from
   * the file — normalised only at import. An older build simply ignores the
   * field.
   */
  settings?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enters every image reference of the rows into `into`. The column list comes
 * from `IMAGE_FIELDS`, so that it is the same one the cleanup action uses.
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
 * Maximum number of bound values per query. SQLite tolerates far more, but a
 * fixed cut makes the query independent of the vault's size.
 */
const IN_CHUNK = 400;

/**
 * Runs a query with an `IN (...)` list without writing the values into the
 * SQL string.
 *
 * The predecessor built the list by string concatenation. The IDs in it
 * are not necessarily assigned by the app: a backup import takes them verbatim
 * from the file, and on the next export they ended up unbound in
 * `db.select`. sqlx splits SQL at `;` and runs every statement
 * (`sqlx-sqlite/src/statement/virtual.rs`), so a crafted
 * `.emeralddb` could execute arbitrary SQL — a second-order
 * injection, triggered only by a later, harmless-looking action.
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

/** Everything in the vault — trash and settings included. The selection
 *  of the automatic backup: one with gaps would be a trap. */
export const FULL_BACKUP_OPTIONS: Required<BackupOptions> = {
  ...ALL_ENTRIES,
  includeTasks: true,
  includeTags: true,
  includeLexicon: true,
  dateFrom: '',
  dateTo: '',
  includeDeleted: true,
  includeSettings: true,
};

/**
 * The rows of `blocks` of these owners, as the file carries them (without
 * `row_id`, which is the vault's own, and `text`, which follows from the
 * block), in owner and position order. Their pictures go into `into`, from
 * the blocks themselves (`blockRefs`): a picture that only stands in a
 * block's JSON — a canvas background, a copy's image prefill — comes along too.
 */
async function exportBlockRows(
  db: Awaited<ReturnType<typeof getDb>>, kind: BlockOwnerKind, owners: Row[], into: Set<string>,
): Promise<Row[]> {
  const { column } = OWNER[kind];
  const rows = await selectWhereIn(
    db, (ph) => `SELECT * FROM blocks WHERE ${column} IN (${ph}) ORDER BY ${column}, position`, owners,
  );
  for (const row of rows) {
    delete row.row_id;
    delete row.text;
    for (const ref of blockRefs(fromBlockRow(row as StoredBlockRow))) {
      if (ref.kind === 'image') into.add(ref.target);
    }
    // And every stored name anywhere in the row, as the image cleanup keeps them
    // (`collectUsedImageFilenames`): a block `blockRefs` cannot fully read
    // (broken JSON, a newer type) still takes its pictures along.
    for (const key of ['title', 'config', 'data', 'attrs', 'html']) {
      if (typeof row[key] === 'string') storedImageNamesIn(row[key]).forEach((name) => into.add(name));
    }
  }
  return rows;
}

/** The content of a backup according to `options`, images embedded. Writes nothing. */
export async function buildBackup(options: BackupOptions): Promise<BackupFile> {
  return buildBackupFrom(await getDb(), options);
}

/** `buildBackup` against a given database — the schema harness calls it directly. */
export async function buildBackupFrom(db: Awaited<ReturnType<typeof getDb>>, options: BackupOptions): Promise<BackupFile> {
  const data: BackupFile['data'] = {};
  const allImagePaths = new Set<string>();

  const { clause: dateClause, params: dateParams } = buildDateFilter(options.dateFrom, options.dateTo);
  const deletedClause = deletedFilter(options.includeDeleted);

  // ── Entries ──────────────────────────────────────────────────────────────
  // One table, one array — the selection by category decides which come
  // along. An entry whose category is in the trash counts as uncategorized,
  // as everywhere it is shown.
  const withEntries = selectsEntries(options);
  if (withEntries) {
    const live = new Set((await db.select<{ id: string }[]>('SELECT id FROM categories WHERE deleted_at IS NULL')).map((r) => r.id));
    const rows = await db.select<Row[]>(`SELECT * FROM entries WHERE 1=1 ${dateClause} ${deletedClause}`, dateParams);
    data.entries = rows.filter((row) => entrySelected(row, options, live));
    collectImageRefs('entries', data.entries, allImagePaths);
    data.blocks = await exportBlockRows(db, 'entry', data.entries, allImagePaths);
    data.dashboards = await db.select<Row[]>('SELECT * FROM dashboards');
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  // With the trash, the tags in it too: entries keep carrying their IDs.
  if (options.includeTags) {
    data.tags = await db.select<Row[]>(`SELECT * FROM tags WHERE 1=1 ${deletedClause}`);
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

  // ── Images ───────────────────────────────────────────────────────────────
  // The pictures taken into "Images" belong to no module: all of them, trash
  // included, with their files — like the templates, one list, no date question.
  data.vaultImages = await db.select<Row[]>(`SELECT * FROM images`);
  for (const row of data.vaultImages) {
    const file = storedImageName(typeof row.file === 'string' ? row.file : null);
    if (file) allImagePaths.add(file);
  }

  // ── Categories ───────────────────────────────────────────────────────────
  // The one list, as soon as entries or tasks are included. Soft-deleted
  // categories too: their contents are exported along and
  // need their counterpart, otherwise the import fails on the foreign key.
  if (withEntries || options.includeTasks) {
    data.categories = await db.select<Row[]>(`SELECT * FROM categories`);
    // The categories are read after their contents, and deleting or
    // merging a category runs over several statements without a
    // transaction. If it fell exactly in between, a content would carry a category
    // that is missing from the file — and the import would reject the whole backup
    // (`assertPayloadReferencesResolve`). "Uncategorized" is what
    // deleting does to these rows anyway. On a merge the
    // backup loses the assignment to the target category for these rows — accepted,
    // the window is a few statements wide. The tables: `CATEGORIZED_TABLES`.
    const known = new Set(data.categories.map((c) => String(c.id)));
    for (const rows of [data.entries, data.tasks]) {
      for (const row of rows ?? []) {
        if (row.category_id != null && !known.has(String(row.category_id))) row.category_id = null;
      }
    }
  }

  // ── Custom blocks ────────────────────────────────────────────────────────
  // The vault's own blocks. All of it, trash included —
  // one list, no date question.
  if (withEntries) {
    data.blockDefinitions = await db.select<Row[]>(`SELECT * FROM block_definitions`);
    // The image defaults travel along, even if no copy uses them yet.
    for (const row of data.blockDefinitions) {
      definitionImageRefs(parseDefinitionElements(row.elements)).forEach((ref) => allImagePaths.add(ref));
    }
  }

  // ── Templates ────────────────────────────────────────────────────────────
  // Like the custom blocks: all of it, trash included, with the images in the block stack.
  if (withEntries) {
    data.templates = await db.select<Row[]>(`SELECT * FROM templates`);
    data.blocks = [...(data.blocks ?? []), ...await exportBlockRows(db, 'template', data.templates, allImagePaths)];
  }

  // ── Lexicon ──────────────────────────────────────────────────────────────
  // Languages and vocabulary travel together and in full, trash included: it is
  // one list, no date question — like the custom blocks and the templates.
  // Icons are a data URL in the row, so no image file hangs off them.
  if (options.includeLexicon) {
    data.languages = await db.select<Row[]>(`SELECT * FROM languages`);
    data.lexiconEntries = await db.select<Row[]>(`SELECT * FROM lexicon_entries`);
  }

  // ── Own symbols ──────────────────────────────────────────────────────────
  // Always and in full, like the lexicon: a short list, path data in the row.
  data.symbols = await db.select<Row[]>('SELECT * FROM symbols');

  // ── Embed images ─────────────────────────────────────────────────────────
  const images: Record<string, string> = {};
  for (const path of allImagePaths) {
    try {
      images[path] = await readImageAsBase64(path);
    } catch {
      // Image file missing — skip silently
    }
  }

  return {
    version: BACKUP_VERSION,
    type: 'backup',
    exportedAt: new Date().toISOString(),
    filters: options,
    data,
    images,
    // Without what a `settings.json` from before still carries of language and
    // theme: those belong to the device, and a backup must not bring them back.
    ...(options.includeSettings && { settings: withoutDeviceKeys(useSettingsStore.getState().settings) }),
  };
}

/** Resolves to `false` when the save dialog was cancelled — nothing was
 *  written, and the UI must not report success then. */
export async function exportDatabase(options: BackupOptions): Promise<boolean> {
  const backup = await buildBackup(options);

  // The dialog opens in the active vault's `backup/` folder — created
  // if needed. If that fails (vault folder currently unreachable),
  // it stays with the bare file name and the dialog opens wherever the
  // operating system wants; the export itself does not depend on it.
  const filename = `emerald-backup-${new Date().toISOString().slice(0, 10)}.emeralddb`;
  // One chain, one catch: if `getActiveVaultId()` stood as its own await in the
  // argument, its rejection would escape the `.catch` and take the export down with it.
  const backupDir = await getActiveVaultId()
    .then((vaultId) => invoke<string>('ensure_backup_dir', { vaultId }))
    .catch(() => null);

  const savePath = await save({
    defaultPath: backupDir ? joinPath(backupDir, filename) : filename,
    filters: [{ name: 'Emerald Backup', extensions: ['emeralddb'] }],
  });
  if (!savePath) return false;

  // Sealed under the vault's key, with its `vault.key` in the header
  // (`backup.rs`) — opens with the password that applies now.
  await invoke('write_backup_file', { vaultId: await getActiveVaultId(), path: savePath, content: JSON.stringify(backup) });
  return true;
}

/**
 * The JSON text of a backup. An encrypted one is opened by Rust with the
 * key of an open vault if it fits; otherwise the password or
 * recovery key is asked for — until it fits or the user
 * cancels (`null`).
 */
async function readBackupText(path: string): Promise<string | null> {
  let secret: BackupSecret | null = null;
  try {
    for (;;) {
      let message: string | null;
      try {
        return await invoke<string>('read_backup_file', { path, ...(secret ?? {}) });
      } catch (err) {
        const code = keyErrorOf(err);
        if (code === KEY_ERRORS.backupLocked) message = null;
        else if (code === KEY_ERRORS.wrongPassword) message = i18n.t('vaultKey.wrongPassword');
        else if (code === KEY_ERRORS.wrongRecoveryKey) message = i18n.t('vaultKey.wrongRecoveryKey');
        else throw err;
      }
      try {
        secret = await askBackupSecret(message);
      } catch (cancelled) {
        if (keyErrorOf(cancelled) === BACKUP_UNLOCK_CANCELLED) return null;
        throw cancelled;
      }
    }
  } finally {
    // Opened, discarded or failed — the question is settled.
    endBackupSecret();
  }
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

  const raw = await readBackupText(filePath);
  if (raw === null) return null;
  const backup = JSON.parse(raw) as BackupFile;
  if (backup.type !== 'backup') throw new Error('Not an Emerald backup file');
  readBackupPayload(backup);

  const preview = previewOf(backup);
  return { path: filePath, backup, preview };
}

/** What the import offers to choose from: the categories in use and how many entries each holds. */
export function previewOf(backup: BackupFile): BackupPreview {
  const entries = backup.data.entries ?? [];
  const known = new Set((backup.data.categories ?? []).map((c) => String(c.id)));
  const entryCounts: Record<string, number> = {};
  let uncategorizedCount = 0;
  for (const row of entries) {
    const category = row.category_id == null ? null : String(row.category_id);
    if (category === null || !known.has(category)) uncategorizedCount += 1;
    else entryCounts[category] = (entryCounts[category] ?? 0) + 1;
  }
  // Only show categories that are actually used by entries or tasks in this backup.
  const usedCatIds = new Set([...entries, ...(backup.data.tasks ?? [])].map((r) => String(r.category_id)));
  return {
    exportedAt: backup.exportedAt,
    entriesCount: entries.length,
    uncategorizedCount,
    entryCounts,
    templatesCount: backup.data.templates?.length ?? 0,
    taskCount: backup.data.tasks?.length ?? 0,
    languagesCount: backup.data.languages?.length ?? 0,
    categories: (backup.data.categories ?? []).filter((c) => usedCatIds.has(String(c.id))) as BackupCategoryEntry[],
    hasSettings: isPlainObject(backup.settings),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image restore helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The file's pictures stored in this vault, by the name the file knew them by.
 * A file already here under that very name stays as it is: a stored name is
 * a hash of the content, and saving again could spell the type differently
 * (a `.jpeg` taken from the disk comes back as `.jpg`), which would leave the
 * picture in "Images" twice and the texts pointing at the second.
 */
async function restoreImages(backup: BackupFile): Promise<Map<string, string>> {
  const pathMap = new Map<string, string>();
  const here = new Set(await listImageFiles().then((files) => files.map((f) => f.name), () => []));
  for (const [oldPath, dataUrl] of Object.entries(backup.images)) {
    if (here.has(oldPath) && storedImageName(oldPath) === oldPath) {
      pathMap.set(oldPath, oldPath);
      continue;
    }
    try {
      pathMap.set(oldPath, await saveImage(dataUrl));
    } catch {
      // skip
    }
  }
  return pathMap;
}

function remapPaths(value: unknown, pathMap: Map<string, string>): unknown {
  return typeof value === 'string' ? renameAll(value, pathMap) : value;
}

/** Rewrite the defaults of brought-along definitions to the images stored here (and, on merge, to the new IDs). */
function remapDefinitionRows(rows: unknown, pathMap: Map<string, string>, link?: LinkDefaultResolver): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => (typeof r === 'object' && r !== null
    ? { ...r, elements: remapDefinitionDefaults((r as Row).elements, (name) => pathMap.get(name) ?? name, link) }
    : r));
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
  // One transaction per chunk instead of one per row — otherwise SQLite commits the
  // file once for every row. Chunks, so that no IPC message carries the
  // entire content of a large backup.
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.batch(rows.slice(i, i + INSERT_CHUNK).map((row) => [sql, cols.map((c) => row[c])] as const));
  }
}

/** Rows per `batch` in `insertRows`. */
const INSERT_CHUNK = 500;

/**
 * The custom blocks of a backup: by ID, `INSERT OR IGNORE` — a
 * definition that already exists here (also in the trash) stays as it
 * is; none is deleted, not even on replace. The copies in the
 * entries carry their elements themselves, a differing version here changes
 * nothing about them. Crafted `elements`/`display` are caught on reading
 * (`fromRow.blockDefinition` validates as for content).
 *
 * The file is foreign: every row is first brought into the complete column shape
 * — `insertRows` takes the columns of the first row, and a row
 * without a required column would abort the INSERT. Anything without a usable ID is dropped.
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
      elements: json(r.elements, '[]'),
      display: json(r.display, '{}'),
      sort_order: Number.isFinite(r.sort_order) ? r.sort_order : 0,
      created_at: text(r.created_at, now),
      updated_at: text(r.updated_at, now),
      deleted_at: typeof r.deleted_at === 'string' ? r.deleted_at : null,
    }));
  await insertRows(db, 'block_definitions', normalized, true);
}

/**
 * The pictures of "Images" from a file: like the templates never deleted,
 * missing ones added — by file, since a file is one picture. The file name
 * follows the images stored here (`pathMap`). An ID already taken by another
 * picture gets a new one.
 */
async function insertVaultImages(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: unknown,
  pathMap: Map<string, string>,
): Promise<void> {
  if (!Array.isArray(rows)) return;
  const local = await db.select<{ id: string; file: string }[]>('SELECT id, file FROM images');
  const files = new Set(local.map((r) => r.file));
  const ids = new Set(local.map((r) => r.id));
  const fresh: Row[] = [];
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Row;
    const before = typeof row.file === 'string' ? row.file : '';
    const file = storedImageName(pathMap.get(before) ?? before);
    if (!file || files.has(file)) continue;
    files.add(file);
    const id = typeof row.id === 'string' && /^[\w-]{1,100}$/.test(row.id) && !ids.has(row.id) ? row.id : generateId();
    ids.add(id);
    const at = typeof row.created_at === 'string' ? row.created_at : nowIso();
    fresh.push({
      ...row,
      id,
      file,
      // The texts it was taken out of are this vault's, not the file's.
      detached: '[]',
      created_at: at,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : at,
    });
  }
  await insertRows(db, 'images', fresh);
}

/**
 * The templates of a backup: by ID, `INSERT OR IGNORE` like the custom
 * blocks — an existing template (also in the trash, also the built-in
 * sigil template) stays as it is, none is deleted. New ones go to the end
 * of the list in their order.
 *
 * The file is foreign: every row runs through `fromRow.template` as on
 * reading; its blocks come as rows (`insertImportedBlocks`). Which category
 * starts with it is the category's business (`applyStartTemplates`).
 */
async function insertTemplates(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: unknown,
): Promise<string[]> {
  if (!Array.isArray(rows)) return [];
  const local = (await db.select<Row[]>('SELECT * FROM templates')).map(fromRow.template);
  const known = new Set(local.map((t) => t.id));

  const now = nowIso();
  const fresh = rows
    .filter((r): r is Row => typeof r === 'object' && r !== null && isTemplateId((r as Row).id))
    .map((r) => fromRow.template(r))
    .sort((a, b) => a.sort_order - b.sort_order)
    // An ID that is already there — also a second row of the same ID in the file — does not get in.
    .filter((t) => !known.has(t.id) && !!known.add(t.id));
  let sortOrder = await nextTemplateSortOrder(db);
  const normalized = fresh.map((t) => {
    return templateToRow({
      ...t,
      content: '',
      sort_order: sortOrder++,
      created_at: t.created_at || now,
      updated_at: t.updated_at || now,
    });
  });
  await insertRows(db, 'templates', normalized, true);
  return normalized.map((t) => t.id);
}

/** Statements per `batch` when inserting block rows — a block is a few of them. */
const BLOCK_BATCH = 500;

/** A row of `data.blocks` in the shape `fromBlockRow` reads — the file is foreign, so every value is checked. */
function fileBlockRow(row: Row): StoredBlockRow | null {
  if (typeof row.id !== 'string' || !row.id || typeof row.type !== 'string' || !row.type) return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: row.id,
    type: row.type,
    version: Number.isInteger(row.version) && row.version > 0 ? row.version : null,
    hidden: row.hidden === 1 ? 1 : 0,
    title: text(row.title),
    show_title: row.show_title === 0 || row.show_title === 1 ? row.show_title : null,
    config: text(row.config),
    data: text(row.data),
    attrs: text(row.attrs),
    html: text(row.html) ?? '',
  };
}

/**
 * The blocks of a file, for the owners the import has just inserted:
 * `owners` maps an owner's ID in the file to its ID here (the merge prefix), and
 * an owner not in it — filtered out, or a template that already existed here —
 * gets none. Each block goes through `remapBlock` (pictures, and on a merge the
 * IDs) and keeps its position and time (`copyBlockStatements`); `block_refs`
 * is written from it.
 */
async function insertImportedBlocks(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: Row[] | undefined,
  kind: BlockOwnerKind,
  owners: ReadonlyMap<string, string>,
  remap: BlockRemap,
): Promise<void> {
  if (!Array.isArray(rows) || !rows.length || !owners.size) return;
  const { column } = OWNER[kind];
  const byOwner = new Map<string, CopiedBlock[]>();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const owner = typeof row[column] === 'string' ? owners.get(row[column]) : undefined;
    if (owner === undefined) continue;
    const stored = fileBlockRow(row);
    if (!stored) continue;
    const list = byOwner.get(owner) ?? [];
    list.push({
      block: remapBlock(fromBlockRow(stored), remap),
      position: typeof row.position === 'string' ? row.position : null,
      updatedAt: typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : null,
    });
    byOwner.set(owner, list);
  }
  const now = nowIso();
  let batch: Statement[] = [];
  for (const [id, copies] of byOwner) {
    batch.push(...copyBlockStatements({ kind, id }, copies, now));
    if (batch.length >= BLOCK_BATCH) {
      await db.batch(batch);
      batch = [];
    }
  }
  if (batch.length) await db.batch(batch);
}

/**
 * The lexicon of a backup: by ID, `INSERT OR IGNORE` like the custom
 * blocks and the templates — a language that already exists here (also in the
 * trash) stays as it is; none is deleted, not even on
 * replace. New ones go to the end of the list in their order.
 *
 * The vocabulary comes afterwards, and only for a language that really
 * exists here: `lexicon_entries.language_id` carries a foreign key, a word
 * without its language would make the whole import fail. So for an already
 * existing language the brought-along vocabulary **is added**; it
 * gets new slots at the end of its list, otherwise two words would sit on
 * the same `sort_order` and the order would be random.
 *
 * The file is foreign: every row runs through `fromRow.*` as on reading, and
 * whatever has no ID is dropped.
 */
async function insertLexicon(
  db: Awaited<ReturnType<typeof getDb>>,
  languageRows: unknown,
  entryRows: unknown,
): Promise<void> {
  const now = nowIso();
  const rows = <T,>(value: unknown, read: (row: Row) => T): T[] => (Array.isArray(value) ? value : [])
    .filter((r): r is Row => typeof r === 'object' && r !== null && typeof r.id === 'string' && !!r.id)
    .map(read);

  const known = new Set(
    (await db.select<Row[]>('SELECT id FROM languages')).map((r) => String(r.id)),
  );

  const fresh: Language[] = [];
  for (const language of rows(languageRows, fromRow.language).sort((a, b) => a.sort_order - b.sort_order)) {
    // An ID that is already there — also a second row of the same ID in the file — does not get in.
    if (known.has(language.id)) continue;
    known.add(language.id);
    fresh.push(language);
  }
  let languageOrder = await nextLanguageSortOrder(db);
  await insertRows(db, 'languages', fresh.map((l) => ({
    id: l.id,
    name: l.name,
    icon: l.icon || DEFAULT_LANGUAGE_ICON,
    alphabet: alphabetToJson(l.alphabet),
    sort_order: languageOrder++,
    created_at: l.created_at || now,
    updated_at: l.updated_at || now,
    deleted_at: l.deleted_at,
  })), true);

  // `known` now holds exactly the languages of this vault: the ones found and
  // the ones just inserted. A second SELECT is not needed for that.
  const entryOrder = new Map<string, number>();
  const entries: Row[] = [];
  for (const entry of rows(entryRows, fromRow.lexiconEntry).sort((a, b) => a.sort_order - b.sort_order)) {
    if (!known.has(entry.language_id)) continue;
    const next = entryOrder.get(entry.language_id) ?? await nextEntrySortOrder(db, entry.language_id);
    entryOrder.set(entry.language_id, next + 1);
    entries.push({
      id: entry.id,
      language_id: entry.language_id,
      term: entry.term,
      translation: entry.translation,
      pronunciation: entry.pronunciation,
      note: entry.note,
      sort_order: next,
      created_at: entry.created_at || now,
      updated_at: entry.updated_at || now,
    });
  }
  await insertRows(db, 'lexicon_entries', entries, true);
}

/**
 * The own symbols of a backup: by ID, `INSERT OR IGNORE` like the lexicon —
 * one that exists here stays, none is deleted, not even on replace. The file
 * is foreign: a row without an id or usable path data is dropped.
 */
async function insertSymbols(db: Awaited<ReturnType<typeof getDb>>, symbolRows: unknown): Promise<void> {
  const symbols = (Array.isArray(symbolRows) ? symbolRows : [])
    .filter((r): r is Row => typeof r === 'object' && r !== null)
    .map(readUserSymbol)
    .filter((s): s is UserSymbol => !!s);
  await insertRows(db, 'symbols', symbols.map((s) => ({ ...s })), true);
}

/**
 * `tasks.parent_task_id` points to the same table. If a child comes before its
 * parent in the backup, the foreign key fails on INSERT.
 * So insert first without the parent reference and fill it in afterwards — then
 * all rows are guaranteed to exist.
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

  await db.batch(parents.map(([id, parentId]) => [
    'UPDATE tasks SET parent_task_id=$1 WHERE id=$2 AND EXISTS (SELECT 1 FROM tasks WHERE id=$1)',
    [parentId, id],
  ] as const));
}

// ─────────────────────────────────────────────────────────────────────────────
// Replace import
// ─────────────────────────────────────────────────────────────────────────────

function applyTypeFilters(d: BackupFile['data'], f: ImportTypeFilters): BackupFile['data'] {
  const anyEntries = selectsEntries(f);
  const known = new Set((d.categories ?? []).map((c) => String(c.id)));
  return {
    ...d,
    blockDefinitions:   anyEntries          ? d.blockDefinitions  : [],
    templates:          anyEntries          ? d.templates         : [],
    entries:            anyEntries          ? (d.entries ?? []).filter((row) => entrySelected(row, f, known)) : [],
    dashboards:         anyEntries          ? d.dashboards        : [],
    // `usedCategoryRows` narrows them down to what the rest needs.
    categories:         anyEntries || f.includeTasks ? d.categories : [],
    tasks:              f.includeTasks      ? d.tasks             : [],
    taskLinks:          f.includeTasks      ? d.taskLinks         : [],
    tags:               f.includeTags       ? d.tags              : [],
    languages:          f.includeLexicon    ? d.languages         : [],
    lexiconEntries:     f.includeLexicon    ? d.lexiconEntries    : [],
  };
}

/**
 * Translates a backup's categories into this vault's: same ID
 * (the builtins) or same name (case-insensitive) → local row,
 * otherwise newly created. Returns the mapping backup ID → local ID, with
 * which the content arrays are re-pointed (`remapCategoryIds`), and the
 * start templates the newly created ones bring (`applyStartTemplates`,
 * once the templates are in).
 *
 * Categories are never deleted, not even on replace: a category
 * spans entries and tasks, and a partial replace must not pull the
 * categories out from under the rest.
 */
async function resolveImportedCategories(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: Row[],
): Promise<CategoryResolution> {
  const local = await db.select<Row[]>('SELECT id, name, deleted_at, sort_order FROM categories');
  const localById = new Map(local.map((r) => [String(r.id), r]));
  // If the same name exists both active and in the trash (a vault from before the
  // name rule), the active one applies: the later entries of the map win.
  const byLiveLast = [...local].sort((a, b) => Number(!a.deleted_at) - Number(!b.deleted_at));
  const localByKey = new Map(byLiveLast.map((r) => [categoryKey(String(r.name)), r]));
  let nextSort = local.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), -1) + 1;

  const map = new Map<string, string>();
  const startTemplates = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id);
    const template = typeof row.template_id === 'string' && isTemplateId(row.template_id) ? row.template_id : null;
    // A built-in category carries only its English seed in the column
    // ("Sigils"); it is displayed via its locale key. Matched by ID first,
    // otherwise by its name in the app language.
    const name = row.is_builtin
      ? i18n.t(`categories.builtin.${id}`, { defaultValue: String(row.name ?? '') })
      : String(row.name ?? '');
    const key = categoryKey(name);
    const match = (row.is_builtin ? localById.get(id) : undefined) ?? localByKey.get(key);
    if (match) {
      map.set(id, String(match.id));
      // A local category keeps its own start template; one without gets the file's.
      if (template) startTemplates.set(String(match.id), template);
      // An imported active category brings its local counterpart back from the trash.
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
    if (template) startTemplates.set(newId, template);
  }
  return { map, startTemplates };
}

interface CategoryResolution {
  /** Backup ID → local ID. */
  map: Map<string, string>;
  /** Local category ID → the start template the file gives it. */
  startTemplates: Map<string, string>;
}

/**
 * The start templates of the file, once its templates are in: a category
 * that has none yet gets the file's — if that template is here. A category
 * with a start template of its own keeps it.
 */
async function applyStartTemplates(db: Awaited<ReturnType<typeof getDb>>, startTemplates: Map<string, string>): Promise<void> {
  for (const [category, template] of startTemplates) {
    await db.execute(
      'UPDATE categories SET template_id=$1 WHERE id=$2 AND template_id IS NULL AND EXISTS (SELECT 1 FROM templates WHERE id=$1)',
      [template, category],
    );
  }
}

/**
 * Only the categories that some content of the (already filtered) payload
 * points to — entries, tasks, the dashboards' filters — and the ones whose
 * start template the file brings. The export sends
 * the whole table along; what nobody needs here — excluded categories,
 * unused ones — should not become a row in the vault.
 */
function usedCategoryRows(d: BackupFile['data']): Row[] {
  const used = new Set(
    [...(d.entries ?? []), ...(d.tasks ?? [])]
      .filter((r) => r.category_id != null)
      .map((r) => String(r.category_id))
  );
  for (const row of d.dashboards ?? []) parseDashboardFilter(row?.filter).categories?.forEach((id) => used.add(id));
  // And a category whose start template comes along — otherwise a fresh vault would lose it.
  const templates = new Set((d.templates ?? []).map((t) => String(t?.id)));
  for (const c of d.categories ?? []) if (c?.template_id != null && templates.has(String(c.template_id))) used.add(String(c.id));
  return (d.categories ?? []).filter((c) => used.has(String(c.id)));
}

/**
 * The file's dashboards, their category IDs translated to this vault's (an
 * ID that points nowhere here drops out). `replace`: a dashboard the vault
 * has (the built-ins, by ID) takes the file's state, one it lacks is added.
 * `merge`: a dashboard the vault has keeps its state and takes on the file's
 * categories besides; one it lacks is added.
 */
async function importDashboards(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: Row[] | undefined,
  catMap: Map<string, string>,
  mode: 'replace' | 'merge',
): Promise<void> {
  if (!rows?.length) return;
  const categories = new Set((await db.select<{ id: string }[]>('SELECT id FROM categories')).map((r) => r.id));
  const local = new Map((await db.select<Row[]>('SELECT * FROM dashboards')).map((r) => [String(r.id), fromRow.dashboard(r)]));
  const now = nowIso();
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null || typeof raw.id !== 'string' || !/^[\w-]{1,100}$/.test(raw.id)) continue;
    // A built-in's id belongs to that built-in: a row that takes it without being it is left out.
    if (isBuiltinDashboard(raw.id) && raw.builtin !== raw.id) continue;
    const row = fromRow.dashboard(raw);
    const mapped = row.filter.categories?.map((id) => catMap.get(id) ?? id).filter((id) => categories.has(id));
    // "All entries" has no filter, so that no entry can become unfindable.
    const filter = row.builtin === 'all' ? {} : { ...row.filter, ...(mapped && { categories: [...new Set(mapped)] }) };
    const mine = local.get(row.id);
    if (mine && mode === 'merge') {
      if (!mine.filter.categories || !filter.categories) continue;
      const merged = [...new Set([...mine.filter.categories, ...filter.categories])];
      if (merged.length === mine.filter.categories.length) continue;
      await db.execute('UPDATE dashboards SET filter=$1, updated_at=$2 WHERE id=$3', [JSON.stringify({ ...mine.filter, categories: merged }), now, row.id]);
      continue;
    }
    await db.execute(
      `INSERT OR REPLACE INTO dashboards (id, builtin, name, icon, position, filter, sort, display, created_at, updated_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.id, row.builtin, row.name, row.icon, row.position, JSON.stringify(filter), JSON.stringify(row.sort),
        JSON.stringify(row.display), row.created_at || now, row.updated_at || now, row.deleted_at],
    );
  }
}

function remapCategoryIds(rows: Row[], map: Map<string, string>): Row[] {
  return rows.map((r) => ({
    ...r,
    category_id: map.get(String(r.category_id)) ?? r.category_id,
  }));
}

/**
 * Checks whether every category reference of the payload is resolvable — either from
 * the backup itself or from the target vault's existing data.
 *
 * Runs **before** the first DELETE. Without this pre-check, a backup
 * with an unresolvable category would only fail at INSERT on the foreign key —
 * the vault would stay untouched thanks to the working copy (`importStaging.ts`),
 * but the message would not say which category is missing.
 */
export async function assertPayloadReferencesResolve(
  db: Awaited<ReturnType<typeof getDb>>,
  d: BackupFile['data'],
): Promise<void> {
  // Categories survive every import (see resolveImportedCategories) — the
  // vault's existing data therefore counts as a target in both modes.
  const known = new Set((d.categories ?? []).map((c) => String(c.id)));
  for (const row of await db.select<Row[]>('SELECT id FROM categories')) {
    known.add(String(row.id));
  }

  const checks = [
    ['entries', 'entries'],
    ['tasks', 'tasks'],
  ] as const;

  for (const [rowsKey, label] of checks) {
    const missing = new Set<string>();
    for (const row of d[rowsKey] ?? []) {
      // "Uncategorized" is a valid state — and the one every new entry
      // starts with. An empty *string* remains a miss.
      if (row.category_id == null) continue;
      const id = String(row.category_id);
      if (!known.has(id)) missing.add(id || '(empty)');
    }
    if (missing.size) {
      throw new Error(
        `The backup's ${label} point to categories that exist neither in the ` +
          `file nor in this vault: ${[...missing].join(', ')}. ` +
          'The import was aborted before anything changed.'
      );
    }
  }
}

export async function doReplace(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile): Promise<void> {
  const pathMap = await restoreImages(backup);
  // Tags are not replaced but merged: entries that this file does
  // not replace carry the IDs of the existing ones.
  const d = await importTagsAndRemap(db, backup.data);

  await assertPayloadReferencesResolve(db, d);

  // Categories first: the contents get the local IDs before they are
  // inserted. Categories are never deleted (see there).
  const { map: catMap, startTemplates } = await resolveImportedCategories(db, usedCategoryRows(d));

  const entries = entryRowsForInsert(remapCategoryIds((d.entries ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ENTRY, pathMap)), catMap));
  const tasks = remapCategoryIds(d.tasks ?? [], catMap);

  // Custom blocks like categories: never deleted, missing ones added by ID,
  // existing ones stay. `db` here is the working copy (`importViaStaging`):
  // if anything fails before the end, the vault stays as it was.
  await insertBlockDefinitions(db, remapDefinitionRows(d.blockDefinitions, pathMap));
  const templateIds = await insertTemplates(db, d.templates);
  await applyStartTemplates(db, startTemplates);
  await importDashboards(db, d.dashboards, catMap, 'replace');
  // Like the custom blocks and the templates: never deleted, missing ones added.
  await insertLexicon(db, d.languages, d.lexiconEntries);
  await insertVaultImages(db, d.vaultImages, pathMap);
  await insertSymbols(db, d.symbols);

  const hasTasks = (d.tasks?.length ?? 0) > 0;
  if (hasTasks) {
    await db.execute('DELETE FROM task_links');
    await db.execute('DELETE FROM tasks');
  }
  // Replace only the categories the backup brings entries of (so a partial
  // backup holding only the journal does not wipe the rest) — and the
  // uncategorized entries only if it brings some of those.
  const presentCategories = [...new Set(entries.filter((r) => r.category_id != null).map((r) => String(r.category_id)))];
  for (let i = 0; i < presentCategories.length; i += IN_CHUNK) {
    const chunk = presentCategories.slice(i, i + IN_CHUNK);
    await db.execute(`DELETE FROM entries WHERE category_id IN (${chunk.map((_, n) => `$${n + 1}`).join(',')})`, chunk);
  }
  if (entries.some((r) => r.category_id == null)) await db.execute('DELETE FROM entries WHERE category_id IS NULL');
  // Plus every imported ID, whatever category it has in the vault by now: an
  // entry that has changed its category since the backup would otherwise
  // appear twice — and `entries.id` is unique.
  for (let i = 0; i < entries.length; i += IN_CHUNK) {
    const chunk = entries.slice(i, i + IN_CHUNK).map((r) => String(r.id));
    await db.execute(`DELETE FROM entries WHERE id IN (${chunk.map((_, n) => `$${n + 1}`).join(',')})`, chunk);
  }
  // A number an entry that stays still holds goes to the file's entry afresh (`numberUnnumbered`).
  const heldNumbers = new Set((await db.select<{ n: number }[]>('SELECT entry_number AS n FROM entries WHERE entry_number IS NOT NULL')).map((r) => r.n));
  for (const row of entries) if (row.entry_number != null && heldNumbers.has(Number(row.entry_number))) row.entry_number = null;
  // Re-insert
  await insertRows(db, 'entries', entries);
  await numberUnnumbered(db);
  const same = (ids: string[]) => new Map(ids.map((id) => [id, id]));
  await insertImportedBlocks(db, d.blocks, 'entry', same(entries.map((r) => String(r.id))), { images: pathMap });
  await insertImportedBlocks(db, d.blocks, 'template', same(templateIds), { images: pathMap });
  await insertTasks(db, tasks);
  if (d.taskLinks) await insertRows(db, 'task_links', d.taskLinks);

  // A partial replace (e.g. only tasks) can orphan existing links that point to
  // just-replaced targets — and imported task_links
  // can point to deselected types. Same sweep as for the trash.
  await sweepDanglingTaskLinks(db);
  await dropUnknownTagIds(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge import (ID-prefix strategy)
// ─────────────────────────────────────────────────────────────────────────────

export async function doMerge(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = await importTagsAndRemap(db, backup.data);

  // Merge deletes nothing, but aborts midway through inserting if a
  // category is missing — check beforehand so the message says which.
  await assertPayloadReferencesResolve(db, d);
  const { map: catMap, startTemplates } = await resolveImportedCategories(db, usedCategoryRows(d));

  // Prefix = base36 encoding of current timestamp (8 chars, unique per merge)
  const prefix = Date.now().toString(36).slice(-8);
  const pid = (id: string) => `${prefix}-${id}`;

  // Build id maps for every entity type
  const allOldIds = new Set<string>([
    ...(d.entries ?? []).map((r: Row) => r.id as string),
    ...(d.tasks ?? []).map((r: Row) => r.id as string),
  ]);

  /** The ID here of an entry or task of the file; `undefined` for any other ID. */
  const nextId = (id: string): string | undefined => (allOldIds.has(id) ? pid(id) : undefined);
  function remapId(id: unknown): unknown {
    return typeof id === 'string' ? nextId(id) ?? id : id;
  }

  /**
   * `entry_number` is stored with the entry and unique over all of them. On
   * merge the numbers are therefore shifted behind the existing ones —
   * otherwise two entries would show the same `#n`.
   */
  const [{ n: offset }] = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(entry_number), 0) AS n FROM entries');

  function remapEntry(row: Row, imagePaths: string[], idFields: string[], numbered = false): Row {
    const out = remapRow(row, imagePaths, pathMap);
    out.id = pid(out.id as string);
    if (numbered && out.entry_number != null) {
      out.entry_number = Number(out.entry_number) + offset;
    }
    for (const f of idFields) {
      if (out[f] != null) out[f] = remapId(out[f]);
    }
    return out;
  }

  const entries = entryRowsForInsert(remapCategoryIds((d.entries ?? []).map((r: Row) =>
    remapEntry(r, IMAGE_FIELDS_ENTRY, [], true)
  ), catMap));
  const tasks = remapCategoryIds((d.tasks ?? []).map((r: Row) =>
    remapEntry(r, [], ['parent_task_id'])
  ), catMap);
  const taskLinks = (d.taskLinks ?? []).map((r: Row) => ({
    ...r,
    id: pid(r.id as string),
    task_id: remapId(r.task_id),
    target_id: remapId(r.target_id),
  }));

  // Categories and tags are already resolved (resolveImportedCategories,
  // importTagsAndRemap above).
  // Without prefix, so that a block arriving twice stays one.
  // Link defaults point to the renamed entries, like the chips in the content.
  await insertBlockDefinitions(
    db, remapDefinitionRows(d.blockDefinitions, pathMap, (t) => ({ id: String(remapId(t.id)), label: t.label })),
  );
  // Without prefix, like the definitions.
  const templateIds = await insertTemplates(db, d.templates);
  await applyStartTemplates(db, startTemplates);
  await importDashboards(db, d.dashboards, catMap, 'merge');
  // Without prefix like the two above: a language stands on its own, its ID
  // appears in no entry.
  await insertLexicon(db, d.languages, d.lexiconEntries);
  // By file, like the replace: a picture that is already here stays as it is.
  await insertVaultImages(db, d.vaultImages, pathMap);
  // The same for own symbols: an element on an altar keeps its own copy of the path.
  await insertSymbols(db, d.symbols);

  // Content: plain INSERT with prefixed IDs (no conflicts possible)
  await insertRows(db, 'entries', entries);
  await numberUnnumbered(db);
  // The blocks under the prefixed owners, their pictures and links pointed here like the rows'.
  const inserted = new Set(entries.map((r) => String(r.id)));
  const owners = new Map([...allOldIds].filter((id) => inserted.has(pid(id))).map((id) => [id, pid(id)]));
  await insertImportedBlocks(db, d.blocks, 'entry', owners, { images: pathMap, id: nextId });
  await insertImportedBlocks(db, d.blocks, 'template', new Map(templateIds.map((id) => [id, id])), { images: pathMap, id: nextId });
  await insertTasks(db, tasks);
  await insertRows(db, 'task_links', taskLinks, true);

  // Imported task_links can point to targets that the type filter
  // has just deselected — sweep them out as in doReplace.
  await sweepDanglingTaskLinks(db);
  await dropUnknownTagIds(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public import entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The content kinds of the backup and their labels. A record instead of a list,
 * as with the settings groups in the settings window: a new kind without a
 * label is a type error, not a forgotten entry.
 *
 * One truth for four places that previously each kept the same list:
 * the two packing lists in the settings window (export and import), the
 * initial and reset value of the import filter, and `ALL_TYPES_INCLUDED`
 * below. A kind that was forgotten there was silently excluded from every
 * "import everything".
 */
const CONTENT_TYPE_LABELS: Record<ContentToggle, string> = {
  includeTasks: 'settings.includeTasks',
  includeTags: 'settings.includeTags',
  includeLexicon: 'settings.includeLexicon',
};

/** The content kinds besides the entries, which are chosen by category (`EntrySelection`). */
export type ContentToggle = Exclude<keyof ImportTypeFilters, keyof EntrySelection>;

/** The same kinds as a list — the order of the packing lists. */
export const CONTENT_TYPES: readonly [ContentToggle, string][] =
  (Object.keys(CONTENT_TYPE_LABELS) as ContentToggle[]).map((key) => [key, CONTENT_TYPE_LABELS[key]]);

/** Everything included — the default of the import filter and its reset value. */
export function allTypesIncluded(): ImportTypeFilters {
  const filters = { ...ALL_ENTRIES } as ImportTypeFilters;
  for (const [key] of CONTENT_TYPES) filters[key] = true;
  return filters;
}

const ALL_TYPES_INCLUDED: ImportTypeFilters = allTypesIncluded();

export async function importDatabase(
  backup: BackupFile,
  mode: ImportMode,
  /** Only for `add-vault`: name and — if the user chose one —
   *  target folder of the new vault. Without `path` the fallback from
   *  `newVaultRecord` applies (`{appDataDir}/vaults/{id}`). */
  newVault?: { name: string; path?: string },
  typeFilters?: ImportTypeFilters,
  /** Only for `merge`: which settings groups from the file should apply.
   *  replace and add-vault take over the file's settings entirely. */
  settingsGroups: readonly SettingsGroup[] = [],
): Promise<void> {
  // Unchecked from the file — from here on only in checked form.
  const backupSettings = importableSettings(backup.settings);
  // A backup from before language and theme moved to the device may hold
  // custom themes; they join this device's list (`adoptCustomThemes` checks
  // them), while its language and selection do not apply here.
  const backupThemes = isPlainObject(backup.settings) && isPlainObject(backup.settings.appearance)
    ? backup.settings.appearance.customThemes
    : undefined;

  // For the duration of the import the automatic editor saves are suspended,
  // in all three modes. replace keeps the original IDs and add-vault switches
  // the vault: an open editor that navigation unmounts in the process would
  // save its PRE-import state over the freshly imported rows.
  // And every mode swaps in the working copy at the end (`importStaging.ts`) —
  // whatever is saved in the vault between copy and swap would be lost.
  suspendEditorSaves();
  try {

  // The suspension only stops future saves — let store writes that are already
  // queued finish before the working copy is taken.
  await drainSerialized();

  const filteredBackup: BackupFile = {
    ...backup,
    data: applyTypeFilters(backup.data, typeFilters ?? ALL_TYPES_INCLUDED),
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

    // Before switching into the folder: then the new vault opens right away with
    // the backup's fonts, instead of the defaults first.
    if (backupSettings) {
      // Just a nicety: if writing fails, the vault starts with the
      // defaults — the import itself should not get stuck on that.
      await writeVaultSettings(vaultId, backupSettings).catch((err) => {
        console.warn('[backup] could not write vault settings', err);
      });
    }

    // 3. Switch to it (resets the DB cache and creates the schema in the new empty DB)
    await useVaultStore.getState().loadVaults();
    // `editsResolved`: the question about ongoing edits was asked
    // before the import began (`BackupPage`). If it came up here again and
    // the answer were "keep editing", the old vault would stay active —
    // and step 4 would fill it instead of the new one.
    // If the user cancels at the new vault's password, the import is
    // cancelled — and the just-created empty vault is removed again.
    const switched = await useVaultStore.getState().switchVault(vaultId, { editsResolved: true }).catch(async (err: unknown) => {
      if (keyErrorOf(err) === VAULT_KEY_CANCELLED) {
        await useVaultStore.getState().removeVault(vaultId).catch((e: unknown) => console.warn('[backup] could not remove the new vault', e));
      }
      throw err;
    });
    if (!switched || useVaultStore.getState().activeVaultId !== vaultId) {
      throw new Error('could not switch to the new vault');
    }

    // 4. Fill the new (empty) vault with the backup data
    const db = await getDb();
    // The fresh vault has just created the built-in templates itself. If
    // the file carries its templates along, its version applies — including
    // that a template was changed or deleted there. Otherwise the fresh
    // row would displace the brought-along one, and the categories would keep starting with it.
    const types = typeFilters ?? ALL_TYPES_INCLUDED;
    const bringsTemplates = Array.isArray(backup.data.templates);
    // Via the working copy as with replace: an abort leaves the new vault empty rather than half filled.
    await importViaStaging(db, async (staging) => {
      if (bringsTemplates && selectsEntries(types)) {
        await staging.execute('DELETE FROM templates WHERE id IN ($1, $2)', [SIGIL_TEMPLATE_ID, ALTAR_TEMPLATE_ID]);
      }
      await doReplace(staging, filteredBackup);
    });
    // Only once the import went through, as with replace and merge below.
    if (backupThemes) useDeviceStore.getState().adoptCustomThemes(backupThemes);
  } else {
    // Never directly against the vault: `doReplace` deletes before it inserts, and
    // an aborted merge would leave half-imported data behind (see `importStaging.ts`).
    const run = mode === 'replace' ? doReplace : doMerge;
    await importViaStaging(await getDb(), (staging) => run(staging, filteredBackup));

    // Only after a successful swap: an aborted import leaves the
    // settings as they were, too.
    if (backupThemes && (mode === 'replace' || settingsGroups.includes('appearance'))) {
      useDeviceStore.getState().adoptCustomThemes(backupThemes);
    }
    if (backupSettings) {
      const settingsStore = useSettingsStore.getState();
      if (mode === 'replace') {
        await settingsStore.replaceSettings(backupSettings);
      } else if (settingsGroups.length) {
        await settingsStore.replaceSettings(withSettingsGroups(settingsStore.settings, backupSettings, settingsGroups));
      }
    }
  }

  // Reload all store data from the (now modified) active vault
  console.log(`[backup] import complete (${mode}) into ${await getActiveDbFile()}`);

  // replace swaps the rows out from under the open tabs — their entry IDs
  // come from the state before the import. merge keeps existing rows, so
  // the tabs stay valid; add-vault goes through switchVault and cleans up there.
  if (mode === 'replace') {
    useUIStore.getState().closeAllTabs();
    clearAllDrafts();
    // Straight from the file, not only after the delay: an old draft
    // that survives a crash would overwrite the imported data at the next "Done".
    await flushDrafts();
  }

  // The global search remembers an entry's plain text under (id,
  // updated_at). Both halves appear like this in the backup file: a file
  // that reuses a pair and only changes the content would otherwise inherit the
  // old text — the new one would be unfindable until restart.
  clearSearchTextCache();
  clearEntrySummaryCache();

  await reloadAllStores();
  } finally {
    resumeEditorSaves();
  }
}

// Re-export BackupFile type for use in UI
export type { BackupFile };
