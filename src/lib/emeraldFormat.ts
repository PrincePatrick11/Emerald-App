import { invoke } from '@tauri-apps/api/core';
import { readImageAsBase64, saveImage } from './images';
import { isIconFile, plausibleEmoji } from './icons';
import { storedImageName, storedImageNamesIn } from './schema';
import { parseBlocks } from './blocks/blockHtml';
import { blockRefs } from './blocks/blockRefs';
import { save, message } from '@tauri-apps/plugin-dialog';
import { exportFilename } from './helpers';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useUIStore } from '../store/uiStore';
import { useEntryStore } from '../store/entryStore';
import { liveTagNames, useTagStore } from '../store/tagStore';
import { useSettingsStore } from '../store/settingsStore';
import { reloadModules } from '../store/moduleWiring';
import { useTaskStore } from '../store/taskStore';
import { getDb } from './db';
import { categoryKey, categoryLabel } from './categories';
import { useCategoryStore } from '../store/categoryStore';
import { useTemplateStore } from '../store/templateStore';
import i18n from '../i18n';
import { buildLinkItems, linkItemKey, linkItemsByKey } from './linkItems';
import { extractInternalLinks, linkTargetKindOf, remapInternalLinks } from './internalLinkHtml';
import { entryView } from '../store/entryViews';
import { dashboardShowing, startCategoryOf, startTagsOf } from './createItem';
import type { SuggestionItem } from '../components/editors/text/SuggestionList';
import type { Category } from '../types';
import type { WriteOptions } from './stamp';
import { displayTitle, hasOwnTitle } from './entryTitle';
import { compressDataUrl } from './imageCompression';
import { exportDefaultPath } from './vaultManager';
import { imageDetailsOf, importImageDetails } from './emerald/imageDetails';
import {
  definitionImageRefs, parseDefinitionElements, remapDefinitionDefaults, type LinkDefaultResolver,
} from './blocks/definitions';
import { nextDefinitionSortOrder } from './blockDefinitionRows';
import {
  blocksToContent, categoryRowsOf, contentToBlocks, EMERALD_FORMAT_VERSION, gentlestImageMode, manifestCategoryOf,
  parseManifest, relinkWithinFile, usedDefinitionIds,
  renameStoredFiles, storedNameStem,
  type EmeraldManifest, type ImageMode, type ManifestBlockDefinition, type ManifestEntry, type ManifestItem,
  type ManifestLink, type ManifestTemplate,
} from './emerald/manifest';
import {
  EmeraldNotice, noticeFor, storeArchiveFiles, withEmeraldEnding, writeArchive,
  type ArchiveImage, type EmeraldProtection, type OpenedArchive,
} from './emerald/file';

export type { ImageMode } from './emerald/manifest';
export type { EmeraldProtection } from './emerald/file';

// ── Link chips across vault boundaries ───────────────────────────────────────

/** `buildLinkItems` over the current stores — the React-free variant of
 *  `useLinkItems`, for the import/export paths. */
function linkItemsSnapshot(): SuggestionItem[] {
  return buildLinkItems({
    entries: useEntryStore.getState().entries,
    tasks: useTaskStore.getState().tasks,
    categories: useCategoryStore.getState().categories,
    showMoonPhase: useSettingsStore.getState().settings.journal.moonPhase,
  }, i18n.t);
}

/** The title of every link chip in the contents — travels along as the manifest's `links`. */
function collectContentLinks(contents: readonly string[]): ManifestLink[] {
  const byKey = linkItemsByKey(linkItemsSnapshot());
  const seen = new Set<string>();
  const out: ManifestLink[] = [];
  for (const content of contents) {
    for (const link of extractInternalLinks(content)) {
      const key = linkItemKey(link);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: link.id, kind: link.targetKind === 'task' ? 'task' : 'entry', title: byKey.get(key)?.label ?? link.label });
    }
  }
  return out;
}

/**
 * Points every link chip of the imported content at the target IN THIS vault:
 * first via the ID (the same vault or an already matching entry),
 * then via the title from the manifest's `links`, otherwise via the
 * `data-label` that sits in the chip itself. If nothing is found,
 * the chip becomes its text (see `remapInternalLinks`).
 *
 * In every hit the label is also set to the title of the local target.
 * Otherwise the chip could claim something other than what it hits: the title path
 * rewrites the ID and would leave the supplied text in place, and even with
 * an ID hit the target here may long since have been renamed. The
 * text is only displayed where no live lookup applies — in the export and in Markdown.
 */
function remapImportedLinks(
  content: string,
  links: readonly ManifestLink[],
  items: SuggestionItem[],
  ownIds: ReadonlySet<string> = new Set(),
): string {
  const byKey = linkItemsByKey(items);
  const titleByKey = new Map(links.map((l) => [linkItemKey({ id: l.id, targetKind: l.kind }), l.title]));
  return remapInternalLinks(content, (link) => (
    // An entry of the same file, created by this import: its title is not written yet, the chip's own label stays.
    link.targetKind !== 'task' && ownIds.has(link.id)
      ? { id: link.id }
      : resolveImportedTarget(link, titleByKey.get(linkItemKey(link)), items, byKey)
  ));
}

/**
 * A link target from a foreign file in this vault: the same ID, otherwise
 * the same title under the same kind — or `null`.
 */
function resolveImportedTarget(
  link: { id: string; targetKind: string; label: string },
  manifestTitle: string | undefined,
  items: SuggestionItem[],
  byKey = linkItemsByKey(items),
): { id: string; label: string } | null {
  const local = byKey.get(linkItemKey({ id: link.id, targetKind: link.targetKind as SuggestionItem['targetKind'] }));
  if (local) return { id: local.id, label: local.label };
  // No title, or only the "Untitled …" every untitled entry shows: nothing to find it by.
  const title = importedTitle({ title: manifestTitle || link.label });
  if (!title) return null;
  const kind = linkTargetKindOf(link.targetKind);
  const match = items.find((i) => linkTargetKindOf(i.targetKind) === kind && i.label === title);
  return match ? { id: match.id, label: match.label } : null;
}

// ── Export ───────────────────────────────────────────────────────────────────

/** One item of an export: an entry or a template, with its own picture handling if it differs from the export's. */
export interface EmeraldExportItem {
  kind: 'entry' | 'template';
  id: string;
  images?: ImageMode;
}

/**
 * What an export writes — the settings the export menu offers:
 *
 * - `items`: the entries and templates, chosen by the caller (linked entries
 *   included or not; `linkedEntriesOf` finds them).
 * - `images`: what happens to the pictures (`ImageMode`); each item can
 *   override it, so linked entries can have a setting of their own. A picture
 *   two items share gets the gentlest setting either asks for.
 * - `protection`: none (the default), an own password of at least 8
 *   characters, or the vault's key — the file then opens with the vault's
 *   password or recovery key.
 * - `blockDefinitions`: the custom blocks the items' copies came from
 *   (`FieldsModel.definition`) go along, so that the importing vault has them
 *   too; on by default.
 *
 * Always along, without a setting: category (a built-in or starter one with
 * its ID) and tags by name, icons, cover, the copies of custom blocks in the
 * content, concealed sigils (concealed), and name, note and tags (by name) of
 * the pictures that are in "Images".
 */
export interface EmeraldExportOptions {
  items: readonly EmeraldExportItem[];
  images?: ImageMode;
  protection?: EmeraldProtection;
  blockDefinitions?: boolean;
}

/** The pictures and icons a block stack names — from the blocks (`blockRefs`), and every stored name in it, as the backup does. */
function storedFilesOf(content: string): { images: string[]; icons: string[] } {
  const refs = parseBlocks(content).flatMap(blockRefs);
  const images = refs.filter((r) => r.kind === 'image').map((r) => r.target);
  const icons = refs.filter((r) => r.kind === 'icon').map((r) => r.target);
  const iconSet = new Set(icons);
  // A stored name `blockRefs` cannot place is a picture — unless it is a known icon.
  images.push(...storedImageNamesIn(content).filter((name) => !iconSet.has(name)));
  const valid = (names: string[]) => [...new Set(names.map((n) => storedImageName(n)).filter((n): n is string => !!n))];
  return { images: valid(images), icons: valid(icons) };
}

async function manifestItemOf(item: EmeraldExportItem): Promise<{ manifest: ManifestItem; content: string } | null> {
  if (item.kind === 'template') {
    const template = useTemplateStore.getState().templates.find((tpl) => tpl.id === item.id);
    if (!template) return null;
    const manifest: ManifestTemplate = {
      kind: 'template',
      id: template.id,
      name: template.name,
      title: template.title,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
      icon: template.icon ?? '',
      tags: liveTagNames(template.tags),
      blocks: contentToBlocks(template.content),
    };
    return { manifest, content: template.content };
  }
  // Right after startup the content may still be pending.
  await useEntryStore.getState().ensureEntryContent(item.id);
  const entry = useEntryStore.getState().getEntry(item.id);
  if (!entry) return null;
  const cat = useCategoryStore.getState().categories.find((c) => c.id === entry.category_id);
  const content = entry.content || '';
  const manifest: ManifestEntry = {
    kind: 'entry',
    id: entry.id,
    title: entry.title,
    number: entry.entry_number ?? null,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    icon: entry.icon ?? '',
    cover: storedImageName(entry.cover_image) ?? null,
    // With its ID — a built-in or starter category is found by it in every
    // vault, whatever its name there — and the name it has here and now.
    category: cat ? manifestCategoryOf(cat, categoryLabel(i18n.t, cat)) : null,
    tags: liveTagNames(entry.tags),
    // Concealed sigils go along as they are: they arrive concealed.
    blocks: contentToBlocks(content),
  };
  return { manifest, content };
}

/**
 * Writes the items as a `.emerald` file at `path` — without a dialog, so the
 * export menu and a check can call it alike.
 */
export async function writeEmeraldFile(path: string, options: EmeraldExportOptions): Promise<void> {
  const fallback = options.images ?? 'none';
  const items: ManifestItem[] = [];
  const contents: string[] = [];
  const imageModes = new Map<string, ImageMode>();
  const icons = new Set<string>();
  for (const item of options.items) {
    const built = await manifestItemOf(item);
    if (!built) continue;
    items.push(built.manifest);
    contents.push(built.content);
    const files = storedFilesOf(built.content);
    const mode = item.images ?? fallback;
    const cover = built.manifest.kind === 'entry' ? built.manifest.cover : null;
    for (const name of cover ? [...files.images, cover] : files.images) {
      const known = imageModes.get(name);
      imageModes.set(name, known ? gentlestImageMode(known, mode) : mode);
    }
    files.icons.forEach((name) => icons.add(name));
    if (isIconFile(built.manifest.icon)) icons.add(built.manifest.icon);
  }
  if (items.length === 0) throw new Error(i18n.t('emeraldExport.nothing'));

  // A definition's prefilled link names an entry of this vault: it goes along
  // only to an entry the file carries too — of any other the file says nothing.
  const exported = new Set(options.items.filter((i) => i.kind === 'entry').map((i) => i.id));
  const linkInFile: LinkDefaultResolver = (t) => (exported.has(t.id) ? t : null);
  const blockDefinitions = (options.blockDefinitions === false ? [] : await usedDefinitions(contents))
    .map((row): ManifestBlockDefinition => ({ ...row, elements: remapDefinitionDefaults(row.elements, (name) => name, linkInFile) }));
  // A definition's prefilled pictures and its icon travel like the items' own.
  for (const row of blockDefinitions) {
    for (const name of definitionPictures(row)) {
      const known = imageModes.get(name);
      imageModes.set(name, known ? gentlestImageMode(known, fallback) : fallback);
    }
    if (typeof row.icon === 'string' && isIconFile(row.icon)) icons.add(row.icon);
  }

  const images: ArchiveImage[] = [];
  const omittedImages: string[] = [];
  for (const [name, mode] of imageModes) {
    if (mode === 'placeholder') {
      omittedImages.push(name);
    } else if (mode === 'none') {
      images.push({ name });
    } else {
      try {
        const original = await readImageAsBase64(name);
        const compressed = await compressDataUrl(original, mode);
        images.push(compressed === original ? { name } : { name, dataUrl: compressed });
      } catch { /* a missing picture is left out, as Rust does */ }
    }
  }

  const manifest: EmeraldManifest = {
    format: 'emerald',
    version: EMERALD_FORMAT_VERSION,
    kind: 'items',
    exportedAt: new Date().toISOString(),
    items,
    links: collectContentLinks(contents),
    omittedImages,
    blockDefinitions,
    // Name, note and tags of the pictures the file carries; a left-out one is a placeholder there.
    images: await imageDetailsOf(await getDb(), images.map((image) => image.name)),
  };
  await writeArchive(path, 'items', JSON.stringify(manifest), images, [...icons], options.protection ?? { type: 'none' });
}

/**
 * The custom block definitions the copies in the contents came from, by the
 * quiet note every copy carries (`FieldsModel.definition`) — the rows as the
 * vault holds them, not those in the trash (`definitionRows`): the copy
 * travels and works without its origin.
 */
async function usedDefinitions(contents: readonly string[]): Promise<ManifestBlockDefinition[]> {
  const ids = usedDefinitionIds(contents);
  if (ids.length === 0) return [];
  const { definitionRows } = await import('./dbBackup');
  return definitionRows(await getDb(), ids);
}

/**
 * The entries the given ones link to (`block_refs`, kind `entry`), without
 * the given ones and without entries in the trash — with `recursive`, also
 * those the linked ones link to, and so on. For the export menu's
 * "include linked entries". `blocked` entries (ticked off in the menu) are
 * listed when linked, but not walked through: what only they link to stays out.
 */
export async function linkedEntriesOf(
  ids: readonly string[],
  { recursive = false, blocked = [] }: { recursive?: boolean; blocked?: readonly string[] } = {},
): Promise<string[]> {
  const db = await getDb();
  const stop = new Set(blocked);
  const seen = new Set(ids);
  const found: string[] = [];
  let frontier = [...ids];
  while (frontier.length > 0) {
    const rows = await db.select<{ target: string }[]>(
      `SELECT DISTINCT r.target AS target
         FROM block_refs r
         JOIN blocks b ON b.row_id = r.block_row
         JOIN entries e ON e.id = r.target AND e.deleted_at IS NULL
        WHERE r.target_kind = 'entry' AND b.entry_id IN (SELECT value FROM json_each($1))`,
      [JSON.stringify(frontier)],
    );
    const fresh = rows.map((r) => r.target).filter((id) => !seen.has(id));
    fresh.forEach((id) => { seen.add(id); found.push(id); });
    frontier = fresh.filter((id) => !stop.has(id));
    if (!recursive) break;
  }
  return found;
}

/** A template as `.emerald` — the saved state, not an open draft. */
export async function exportTemplateAsEmerald(templateId: string): Promise<void> {
  const template = useTemplateStore.getState().templates.find((tpl) => tpl.id === templateId);
  if (!template) {
    await message(i18n.t('emeraldExport.openTemplateFirst'), { title: i18n.t('emeraldExport.title'), kind: 'info' });
    return;
  }
  const name = exportFilename(template.name || i18n.t('templates.untitled'), template.created_at, 'emerald');
  await exportItemsAsEmerald({ items: [{ kind: 'template', id: template.id }] }, name);
}

/**
 * The export menu's `.emerald`: asks where, then writes. Resolves to `false`
 * when the save dialog was cancelled.
 */
export async function exportItemsAsEmerald(options: EmeraldExportOptions, defaultName: string): Promise<boolean> {
  const path = await save({
    defaultPath: await exportDefaultPath(defaultName),
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
  });
  if (!path) return false;
  await writeEmeraldFile(withEmeraldEnding(path), options);
  return true;
}

// ── Import helpers ───────────────────────────────────────────────────────────

/** The tag IDs for the names in the file — the file carries names, the entry IDs.
 *  ensureTag also finds "foo" as "Foo". As when typing into the tag field,
 *  without permission to create (`tags.createInline`) only names that are already
 *  tags remain. */
async function ensureTagIds(names: string[]): Promise<string[]> {
  const createInline = useSettingsStore.getState().settings.tags.createInline;
  const result: string[] = [];
  for (const name of names) {
    const known = useTagStore.getState().getByName(name);
    if (!known && !createInline) continue;
    const { id } = known ?? await useTagStore.getState().ensureTag(name);
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

// ── Import from Emerald ──────────────────────────────────────────────────────

/** The picture a left-out one becomes: grey, with a crossed-out picture, without words — stored once per import. */
async function placeholderImage(): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.fillStyle = '#d6d3d1';
  ctx.fillRect(0, 0, 480, 320);
  ctx.strokeStyle = '#78716c';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // A frame with a mountain and a sun, crossed out.
  ctx.strokeRect(170, 110, 140, 100);
  ctx.beginPath();
  ctx.moveTo(178, 200);
  ctx.lineTo(225, 155);
  ctx.lineTo(255, 182);
  ctx.lineTo(272, 168);
  ctx.lineTo(302, 200);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(278, 138, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(150, 90);
  ctx.lineTo(330, 230);
  ctx.stroke();
  return saveImage(canvas.toDataURL('image/png'));
}

/** What an import created, in the order of the file, and how many items it left out as already here. */
export interface EmeraldImportResult {
  entries: string[];
  templates: string[];
  skipped: number;
}

/**
 * Where an imported entry goes that brings no category of its own: nowhere
 * (no category), the start category and tag of a dashboard, or a category.
 */
export type ImportTarget = { kind: 'none' } | { kind: 'dashboard'; id: string } | { kind: 'category'; id: string };

/** The category and tags a target gives an entry without a category of its own. */
function placementOf(target: ImportTarget): { categoryId: string | null; tagIds: string[] } {
  if (target.kind === 'dashboard') return { categoryId: startCategoryOf(target.id), tagIds: startTagsOf(target.id) };
  if (target.kind === 'category' && useCategoryStore.getState().categories.some((c) => c.id === target.id)) {
    return { categoryId: target.id, tagIds: [] };
  }
  return { categoryId: null, tagIds: [] };
}

/** The dashboard an imported entry opens in: the target's (if it can show it), else "All entries". */
function dashboardOf(target: ImportTarget): string {
  return target.kind === 'dashboard' ? dashboardShowing(target.id) : 'all';
}

/** What the import window decides for a file of entries and templates. */
export interface ItemImportOptions {
  /** IDs in the file of the items to import; every item when absent. */
  only?: ReadonlySet<string>;
  /** Where entries go that bring no category; no category when absent. */
  target?: ImportTarget;
  /** Items already here (`existingItemsOf`: ID in the file → ID here), left out. */
  skip?: ReadonlyMap<string, string>;
}

/** The manifest of an opened file of entries and templates, checked — before anything is stored or created. */
export function itemsManifestOf(opened: OpenedArchive): EmeraldManifest {
  const manifest = parseManifest(opened.manifest);
  // Format, version and item count already checked by Rust: a refused file leaves the vault as it is.
  if (typeof manifest === 'string') throw new EmeraldNotice(i18n.t(`emeraldImport.${manifest}`));
  return manifest;
}

/** A date as the instant it names, so that two spellings of one compare equal. */
function instantKey(value: string | undefined): string | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * The items of a file this vault already has — ID in the file → ID here. An
 * entry by its ID (a file of this vault) or by title and creation date (an
 * entry imported before keeps both); a template by its ID or its name. Only
 * what is not in the trash counts.
 */
export function existingItemsOf(manifest: EmeraldManifest): Map<string, string> {
  const entries = useEntryStore.getState().entries.filter((e) => !e.deleted_at);
  const templates = useTemplateStore.getState().templates;
  const entryIds = new Set(entries.map((e) => e.id));
  const stampOf = (title: string, at: string | null) => (at ? `${title.trim()}\u0000${at}` : null);
  const byStamp = new Map<string, string>();
  for (const entry of entries) {
    const stamp = stampOf(entry.title ?? '', instantKey(entry.created_at));
    if (stamp && !byStamp.has(stamp)) byStamp.set(stamp, entry.id);
  }
  const found = new Map<string, string>();
  for (const item of manifest.items) {
    if (item.kind === 'entry') {
      const stamp = stampOf(importedTitle(item), instantKey(importedCreatedAt(item.createdAt)));
      const here = entryIds.has(item.id) ? item.id : stamp ? byStamp.get(stamp) : undefined;
      if (here) found.set(item.id, here);
    } else {
      const name = item.name.trim();
      const here = templates.find((tpl) => tpl.id === item.id || (name && tpl.name.trim() === name));
      if (here) found.set(item.id, here.id);
    }
  }
  return found;
}

/**
 * The items of an opened file (its manifest from `itemsManifestOf`): its
 * pictures stored, then the items created. The file stays open.
 */
export async function importItems(
  opened: OpenedArchive, manifest: EmeraldManifest, options: ItemImportOptions = {},
): Promise<EmeraldImportResult> {
  const stored = await storeArchiveFiles(opened.ticket);
  // By the hash part of the name: a picture compressed on export travels with
  // the extension of its new type, the content still names the old one.
  const byStem = (files: ReadonlyMap<string, string>) => new Map([...files].map(([name, here]) => [storedNameStem(name), here]));
  return importManifest(manifest, byStem(stored.images), byStem(stored.icons), options);
}

/**
 * The categories of the file's entries in this vault, by the rule of the
 * backup import (`resolveImportedCategories`): a built-in or starter category
 * by its ID, renamed or in another language as it may be; every other one by
 * the name it had at export, created when there is none of that name (one in
 * the trash comes back). Returns: ID in the file → ID here.
 */
async function resolveFileCategories(items: readonly ManifestItem[]): Promise<Map<string, string>> {
  const rows = categoryRowsOf(items, (icon) => plausibleEmoji(icon) || '📁');
  if (rows.length === 0) return new Map();
  const { resolveImportedCategories } = await import('./dbBackup');
  const { map } = await resolveImportedCategories(await getDb(), rows);
  await useCategoryStore.getState().fetchCategories();
  return map;
}

/**
 * The custom blocks of the file: added by ID, one this vault has already
 * (also in the trash) stays as it is — the rule of the backup import. A new
 * one is usable at once, at the end of the Blocks view. Its prefilled pictures
 * and its icon point at the files stored here; a prefilled link only at an
 * entry of the same file (the export keeps no other), else it is dropped.
 * Returns the rows it added — not those this vault had already.
 */
async function importBlockDefinitions(
  rows: readonly ManifestBlockDefinition[],
  imageNames: ReadonlyMap<string, string>,
  iconNames: ReadonlyMap<string, string>,
  idMap: ReadonlyMap<string, string>,
): Promise<ManifestBlockDefinition[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM block_definitions')).map((r) => r.id));
  const pictures = new Map<string, string>();
  for (const row of rows) {
    for (const name of definitionPictures(row)) {
      const here = imageNames.get(storedNameStem(name));
      if (here) pictures.set(name, here);
    }
  }
  let sortOrder = await nextDefinitionSortOrder(db);
  const fresh = rows.map((row) => ({
    ...row,
    // An icon file under this vault's name, or — without its file — the default.
    icon: typeof row.icon === 'string' && isIconFile(row.icon) ? iconNames.get(storedNameStem(row.icon)) ?? '' : row.icon,
    sort_order: sortOrder++,
    deleted_at: null,
  }));
  const { insertBlockDefinitions, remapDefinitionRows } = await import('./dbBackup');
  await insertBlockDefinitions(db, remapDefinitionRows(fresh, pictures, (t) => {
    const id = idMap.get(t.id);
    return id ? { id, label: t.label } : null;
  }));
  return rows.filter((row) => !known.has(row.id));
}

/** The hash parts of the pictures the items use — content and cover — and the definitions prefill. */
function importedPictureStems(items: readonly ManifestItem[], definitions: readonly ManifestBlockDefinition[]): Set<string> {
  const names = [
    ...items.flatMap((item) => [
      ...storedFilesOf(blocksToContent(item.blocks)).images,
      ...(item.kind === 'entry' && item.cover ? [item.cover] : []),
    ]),
    ...definitions.flatMap(definitionPictures),
  ];
  return new Set(names.map(storedNameStem));
}

/** The stored names of the pictures a definition row prefills. */
function definitionPictures(row: ManifestBlockDefinition): string[] {
  return definitionImageRefs(parseDefinitionElements(row.elements))
    .map((name) => storedImageName(name))
    .filter((name): name is string => !!name);
}

/**
 * Creates the items of a manifest — those `options` keep. Entries are created
 * first, all of them, so that links between items of the same file can point
 * at the new ones (and at the ones already here that were left out); then
 * each gets its content, category, tags, icon and cover. If a step fails, the
 * entries and templates created are removed again; categories, custom blocks
 * and pictures' details it found missing stay, as they would after a
 * successful import. `storedImages`/`iconNames`: the hash part of
 * a name in the file → the name stored here.
 */
async function importManifest(
  manifest: EmeraldManifest, storedImages: ReadonlyMap<string, string>, iconNames: ReadonlyMap<string, string>,
  options: ItemImportOptions,
): Promise<EmeraldImportResult> {
  const chosen = options.only ? manifest.items.filter((item) => options.only!.has(item.id)) : manifest.items;
  const skip = options.skip ?? new Map<string, string>();
  const items = chosen.filter((item) => !skip.has(item.id));
  const placement = placementOf(options.target ?? { kind: 'none' });
  const result: EmeraldImportResult = { entries: [], templates: [], skipped: chosen.length - items.length };
  const entryStore = useEntryStore.getState();
  try {
    const imageNames = new Map(storedImages);
    if (manifest.omittedImages.length > 0) {
      const placeholder = await placeholderImage();
      for (const name of manifest.omittedImages) {
        const stem = storedNameStem(name);
        if (!imageNames.has(stem)) imageNames.set(stem, placeholder);
      }
    }
    const categories = await resolveFileCategories(items);
    // Created blank, so that the IDs are there before any content refers to them.
    // The link targets of this vault as they were before the import: a blank
    // entry it creates must not be found by title ("Untitled …") for a link
    // that pointed elsewhere.
    const linkItems = linkItemsSnapshot();
    const idMap = new Map<string, string>();
    const createdAt = new Map<string, string | undefined>();
    const placed = new Set<string>();
    for (const item of items) {
      if (item.kind !== 'entry') continue;
      const own = item.category ? categories.get(item.category.id) ?? null : null;
      const categoryId = own ?? placement.categoryId;
      const at = importedCreatedAt(item.createdAt);
      const entry = await entryStore.createEntry({ categoryId, blank: true, createdAt: at });
      idMap.set(item.id, entry.id);
      createdAt.set(entry.id, at);
      if (!own) placed.add(item.id);
      result.entries.push(entry.id);
    }

    const ownIds = new Set(idMap.values());
    // A link to an item left out as already here points at the one here.
    const relinkMap = new Map([...skip, ...idMap]); // later pairs win: a created item over a skipped one
    const contentOf = (item: ManifestItem): string => {
      const raw = blocksToContent(item.blocks);
      const renamed = renameStoredFiles(renameStoredFiles(raw, iconNames), imageNames);
      const relinked = remapImportedLinks(relinkWithinFile(renamed, relinkMap), manifest.links, linkItems, ownIds);
      return sanitizeImportedHtml(relinked);
    };
    const iconOf = (icon: string): string | undefined => {
      if (!icon) return undefined;
      if (isIconFile(icon)) return iconNames.get(storedNameStem(icon));
      return plausibleEmoji(icon) || undefined;
    };

    for (const item of items) {
      const content = contentOf(item);
      const own = await ensureTagIds(item.tags);
      // An entry placed by the target gets the dashboard's start tag, so it shows there.
      const tags = placed.has(item.id)
        ? [...new Set([...own, ...placement.tagIds])]
        : own;
      if (item.kind === 'template') {
        const created = await useTemplateStore.getState().createTemplate(item.name, {
          icon: iconOf(item.icon), title: item.title, content, tags,
        });
        result.templates.push(created.id);
        continue;
      }
      const id = idMap.get(item.id)!;
      const cover = item.cover ? imageNames.get(storedNameStem(item.cover)) : undefined;
      await entryStore.updateEntry(id, {
        title: importedTitle(item),
        content,
        tags,
        icon: iconOf(item.icon),
        ...(cover ? { cover_image: cover } : {}),
      }, importedStamp(createdAt.get(id)));
    }
    // Last: a prefilled link points at an entry of this import, which a failure
    // before here would have removed again. The copies need no definition.
    // Only the definitions the imported items' copies came from.
    const used = new Set(usedDefinitionIds(items.map((item) => blocksToContent(item.blocks))));
    const definitions = manifest.blockDefinitions.filter((row) => used.has(row.id));
    // One this vault has already (also in the trash) stays as it is — its prefills bring no details either.
    const added = await importBlockDefinitions(definitions, imageNames, iconNames, relinkMap);
    // The pictures of what came in, with their name, note and tags — not those
    // only items left out use. `storedImages`, not `imageNames`: there a
    // left-out picture is the placeholder, which must not take its details.
    // "Images" reloads with the modules afterwards (`showImportedItems`).
    const pictures = importedPictureStems(items, added);
    const details = manifest.images.filter((image) => pictures.has(storedNameStem(image.file)));
    await importImageDetails(await getDb(), details, storedImages, ensureTagIds);
    return result;
  } catch (err) {
    await Promise.allSettled([
      ...result.entries.map((id) => discardEntry(id)),
      ...result.templates.map((id) => discardTemplate(id)),
    ]);
    throw err;
  }
}

/** Removes a template an import created, from the database and the list. */
async function discardTemplate(id: string): Promise<void> {
  await useTemplateStore.getState().permanentlyDeleteTemplate(id);
  useTemplateStore.setState((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
}

/** Removes an entry an import created, from the database and the list. */
async function discardEntry(id: string): Promise<void> {
  await useEntryStore.getState().permanentlyDeleteEntry(id);
  useEntryStore.setState((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
}

/**
 * After an import of entries and templates: the lists reloaded, the first
 * entry opened (in the target's dashboard), or else the first template; then
 * the note with what came in.
 */
export async function showImportedItems(result: EmeraldImportResult, target: ImportTarget = { kind: 'none' }): Promise<void> {
  await reloadModules(['entries']);
  const [firstEntry] = result.entries;
  if (firstEntry) useUIStore.getState().setActiveView(entryView(firstEntry, dashboardOf(target)));
  else if (result.templates[0]) useUIStore.getState().setActiveView({ type: 'templates', id: result.templates[0] });
  const counts = { entries: result.entries.length, templates: result.templates.length, skipped: result.skipped };
  await message(
    i18n.t(result.skipped > 0 ? 'emeraldImport.doneSkipped' : 'emeraldImport.done', counts),
    { title: i18n.t('emeraldImport.title'), kind: 'info' },
  );
}

/**
 * The last step of every import that writes HTML into the database:
 * scripts and event handlers out; TipTap's own data attributes
 * (link chips, image alignment, table column widths, text colours) and inline styles stay.
 */
function sanitizeImportedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: [
      'data-type', 'data-id', 'data-target-kind', 'data-label', 'data-icon',
      'data-entry-number', 'data-align', 'colwidth', 'data-color',
    ],
  });
}

/**
 * The creation date from the file, so that an entry lands at its place in the
 * timeline instead of as the newest. The file is foreign: only a readable
 * date with a four-digit year, as ISO like any other — dates are sorted as
 * text, and `+010000-…` would sort before 2024. Otherwise now.
 */
function importedCreatedAt(value: string): string | undefined {
  const time = value ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return undefined;
  const iso = new Date(time).toISOString();
  return /^\d{4}-/.test(iso) ? iso : undefined;
}

/** The title from the file. */
function importedTitle(file: { title: string }): string {
  if (!hasOwnTitle(file.title)) return '';
  // A Markdown or PDF export writes "Untitled…" for an empty title
  // in the app's language — that comes back empty on re-import.
  const untitled = (['entry', 'task'] as const)
    .map((type) => displayTitle(i18n.t, type, ''));
  return untitled.includes(file.title.trim()) ? '' : file.title;
}

/**
 * "Last modified" of an imported entry: its creation date. An import is not
 * an edit — otherwise it would still be at the very top of lists that sort
 * by it.
 */
function importedStamp(createdAt: string | undefined): WriteOptions {
  return { touch: createdAt ?? true };
}

/**
 * The one category resolution of the import: the local category with this
 * name (case-insensitive, builtins also via their translated name), otherwise
 * newly created; without a name the entry stays uncategorized.
 */
async function ensureCategoryByName(name: string | null | undefined, emoji = '📁'): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const key = categoryKey(trimmed);
  const matches = (c: Category) =>
    categoryKey(c.name) === key || (c.is_builtin && categoryKey(categoryLabel(i18n.t, c)) === key);

  const store = useCategoryStore.getState();
  const active = store.categories.find(matches);
  if (active) return active.id;

  // In the trash? Then bring it back instead of creating a second one — the rule
  // of `addCategory` and the backup import. Searched for here ourselves, so that the
  // restored one keeps its emoji instead of getting the file's.
  const db = await getDb();
  const trashed = await db.select<{ id: string; name: string }[]>(
    'SELECT id, name FROM categories WHERE deleted_at IS NOT NULL'
  );
  const hit = trashed.find((c) => categoryKey(c.name) === key);
  if (hit) {
    await store.restoreCategory(hit.id);
    return hit.id;
  }

  try {
    return (await store.addCategory(trimmed, plausibleEmoji(emoji) || '📁')).id;
  } catch {
    // Name conflict from a parallel creation — then it exists now.
    return useCategoryStore.getState().categories.find(matches)?.id ?? null;
  }
}

// ── Import from Markdown ─────────────────────────────────────────────────────

/** Strips a leading emoji + whitespace from a metadata value like "🌀 Paradigm Name". */
function stripIconPrefix(val: string): string {
  const trimmed = val.trim();
  if (trimmed.length > 0 && trimmed.charCodeAt(0) > 127) {
    const spaceIdx = trimmed.indexOf(' ');
    return spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
  }
  return trimmed;
}

/** A Markdown file as read for the import window: its title, the category its front matter names, its tags, its body as HTML. */
export interface MarkdownFile {
  title: string;
  /** The category the file names — empty when it names none. */
  categoryName: string;
  tags: string[];
  html: string;
}

/** Reads and parses the Markdown file at `path`; one that cannot be read is an `EmeraldNotice`. */
export async function readMarkdownFile(path: string): Promise<MarkdownFile> {
  let raw: string;
  try {
    raw = await invoke<string>('read_file', { path });
  } catch (e) {
    throw new EmeraldNotice(noticeFor(e) ?? i18n.t('emeraldImport.readFailed', { error: String(e) }));
  }

  // ── Parse frontmatter ──────────────────────────────────────────────────
  const lines = raw.split('\n');
  let title = '';
  const frontMeta: Record<string, string> = {};
  let bodyStart = 0;

  if (lines[0]?.startsWith('# ')) {
    title = importedTitle({ title: lines[0].slice(2).trim() });
    let i = 1;
    while (i < lines.length && lines[i].trim() === '') i++;
    while (i < lines.length && lines[i].trim() !== '---') {
      const line = lines[i].trim();
      // Skip italic date line (*April 15, 2026*)
      if (line.startsWith('*') && line.endsWith('*')) { i++; continue; }
      const sep = line.indexOf(': ');
      if (sep > 0) frontMeta[line.slice(0, sep).toLowerCase()] = line.slice(sep + 2);
      i++;
    }
    bodyStart = lines[i]?.trim() === '---' ? i + 1 : i;
  }

  const bodyMd = lines.slice(bodyStart).join('\n').trim();
  return {
    title,
    categoryName: stripIconPrefix(frontMeta['category'] ?? ''),
    tags: (frontMeta['tags'] ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    html: await marked.parse(bodyMd) as string,
  };
}

/**
 * Imports a read Markdown file as an entry and opens it: in the category it
 * names (in "All entries"), else where `target` says.
 */
export async function importMarkdown(file: MarkdownFile, target: ImportTarget): Promise<void> {
  const tagIds = await ensureTagIds(file.tags);
  const byName = await ensureCategoryByName(file.categoryName);
  const placement = byName ? { categoryId: byName, tagIds: [] } : placementOf(target);
  const { createEntry, updateEntry } = useEntryStore.getState();
  // Created now — with today's moon phase if it lands in the category Journal.
  const entry = await createEntry({ categoryId: placement.categoryId, blank: true });
  try {
    const tags = [...new Set([...tagIds, ...placement.tagIds])];
    await updateEntry(entry.id, { title: file.title, content: sanitizeImportedHtml(file.html), tags });
  } catch (err) {
    await discardEntry(entry.id).catch(() => { /* the error that counts is the first */ });
    throw err;
  }
  await reloadModules(['entries']);
  useUIStore.getState().setActiveView(entryView(entry.id, byName ? 'all' : dashboardOf(target)));
}
