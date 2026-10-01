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
import type { EntryType, Language } from '../types';
import {
  routineLinkResolver, routineToTemplate, vaultRoutineLinkSource, type RoutineCategoryRow, type RoutineTargetRow,
} from './migrateRoutinesToTemplates';
import {
  assignedCategoryId, assignmentKey, defaultKeys, isTemplateId, parseAssignments, SIGIL_TEMPLATE_ID, templateToRow,
} from './blocks/templates';
import { fromRow } from './row';
import { needsSigilConversion, sigilRowToContent, type LegacySigilRow } from './migrateLegacySigils';
import { linkedIdsToContent, rowsLinkSource } from './migrateLinkedIdsToContent';
import { journalFieldsToContent } from './migrateJournalFieldsToContent';
import { IMAGE_FIELDS, imageColumns } from './schema';
import { ALTAR_SETTING_KEYS, altarSettingsJson } from './altarSettings';
import { isTagId, rewriteTagRefs, stripTagIds, tagIdList, tagNameKey, tagNameResolver, type LegacyTagRow } from './tagRefs';
import { randomTagColor } from '../store/tagStore';
import { categoryKey, mergeCategoryRows, type CategorySource } from './categoryMerge';
import { legacyDisplayName, type LegacyCategoryTable } from './categories';
import i18n from '../i18n';
import { generateId, isValidHexColor, nowIso } from './helpers';
import { useVaultStore } from '../store/vaultStore';
import { VAULT_KEY_CANCELLED } from '../store/vaultKeyStore';
import { keyErrorOf } from './vaultKeys';
import { reloadAllStores } from '../store/moduleWiring';
import { useUIStore } from '../store/uiStore';
import { clearAllDrafts, flushDrafts } from '../store/draftStore';
import { clearAltarEdits } from '../store/altarEdit';
import { resumeEditorSaves, suspendEditorSaves } from './editorLock';
import { drainSerialized } from './serialize';
import { importViaStaging } from './importStaging';
import { importableSettings, isPlainObject, withSettingsGroups, writeVaultSettings, type SettingsGroup } from './vaultSettings';
import { useSettingsStore } from '../store/settingsStore';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface BackupOptions {
  includeJournal: boolean;
  includeWiki: boolean;
  includeOperations: boolean;
  includeAltars: boolean;
  includeTasks: boolean;
  includeTags: boolean;
  /** Die Sprachen des Lexikons samt ihren Vokabeln — ganz, ohne Datumsfrage. */
  includeLexicon: boolean;
  dateFrom: string;       // ISO date string, '' = no lower bound
  dateTo: string;         // ISO date string, '' = no upper bound
  includeDeleted: boolean;
  /** Die `settings.json` des Vaults. Fehlt in Dateien von vor den Vault-Einstellungen. */
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
  opsCount: number;
  /** Vorlagen samt der Routinen älterer Dateien, die als Vorlagen ankommen. */
  templatesCount: number;
  altarsCount: number;
  /** Eigener Zähler: die Bibliothek reist unabhängig von den Altären, eine
   *  Datei kann null Altäre und trotzdem Elemente tragen. */
  altarItemsCount: number;
  taskCount: number;
  /** Die Sprachen des Lexikons; ihre Vokabeln reisen mit ihnen. */
  languagesCount: number;
  /** Nur Kategorien, auf die ein Inhalt der Sicherung zeigt. */
  categories: BackupCategoryEntry[];
  /** Ob die Datei Vault-Einstellungen mitbringt. */
  hasSettings: boolean;
}

/** Which top-level content types to import. */
export interface ImportTypeFilters {
  includeJournal: boolean;
  includeWiki: boolean;
  includeOperations: boolean;
  includeAltars: boolean;
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
 * '1' = vor der Schema-Vereinheitlichung (`wiki_articles.category`,
 * `altar_items.category` mit dem Kategorie-*Namen*), '2' = danach, '3' = seit
 * Bilder als Dateiname statt als absoluter Pfad referenziert werden, '4' =
 * seit v38 eine Tabelle `categories` die vier Modul-Tabellen ersetzt
 * (`data.categories` statt `wikiCategories`/`operationCategories`/
 * `taskCategories`/`altarCategories`), '5' = seit v39 `category_id` NULL sein
 * darf, '6' = seit v40 reisen die eigenen Blöcke als `data.blockDefinitions`
 * mit, '7' = seit v42 tragen Operationen ihre Sigille als Blöcke im Inhalt
 * statt in eigenen Spalten, '8' = seit v43 reisen die Vorlagen als
 * `data.templates` mit, '9' = seit v45 das Lexikon als `data.languages` und
 * `data.lexiconEntries`, '10' = seit v46 tragen Altäre `deleted_at`, '11' =
 * seit v49 stehen Journal, Wiki und Operationen als `data.entries` in einem
 * Array, jede Zeile mit `type` und ohne die Spalten, die es nicht mehr gibt,
 * '12' = seit v51 tragen Altäre ihre Darstellung als JSON-Spalte `settings`,
 * seit v52 Altar-Elemente `updated_at`/`deleted_at` und seit v53 Einträge und
 * Vorlagen Tag-IDs statt Tag-Namen.
 *
 * Die '12' braucht es, weil ein älterer Build die zwölf Einzelspalten sucht:
 * `insertRows` ließe `settings` fallen, und jeder Altar käme mit den
 * Standardwerten an. Mit der '12' lehnt er die Datei ab.
 *
 * Die '11' braucht es, weil ein älterer Build die Einträge unter
 * `journalEntries`/`wikiArticles`/`operations` sucht: er fände dort nichts und
 * übernähme sie still nicht. Mit der '11' lehnt er die Datei ab
 * (`version > BACKUP_VERSION`), bevor irgendetwas passiert.
 *
 * Auch die '10' ist kein Formalismus: ein Build von vor v46 kennt die Spalte
 * nicht, `insertRows` ließe sie fallen — und ein Altar aus dem Papierkorb
 * käme dort als lebender zurück. Lieber lehnt er die Datei ab.
 *
 * Die '5' ist kein Formalismus: Eine so geschriebene Datei enthält Einträge
 * ohne Kategorie, und ein Build von vor v39 hat dort noch eine NOT-NULL-Spalte.
 * Ohne die Erhöhung liefe er in einen Constraint-Fehler mitten im Import —
 * nach den Löschungen des Replace-Modus, ohne Transaktion. Mit ihr weist die
 * Prüfung „neuer als ich" (`backup.version > BACKUP_VERSION`) die Datei ehrlich
 * ab, bevor irgendetwas passiert.
 */
const BACKUP_VERSION = '12' as const;

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
  // Operationen wandelt der Import vor dem Einfügen um (`liftLegacySigilRows`),
  // die alten Journal-Felder ebenso (`liftLegacyJournalRows`).

  // v7 → v8 braucht keinen Schritt: neu ist nur das Array `templates`.
  // v8 → v9 ebenso wenig: neu sind nur `languages`/`lexiconEntries`, und eine
  // ältere Datei bringt eben kein Lexikon mit.
  // v9 → v10 auch nicht: Altäre ohne `deleted_at` sind lebende Altäre.

  // v10 → v11 ist umgekehrt: die Datei hat die drei Listen schon, erst eine
  // '11' bringt `entries` mit, und das teilt sich hier nach Typ. Eine Zeile
  // mit unbekanntem Typ fällt weg — in `entries` gäbe es für sie kein Modul.
  if (version >= 11) splitEntries(data);

  // v11 → v12: die Einzelspalten der Altäre werden `settings`, und
  // Altar-Elemente bekommen ein `updated_at`.
  if (version < 12) {
    for (const row of data.altars ?? []) {
      row.settings = altarSettingsJson(row);
      for (const key of ALTAR_SETTING_KEYS) delete row[key];
    }
    for (const row of data.altarItems ?? []) row.updated_at ??= row.created_at;
    tagNamesToIds(data);
  }

  // Routinen (Dateien von vor v44) bleiben hier liegen: sie werden erst beim
  // Import Vorlagen (`withRoutinesAsTemplates`), nach den Filtern — sonst
  // zeigten ihre Links auf Einträge, die gar nicht mitkommen.
  backup.sourceVersion = version;
  backup.version = BACKUP_VERSION;
}

/**
 * Tag-Namen einer Datei bis Format 11 werden Tag-IDs — dieselbe Regel wie
 * Migration v53 (`tagNameResolver`): Namen ohne Tag bekommen einen neuen in
 * `data.tags`, ein Tag im Papierkorb kommt zurück in die Zeilen, die er beim
 * Löschen verlor. Auch die Routinen, die erst beim Import Vorlagen werden.
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

/** Höchstlänge eines Tag-Namens aus fremder Quelle. */
const TAG_NAME_MAX = 100;

/**
 * Schreibt die Tags einer Sicherung in den Vault und hängt die Zeilen der
 * Datei auf lokale IDs um — beim Ersetzen wie beim Zusammenführen. Ein Tag mit
 * derselben ID ist derselbe; sonst gehört ein Name einem Tag (`tagNameKey`):
 * ein gleichnamiger lokaler wird benutzt — liegt er im Papierkorb und der aus
 * der Datei nicht, kommt er zurück, wie beim Eintippen ohne die Einträge, die
 * ihn noch trugen (`tagStore`). Was bleibt, kommt mit seiner ID dazu. Eine ID
 * ohne Tag in der Datei (Tags abgewählt) bleibt, wenn es den Tag hier gibt —
 * sonst fällt sie aus der Zeile.
 * Läuft in der Arbeitskopie (`importViaStaging`): scheitert der Import danach,
 * bleibt auch von den Tags nichts.
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
  };
}

/** Nach dem Import: Tag-IDs ohne Tag-Zeile fallen aus jeder Liste. */
export async function dropUnknownTagIds(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM tags')).map((r) => r.id));
  await rewriteTagRefs(db, (ids) => ids.filter((id) => known.has(id)));
}

/** Teilt `data.entries` (Datei ab '11') in die Listen, mit denen der Import arbeitet. */
function splitEntries(data: BackupFile['data']): void {
  const rows = Array.isArray(data.entries) ? data.entries : [];
  const ofType = (type: EntryType) => rows.filter((r) => r?.type === type);
  data.journalEntries = ofType('journal');
  data.wikiArticles = ofType('wiki');
  data.operations = ofType('operation');
  delete data.entries;
}

/**
 * Die Spalten von `entries` außer `type`. Jede Zeile bekommt alle: `insertRows`
 * nimmt die Spaltenliste aus der ersten Zeile, und ein Journal-Eintrag vorne
 * nähme den Wiki-Artikeln dahinter sonst Kategorie, Icon und Titelbild. Was
 * die alten Tabellen mehr hatten (`slug`, `moon_phase`, tote Spalten), fällt
 * hier weg — die Umwandlungen davor haben gelesen, was sie brauchten.
 */
const ENTRY_COLUMNS = [
  'id', 'title', 'content', 'category_id', 'entry_number', 'icon', 'cover_image',
  'tags', 'created_at', 'updated_at', 'deleted_at',
] as const;

/**
 * Die Bildspalten einer Operationszeile beim Import: die von `entries` und die
 * Sigillen-Zeichnung alter Dateien — sie wird erst in `liftLegacySigilRows`
 * zur Datei und muss dafür schon den lokalen Namen tragen.
 */
const IMAGE_FIELDS_OP = [...imageColumns('entries'), 'drawing_data'];

function asEntryRow(type: EntryType, row: Row): Row {
  const out: Row = { type };
  for (const column of ENTRY_COLUMNS) out[column] = row[column] ?? null;
  out.title ??= '';
  out.content ??= '';
  out.tags ??= '[]';
  // Das Journal hat keine Kategorie, kein Icon und kein Titelbild.
  if (type === 'journal') out.category_id = out.icon = out.cover_image = null;
  return out;
}

/**
 * Die Eintragszeilen des Imports für `entries`. Eine ID kommt nur einmal an:
 * eine Sicherung bis '10' kann denselben Eintrag in zwei Listen tragen (ein
 * Typwechsel, der mittendrin abbrach) — wie in v49 gewinnt die erste, in der
 * Reihenfolge Journal, Wiki, Operationen.
 */
export function entryRowsForInsert(journal: Row[], wiki: Row[], operations: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const [type, rows] of [['journal', journal], ['wiki', wiki], ['operation', operations]] as const) {
    for (const row of rows) {
      const id = String(row.id);
      if (seen.has(id)) {
        console.warn(`[backup] ${type}.${id} steht in der Datei schon unter einem anderen Typ — übersprungen`);
        continue;
      }
      seen.add(id);
      out.push(asEntryRow(type, row));
    }
  }
  return out;
}

/** Die Eintragstypen, die eine Sicherung mitbringt — nur deren Einträge ersetzt `doReplace`. */
function presentEntryTypes(d: BackupFile['data']): EntryType[] {
  return ([
    ['journal', d.journalEntries],
    ['wiki', d.wikiArticles],
    ['operation', d.operations],
  ] as const).filter(([, rows]) => (rows?.length ?? 0) > 0).map(([type]) => type);
}

interface BackupFile {
  version: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12';
  /** Die Version, mit der die Datei geschrieben wurde — `migrateBackupPayload` setzt `version` auf die aktuelle. */
  sourceVersion?: number;
  type: 'backup';
  exportedAt: string;
  filters: BackupOptions;
  data: {
    /**
     * In der Datei (seit '11'): Journal, Wiki und Operationen wie in der
     * Tabelle `entries`. `migrateBackupPayload` teilt sie in die drei Listen
     * darunter — der Import behandelt jeden Typ anders (Kategorien, Status,
     * Sigillen, alte Journal-Felder).
     */
    entries?: Row[];
    /** Im Import: die Einträge je Typ. In Dateien bis '10' standen sie so auch in der Datei. */
    journalEntries?: Row[];
    wikiArticles?: Row[];
    operations?: Row[];
    /** Die globale Liste; dabei, sobald eines der vier kategorisierten Module dabei ist. */
    categories?: Row[];
    /** Die eigenen Blöcke (seit '5'); dabei, sobald Journal, Wiki oder Operationen dabei sind. */
    blockDefinitions?: Row[];
    /** Die Vorlagen (seit '8'); dabei, sobald Journal, Wiki oder Operationen dabei sind. */
    templates?: Row[];
    tags?: Row[];
    /** Nur in Dateien von vor v44: die Routinen — der Import macht Vorlagen daraus (`withRoutinesAsTemplates`). */
    routines?: Row[];
    altars?: Row[];
    altarItems?: Row[];
    altarPlacements?: Row[];
    tasks?: Row[];
    taskLinks?: Row[];
    // Bis zum Schema v46 stand hier noch `links`, ein Spiegel der Link-Chips,
    // den nichts las. Alte Dateien tragen ihn weiter; der Import übergeht ihn.
    /** Die Sprachen des Lexikons (seit '9'). */
    languages?: Row[];
    /** Ihre Vokabeln (seit '9') — ohne ihre Sprache wertlos, deshalb immer zusammen. */
    lexiconEntries?: Row[];
  };
  images: Record<string, string>;  // gespeicherter Dateiname → data-URL (in v1/v2: absoluter Pfad)
  /**
   * Die Einstellungen des Vaults (`settings.json`), ungeprüft wie alles aus
   * der Datei — normalisiert wird erst beim Import. Braucht keine neue
   * Version: ein älterer Build übergeht das Feld einfach.
   */
  settings?: unknown;
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

  // ── Journal, Wiki, Operationen ───────────────────────────────────────────
  // Eine Tabelle, ein Array — die Auswahl entscheidet, welche Typen mitkommen.
  // Die Typen stehen literal im SQL (keine Nutzereingabe).
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

  // ── Altars ───────────────────────────────────────────────────────────────
  if (options.includeAltars) {
    data.altars = await db.select<Row[]>(
      `SELECT * FROM altars WHERE 1=1 ${dateClause} ${deletedClause}`,
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
    // Elemente im Papierkorb nur, wenn der Papierkorb mitkommt — wie alles andere.
    data.altarItems = await db.select<Row[]>(`SELECT * FROM altar_items WHERE 1=1 ${deletedClause}`);
    // Platzierungen bleiben an ihre Altäre gebunden — ohne Altar kein Ort —
    // und an ihr Element: ohne es scheiterte das Einfügen am Fremdschlüssel.
    const exportedItems = new Set(data.altarItems.map((r) => String(r.id)));
    data.altarPlacements = data.altars.length
      ? (await selectWhereIn(
          db,
          (ph) => `SELECT * FROM altar_placements WHERE altar_id IN (${ph})`,
          data.altars,
        )).filter((p) => exportedItems.has(String(p.item_id)))
      : [];
    collectImageRefs('altars', data.altars, allImagePaths);
    collectImageRefs('altar_items', data.altarItems, allImagePaths);
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  // Mit dem Papierkorb auch die Tags darin: Einträge tragen ihre IDs weiter.
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

  // ── Kategorien ───────────────────────────────────────────────────────────
  // Die eine Liste, sobald ein kategorisiertes Modul dabei ist. Auch
  // soft-geloeschte Kategorien: ihre Inhalte werden mitexportiert und
  // brauchen ihr Gegenstueck, sonst scheitert der Import am Foreign Key.
  // Auch mit Journal allein: die Vorlagen reisen dann mit, und ihre Zuweisungen brauchen die Kategorien.
  if (
    options.includeJournal || options.includeWiki || options.includeOperations || options.includeTasks || options.includeAltars
  ) {
    data.categories = await db.select<Row[]>(`SELECT * FROM categories`);
  }

  // ── Eigene Blöcke ────────────────────────────────────────────────────────
  // Die Vorlagen der Kopien im Inhalt. Die Kopien kommen ohne sie aus, aber
  // ohne Definition gibt es kein „Aktualisieren" mehr. Ganz, samt Papierkorb —
  // eine Liste, keine Datumsfrage.
  if (options.includeJournal || options.includeWiki || options.includeOperations) {
    data.blockDefinitions = await db.select<Row[]>(`SELECT * FROM block_definitions`);
    // Die Bild-Vorgaben reisen mit, auch wenn noch keine Kopie sie benutzt.
    for (const row of data.blockDefinitions) {
      definitionImageRefs(parseDefinitionElements(row.elements)).forEach((ref) => allImagePaths.add(ref));
    }
  }

  // ── Vorlagen ─────────────────────────────────────────────────────────────
  // Wie die eigenen Blöcke: ganz, samt Papierkorb, mit den Bildern im Blockstapel.
  if (options.includeJournal || options.includeWiki || options.includeOperations) {
    data.templates = await db.select<Row[]>(`SELECT * FROM templates`);
    for (const row of data.templates) {
      if (typeof row.content === 'string') imageRefsInHtml(row.content).forEach((ref) => allImagePaths.add(ref));
    }
  }

  // ── Lexikon ──────────────────────────────────────────────────────────────
  // Sprachen und Vokabeln reisen zusammen und ganz, samt Papierkorb: es ist
  // eine Liste, keine Datumsfrage — wie die eigenen Blöcke und die Vorlagen.
  // Icons liegen als Data-URL in der Zeile, es hängt also keine Bilddatei dran.
  if (options.includeLexicon) {
    data.languages = await db.select<Row[]>(`SELECT * FROM languages`);
    data.lexiconEntries = await db.select<Row[]>(`SELECT * FROM lexicon_entries`);
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
    ...(options.includeSettings && { settings: useSettingsStore.getState().settings }),
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
    opsCount: backup.data.operations?.length ?? 0,
    templatesCount: (backup.data.templates?.length ?? 0) + (backup.data.routines?.length ?? 0),
    altarsCount: backup.data.altars?.length ?? 0,
    altarItemsCount: backup.data.altarItems?.length ?? 0,
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

/** Die Vorgaben mitgebrachter Definitionen auf die hier gespeicherten Bilder (und beim Merge die neuen IDs) umschreiben. */
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

/** Die Kategorie-IDs, denen Vorlagen einer Sicherung zugewiesen sind. */
function templateCategoryIds(rows: Row[] | undefined): string[] {
  return (rows ?? []).flatMap((r) => parseAssignments(r.assignments).map(assignedCategoryId))
    .filter((id): id is string => id !== null);
}

/**
 * Die Vorlagen einer Sicherung: nach ID, `INSERT OR IGNORE` wie die eigenen
 * Blöcke — eine vorhandene Vorlage (auch im Papierkorb, auch die eingebaute
 * Sigillen-Vorlage) bleibt, wie sie ist, gelöscht wird keine. Neue kommen in
 * ihrer Reihenfolge ans Ende der Liste.
 *
 * Die Datei ist fremd: jede Zeile läuft durch `fromRow.template` wie beim
 * Lesen. `content` bekommt die hier gespeicherten Bilder (und beim Merge die
 * umbenannten Link-Ziele), die Zuweisungen die lokalen Kategorie-IDs — was
 * auf keine Kategorie zeigt, fällt weg. Einen Standard, den hier schon eine
 * aktive Vorlage hält, verliert eine aktive importierte; eine aus dem
 * Papierkorb behält ihn wie im Store und klärt das beim Wiederherstellen.
 */
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
  const taken = new Set(local.filter((t) => t.deleted_at === null).flatMap((t) => [...defaultKeys(t.assignments)]));
  const categories = new Set((await db.select<Row[]>('SELECT id FROM categories')).map((r) => String(r.id)));

  const now = nowIso();
  const fresh = rows
    .filter((r): r is Row => typeof r === 'object' && r !== null && isTemplateId((r as Row).id))
    .map((r) => fromRow.template(r))
    .sort((a, b) => a.sort_order - b.sort_order)
    // Eine ID, die schon da ist — auch eine zweite Zeile derselben ID in der Datei — kommt nicht hinein.
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
    const assignments = remapped.map((a) => {
      const key = assignmentKey(a.entryType, a.category);
      if (!a.isDefault || !active) return a;
      if (taken.has(key)) return { ...a, isDefault: false };
      taken.add(key);
      return a;
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
 * Das Lexikon einer Sicherung: nach ID, `INSERT OR IGNORE` wie die eigenen
 * Blöcke und die Vorlagen — eine Sprache, die es hier schon gibt (auch im
 * Papierkorb), bleibt, wie sie ist; gelöscht wird keine, auch nicht beim
 * Ersetzen. Neue kommen in ihrer Reihenfolge ans Ende der Liste.
 *
 * Die Vokabeln danach, und nur die zu einer Sprache, die es hier wirklich
 * gibt: `lexicon_entries.language_id` trägt einen Fremdschlüssel, eine Vokabel
 * ohne ihre Sprache brächte den ganzen Import zum Scheitern. Zu einer schon
 * vorhandenen Sprache **kommen** die mitgebrachten Vokabeln also hinzu; sie
 * bekommen dabei neue Plätze am Ende ihrer Liste, sonst säßen zwei Wörter auf
 * derselben `sort_order` und die Reihenfolge wäre Zufall.
 *
 * Die Datei ist fremd: jede Zeile läuft durch `fromRow.*` wie beim Lesen, und
 * was keine ID hat, fällt weg.
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
    // Eine ID, die schon da ist — auch eine zweite Zeile derselben ID in der Datei — kommt nicht hinein.
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

  // `known` hält jetzt genau die Sprachen dieses Vaults: die vorgefundenen und
  // die gerade eingefügten. Ein zweites SELECT bräuchte es dafür nicht.
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
 * Journal (v36/v37): verknüpfte Operationen und Artikel, Paradigma, Bannung
 * und Meditation einer älteren Sicherung werden Link-Blöcke im Inhalt — vor
 * dem Einfügen, denn seit v49 gibt es die alten Spalten nicht mehr (die
 * übrigen fallen in `asEntryRows` weg). Die Ziele stehen in der Datei oder,
 * wenn der Import sie abgewählt hat, womöglich schon im Vault; die Datei hat
 * Vorrang. Der Merge benennt die Chips danach mit allen anderen um — ein Ziel
 * aus dem Vault behält dabei seine ID.
 *
 * Status/Enddatum/Version (v41) wandelt `convertLegacyStatusRows` je Modus um —
 * es braucht die „Status"-Definition des Ziel-Vaults.
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
  // Später gewinnt: erst der Vault, dann die Datei.
  const source = rowsLinkSource(
    {
      operation: [...vaultTargets.filter((r) => r.type === 'operation'), ...(d.operations ?? [])],
      wiki: [...vaultTargets.filter((r) => r.type === 'wiki'), ...(d.wikiArticles ?? [])],
    },
    [...vaultCategories, ...(d.categories ?? [])],
  );
  const journalEntries = d.journalEntries.map((row) => {
    const linked = linkedIdsToContent(String(row.content ?? ''), { id: String(row.id), ...row }, source);
    // Kaputtes JSON in den verknüpften IDs: die Zeile bleibt wie in v36 unberührt.
    if (linked === null) return row;
    const content = journalFieldsToContent(linked, row, source);
    return content === row.content ? row : { ...row, content };
  });
  return { ...d, journalEntries };
}

/**
 * Operationen (v42): Sigillen-Spalten werden Blöcke — nach der Status-
 * Umwandlung, damit die Blöcke in derselben Reihenfolge stehen wie nach den
 * Migrationen v41 und v42. `operations` und `wikiArticles` sind die Zeilen des
 * Modus, also schon umbenannt (Merge) und mit lokalen Bildnamen. Leere
 * Operationen der Kategorie „Sigillen" bekommen das Set nur aus Dateien vor
 * Version 7: in einer neueren hat der Nutzer die Blöcke womöglich bewusst
 * entfernt.
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
    // Anders als die Migration kann der Import nicht später nachholen — nach
    // v49 gibt es keine Spalte, in der die Zeichnung warten könnte.
    if (content === undefined) throw new Error(`Sigil drawing of operation ${String(row.id)} could not be saved`);
    out.push({ ...row, content });
  }

  return out;
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
  const anyCategorized = f.includeWiki || f.includeOperations || f.includeTasks || f.includeAltars;
  const anyBlocks = f.includeJournal || f.includeWiki || f.includeOperations;
  return {
    ...d,
    blockDefinitions:   anyBlocks           ? d.blockDefinitions  : [],
    templates:          anyBlocks           ? d.templates         : [],
    routines:           anyBlocks           ? d.routines          : [],
    journalEntries:     f.includeJournal    ? d.journalEntries    : [],
    wikiArticles:       f.includeWiki       ? d.wikiArticles      : [],
    operations:         f.includeOperations ? d.operations        : [],
    // Vorlagen (mit `anyBlocks`) brauchen die Kategorien ihrer Zuweisungen; `usedCategoryRows` grenzt ein.
    categories:         anyCategorized || anyBlocks ? d.categories : [],
    altars:             f.includeAltars     ? d.altars            : [],
    altarItems:         f.includeAltars     ? d.altarItems        : [],
    altarPlacements:    f.includeAltars     ? d.altarPlacements   : [],
    tasks:              f.includeTasks      ? d.tasks             : [],
    taskLinks:          f.includeTasks      ? d.taskLinks         : [],
    tags:               f.includeTags       ? d.tags              : [],
    languages:          f.includeLexicon    ? d.languages         : [],
    lexiconEntries:     f.includeLexicon    ? d.lexiconEntries    : [],
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
  // Gibt es denselben Namen aktiv und im Papierkorb (ein Vault von vor der
  // Namensregel), gilt der aktive: die späteren Einträge der Map gewinnen.
  const byLiveLast = [...local].sort((a, b) => Number(!a.deleted_at) - Number(!b.deleted_at));
  const localByKey = new Map(byLiveLast.map((r) => [categoryKey(String(r.name)), r]));
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
  // Auch die Kategorien, denen eine Vorlage zugewiesen ist — sonst verlöre sie die Zuweisung.
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
 * Prüft, ob jede Kategorie-Referenz der Nutzlast auflösbar ist — entweder aus
 * der Sicherung selbst oder aus dem Bestand des Ziel-Vaults.
 *
 * Läuft **vor** dem ersten DELETE. Ohne diese Vorprüfung würde eine Sicherung
 * mit einer unauflösbaren Kategorie erst beim INSERT am Foreign Key scheitern —
 * der Vault bliebe dank der Arbeitskopie (`importStaging.ts`) zwar unberührt,
 * aber die Meldung sagte nicht, welche Kategorie fehlt.
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

/**
 * Die Routinen einer älteren Sicherung als Vorlagen — derselbe Weg wie
 * Migration v44, aber erst jetzt, nach den Typ- und Kategorie-Filtern: ein
 * Link-Ziel muss mitkommen (aus der Datei) oder schon da sein (im Vault),
 * sonst fällt der Chip weg. Neue Vorlagen kommen hinter die der Datei. Beim
 * Merge zieht `insertTemplates` die Chips danach auf die umbenannten IDs.
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

async function doReplace(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile): Promise<void> {
  const pathMap = await restoreImages(backup);
  // Tags werden nicht ersetzt, sondern zusammengeführt: Einträge, die diese
  // Datei nicht ersetzt, tragen die IDs der vorhandenen.
  const d = await importTagsAndRemap(db, await liftLegacyJournalRows(db, await withRoutinesAsTemplates(db, backup.data)));

  await assertPayloadReferencesResolve(db, d);

  // Remap image paths — Spalten aus `IMAGE_FIELDS`, nicht von Hand gepflegt.
  const IMAGE_FIELDS_ENTRY = imageColumns('entries');
  const IMAGE_FIELDS_ALTAR = imageColumns('altars');
  const IMAGE_FIELDS_ITEM = imageColumns('altar_items');

  // Kategorien zuerst: Die Inhalte bekommen die lokalen IDs, bevor sie
  // eingefügt werden. Gelöscht wird bei Kategorien nie (siehe dort).
  const catMap = await resolveImportedCategories(db, usedCategoryRows(d));

  const journalEntries = (d.journalEntries ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ENTRY, pathMap));
  const wikiArticles = remapCategoryIds((d.wikiArticles ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ENTRY, pathMap)), catMap);
  // Sicherungen bis v40 tragen Status/Enddatum/Version noch in den Spalten.
  const replaceStatus = await statusDefinitionForImport(db, d.blockDefinitions);
  const replaceOps = convertLegacyStatusRows(
    remapCategoryIds((d.operations ?? []).map((r) => remapRow(r, IMAGE_FIELDS_OP, pathMap)), catMap),
    i18n.t, nowIso(), replaceStatus,
  );
  const operations = await liftLegacySigilRows(replaceOps.rows, wikiArticles, backup);
  const altars = (d.altars ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ALTAR, pathMap));
  const altarItems = remapCategoryIds((d.altarItems ?? []).map((r) => remapRow(r, IMAGE_FIELDS_ITEM, pathMap)), catMap);
  const tasks = remapCategoryIds(d.tasks ?? [], catMap);

  // Eigene Blöcke wie Kategorien: nie gelöscht, Fehlendes nach ID ergänzt,
  // Vorhandenes bleibt. `db` ist hier die Arbeitskopie (`importViaStaging`):
  // scheitert irgendetwas bis zum Ende, bleibt der Vault, wie er war.
  await insertBlockDefinitions(db, await withStatusDefinition(
    db, remapDefinitionRows(d.blockDefinitions, pathMap), replaceOps.definition, replaceStatus,
  ));
  await insertTemplates(db, d.templates, pathMap, catMap);
  // Wie die eigenen Blöcke und die Vorlagen: nie gelöscht, Fehlendes ergänzt.
  await insertLexicon(db, d.languages, d.lexiconEntries);

  // Delete only the content types present in the backup (so a partial backup
  // replacing only Journal data won't wipe wiki/ops).
  const entryTypes = presentEntryTypes(d);
  const hasAltars = (d.altars?.length ?? 0) > 0;
  const hasTasks = (d.tasks?.length ?? 0) > 0;

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
  for (const type of entryTypes) await db.execute('DELETE FROM entries WHERE type=$1', [type]);
  // Dazu jede importierte ID, welchen Typ sie im Vault inzwischen hat: ein
  // Eintrag, der seit der Sicherung sein Modul gewechselt hat, stünde sonst
  // doppelt da — und `entries.id` ist über alle Typen eindeutig.
  const entries = entryRowsForInsert(journalEntries, wikiArticles, operations);
  for (let i = 0; i < entries.length; i += IN_CHUNK) {
    const chunk = entries.slice(i, i + IN_CHUNK).map((r) => String(r.id));
    await db.execute(`DELETE FROM entries WHERE id IN (${chunk.map((_, n) => `$${n + 1}`).join(',')})`, chunk);
  }
  // Re-insert
  await insertRows(db, 'entries', entries);
  await insertRows(db, 'altars', altars);
  // OR IGNORE, wenn oben nicht geleert wurde: die Datei kann eine Bibliothek
  // ohne Altäre tragen (Datumsfilter, oder ein Vault, der nur Elemente hat),
  // und ein blanker INSERT liefe dann in den Primärschlüssel — und damit
  // brächte jede solche Datei den ganzen Restore zum Scheitern. Der Preis:
  // eine in der Datei geänderte Fassung eines vorhandenen Elements bleibt in
  // diesem einen Fall außen vor.
  const keepExistingLibrary = !hasAltars;
  await insertRows(db, 'altar_items', altarItems, keepExistingLibrary);
  if (d.altarPlacements) await insertRows(db, 'altar_placements', d.altarPlacements);
  await insertTasks(db, tasks);
  if (d.taskLinks) await insertRows(db, 'task_links', d.taskLinks);

  // Ein Teil-Replace (z. B. nur Tasks) kann Verknüpfungen des Bestands auf
  // gerade ersetzte Ziele verwaisen lassen — und importierte task_links
  // können auf abgewählte Typen zeigen. Gleicher Sweep wie beim Papierkorb.
  await sweepDanglingTaskLinks(db);
  await dropUnknownTagIds(db);
  // Eine Sicherung von vor v48 bringt die englischen Standardtitel mit.
  await clearLegacyUntitledTitles(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge import (ID-prefix strategy)
// ─────────────────────────────────────────────────────────────────────────────

async function doMerge(db: Awaited<ReturnType<typeof getDb>>, backup: BackupFile): Promise<void> {
  const pathMap = await restoreImages(backup);
  const d = await importTagsAndRemap(db, await liftLegacyJournalRows(db, await withRoutinesAsTemplates(db, backup.data)));

  // Merge loescht zwar nichts, bricht aber mitten im Einfuegen ab, wenn eine
  // Kategorie fehlt — vorher pruefen, damit die Meldung sagt, welche.
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
   * Seit v33 steht `entry_number` wirklich in der Datenbank, statt beim Lesen
   * aus der ROWID erzeugt zu werden. Beim Merge muessen die Nummern deshalb
   * hinter den Bestand geschoben werden — sonst zeigen zwei Eintraege dieselbe
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
   * Die Ziel-IDs der internen Link-Chips IM `content` mitziehen. `remapEntry`
   * behandelt `content` nur als Bildpfad-Feld; die `data-id`-Attribute darin
   * blieben sonst auf den alten, hier umbenannten IDs stehen, und jeder
   * Link-Chip zeigte ins Leere.
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

  // Kategorien und Tags sind schon aufgelöst (resolveImportedCategories,
  // importTagsAndRemap oben).
  // Ohne Präfix: die Kopien im Inhalt nennen ihre Definition über genau diese ID.
  // Link-Vorgaben zeigen wie die Chips im Inhalt auf die umbenannten Einträge.
  await insertBlockDefinitions(db, await withStatusDefinition(
    db, remapDefinitionRows(d.blockDefinitions, pathMap, (t) => ({ id: String(remapId(t.id)), label: t.label })),
    mergeOps.definition, mergeStatus,
  ));
  // Ohne Präfix wie die Definitionen: `data-template-origin` in den Einträgen nennt genau diese ID.
  await insertTemplates(db, d.templates, pathMap, catMap,
    (content) => remapInternalLinks(content, (link) => ({ id: String(remapId(link.id)) })));
  // Ohne Präfix wie die beiden darüber: eine Sprache ist für sich, ihre ID
  // taucht in keinem Eintrag auf.
  await insertLexicon(db, d.languages, d.lexiconEntries);

  // Content: plain INSERT with prefixed IDs (no conflicts possible)
  await insertRows(db, 'entries', entryRowsForInsert(journalEntries, wikiArticles, operations));
  await insertRows(db, 'altars', altars);
  await insertRows(db, 'altar_items', altarItems);
  await insertRows(db, 'altar_placements', altarPlacements);
  await insertTasks(db, tasks);
  await insertRows(db, 'task_links', taskLinks, true);

  // Importierte task_links können auf Ziele zeigen, die der Typ-Filter
  // gerade abgewählt hat — wie in doReplace ausfegen.
  await sweepDanglingTaskLinks(db);
  await dropUnknownTagIds(db);
  await clearLegacyUntitledTitles(db);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public import entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Die Inhaltsarten der Sicherung und ihre Beschriftung. Record statt Liste,
 * wie bei den Einstellungs-Gruppen im Einstellungs-Fenster: eine neue Art ohne
 * Beschriftung ist ein Typfehler, kein vergessener Eintrag.
 *
 * Eine Wahrheit für vier Stellen, die vorher dieselbe Liste einzeln führten:
 * die beiden Packlisten im Einstellungs-Fenster (Export und Import), der
 * Anfangs- und Rückstell-Wert des Import-Filters und `ALL_TYPES_INCLUDED`
 * darunter. Eine Art, die dort vergessen wurde, war still von jedem
 * „alles importieren" ausgenommen.
 */
const CONTENT_TYPE_LABELS: Record<keyof ImportTypeFilters, string> = {
  includeJournal: 'settings.includeJournal',
  includeWiki: 'settings.includeWiki',
  includeOperations: 'settings.includeOperations',
  includeAltars: 'settings.includeAltars',
  includeTasks: 'settings.includeTasks',
  includeTags: 'settings.includeTags',
  includeLexicon: 'settings.includeLexicon',
};

/** Dieselben Arten als Liste — die Reihenfolge der Packlisten. */
export const CONTENT_TYPES: readonly [keyof ImportTypeFilters, string][] =
  (Object.keys(CONTENT_TYPE_LABELS) as (keyof ImportTypeFilters)[]).map((key) => [key, CONTENT_TYPE_LABELS[key]]);

/** Alles dabei — der Standard des Import-Filters und sein Rückstell-Wert. */
export function allTypesIncluded(): ImportTypeFilters {
  const filters = {} as ImportTypeFilters;
  for (const [key] of CONTENT_TYPES) filters[key] = true;
  return filters;
}

const ALL_TYPES_INCLUDED: ImportTypeFilters = allTypesIncluded();

export async function importDatabase(
  backup: BackupFile,
  mode: ImportMode,
  /** Nur fuer `add-vault`: Name und — wenn der Nutzer einen gewaehlt hat —
   *  Zielordner des neuen Vaults. Ohne `path` greift der Rueckfall aus
   *  `newVaultRecord` (`{appDataDir}/vaults/{id}`). */
  newVault?: { name: string; path?: string },
  typeFilters?: ImportTypeFilters,
  /** Nur für `merge`: welche Einstellungs-Gruppen aus der Datei gelten sollen.
   *  replace und add-vault übernehmen die Einstellungen der Datei ganz. */
  settingsGroups: readonly SettingsGroup[] = [],
): Promise<void> {
  // Ungeprüft aus der Datei — ab hier nur noch in geprüfter Form.
  const backupSettings = importableSettings(backup.settings);

  // Fuer die Dauer des Imports sind die automatischen Editor-Saves gesperrt,
  // in allen drei Modi. replace behaelt die Original-IDs und add-vault wechselt
  // den Vault: ein offener Editor, den die Navigation dabei unmountet, wuerde
  // seinen VOR-Import-Stand ueber die frisch importierten Zeilen speichern.
  // Und jeder Modus tauscht am Ende die Arbeitskopie ein (`importStaging.ts`) —
  // was zwischen Kopie und Austausch im Vault gespeichert wird, ginge verloren.
  suspendEditorSaves();
  try {

  // Die Sperre stoppt nur künftige Saves — bereits eingereihte Store-Writes
  // erst zu Ende laufen lassen, bevor die Arbeitskopie gezogen wird.
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

    // Vor dem Wechsel in den Ordner: dann öffnet der neue Vault gleich mit
    // Sprache und Aussehen der Sicherung, statt erst mit den Standards.
    if (backupSettings) {
      // Nur Beiwerk: scheitert das Schreiben, startet der Vault mit den
      // Standards — der Import selbst soll daran nicht hängen bleiben.
      await writeVaultSettings(vaultId, backupSettings).catch((err) => {
        console.warn('[backup] could not write vault settings', err);
      });
    }

    // 3. Switch to it (resets DB cache + runs migrations on new empty DB)
    await useVaultStore.getState().loadVaults();
    // `editsResolved`: die Frage nach laufenden Bearbeitungen ist gestellt,
    // bevor der Import begann (`BackupPage`). Käme sie hier noch einmal und
    // hieße die Antwort „weiter bearbeiten", bliebe der alte Vault aktiv —
    // und Schritt 4 füllte ihn statt des neuen.
    // Bricht der Nutzer beim Passwort des neuen Vaults ab, ist der Import
    // abgebrochen — und der eben angelegte, leere Vault kommt wieder weg.
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
    // Der frische Vault hat die Sigillen-Vorlage gerade selbst angelegt. Trägt
    // die Datei ihre Vorlagen mit (ab '8' — Routinen älterer Dateien zählen
    // nicht, die kennen die Sigillen-Vorlage nicht), gilt deren Fassung — auch dass die
    // Vorlage dort geändert oder gelöscht war. Sonst verdrängte die frische
    // Zeile die mitgebrachte samt ihrem Stern.
    const types = typeFilters ?? ALL_TYPES_INCLUDED;
    const bringsTemplates = (backup.sourceVersion ?? Number(BACKUP_VERSION)) >= 8 && Array.isArray(backup.data.templates);
    // Über die Arbeitskopie wie beim Ersetzen: ein Abbruch lässt den neuen Vault leer statt halb gefüllt.
    await importViaStaging(db, async (staging) => {
      if (bringsTemplates && (types.includeJournal || types.includeWiki || types.includeOperations)) {
        await staging.execute('DELETE FROM templates WHERE id=$1', [SIGIL_TEMPLATE_ID]);
      }
      await doReplace(staging, filteredBackup);
    });
  } else {
    // Nie direkt gegen den Vault: `doReplace` löscht, bevor es einfügt, und
    // ein abgebrochener Merge ließe halb importierte Daten zurück (siehe `importStaging.ts`).
    const run = mode === 'replace' ? doReplace : doMerge;
    await importViaStaging(await getDb(), (staging) => run(staging, filteredBackup));

    // Erst nach geglücktem Austausch: ein abgebrochener Import lässt auch die
    // Einstellungen, wie sie waren.
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

  // replace tauscht die Zeilen unter den offenen Tabs weg — deren Eintrags-IDs
  // stammen aus dem Stand vor dem Import. merge behaelt bestehende Zeilen, da
  // bleiben die Tabs gueltig; add-vault laeuft ueber switchVault und raeumt dort.
  if (mode === 'replace') {
    useUIStore.getState().closeAllTabs();
    clearAltarEdits();
    clearAllDrafts();
    // Gleich aus der Datei, nicht erst nach der Verzögerung: ein alter Entwurf,
    // der einen Absturz überlebt, schriebe beim nächsten „Fertig" über das Eingespielte.
    await flushDrafts();
  }

  // Die globale Suche merkt sich den Klartext eines Eintrags unter (id,
  // updated_at). Beide Haelften stehen so in der Sicherungsdatei: eine Datei,
  // die ein Paar wiederverwendet und nur den Inhalt aendert, erbte sonst den
  // alten Text — der neue waere bis zum Neustart unauffindbar.
  clearSearchTextCache();
  clearEntrySummaryCache();

  await reloadAllStores();
  } finally {
    resumeEditorSaves();
  }
}

// Re-export BackupFile type for use in UI
export type { BackupFile };
