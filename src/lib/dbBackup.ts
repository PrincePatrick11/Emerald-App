/**
 * A vault's content as a `.vault.emerald` — export and import.
 *
 * Export: queries the active vault and puts the selected tables into the
 * manifest of a `.emerald` file of the kind `vault`; its pictures and icons
 * travel as members of the archive, read from the vault by Rust
 * (`lib/emerald/file.ts`, `emerald_file.rs`).
 *
 * Import modes:
 *   replace  — wipe the current vault and restore from the file
 *   merge    — insert all rows with a date-based ID prefix (no overwrites)
 *   add-vault — create a new vault from the file and switch to it
 *
 * A raw backup (the automatic backup's `.vault.emerald`, `raw_backup.rs`)
 * imports the same way: its database is unpacked beside the active vault,
 * opened under the backup's own key, brought to this version's schema and
 * read like a vault (`collectVaultContent`) — from there on it is the same
 * content as any `.vault.emerald`.
 */

import { copyBlockStatements, OWNER, type BlockOwnerKind, type CopiedBlock, type Statement } from './blockStore';
import { blockRefs } from './blocks/blockRefs';
import { fromBlockRow, type StoredBlockRow } from './blocks/blockRows';
import { remapBlock, renameAll, type BlockRemap } from './blocks/blockRemap';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { getDb, runMigrations, sweepDanglingTaskLinks, VAULT_OUTDATED, VAULT_TOO_NEW, vaultVersionErrorOf } from './db';
import Database from './sqlite';
import {
  addVault,
  exportDefaultPath,
  getActiveDbFile,
  getActiveVaultId,
  invalidateVaultCache,
  newVaultRecord,
  discardNewVaultDirs,
} from './vaultManager';
import { imageRefsInHtml, isStoredImage } from './images';
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
import { ICON_FIELDS, IMAGE_FIELDS, STARTER_CATEGORY_IDS, imageColumns, storedImageName, storedImageNamesIn } from './schema';
import { iconFileNames, plausibleEmoji } from './icons';
import { isTagId, readTagLinks, tagIdList, tagInsertStatements, tagNameKey, unlinkTags, type TagOwner } from './tagRefs';
import { randomTagColor } from '../store/tagStore';
import { categoryKey } from './categories';
import i18n from '../i18n';
import { endOfDay, isValid, parseISO, startOfDay } from 'date-fns';
import { asString, generateId, isRecord, isValidHexColor, nowIso } from './helpers';
import { useVaultStore } from '../store/vaultStore';
import { VAULT_KEY_CANCELLED } from '../store/vaultKeyStore';
import { keyErrorOf } from './vaultKeys';
import {
  EmeraldNotice, noticeFor, storeArchiveFiles, withEmeraldEnding, writeArchive,
  type EmeraldProtection, type OpenedArchive, type StoredArchiveFiles,
} from './emerald/file';
import { EMERALD_FORMAT_VERSION, parseVaultManifest, type EmeraldVaultManifest, type ManifestBlockDefinition } from './emerald/manifest';
import { reloadAllStores } from '../store/moduleWiring';
import { useUIStore } from '../store/uiStore';
import { clearAllDrafts, flushDrafts } from '../store/draftStore';
import { resumeEditorSaves, suspendEditorSaves } from './editorLock';
import { drainSerialized } from './serialize';
import { importViaStaging } from './importStaging';
import { importableSettings, withSettingsGroups, withoutDeviceKeys, writeVaultSettings, type SettingsGroup } from './vaultSettings';
import { useSettingsStore } from '../store/settingsStore';
import { useDeviceStore } from '../store/deviceStore';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which entries come along, by category — the packing list. `categoryIds` null: every category; otherwise only
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
 * The content of a `.vault.emerald` (the manifest of the kind `vault`, format
 * version `EMERALD_FORMAT_VERSION`): all entries in one `data.entries` array;
 * categories with their start template (`template_id`); the dashboards as
 * `data.dashboards`; the blocks of entries and templates as the rows of
 * `blocks` (`data.blocks`); the pictures taken into "Images" as
 * `data.vaultImages`. The rows of entries, templates and pictures carry their
 * tags as an array of IDs in `tags` (the vault keeps them in link tables);
 * pictures and icons are stored names, their files members of the archive.
 *
 * Only this version is read (`parseVaultManifest`, and Rust before it): a
 * newer one is refused, since `insertRows` filters every row against
 * `PRAGMA table_info` and a file this build does not fully understand would
 * be imported *wrongly* rather than fail. Raise `EMERALD_FORMAT_VERSION`
 * whenever an older build would otherwise import a file wrongly.
 */
export interface VaultContent {
  exportedAt: string;
  filters: BackupOptions;
  data: VaultData;
  /**
   * The vault's settings (`settings.json`), unchecked like everything from
   * the file — normalised only at import.
   */
  settings?: unknown;
}

/**
 * The content of a vault's manifest, the `category_id` of an entry whose
 * category the file does not carry cleared. Throws {@link EmeraldNotice} for
 * a manifest of another version or none at all.
 */
export function vaultContentOf(manifest: string): VaultContent {
  const parsed = parseVaultManifest(manifest);
  if (typeof parsed === 'string') throw new EmeraldNotice(i18n.t(`emeraldImport.${parsed}`));
  const data = parsed.data as VaultData;
  if (!Array.isArray(data.entries)) data.entries = [];
  // An entry is in a category only if the file carries that category. Without
  // this, a crafted file could count an entry as "uncategorized" in the
  // dialog and still name a category of this vault — whose entries a replace
  // would then delete without being asked.
  const known = new Set((Array.isArray(data.categories) ? data.categories : []).map((c) => String(c?.id)));
  data.entries = data.entries.map((row) => (
    row?.category_id != null && !known.has(String(row.category_id)) ? { ...row, category_id: null } : row
  ));
  return { exportedAt: parsed.exportedAt, filters: parsed.filters as BackupOptions, data, settings: parsed.settings };
}

/** The manifest of a vault's content, as the file carries it. */
export function vaultManifestOf(content: VaultContent): EmeraldVaultManifest {
  return { format: 'emerald', version: EMERALD_FORMAT_VERSION, kind: 'vault', ...content, data: { ...content.data } };
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
async function importTagsAndRemap(db: Awaited<ReturnType<typeof getDb>>, d: VaultData): Promise<VaultData> {
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
        await unlinkTags(db, [hit.id]);
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
  const localIds = (ids: string[]) => [...new Set(ids.flatMap((id) => idMap.get(id) ?? (byId.has(id) ? [id] : [])))];
  const remap = (rows: Row[] | undefined) => rows?.map((row) => ({ ...row, tags: localIds(tagIdList(row.tags)) }));
  // The dashboards' tag filters name the same tags.
  const dashboards = d.dashboards?.map((row) => {
    if (typeof row !== 'object' || row === null) return row;
    const filter = parseDashboardFilter(row.filter);
    return filter.tags ? { ...row, filter: { ...filter, tags: localIds(filter.tags) } } : row;
  });
  return {
    ...d,
    tags: [],
    entries: remap(d.entries),
    templates: remap(d.templates),
    vaultImages: remap(d.vaultImages),
    dashboards,
  };
}

/**
 * Writes the tag links of imported rows — `tags` as `importTagsAndRemap` left
 * it, under the owner's ID in this vault (`idOf`). Only for owners the import
 * actually inserted: an existing one keeps its own tags.
 */
async function insertTagLinks(
  db: Awaited<ReturnType<typeof getDb>>,
  owner: TagOwner,
  rows: readonly Row[] | undefined,
  idOf: (id: string) => string | undefined,
): Promise<void> {
  let batch: [string, unknown[]][] = [];
  for (const row of rows ?? []) {
    if (typeof row !== 'object' || row === null || typeof row.id !== 'string') continue;
    const id = idOf(row.id);
    const tags = tagIdList(row.tags);
    if (!id || !tags.length) continue;
    batch.push(...tagInsertStatements(owner, id, tags));
    if (batch.length >= INSERT_CHUNK) {
      await db.batch(batch);
      batch = [];
    }
  }
  if (batch.length) await db.batch(batch);
}

/** Puts the tags of the owners into their rows, as an array of IDs — what the file carries. */
async function withTagLists(db: Awaited<ReturnType<typeof getDb>>, owner: TagOwner, rows: Row[]): Promise<Row[]> {
  const tags = await readTagLinks(db, owner, rows.map((r) => String(r.id)));
  for (const row of rows) row.tags = tags.get(String(row.id)) ?? [];
  return rows;
}

/**
 * The columns of `entries`. Every row gets all of them: `insertRows` takes
 * the column list from the first row, and a row without an icon at the front
 * would otherwise strip the icons from the rows behind it.
 */
const ENTRY_COLUMNS = [
  'id', 'title', 'category_id', 'entry_number', 'icon', 'cover_image',
  'created_at', 'updated_at', 'deleted_at',
] as const;

/** The image columns of an entry row at import. */
const IMAGE_FIELDS_ENTRY = imageColumns('entries');

function asEntryRow(row: Row): Row {
  const out: Row = {};
  for (const column of ENTRY_COLUMNS) out[column] = row[column] ?? null;
  out.title ??= '';
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
function entryRowsForInsert(rows: Row[]): Row[] {
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
function entrySelected(row: Row, selection: EntrySelection, known: ReadonlySet<string>): boolean {
  const category = row.category_id == null ? null : String(row.category_id);
  if (category === null || !known.has(category)) return selection.includeUncategorized;
  return selection.categoryIds === null || selection.categoryIds.includes(category);
}

/** Selects every category, with the uncategorized entries. */
const ALL_ENTRIES: EntrySelection = { categoryIds: null, includeUncategorized: true };

/** Does the selection take any entry at all? */
function selectsEntries(selection: EntrySelection): boolean {
  return selection.includeUncategorized || selection.categoryIds === null || selection.categoryIds.length > 0;
}

interface VaultData {
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
    for (const column of fields.plain) {
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
  // Whole local days, as the export menu's collection counts them
  // (`createdWithin`); a range given backwards is read the right way round.
  const day = (s: string) => (s && isValid(parseISO(s)) ? parseISO(s) : null);
  let [from, to] = [day(dateFrom), day(dateTo)];
  if (from && to && from > to) [from, to] = [to, from];
  if (from) {
    parts.push('created_at >= $1');
    params.push(startOfDay(from).toISOString());
  }
  if (to) {
    parts.push(`created_at <= $${params.length + 1}`);
    params.push(endOfDay(to).toISOString());
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
 * backup could execute arbitrary SQL — a second-order
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

/**
 * Where the icon columns of `ICON_FIELDS` travel in a backup's `data`. A
 * table missing here would lose its icons on the way.
 */
const ICON_DATA_KEYS: Record<string, keyof VaultData> = {
  entries: 'entries',
  templates: 'templates',
  block_definitions: 'blockDefinitions',
  languages: 'languages',
  dashboards: 'dashboards',
};

/**
 * The icon files the rows of a vault's content name: the icon columns
 * (`ICON_FIELDS`) and every stored name in the block rows' `config` (a
 * custom block's copy carries its icon there). A name that is no file in
 * `icons/` — a picture of a block — is skipped.
 */
async function iconNamesOf(data: VaultData): Promise<string[]> {
  const names = new Set<string>();
  for (const { table, column } of ICON_FIELDS) {
    const rows = data[ICON_DATA_KEYS[table]] as Row[] | undefined;
    for (const row of rows ?? []) {
      const name = storedImageName(typeof row[column] === 'string' ? row[column] : null);
      if (name) names.add(name);
    }
  }
  for (const row of data.blocks ?? []) {
    if (typeof row.config === 'string') storedImageNamesIn(row.config).forEach((name) => names.add(name));
  }
  const stored = await iconFileNames();
  return [...names].filter((name) => stored.has(name));
}

/**
 * Points every icon column of the file's rows at the name its icon was
 * stored under here (`iconMap`, from the archive); a value that is neither an
 * emoji nor an icon the file brings (a data URL, a name without its file) is
 * dropped, so that the row falls back to its default icon.
 */
function remapIconColumns(data: VaultData, iconMap: ReadonlyMap<string, string>): VaultData {
  const out: VaultData = { ...data };
  for (const { table, column } of ICON_FIELDS) {
    const key = ICON_DATA_KEYS[table];
    const rows = data[key] as unknown;
    if (!Array.isArray(rows)) continue;
    (out as Record<string, unknown>)[key] = rows.map((row: unknown) => {
      if (typeof row !== 'object' || row === null) return row;
      const value = (row as Row)[column];
      if (typeof value !== 'string' || !value) return row;
      const name = storedImageName(value);
      const next = name ? iconMap.get(name) ?? '' : plausibleEmoji(value);
      return next === value ? row : { ...row, [column]: next || null };
    });
  }
  return out;
}

/**
 * A vault's content according to `options`, with the stored names of the
 * pictures and icons it names — their files go into the archive beside it.
 * For `raw`, a raw backup's database: its settings come along instead of the
 * active vault's, and no icons are looked up here. Writes nothing; the
 * schema harness calls it directly.
 */
export async function collectVaultContent(
  db: Awaited<ReturnType<typeof getDb>>,
  options: BackupOptions,
  raw?: { settings: unknown },
): Promise<{ content: VaultContent; images: string[]; icons: string[] }> {
  const data: VaultData = {};
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
    data.entries = await withTagLists(db, 'entry', rows.filter((row) => entrySelected(row, options, live)));
    collectImageRefs('entries', data.entries, allImagePaths);
    data.blocks = await exportBlockRows(db, 'entry', data.entries, allImagePaths);
    // Trashed ones only with the trash, like the entries.
    data.dashboards = await db.select<Row[]>(`SELECT * FROM dashboards WHERE 1=1 ${deletedClause}`);
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
  data.vaultImages = await withTagLists(db, 'image', await db.select<Row[]>(`SELECT * FROM images`));
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
    data.templates = await withTagLists(db, 'template', await db.select<Row[]>(`SELECT * FROM templates`));
    data.blocks = [...(data.blocks ?? []), ...await exportBlockRows(db, 'template', data.templates, allImagePaths)];
  }

  // ── Lexicon ──────────────────────────────────────────────────────────────
  // Languages and vocabulary travel together and in full, trash included: it is
  // one list, no date question — like the custom blocks and the templates.
  if (options.includeLexicon) {
    data.languages = await db.select<Row[]>(`SELECT * FROM languages`);
    data.lexiconEntries = await db.select<Row[]>(`SELECT * FROM lexicon_entries`);
  }

  // ── Own symbols ──────────────────────────────────────────────────────────
  // Always and in full, like the lexicon: a short list, path data in the row.
  data.symbols = await db.select<Row[]>('SELECT * FROM symbols');

  const content: VaultContent = {
    exportedAt: new Date().toISOString(),
    filters: options,
    data,
    // Without what a `settings.json` from before still carries of language and
    // theme: those belong to the device, and a backup must not bring them back.
    ...(options.includeSettings && {
      settings: raw ? raw.settings : withoutDeviceKeys(useSettingsStore.getState().settings),
    }),
  };
  // A raw backup's pictures come from its own archive, not from this vault's folders.
  return { content, images: [...allImagePaths], icons: raw ? [] : await iconNamesOf(data) };
}

/** The name a vault file gets in the save dialog. */
export function vaultFileName(date = new Date()): string {
  return `emerald-backup-${date.toISOString().slice(0, 10)}.vault.emerald`;
}

/**
 * Writes the vault's content as a `.vault.emerald` at `path`, without a
 * dialog: the manifest of the kind `vault`, the pictures and icons as members
 * of the archive (read from the vault by Rust, never through here).
 */
export async function writeVaultFile(path: string, options: BackupOptions, protection: EmeraldProtection): Promise<void> {
  const { content, images, icons } = await collectVaultContent(await getDb(), options);
  await writeArchive(path, 'vault', JSON.stringify(vaultManifestOf(content)), images.map((name) => ({ name })), icons, protection);
}

/** Resolves to `false` when the save dialog was cancelled — nothing was
 *  written, and the UI must not report success then. */
export async function exportDatabase(
  options: BackupOptions,
  protection: EmeraldProtection = { type: 'vaultKey' },
): Promise<boolean> {
  // The dialog opens in the active vault's `export/` folder, like every export.
  const savePath = await save({
    defaultPath: await exportDefaultPath(vaultFileName()),
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
  });
  if (!savePath) return false;

  // By default under the vault's key, with its `vault.key` in the header
  // (`emerald_file.rs`) — opens with the password that applies now.
  await writeVaultFile(withEmeraldEnding(savePath, '.vault.emerald'), options, protection);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Open + preview
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An opened `.vault.emerald`: its content and what the import offers from it.
 * Its pictures wait in the file under `ticket` until the import stores them;
 * whoever drops it closes it (`closeImportSource`).
 */
export interface OpenedVaultFile {
  ticket: string;
  content: VaultContent;
  preview: BackupPreview;
}

/**
 * A file opened by the import window as a vault's content — still
 * open. A raw backup's content is read from its database first.
 */
export async function openedVaultFile(opened: OpenedArchive): Promise<OpenedVaultFile> {
  const content = opened.kind === 'raw' ? await rawBackupContent(opened) : vaultContentOf(opened.manifest);
  return { ticket: opened.ticket, content, preview: previewOf(content) };
}

/** When a raw backup was written, from its manifest — `null` if it does not say. */
function rawBackupDate(manifest: string): string | null {
  try {
    const parsed: unknown = JSON.parse(manifest);
    const created = isRecord(parsed) ? parsed.createdAt : null;
    return typeof created === 'string' && !Number.isNaN(Date.parse(created)) ? created : null;
  } catch {
    return null;
  }
}

/**
 * Brings a raw backup's database to this version's schema, as opening a vault
 * does (`runMigrations`). One without any schema is no vault's, one from
 * before the fresh start or from a newer app is refused — before anything is
 * written. The copy is the backup's, not the vault's: what the migrations
 * change there is thrown away with it.
 */
export async function prepareRawDatabase(db: Database): Promise<void> {
  const stamped = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
  );
  if (!stamped[0]?.n) throw new EmeraldNotice(i18n.t('emeraldImport.unsupported'));
  try {
    await runMigrations(db);
  } catch (err) {
    const version = vaultVersionErrorOf(err);
    if (version === VAULT_TOO_NEW) throw new EmeraldNotice(i18n.t('emeraldImport.newVersion'));
    if (version === VAULT_OUTDATED) throw new EmeraldNotice(i18n.t('emeraldImport.oldVersion'));
    throw err;
  }
}

/**
 * The content of a raw backup: its database unpacked beside the active vault
 * and opened under the backup's own key (`open_raw_backup_db`), read whole
 * like a vault, then closed and removed again. Its pictures stay in the file
 * until the import stores them.
 */
async function rawBackupContent(opened: OpenedArchive): Promise<VaultContent> {
  const vaultId = await getActiveVaultId();
  let handle: string;
  try {
    handle = await invoke<string>('open_raw_backup_db', { ticket: opened.ticket, vaultId });
  } catch (err) {
    const notice = noticeFor(err);
    throw notice ? new EmeraldNotice(notice) : err;
  }
  try {
    const db = Database.fromHandle(handle);
    await prepareRawDatabase(db);
    let settings: unknown;
    try {
      settings = opened.settings === undefined ? undefined : JSON.parse(opened.settings);
    } catch {
      // Unreadable settings: the backup is still one, without them.
    }
    const { content } = await collectVaultContent(db, FULL_BACKUP_OPTIONS, { settings });
    // The day of the backup, not of this reading.
    return { ...content, exportedAt: rawBackupDate(opened.manifest) ?? content.exportedAt };
  } finally {
    await invoke('discard_raw_backup_db', { vaultId })
      .catch((err: unknown) => console.warn('[backup] raw backup database left behind:', err));
  }
}

/**
 * The file's pictures and icons stored in the active vault. Opening read only
 * the parts it needed: a damaged picture further in shows only here, and is
 * named like any other damage of a file.
 */
async function storeFiles(file: OpenedVaultFile): Promise<StoredArchiveFiles> {
  try {
    return await storeArchiveFiles(file.ticket);
  } catch (err) {
    const notice = noticeFor(err);
    throw notice ? new EmeraldNotice(notice) : err;
  }
}

/** What the import offers to choose from: the categories in use and how many entries each holds. */
function previewOf(backup: VaultContent): BackupPreview {
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
    hasSettings: isRecord(backup.settings),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Image restore helpers
// ─────────────────────────────────────────────────────────────────────────────

function remapPaths(value: unknown, pathMap: Map<string, string>): unknown {
  return typeof value === 'string' ? renameAll(value, pathMap) : value;
}

/** Rewrite the defaults of brought-along definitions to the images stored here (and, on merge, to the new IDs). */
export function remapDefinitionRows(rows: unknown, pathMap: Map<string, string>, link?: LinkDefaultResolver): unknown {
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
export async function insertBlockDefinitions(
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
  await insertTagLinks(db, 'image', fresh, (id) => id);
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
  const inserted = new Set(normalized.map((t) => t.id));
  await insertTagLinks(db, 'template', fresh.map((t) => ({ id: t.id, tags: t.tags })), (id) => (inserted.has(id) ? id : undefined));
  return normalized.map((t) => t.id);
}

/** Statements per `batch` when inserting block rows — a block is a few of them. */
const BLOCK_BATCH = 500;

/** A row of `data.blocks` in the shape `fromBlockRow` reads — the file is foreign, so every value is checked. */
function fileBlockRow(row: Row): StoredBlockRow | null {
  if (typeof row.id !== 'string' || !row.id || typeof row.type !== 'string' || !row.type) return null;
  return {
    id: row.id,
    type: row.type,
    version: Number.isInteger(row.version) && row.version > 0 ? row.version : null,
    hidden: row.hidden === 1 ? 1 : 0,
    title: asString(row.title),
    show_title: row.show_title === 0 || row.show_title === 1 ? row.show_title : null,
    config: asString(row.config),
    data: asString(row.data),
    attrs: asString(row.attrs),
    html: asString(row.html) ?? '',
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

function applyTypeFilters(d: VaultData, f: ImportTypeFilters): VaultData {
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
export async function resolveImportedCategories(
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

  // A built-in category carries only its English seed in the column
  // ("Sigils"); it is displayed via its locale key.
  const nameOf = (row: Row) => (row.is_builtin
    ? i18n.t(`categories.builtin.${String(row.id)}`, { defaultValue: String(row.name ?? '') })
    : String(row.name ?? ''));
  // Built-ins and starters (`dreams`, `herbs` …) have the same ID in every
  // vault; a starter's name may have been renamed or come from another app
  // language. Matched by ID, or the built-in dashboards, which name them,
  // would end up on a duplicate.
  const sameIdEverywhere = (row: Row) => !!row.is_builtin || STARTER_CATEGORY_IDS.has(String(row.id));
  // Unless another category of the file already claims that local starter by
  // its name (the starter renamed there, its old name given to a new one):
  // then the starter goes by name too, so two categories stay two.
  const claimedByName = new Set<string>();
  for (const row of rows) {
    if (sameIdEverywhere(row) && localById.has(String(row.id))) continue;
    const named = localByKey.get(categoryKey(nameOf(row)));
    if (named) claimedByName.add(String(named.id));
  }
  // Built-ins always go by ID; a starter only while no other category of the file claims it by name.
  const matchesById = (row: Row) => !!row.is_builtin
    || (STARTER_CATEGORY_IDS.has(String(row.id)) && !claimedByName.has(String(row.id)));

  const map = new Map<string, string>();
  const startTemplates = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id);
    const template = typeof row.template_id === 'string' && isTemplateId(row.template_id) ? row.template_id : null;
    const name = nameOf(row);
    const key = categoryKey(name);
    const match = (matchesById(row) ? localById.get(id) : undefined) ?? localByKey.get(key);
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
function usedCategoryRows(d: VaultData): Row[] {
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
  d: VaultData,
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

/**
 * Per picture and icon of the file, the name it was stored under here — what
 * `storeArchiveFiles` returns, before the rows are written.
 */
export type ImportedFiles = StoredArchiveFiles;

export async function doReplace(db: Awaited<ReturnType<typeof getDb>>, backup: VaultContent, files: ImportedFiles): Promise<void> {
  const pathMap = new Map(files.images);
  // The block copies name their icons in `config`, beside their pictures: one
  // rename for both (the same bytes have the same name in either folder).
  const fileMap = new Map([...pathMap, ...files.icons]);
  // Tags are not replaced but merged: entries that this file does
  // not replace carry the IDs of the existing ones.
  const d = await importTagsAndRemap(db, remapIconColumns(backup.data, files.icons));

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
  const insertedEntries = new Set(entries.map((r) => String(r.id)));
  await insertTagLinks(db, 'entry', d.entries, (id) => (insertedEntries.has(id) ? id : undefined));
  await insertImportedBlocks(db, d.blocks, 'entry', same(entries.map((r) => String(r.id))), { images: fileMap });
  await insertImportedBlocks(db, d.blocks, 'template', same(templateIds), { images: fileMap });
  await insertTasks(db, tasks);
  if (d.taskLinks) await insertRows(db, 'task_links', d.taskLinks);

  // A partial replace (e.g. only tasks) can orphan existing links that point to
  // just-replaced targets — and imported task_links
  // can point to deselected types. Same sweep as for the trash.
  await sweepDanglingTaskLinks(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge import (ID-prefix strategy)
// ─────────────────────────────────────────────────────────────────────────────

export async function doMerge(db: Awaited<ReturnType<typeof getDb>>, backup: VaultContent, files: ImportedFiles): Promise<void> {
  const pathMap = new Map(files.images);
  const fileMap = new Map([...pathMap, ...files.icons]);
  const d = await importTagsAndRemap(db, remapIconColumns(backup.data, files.icons));

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
  await insertTagLinks(db, 'entry', d.entries, (id) => (inserted.has(pid(id)) ? pid(id) : undefined));
  await insertImportedBlocks(db, d.blocks, 'entry', owners, { images: fileMap, id: nextId });
  await insertImportedBlocks(db, d.blocks, 'template', new Map(templateIds.map((id) => [id, id])), { images: fileMap, id: nextId });
  await insertTasks(db, tasks);
  await insertRows(db, 'task_links', taskLinks, true);

  // Imported task_links can point to targets that the type filter
  // has just deselected — sweep them out as in doReplace.
  await sweepDanglingTaskLinks(db);
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
 * the two packing lists (the export menu's `VaultExportOptions`, the vault
 * import's vault part (`useVaultImport`); `loadExportPrefs` reads the same kinds back), the
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
type ContentToggle = Exclude<keyof ImportTypeFilters, keyof EntrySelection>;

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

/**
 * Imports an opened `.vault.emerald`. Its pictures and icons are stored
 * first, in the vault they are imported into (for `add-vault` the new one).
 * The file stays open: whoever opened it closes it (`closeImportSource`).
 */
export async function importDatabase(
  file: OpenedVaultFile,
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
  const backup = file.content;
  // Unchecked from the file — from here on only in checked form.
  const backupSettings = importableSettings(backup.settings);
  // A backup from before language and theme moved to the device may hold
  // custom themes; they join this device's list (`adoptCustomThemes` checks
  // them), while its language and selection do not apply here.
  const backupThemes = isRecord(backup.settings) && isRecord(backup.settings.appearance)
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

  const filteredBackup: VaultContent = {
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
    const createdRoot = await addVault(vaultRecord);
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
    // before the import began (`useVaultImport`). If it came up here again and
    // the answer were "keep editing", the old vault would stay active —
    // and step 4 would fill it instead of the new one.
    // If the user cancels at the new vault's password, the import is
    // cancelled — and the just-created empty vault is removed again, with the
    // folder this attempt made (only if it is still empty).
    const switched = await useVaultStore.getState().switchVault(vaultId, { editsResolved: true }).catch(async (err: unknown) => {
      if (keyErrorOf(err) === VAULT_KEY_CANCELLED) {
        // Before removeVault: the command needs the id still registered.
        await discardNewVaultDirs(vaultId, createdRoot).catch((e: unknown) => console.warn('[backup] could not clean up the new vault folder', e));
        await useVaultStore.getState().removeVault(vaultId).catch((e: unknown) => console.warn('[backup] could not remove the new vault', e));
      }
      throw err;
    });
    if (!switched || useVaultStore.getState().activeVaultId !== vaultId) {
      throw new Error('could not switch to the new vault');
    }

    // 4. Fill the new (empty) vault with the backup data — its pictures first, into this vault.
    const files = await storeFiles(file);
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
      await doReplace(staging, filteredBackup, files);
    });
    // Only once the import went through, as with replace and merge below.
    if (backupThemes) useDeviceStore.getState().adoptCustomThemes(backupThemes);
  } else {
    // Never directly against the vault: `doReplace` deletes before it inserts, and
    // an aborted merge would leave half-imported data behind (see `importStaging.ts`).
    const run = mode === 'replace' ? doReplace : doMerge;
    const files = await storeFiles(file);
    await importViaStaging(await getDb(), (staging) => run(staging, filteredBackup, files));

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


/** The rows of these custom block definitions — what a `.emerald` file of entries takes along. */
export async function definitionRows(db: Awaited<ReturnType<typeof getDb>>, ids: readonly string[]): Promise<ManifestBlockDefinition[]> {
  return db.select<ManifestBlockDefinition[]>(
    // Not from the trash: what was thrown away there does not go to another vault.
    'SELECT * FROM block_definitions WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each($1)) ORDER BY sort_order',
    [JSON.stringify(ids)],
  );
}
