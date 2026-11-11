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

import { convertAltarsInPlace, createAltarTables, removeAltarTables } from './migrateAltars';
import { elementsWithAltarsAsOperations } from './altarConversion';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { clearLegacyUntitledTitles, getDb, sweepDanglingTaskLinks } from './db';
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
import {
  DEFAULT_DEFINITION_ICON, definitionImageRefs, definitionToRow, isDefinitionId, parseDefinitionElements,
  remapDefinitionDefaults, type BlockDefinition, type LinkDefaultResolver,
} from './blocks/definitions';
import { convertLegacyStatusRows, STATUS_DEFINITION_ID } from './blocks/legacyStatus';
import { definitionById, nextDefinitionSortOrder } from './blockDefinitionRows';
import { nextTemplateSortOrder } from './templateRows';
import { nextEntrySortOrder, nextLanguageSortOrder } from './lexiconRows';
import { alphabetToJson, DEFAULT_LANGUAGE_ICON } from './lexicon';
import { readUserSymbol, type UserSymbol } from './userSymbols';
import type { EntryType, Language } from '../types';
import {
  routineLinkResolver, routineToTemplate, vaultRoutineLinkSource, type RoutineCategoryRow, type RoutineTargetRow,
} from './migrateRoutinesToTemplates';
import {
  ALTAR_TEMPLATE_ID, assignedCategoryId, assignmentKey, isTemplateId, parseAssignments, SIGIL_TEMPLATE_ID, templateToRow,
} from './blocks/templates';
import { fromRow } from './row';
import { needsSigilConversion, sigilRowToContent, type LegacySigilRow } from './migrateLegacySigils';
import { linkedIdsToContent, rowsLinkSource } from './migrateLinkedIdsToContent';
import { journalFieldsToContent } from './migrateJournalFieldsToContent';
import { IMAGE_FIELDS, imageColumns, storedImageName } from './schema';
import { ALTAR_SETTING_KEYS, altarSettingsJson } from './altarSettings';
import { withNewElementIds } from './altarElements';
import { isTagId, rewriteTagRefs, stripTagIds, tagIdList, tagNameKey, tagNameResolver, type LegacyTagRow } from './tagRefs';
import { randomTagColor } from '../store/tagStore';
import { categoryKey, mergeCategoryRows, type CategorySource } from './categoryMerge';
import { legacyDisplayName, type LegacyCategoryTable } from './categories';
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

export interface BackupOptions {
  includeJournal: boolean;
  includeWiki: boolean;
  includeOperations: boolean;
  includeTasks: boolean;
  includeTags: boolean;
  /** The lexicon's languages with their vocabulary — all of it, no date question. */
  includeLexicon: boolean;
  dateFrom: string;       // ISO date string, '' = no lower bound
  dateTo: string;         // ISO date string, '' = no upper bound
  includeDeleted: boolean;
  /** The vault's `settings.json`. Missing in files from before the vault settings. */
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
  journalCount: number;
  wikiCount: number;
  /** Operations, with the altars of an older file, which arrive as operations. */
  opsCount: number;
  /** Templates plus the routines of older files, which arrive as templates. */
  templatesCount: number;
  taskCount: number;
  /** The lexicon's languages; their vocabulary travels with them. */
  languagesCount: number;
  /** Only categories that some content of the backup points to. */
  categories: BackupCategoryEntry[];
  /** Whether the file brings vault settings along. */
  hasSettings: boolean;
}

/** Which top-level content types to import. */
export interface ImportTypeFilters {
  includeJournal: boolean;
  includeWiki: boolean;
  includeOperations: boolean;
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
 * '1' = before the schema unification (`wiki_articles.category`,
 * `altar_items.category` with the category *name*), '2' = after it, '3' = since
 * images are referenced by file name instead of absolute path, '4' =
 * since v38 one `categories` table replaces the four module tables
 * (`data.categories` instead of `wikiCategories`/`operationCategories`/
 * `taskCategories`/`altarCategories`), '5' = since v39 `category_id` may be NULL,
 * '6' = since v40 the custom blocks travel along as `data.blockDefinitions`,
 * '7' = since v42 operations carry their sigils as blocks in the content
 * instead of in separate columns, '8' = since v43 the templates travel along as
 * `data.templates`, '9' = since v45 the lexicon as `data.languages` and
 * `data.lexiconEntries`, '10' = since v46 altars carry `deleted_at`, '11' =
 * since v49 journal, wiki and operations are in one `data.entries`
 * array, each row with `type` and without the columns that no longer exist,
 * '12' = since v51 altars carry their appearance as a JSON column `settings`,
 * since v52 altar items `updated_at`/`deleted_at`, and since v53 entries and
 * templates tag IDs instead of tag names, '13' = since v56 `assignments` carry
 * no `isDefault` and `block_definitions` no `revision`, since v57 altars
 * carry the shapes and text drawn on them as a JSON column `elements`, and
 * since v60 the pictures taken into "Images" travel along as `data.vaultImages`.
 *
 * The '13' is needed three times over: an older build would read every assignment
 * as merely offered, it has no `elements` column, so `insertRows` would
 * drop it and the drawn shapes and text would be gone without a word, and it
 * would restore the pictures' files but not their names and tags. With
 * the '13' it rejects the file.
 *
 * The '12' is needed because an older build looks for the twelve individual columns:
 * `insertRows` would drop `settings`, and every altar would arrive with the
 * default values. With the '12' it rejects the file.
 *
 * The '11' is needed because an older build looks for the entries under
 * `journalEntries`/`wikiArticles`/`operations`: it would find nothing there and
 * silently not import them. With the '11' it rejects the file
 * (`version > BACKUP_VERSION`) before anything happens.
 *
 * The '10' is no formality either: a build from before v46 does not know the column,
 * `insertRows` would drop it — and an altar from the trash
 * would come back there as a live one. It is better for it to reject the file.
 *
 * The '5' is no formality: a file written that way contains entries
 * without a category, and a build from before v39 still has a NOT NULL column there.
 * Without the bump it would run into a constraint error in the middle of the import —
 * after the deletions of replace mode, without a transaction. With it, the
 * "newer than me" check (`backup.version > BACKUP_VERSION`) honestly rejects the file
 * before anything happens.
 */
const BACKUP_VERSION = '13' as const;

/** The four category arrays of backups up to version 3. */
interface LegacyCategoryArrays {
  wikiCategories?: Row[];
  operationCategories?: Row[];
  taskCategories?: Row[];
  altarCategories?: Row[];
}

/**
 * Merges the four category arrays of a backup up to v3 into `data.categories`
 * — the same rule as migration v38 (`mergeCategoryRows`), including
 * the translation of built-in categories into the current app language — and
 * re-points the four content arrays to the new IDs.
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
      // Without a match the entry stays uncategorized. Until v38 it fell into the
      // catch-all — that special case no longer exists, and "none" is
      // more honest than a category the user never chose.
      row.category_id = merged.idMap.get(`${table}:${String(row.category_id)}`) ?? null;
    }
  };
  remap(data.wikiArticles, 'wiki_categories');
  remap(data.operations, 'operation_categories');
  remap(data.tasks, 'task_categories');
  remap(data.altarItems, 'altar_categories');
}

/**
 * Lifts a backup in the old format to the current one.
 *
 * Without this step `insertRows` would silently discard the column
 * `category`, which has become unknown — every article from an older backup
 * would end up without comment in the default category. The filter there protects against
 * crafted files and cannot tell malicious from outdated;
 * so the translation happens here, before it takes effect.
 */
export function migrateBackupPayload(backup: BackupFile): void {
  // A version this app does not know yet is rejected instead of
  // re-stamped — otherwise a file from a newer version would run through the
  // import as if it had been understood. `.emerald` does the same.
  // As a number: a string comparison would consider '10' older than '4'.
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

    // altar_items used to hold the category *name*. First resolve it against the categories
    // from the same backup, otherwise to 'other'.
    const byName = new Map<string, string>(
      (data.altarCategories ?? []).map((c) => [String(c.name), String(c.id)])
    );
    const byId = new Set((data.altarCategories ?? []).map((c) => String(c.id)));
    for (const row of data.altarItems ?? []) {
      if (row.category_id === undefined) {
        const raw = row.category === undefined ? '' : String(row.category);
        // Without a match the item stays uncategorized instead of falling into the
        // catch-all — the same as `mergeLegacyCategoryArrays` does below.
        row.category_id = byId.has(raw) ? raw : (byName.get(raw) ?? null);
      }
      delete row.category;
    }

    for (const row of data.journalEntries ?? []) {
      row.linked_operation_ids = row.linked_operation_ids ?? '[]';
      row.linked_wiki_ids = row.linked_wiki_ids ?? '[]';
    }
  }

  // v2 → v3 needs no step: the only change is that images are referenced by
  // file name instead of absolute path, and `restoreImages`
  // translates the file's keys either way.

  // v3 → v4: four category arrays become one. The comparison is ordered,
  // not "not equal to 4": a newer file has the single table already and
  // would otherwise run through the merge a second time.
  if (version < 4) {
    mergeLegacyCategoryArrays(data);
  }

  // v4 → v5 needs no step: `category_id` may now be NULL, and
  // an older file has a value there everywhere. The check above
  // covers the other direction.

  // v5 → v6 needs no step: the only new thing is the array `blockDefinitions`,
  // and a file without it simply brings no custom blocks.

  // v6 → v7 needs no step on the file: sigil columns of old
  // operations are converted by the import before inserting (`liftLegacySigilRows`),
  // the old journal fields likewise (`liftLegacyJournalRows`).

  // v7 → v8 needs no step: the only new thing is the array `templates`.
  // v8 → v9 neither: the only new things are `languages`/`lexiconEntries`, and an
  // older file simply brings no lexicon.
  // v9 → v10 neither: altars without `deleted_at` are live altars.

  // v10 → v11 is the reverse: the file already has the three lists, only an
  // '11' brings `entries`, and that is split by type here. A row
  // with an unknown type is dropped — there would be no module for it in `entries`.
  if (version >= 11) splitEntries(data);

  // v11 → v12: the individual columns of altars become `settings`, and
  // altar items get an `updated_at`.
  if (version < 12) {
    for (const row of data.altars ?? []) {
      row.settings = altarSettingsJson(row);
      for (const key of ALTAR_SETTING_KEYS) delete row[key];
    }
    for (const row of data.altarItems ?? []) row.updated_at ??= row.created_at;
    tagNamesToIds(data);
  }

  // Routines (files from before v44) stay as they are here: they only become templates
  // at import (`withRoutinesAsTemplates`), after the filters — otherwise
  // their links would point to entries that do not come along at all.
  backup.sourceVersion = version;
  backup.version = BACKUP_VERSION;
}

/**
 * Tag names of a file up to format 11 become tag IDs — the same rule as
 * migration v53 (`tagNameResolver`): names without a tag get a new one in
 * `data.tags`, a tag in the trash comes back into the rows it lost on
 * deletion. The routines too, which only become templates at import.
 */
function tagNamesToIds(data: BackupFile['data']): void {
  const tags = (data.tags ?? []).filter((t) => isTagId(t.id) && typeof t.name === 'string') as LegacyTagRow[];
  const resolver = tagNameResolver(tags, generateId);
  const lists = [data.journalEntries, data.wikiArticles, data.operations, data.templates, data.routines];
  for (const rows of lists) {
    for (const row of rows ?? []) {
      row.tags = JSON.stringify(resolver.withAffected(String(row.id), resolver.idsFor(row.tags)));
    }
  }
  data.tags = [
    ...(data.tags ?? []).map(({ affected_ids: _affected, ...tag }) => tag),
    ...resolver.created.map((t) => ({ id: t.id, name: t.name, deleted_at: null })),
  ];
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
    journalEntries: remap(d.journalEntries),
    wikiArticles: remap(d.wikiArticles),
    operations: remap(d.operations),
    templates: remap(d.templates),
    vaultImages: remap(d.vaultImages),
  };
}

/** After the import: tag IDs without a tag row drop out of every list. */
export async function dropUnknownTagIds(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM tags')).map((r) => r.id));
  await rewriteTagRefs(db, (ids) => ids.filter((id) => known.has(id)));
}

/** Splits `data.entries` (file from '11') into the lists the import works with. */
function splitEntries(data: BackupFile['data']): void {
  const rows = Array.isArray(data.entries) ? data.entries : [];
  const ofType = (type: EntryType) => rows.filter((r) => r?.type === type);
  data.journalEntries = ofType('journal');
  data.wikiArticles = ofType('wiki');
  data.operations = ofType('operation');
  delete data.entries;
}

/**
 * The columns of `entries` except `type`. Every row gets all of them: `insertRows`
 * takes the column list from the first row, and a journal entry at the front
 * would otherwise strip category, icon and cover image from the wiki articles behind it. What
 * the old tables had in addition (`slug`, `moon_phase`, dead columns) is dropped
 * here — the conversions before this have read what they needed.
 */
const ENTRY_COLUMNS = [
  'id', 'title', 'content', 'category_id', 'entry_number', 'icon', 'cover_image',
  'tags', 'created_at', 'updated_at', 'deleted_at',
] as const;

/**
 * The image columns of an operation row at import: those of `entries` and the
 * sigil drawing of old files — it only becomes a file in `liftLegacySigilRows`
 * and must already carry the local name for that.
 */
const IMAGE_FIELDS_OP = [...imageColumns('entries'), 'drawing_data'];

function asEntryRow(type: EntryType, row: Row): Row {
  const out: Row = { type };
  for (const column of ENTRY_COLUMNS) out[column] = row[column] ?? null;
  out.title ??= '';
  out.content ??= '';
  out.tags ??= '[]';
  // The journal has no category, no icon and no cover image.
  if (type === 'journal') out.category_id = out.icon = out.cover_image = null;
  return out;
}

/**
 * The import's entry rows for `entries`. An ID arrives only once:
 * a backup up to '10' can carry the same entry in two lists (a
 * type change that aborted midway) — as in v49 the first wins, in the
 * order journal, wiki, operations.
 */
export function entryRowsForInsert(journal: Row[], wiki: Row[], operations: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const [type, rows] of [['journal', journal], ['wiki', wiki], ['operation', operations]] as const) {
    for (const row of rows) {
      const id = String(row.id);
      if (seen.has(id)) {
        console.warn(`[backup] ${type}.${id} is already in the file under another type — skipped`);
        continue;
      }
      seen.add(id);
      out.push(asEntryRow(type, row));
    }
  }
  return out;
}

/** The entry types a backup brings along — `doReplace` replaces only their entries. */
function presentEntryTypes(d: BackupFile['data']): EntryType[] {
  return ([
    ['journal', d.journalEntries],
    ['wiki', d.wikiArticles],
    ['operation', d.operations],
  ] as const).filter(([, rows]) => (rows?.length ?? 0) > 0).map(([type]) => type);
}

interface BackupFile {
  version: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13';
  /** The version the file was written with — `migrateBackupPayload` sets `version` to the current one. */
  sourceVersion?: number;
  type: 'backup';
  exportedAt: string;
  filters: BackupOptions;
  data: {
    /**
     * In the file (since '11'): journal, wiki and operations as in the
     * `entries` table. `migrateBackupPayload` splits them into the three lists
     * below — the import treats each type differently (categories, status,
     * sigils, old journal fields).
     */
    entries?: Row[];
    /** In the import: the entries per type. In files up to '10' they were in the file like this too. */
    journalEntries?: Row[];
    wikiArticles?: Row[];
    operations?: Row[];
    /** The global list; included as soon as one of the four categorized modules is included. */
    categories?: Row[];
    /** The custom blocks (since '5'); included as soon as journal, wiki or operations are included. */
    blockDefinitions?: Row[];
    /** The templates (since '8'); included as soon as journal, wiki or operations are included. */
    templates?: Row[];
    tags?: Row[];
    /** Only in files from before v44: the routines — the import makes templates of them (`withRoutinesAsTemplates`). */
    routines?: Row[];
    altars?: Row[];
    altarItems?: Row[];
    altarPlacements?: Row[];
    tasks?: Row[];
    taskLinks?: Row[];
    // Until schema v46 there was also `links` here, a mirror of the link chips
    // that nothing read. Old files still carry it; the import ignores it.
    /** The lexicon's languages (since '9'). */
    languages?: Row[];
    /** Their vocabulary (since '9') — worthless without its language, hence always together. */
    lexiconEntries?: Row[];
    /**
     * The vault's own symbols (table `symbols`). Needs no new version: an
     * older build ignores the field and keeps the rest.
     */
    symbols?: Row[];
    /** The pictures taken into "Images" (since '13'), with their files in `images`. */
    vaultImages?: Row[];
  };
  images: Record<string, string>;  // stored file name → data URL (in v1/v2: absolute path)
  /**
   * The vault's settings (`settings.json`), unchecked like everything from
   * the file — normalised only at import. Needs no new
   * version: an older build simply ignores the field.
   */
  settings?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enters every image reference of the rows into `into`.
 *
 * The column list comes from `IMAGE_FIELDS`, so that it is the same one that
 * migration v35 and the cleanup action use. Before, it was written out
 * by hand three times here — and `doReplace` and `doMerge` had already
 * diverged for `altars`.
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
  includeJournal: true,
  includeWiki: true,
  includeOperations: true,
  includeTasks: true,
  includeTags: true,
  includeLexicon: true,
  dateFrom: '',
  dateTo: '',
  includeDeleted: true,
  includeSettings: true,
};

/** The content of a backup according to `options`, images embedded. Writes nothing. */
export async function buildBackup(options: BackupOptions): Promise<BackupFile> {
  const db = await getDb();
  const data: BackupFile['data'] = {};
  const allImagePaths = new Set<string>();

  const { clause: dateClause, params: dateParams } = buildDateFilter(options.dateFrom, options.dateTo);
  const deletedClause = deletedFilter(options.includeDeleted);

  // ── Journal, Wiki, Operationen ───────────────────────────────────────────
  // One table, one array — the selection decides which types come along.
  // The types are literal in the SQL (no user input).
  const entryTypes = [
    options.includeJournal && "'journal'",
    options.includeWiki && "'wiki'",
    options.includeOperations && "'operation'",
  ].filter(Boolean);
  if (entryTypes.length) {
    data.entries = await db.select<Row[]>(
      `SELECT * FROM entries WHERE type IN (${entryTypes.join(', ')}) ${dateClause} ${deletedClause}`,
      dateParams,
    );
    collectImageRefs('entries', data.entries, allImagePaths);
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
  // The one list, as soon as a categorized module is included. Soft-deleted
  // categories too: their contents are exported along and
  // need their counterpart, otherwise the import fails on the foreign key.
  // Also with journal alone: the templates then travel along, and their assignments need the categories.
  if (
    options.includeJournal || options.includeWiki || options.includeOperations || options.includeTasks
  ) {
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
  if (options.includeJournal || options.includeWiki || options.includeOperations) {
    data.blockDefinitions = await db.select<Row[]>(`SELECT * FROM block_definitions`);
    // The image defaults travel along, even if no copy uses them yet.
    for (const row of data.blockDefinitions) {
      definitionImageRefs(parseDefinitionElements(row.elements)).forEach((ref) => allImagePaths.add(ref));
    }
  }

  // ── Templates ────────────────────────────────────────────────────────────
  // Like the custom blocks: all of it, trash included, with the images in the block stack.
  if (options.includeJournal || options.includeWiki || options.includeOperations) {
    data.templates = await db.select<Row[]>(`SELECT * FROM templates`);
    for (const row of data.templates) {
      if (typeof row.content === 'string') imageRefsInHtml(row.content).forEach((ref) => allImagePaths.add(ref));
    }
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
  migrateBackupPayload(backup);

  // Only show categories that are actually used by entries in this backup
  const usedCatIds = new Set([
    ...[
      ...(backup.data.wikiArticles ?? []),
      ...(backup.data.operations ?? []),
      ...(backup.data.tasks ?? []),
      ...(backup.data.altarItems ?? []),
    ].map((r) => r.category_id as string),
    ...templateCategoryIds(backup.data.templates),
  ]);

  const preview: BackupPreview = {
    exportedAt: backup.exportedAt,
    journalCount: backup.data.journalEntries?.length ?? 0,
    wikiCount: backup.data.wikiArticles?.length ?? 0,
    opsCount: (backup.data.operations?.length ?? 0) + (backup.data.altars?.length ?? 0),
    templatesCount: (backup.data.templates?.length ?? 0) + (backup.data.routines?.length ?? 0),
    taskCount: backup.data.tasks?.length ?? 0,
    languagesCount: backup.data.languages?.length ?? 0,
    categories: (backup.data.categories ?? []).filter((c) => usedCatIds.has(c.id as string)) as BackupCategoryEntry[],
    hasSettings: isPlainObject(backup.settings),
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

/** Rewrite the defaults of brought-along definitions to the images stored here (and, on merge, to the new IDs). */
function remapDefinitionRows(rows: unknown, pathMap: Map<string, string>, link?: LinkDefaultResolver): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((r) => (typeof r === 'object' && r !== null
    // An older file's altar elements are link elements first, or the check below drops them.
    ? { ...r, elements: remapDefinitionDefaults(elementsWithAltarsAsOperations((r as Row).elements), (name) => pathMap.get(name) ?? name, link) }
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

/** The category IDs that a backup's templates are assigned to. */
function templateCategoryIds(rows: Row[] | undefined): string[] {
  return (rows ?? []).flatMap((r) => parseAssignments(r.assignments).map(assignedCategoryId))
    .filter((id): id is string => id !== null);
}

/**
 * The templates of a backup: by ID, `INSERT OR IGNORE` like the custom
 * blocks — an existing template (also in the trash, also the built-in
 * sigil template) stays as it is, none is deleted. New ones go to the end
 * of the list in their order.
 *
 * The file is foreign: every row runs through `fromRow.template` as on
 * reading. `content` gets the images stored here (and, on merge, the
 * renamed link targets), the assignments the local category IDs — whatever
 * points to no category is dropped. A combination that an active template here
 * already holds stays with it, and one from the trash brings no assignments.
 */
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

async function insertTemplates(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: unknown,
  pathMap: Map<string, string>,
  catMap: Map<string, string>,
  remapContent: (content: string) => string = (content) => content,
): Promise<void> {
  if (!Array.isArray(rows)) return;
  const local = (await db.select<Row[]>('SELECT * FROM templates')).map(fromRow.template);
  const known = new Set(local.map((t) => t.id));
  const taken = new Set(local.filter((t) => t.deleted_at === null)
    .flatMap((t) => t.assignments.map((a) => assignmentKey(a.entryType, a.category))));
  const categories = new Set((await db.select<Row[]>('SELECT id FROM categories')).map((r) => String(r.id)));

  const now = nowIso();
  const fresh = rows
    .filter((r): r is Row => typeof r === 'object' && r !== null && isTemplateId((r as Row).id))
    .map((r) => fromRow.template(r))
    .sort((a, b) => a.sort_order - b.sort_order)
    // An ID that is already there — also a second row of the same ID in the file — does not get in.
    .filter((t) => !known.has(t.id) && !!known.add(t.id));
  let sortOrder = await nextTemplateSortOrder(db);
  const normalized = fresh.map((t) => {
    const active = t.deleted_at === null;
    const remapped = parseAssignments(t.assignments.flatMap((a) => {
      const id = assignedCategoryId(a);
      if (id === null) return [a];
      const category = catMap.get(id) ?? id;
      return categories.has(category) ? [{ ...a, category }] : [];
    }));
    const assignments = !active ? [] : remapped.filter((a) => {
      const key = assignmentKey(a.entryType, a.category);
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
    return templateToRow({
      ...t,
      content: remapContent(String(remapPaths(t.content, pathMap))),
      assignments,
      sort_order: sortOrder++,
      created_at: t.created_at || now,
      updated_at: t.updated_at || now,
    });
  });
  await insertRows(db, 'templates', normalized, true);
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
 * Journal (v36/v37): linked operations and articles, paradigm, banishing
 * and meditation of an older backup become link blocks in the content — before
 * inserting, because since v49 the old columns no longer exist (the
 * others are dropped in `asEntryRows`). The targets are in the file or,
 * if the import deselected them, possibly already in the vault; the file takes
 * precedence. The merge then renames the chips along with all the others — a target
 * from the vault keeps its ID in the process.
 *
 * Status/end date/version (v41) is converted by `convertLegacyStatusRows` per mode —
 * it needs the "Status" definition of the target vault.
 */
async function liftLegacyJournalRows(
  db: Awaited<ReturnType<typeof getDb>>,
  d: BackupFile['data'],
): Promise<BackupFile['data']> {
  if (!d.journalEntries?.length) return d;
  const [vaultTargets, vaultCategories] = await Promise.all([
    db.select<Row[]>(
      "SELECT id, type, title, icon, category_id, entry_number, deleted_at FROM entries WHERE type IN ('wiki', 'operation')"
    ),
    db.select<Row[]>('SELECT id, name, emoji, is_builtin FROM categories'),
  ]);
  // Later wins: first the vault, then the file.
  const source = rowsLinkSource(
    {
      operation: [...vaultTargets.filter((r) => r.type === 'operation'), ...(d.operations ?? [])],
      wiki: [...vaultTargets.filter((r) => r.type === 'wiki'), ...(d.wikiArticles ?? [])],
    },
    [...vaultCategories, ...(d.categories ?? [])],
  );
  const journalEntries = d.journalEntries.map((row) => {
    const linked = linkedIdsToContent(String(row.content ?? ''), { id: String(row.id), ...row }, source);
    // Broken JSON in the linked IDs: the row stays untouched as in v36.
    if (linked === null) return row;
    const content = journalFieldsToContent(linked, row, source);
    return content === row.content ? row : { ...row, content };
  });
  return { ...d, journalEntries };
}

/**
 * Operations (v42): sigil columns become blocks — after the status
 * conversion, so that the blocks stand in the same order as after
 * migrations v41 and v42. `operations` and `wikiArticles` are the rows of the
 * mode, so already renamed (merge) and with local image names. Empty
 * operations of the category "Sigils" get the set only from files before
 * version 7: in a newer one the user may have removed the blocks
 * deliberately.
 */
async function liftLegacySigilRows(operations: Row[], wikiArticles: Row[], backup: BackupFile): Promise<Row[]> {
  const includeSigilCategory = (backup.sourceVersion ?? Number(BACKUP_VERSION)) < 7;
  const articles = new Map(wikiArticles.map((a) => [String(a.id), {
    title: a.title == null ? null : String(a.title),
    icon: a.icon == null ? null : String(a.icon),
    entry_number: a.entry_number == null ? null : Number(a.entry_number),
  }]));
  const out: Row[] = [];
  for (const row of operations) {
    const sigilRow = row as LegacySigilRow;
    if (!needsSigilConversion(sigilRow, includeSigilCategory)) {
      out.push(row);
      continue;
    }
    const content = await sigilRowToContent(sigilRow, (id) => articles.get(id));
    // Unlike the migration, the import cannot catch up later — after
    // v49 there is no column in which the drawing could wait.
    if (content === undefined) throw new Error(`Sigil drawing of operation ${String(row.id)} could not be saved`);
    out.push({ ...row, content });
  }

  return out;
}

/**
 * The "Status" definition by which old operation rows are rewritten:
 * the vault's (also in the trash), otherwise the file's — as in
 * migration v41. Otherwise the new copies would not match the "Status" that exists
 * in the vault afterwards.
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
 * The file's definitions, followed by "Status" if the conversion created it
 * anew (it existed neither in the vault nor in the file) — at the end of the list.
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
  const anyCategorized = f.includeWiki || f.includeOperations || f.includeTasks;
  const anyBlocks = f.includeJournal || f.includeWiki || f.includeOperations;
  return {
    ...d,
    blockDefinitions:   anyBlocks           ? d.blockDefinitions  : [],
    templates:          anyBlocks           ? d.templates         : [],
    routines:           anyBlocks           ? d.routines          : [],
    journalEntries:     f.includeJournal    ? d.journalEntries    : [],
    wikiArticles:       f.includeWiki       ? d.wikiArticles      : [],
    operations:         f.includeOperations ? d.operations        : [],
    // Templates (with `anyBlocks`) need the categories of their assignments; `usedCategoryRows` narrows it down.
    categories:         anyCategorized || anyBlocks ? d.categories : [],
    // The altars of an older file arrive as operations.
    altars:             f.includeOperations ? d.altars            : [],
    altarItems:         f.includeOperations ? d.altarItems        : [],
    altarPlacements:    f.includeOperations ? d.altarPlacements   : [],
    tasks:              f.includeTasks      ? d.tasks             : [],
    taskLinks:          f.includeTasks      ? d.taskLinks         : [],
    tags:               f.includeTags       ? d.tags              : [],
    languages:          f.includeLexicon    ? d.languages         : [],
    lexiconEntries:     f.includeLexicon    ? d.lexiconEntries    : [],
  };
}

/**
 * Translates a backup's categories into this vault's: same ID
 * (the two builtins) or same name (case-insensitive) → local row,
 * otherwise newly created. Returns the mapping backup ID → local ID, with
 * which the four content arrays are re-pointed (`remapCategoryIds`).
 *
 * Categories are never deleted, not even on replace: since v38 a category
 * spans modules, and a partial replace (wiki only) must not pull the
 * categories out from under the tasks.
 */
async function resolveImportedCategories(
  db: Awaited<ReturnType<typeof getDb>>,
  rows: Row[],
): Promise<Map<string, string>> {
  const local = await db.select<Row[]>('SELECT id, name, deleted_at, sort_order FROM categories');
  const localById = new Map(local.map((r) => [String(r.id), r]));
  // If the same name exists both active and in the trash (a vault from before the
  // name rule), the active one applies: the later entries of the map win.
  const byLiveLast = [...local].sort((a, b) => Number(!a.deleted_at) - Number(!b.deleted_at));
  const localByKey = new Map(byLiveLast.map((r) => [categoryKey(String(r.name)), r]));
  let nextSort = local.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), -1) + 1;

  const map = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id);
    // A built-in category carries only its English seed in the column
    // ("Other", "Sigils"); it was displayed via its locale key. From a
    // v4 backup it would otherwise arrive as "Other" next to the local "Sonstiges" lang-ok,
    // instead of merging into it — the same resolution that `mergeCategoryRows` performs via
    // `builtinName`.
    const name = row.is_builtin
      ? i18n.t(`categories.builtin.${id}`, { defaultValue: String(row.name ?? '') })
      : String(row.name ?? '');
    const key = categoryKey(name);
    const match = (row.is_builtin ? localById.get(id) : undefined) ?? localByKey.get(key);
    if (match) {
      map.set(id, String(match.id));
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
  }
  return map;
}

/**
 * Only the categories that some content of the (already filtered) payload
 * points to. The export sends the whole table along; what nobody needs here —
 * deselected types, excluded categories, unused ones — should not become
 * a row in the vault.
 */
function usedCategoryRows(d: BackupFile['data']): Row[] {
  const used = new Set(
    [...(d.wikiArticles ?? []), ...(d.operations ?? []), ...(d.tasks ?? []), ...(d.altarItems ?? [])]
      .filter((r) => r.category_id != null)
      .map((r) => String(r.category_id))
  );
  // Also the categories a template is assigned to — otherwise it would lose the assignment.
  templateCategoryIds(d.templates).forEach((id) => used.add(id));
  return (d.categories ?? []).filter((c) => used.has(String(c.id)));
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
    ['wikiArticles', 'wiki articles'],
    ['operations', 'operations'],
    ['tasks', 'tasks'],
    ['altarItems', 'altar items'],
  ] as const;

  for (const [rowsKey, label] of checks) {
    const missing = new Set<string>();
    for (const row of d[rowsKey] ?? []) {
      // Since v39 "uncategorized" is a valid state — and the one every new
      // entry starts with. Reading it as an unresolvable reference
      // made every backup fail in which even a single entry had no
      // category. An empty *string* remains a miss.
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
 * The routines of an older backup as templates — the same path as
 * migration v44, but only now, after the type and category filters: a
 * link target must come along (from the file) or already be there (in the vault),
 * otherwise the chip is dropped. New templates go after those of the file. On
 * merge, `insertTemplates` then re-points the chips to the renamed IDs.
 */
export async function withRoutinesAsTemplates(db: Awaited<ReturnType<typeof getDb>>, d: BackupFile['data']): Promise<BackupFile['data']> {
  if (!d.routines?.length) return d;
  const resolve = routineLinkResolver(i18n.t, [
    {
      operations: (d.operations ?? []) as RoutineTargetRow[],
      articles: (d.wikiArticles ?? []) as RoutineTargetRow[],
      categories: (d.categories ?? []) as RoutineCategoryRow[],
    },
    await vaultRoutineLinkSource(db),
  ]);
  const now = nowIso();
  const offset = (d.templates ?? []).reduce((max, r) => Math.max(max, Number(r.sort_order) || 0), -1) + 1;
  const converted = d.routines
    .map((routine, i) => routineToTemplate(routine, resolve, offset + i, now))
    .filter((tpl): tpl is NonNullable<typeof tpl> => tpl !== null)
    .map(templateToRow);
  return { ...d, templates: [...(d.templates ?? []), ...converted], routines: [] };
}

/** The picture columns of the altar tables an older file brings (`IMAGE_FIELDS` no longer has them). */
const ALTAR_IMAGE_COLUMNS = ['background_image_data', 'thumbnail_data', 'icon_data'];
const ALTAR_ITEM_IMAGE_COLUMNS = ['image_data'];

/**
 * The altars of an older file (from before v62): written into altar tables
 * the working copy builds for them, turned into operations as v62 did with
 * the vault's own, and the tables dropped again (`migrateAltars.ts`). After
 * the tasks and their links, which then follow the altars to their
 * operations; before the sweep, which would take those links away.
 * `replace`: the file's version of an operation wins over the vault's.
 */
async function importAltars(
  db: Awaited<ReturnType<typeof getDb>>, altars: Row[], items: Row[], placements: Row[], replace: boolean,
): Promise<void> {
  if (!altars.length && !items.length) return;
  await createAltarTables(db);
  await insertRows(db, 'altars', altars);
  await insertRows(db, 'altar_items', items, true);
  await insertRows(db, 'altar_placements', placements);
  await convertAltarsInPlace(db, undefined, { replace });
  await removeAltarTables(db);
}

async function doReplace(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile): Promise<void> {
  const pathMap = await restoreImages(backup);
  // Tags are not replaced but merged: entries that this file does
  // not replace carry the IDs of the existing ones.
  const d = await importTagsAndRemap(db, await liftLegacyJournalRows(db, await withRoutinesAsTemplates(db, backup.data)));

  await assertPayloadReferencesResolve(db, d);

  // Remap image paths — columns from `IMAGE_FIELDS`, not maintained by hand.
  const IMAGE_FIELDS_ENTRY = imageColumns('entries');

  // Categories first: the contents get the local IDs before they are
  // inserted. Categories are never deleted (see there).
  const catMap = await resolveImportedCategories(db, usedCategoryRows(d));

  const journalEntries = (d.journalEntries ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ENTRY, pathMap));
  const wikiArticles = remapCategoryIds((d.wikiArticles ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ENTRY, pathMap)), catMap);
  // Backups up to v40 still carry status/end date/version in the columns.
  const replaceStatus = await statusDefinitionForImport(db, d.blockDefinitions);
  const replaceOps = convertLegacyStatusRows(
    remapCategoryIds((d.operations ?? []).map((r) => remapRow(r, IMAGE_FIELDS_OP, pathMap)), catMap),
    i18n.t, nowIso(), replaceStatus,
  );
  const operations = await liftLegacySigilRows(replaceOps.rows, wikiArticles, backup);
  const altars = (d.altars ?? []).map((r) => remapRow(r, ALTAR_IMAGE_COLUMNS, pathMap));
  const altarItems = remapCategoryIds((d.altarItems ?? []).map((r) => remapRow(r, ALTAR_ITEM_IMAGE_COLUMNS, pathMap)), catMap);
  const tasks = remapCategoryIds(d.tasks ?? [], catMap);

  // Custom blocks like categories: never deleted, missing ones added by ID,
  // existing ones stay. `db` here is the working copy (`importViaStaging`):
  // if anything fails before the end, the vault stays as it was.
  await insertBlockDefinitions(db, await withStatusDefinition(
    db, remapDefinitionRows(d.blockDefinitions, pathMap), replaceOps.definition, replaceStatus,
  ));
  await insertTemplates(db, d.templates, pathMap, catMap);
  // Like the custom blocks and the templates: never deleted, missing ones added.
  await insertLexicon(db, d.languages, d.lexiconEntries);
  await insertVaultImages(db, d.vaultImages, pathMap);
  await insertSymbols(db, d.symbols);

  // Delete only the content types present in the backup (so a partial backup
  // replacing only Journal data won't wipe wiki/ops).
  const entryTypes = presentEntryTypes(d);
  const hasTasks = (d.tasks?.length ?? 0) > 0;

  if (hasTasks) {
    await db.execute('DELETE FROM task_links');
    await db.execute('DELETE FROM tasks');
  }
  for (const type of entryTypes) await db.execute('DELETE FROM entries WHERE type=$1', [type]);
  // Plus every imported ID, whatever type it has in the vault by now: an
  // entry that has changed its module since the backup would otherwise appear
  // twice — and `entries.id` is unique across all types.
  const entries = entryRowsForInsert(journalEntries, wikiArticles, operations);
  for (let i = 0; i < entries.length; i += IN_CHUNK) {
    const chunk = entries.slice(i, i + IN_CHUNK).map((r) => String(r.id));
    await db.execute(`DELETE FROM entries WHERE id IN (${chunk.map((_, n) => `$${n + 1}`).join(',')})`, chunk);
  }
  // Re-insert
  await insertRows(db, 'entries', entries);
  await insertTasks(db, tasks);
  if (d.taskLinks) await insertRows(db, 'task_links', d.taskLinks);
  // The file's version of an altar replaces its operation here.
  await importAltars(db, altars, altarItems, d.altarPlacements ?? [], true);

  // A partial replace (e.g. only tasks) can orphan existing links that point to
  // just-replaced targets — and imported task_links
  // can point to deselected types. Same sweep as for the trash.
  await sweepDanglingTaskLinks(db);
  await dropUnknownTagIds(db);
  // A backup from before v48 brings the English default titles along.
  await clearLegacyUntitledTitles(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge import (ID-prefix strategy)
// ─────────────────────────────────────────────────────────────────────────────

async function doMerge(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = await importTagsAndRemap(db, await liftLegacyJournalRows(db, await withRoutinesAsTemplates(db, backup.data)));

  // Merge deletes nothing, but aborts midway through inserting if a
  // category is missing — check beforehand so the message says which.
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
   * Since v33 `entry_number` is really stored in the database, instead of being generated
   * from the ROWID on read. On merge the numbers must therefore be shifted
   * behind the existing ones — otherwise two entries show the same
   * `#n`.
   */
  async function entryNumberOffset(type: EntryType): Promise<number> {
    const rows = await db.select<{ n: number }[]>(
      'SELECT COALESCE(MAX(entry_number), 0) AS n FROM entries WHERE type = $1',
      [type]
    );
    return rows[0]?.n ?? 0;
  }
  const offsets: Record<EntryType, number> = {
    journal: await entryNumberOffset('journal'),
    wiki: await entryNumberOffset('wiki'),
    operation: await entryNumberOffset('operation'),
  };

  function remapEntry(
    row: Row,
    imagePaths: string[],
    idFields: string[],
    jsonIdFields: string[],
    entryType?: EntryType,
  ): Row {
    const out = remapRow(row, imagePaths, pathMap);
    out.id = pid(out.id as string);
    if (entryType && out.entry_number != null) {
      out.entry_number = Number(out.entry_number) + offsets[entryType];
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
   * Carry along the target IDs of the internal link chips IN `content`. `remapEntry`
   * treats `content` only as an image-path field; the `data-id` attributes in it
   * would otherwise keep the old IDs, renamed here, and every
   * link chip would point nowhere.
   *
   * Deliberately always return an ID: `null` would replace the chip with its text,
   * and on merge the target does exist. `remapId` leaves unknown
   * IDs unchanged — the same convention as `remapJsonIds`. No `label`:
   * the target's title does not change on merge.
   *
   * A content WITH chips runs once through parsing and serialising and
   * may afterwards be formatted slightly differently (quotes, empty
   * elements); one without stays byte for byte the same. Accepted
   * deliberately: the markup comes from TipTap, which rewrites it on every save
   * anyway.
   */
  const withContentLinks = (row: Row): Row => {
    if (typeof row.content !== 'string') return row;
    return {
      ...row,
      content: remapInternalLinks(row.content, (link) => ({ id: String(remapId(link.id)) })),
    };
  };

  const journalEntries = (d.journalEntries ?? []).map((r: Row) =>
    withContentLinks(remapEntry(r, ['content'], [], [], 'journal'))
  );
  const wikiArticles = remapCategoryIds((d.wikiArticles ?? []).map((r: Row) =>
    withContentLinks(remapEntry(r, ['content', 'icon', 'cover_image'], [], [], 'wiki'))
  ), catMap);
  const mergeStatus = await statusDefinitionForImport(db, d.blockDefinitions);
  const mergeOps = convertLegacyStatusRows(remapCategoryIds((d.operations ?? []).map((r: Row) =>
    withContentLinks(remapEntry(r, IMAGE_FIELDS_OP, ['charging_technique_wiki_id'], [], 'operation'))
  ), catMap), i18n.t, nowIso(), mergeStatus);
  const operations = await liftLegacySigilRows(mergeOps.rows, wikiArticles, backup);
  const altars = (d.altars ?? []).map((r: Row) => {
    // The same three columns as in doReplace. As long as thumbnail_data and
    // icon_data hold data URLs, the difference is harmless — but the
    // export collects both as soon as they carry a file name, and then
    // merge would be the variant that does not carry it along.
    const row = remapEntry(r, ['background_image_data', 'thumbnail_data', 'icon_data'], [], []);
    // Drawn shapes and text get new ids like the placements: ids are unique across all altars.
    return r.elements === undefined ? row : { ...row, elements: withNewElementIds(r.elements, String(row.id)) };
  });
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

  // Categories and tags are already resolved (resolveImportedCategories,
  // importTagsAndRemap above).
  // Without prefix, so that a block arriving twice stays one.
  // Link defaults point to the renamed entries, like the chips in the content.
  await insertBlockDefinitions(db, await withStatusDefinition(
    db, remapDefinitionRows(d.blockDefinitions, pathMap, (t) => ({ id: String(remapId(t.id)), label: t.label })),
    mergeOps.definition, mergeStatus,
  ));
  // Without prefix, like the definitions.
  await insertTemplates(db, d.templates, pathMap, catMap,
    (content) => remapInternalLinks(content, (link) => ({ id: String(remapId(link.id)) })));
  // Without prefix like the two above: a language stands on its own, its ID
  // appears in no entry.
  await insertLexicon(db, d.languages, d.lexiconEntries);
  // By file, like the replace: a picture that is already here stays as it is.
  await insertVaultImages(db, d.vaultImages, pathMap);
  // The same for own symbols: an element on an altar keeps its own copy of the path.
  await insertSymbols(db, d.symbols);

  // Content: plain INSERT with prefixed IDs (no conflicts possible)
  await insertRows(db, 'entries', entryRowsForInsert(journalEntries, wikiArticles, operations));
  await insertTasks(db, tasks);
  await insertRows(db, 'task_links', taskLinks, true);
  await importAltars(db, altars, altarItems, altarPlacements, false);

  // Imported task_links can point to targets that the type filter
  // has just deselected — sweep them out as in doReplace.
  await sweepDanglingTaskLinks(db);
  await dropUnknownTagIds(db);
  await clearLegacyUntitledTitles(db);
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
const CONTENT_TYPE_LABELS: Record<keyof ImportTypeFilters, string> = {
  includeJournal: 'settings.includeJournal',
  includeWiki: 'settings.includeWiki',
  includeOperations: 'settings.includeOperations',
  includeTasks: 'settings.includeTasks',
  includeTags: 'settings.includeTags',
  includeLexicon: 'settings.includeLexicon',
};

/** The same kinds as a list — the order of the packing lists. */
export const CONTENT_TYPES: readonly [keyof ImportTypeFilters, string][] =
  (Object.keys(CONTENT_TYPE_LABELS) as (keyof ImportTypeFilters)[]).map((key) => [key, CONTENT_TYPE_LABELS[key]]);

/** Everything included — the default of the import filter and its reset value. */
export function allTypesIncluded(): ImportTypeFilters {
  const filters = {} as ImportTypeFilters;
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

    // 3. Switch to it (resets DB cache + runs migrations on new empty DB)
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
    // The fresh vault has just created the sigil template itself. If
    // the file carries its templates along (from '8' — routines of older files do not
    // count, they do not know the sigil template), its version applies — including that the
    // template was changed or deleted there. Otherwise the fresh
    // row would displace the brought-along one, assignments and all.
    const types = typeFilters ?? ALL_TYPES_INCLUDED;
    const bringsTemplates = (backup.sourceVersion ?? Number(BACKUP_VERSION)) >= 8 && Array.isArray(backup.data.templates);
    // Via the working copy as with replace: an abort leaves the new vault empty rather than half filled.
    await importViaStaging(db, async (staging) => {
      if (bringsTemplates && (types.includeJournal || types.includeWiki || types.includeOperations)) {
        await staging.execute('DELETE FROM templates WHERE id=$1', [SIGIL_TEMPLATE_ID]);
        // The altar template is known from '13' on; an older file keeps the fresh one.
        if ((backup.sourceVersion ?? Number(BACKUP_VERSION)) >= 13) {
          await staging.execute('DELETE FROM templates WHERE id=$1', [ALTAR_TEMPLATE_ID]);
        }
      }
      await doReplace(staging, filteredBackup);
    });
    // Only once the import went through, as with replace and merge below.
    if (backupThemes) useDeviceStore.getState().adoptCustomThemes(backupThemes);
  } else {
    // Never directly against the vault: `doReplace` deletes before it inserts, and
    // an aborted merge would leave half-imported data behind (see `importStaging.ts`).
    const run = mode === 'replace' ? doReplace : doMerge;
    await importViaStaging(await getDb(), async (staging) => {
      await run(staging, filteredBackup);
    });

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
