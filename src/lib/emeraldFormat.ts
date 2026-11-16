import { invoke } from '@tauri-apps/api/core';
import { readImageAsBase64, saveImage } from './images';
import { isIconFile, plausibleEmoji } from './icons';
import { storedImageName, storedImageNamesIn } from './schema';
import { parseBlocks } from './blocks/blockHtml';
import { blockRefs } from './blocks/blockRefs';
import { open as openDialog, save, message } from '@tauri-apps/plugin-dialog';
import { exportFilename } from './helpers';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useUIStore } from '../store/uiStore';
import { useEntryStore } from '../store/entryStore';
import { liveTagNames, useTagStore } from '../store/tagStore';
import { useSettingsStore } from '../store/settingsStore';
import { reloadModules } from '../store/moduleWiring';
import { useImportStore } from '../store/importStore';
import { useTaskStore } from '../store/taskStore';
import { getDb } from './db';
import { categoryKey, categoryLabel } from './categories';
import { useCategoryStore } from '../store/categoryStore';
import { useTemplateStore } from '../store/templateStore';
import i18n from '../i18n';
import { buildLinkItems, linkItemKey, linkItemsByKey } from './linkItems';
import { extractInternalLinks, linkTargetKindOf, remapInternalLinks } from './internalLinkHtml';
import { entryView } from '../store/entryViews';
import { startCategoryOf } from './createItem';
import type { SuggestionItem } from '../components/editors/text/SuggestionList';
import type { Category } from '../types';
import type { WriteOptions } from './stamp';
import { displayTitle, hasOwnTitle } from './entryTitle';
import { getActiveVaultId } from './vaultManager';
import { compressDataUrl } from './imageCompression';
import { keyErrorOf, KEY_ERRORS } from './vaultKeys';
import { askBackupSecret, BACKUP_UNLOCK_CANCELLED, endBackupSecret } from '../store/backupSecretStore';
import {
  blocksToContent, contentToBlocks, EMERALD_FORMAT_VERSION, gentlestImageMode, parseManifest, relinkWithinFile,
  renameStoredFiles, storedNameStem,
  type EmeraldManifest, type ImageMode, type ManifestEntry, type ManifestItem, type ManifestLink, type ManifestTemplate,
} from './emerald/manifest';

export type { ImageMode } from './emerald/manifest';

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
      out.push({ id: link.id, kind: link.targetKind === 'task' ? 'task' : 'entry', title: byKey.get(key)?.label ?? '' });
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
 * What an export writes — the settings the export menu (#98) offers:
 *
 * - `items`: the entries and templates, chosen by the caller (linked entries
 *   included or not; `linkedEntriesOf` finds them).
 * - `images`: what happens to the pictures (`ImageMode`); each item can
 *   override it, so linked entries can have a setting of their own. A picture
 *   two items share gets the gentlest setting either asks for.
 * - `password`: seals the whole file; at least 8 characters.
 *
 * Always along, without a setting: category and tags by name, icons, cover,
 * the copies of custom blocks in the content and concealed sigils (concealed).
 */
export interface EmeraldExportOptions {
  items: readonly EmeraldExportItem[];
  images?: ImageMode;
  password?: string;
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
    // A built-in by its stored name, the same in every vault — its label
    // depends on the language and would create a new category elsewhere.
    category: cat ? { name: cat.is_builtin ? cat.name : categoryLabel(i18n.t, cat), icon: cat.emoji, builtin: Boolean(cat.is_builtin) } : null,
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
  if (items.length === 0) throw new Error('Nothing to export.');

  const images: Array<{ name: string; dataUrl?: string }> = [];
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
    exportedAt: new Date().toISOString(),
    items,
    links: collectContentLinks(contents),
    omittedImages,
  };
  await invoke('write_emerald_file', {
    vaultId: await getActiveVaultId(),
    path,
    manifest: JSON.stringify(manifest),
    images,
    icons: [...icons],
    password: options.password || null,
  });
}

/**
 * For the export menu (#98), which does not exist yet: the entries the given ones link to (`block_refs`, kind `entry`), without
 * the given ones and without entries in the trash — with `recursive`, also
 * those the linked ones link to, and so on. For the export menu's
 * "include linked entries".
 */
export async function linkedEntriesOf(ids: readonly string[], { recursive = false } = {}): Promise<string[]> {
  const db = await getDb();
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
    frontier = rows.map((r) => r.target).filter((id) => !seen.has(id));
    frontier.forEach((id) => { seen.add(id); found.push(id); });
    if (!recursive) break;
  }
  return found;
}

/** The menu's export: the open entry or template, as it is, without a password. */
export async function exportAsEmerald(): Promise<void> {
  const view = useUIStore.getState().activeView;
  if (view.type === 'templates' && view.id) {
    return exportTemplateAsEmerald(view.id);
  }
  if (!view.id || view.type !== 'entry') {
    await message(i18n.t('emeraldExport.openEntryFirst'), { title: i18n.t('emeraldExport.title'), kind: 'info' });
    return;
  }
  await useEntryStore.getState().ensureEntryContent(view.id);
  const entry = useEntryStore.getState().getEntry(view.id);
  if (!entry) return;
  await saveWithDialog(entry.title, entry.created_at, { kind: 'entry', id: entry.id });
}

/** A template as `.emerald` — the saved state, not an open draft. */
export async function exportTemplateAsEmerald(templateId: string): Promise<void> {
  const template = useTemplateStore.getState().templates.find((tpl) => tpl.id === templateId);
  if (!template) {
    await message(i18n.t('emeraldExport.openTemplateFirst'), { title: i18n.t('emeraldExport.title'), kind: 'info' });
    return;
  }
  await saveWithDialog(template.name || 'Template', template.created_at, { kind: 'template', id: template.id });
}

async function saveWithDialog(title: string, date: string, item: EmeraldExportItem): Promise<void> {
  const path = await save({
    defaultPath: exportFilename(title, date, 'emerald'),
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
  });
  if (!path) return;
  await writeEmeraldFile(path, { items: [item] });
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

/** What `read_emerald_file` returns: the manifest, and the pictures stored in this vault by the hash part of their name in the file. */
interface ReadArchive {
  manifest: string;
  images: Record<string, string>;
  icons: Record<string, string>;
}

/** Error codes of `emerald_file.rs`. */
const EMERALD_ERRORS = {
  locked: 'EMERALD_LOCKED',
  oldFormat: 'EMERALD_OLD_FORMAT',
  tooLarge: 'EMERALD_TOO_LARGE',
  unreadable: 'EMERALD_UNREADABLE',
  newer: 'EMERALD_NEWER',
} as const;

/** Thrown with a text for the person importing — nothing was changed. */
class EmeraldImportNotice extends Error {}

function noticeFor(err: unknown): string | null {
  switch (keyErrorOf(err)) {
    case EMERALD_ERRORS.oldFormat: return i18n.t('emeraldImport.oldVersion');
    case EMERALD_ERRORS.tooLarge: return i18n.t('emeraldImport.tooLarge');
    case EMERALD_ERRORS.unreadable: return i18n.t('emeraldImport.unsupported');
    case EMERALD_ERRORS.newer: return i18n.t('emeraldImport.newVersion');
    default: return null;
  }
}

/**
 * Reads the file, asking for its password while one is needed and the last
 * one did not fit. `null`: the question was cancelled.
 */
async function readArchiveAsking(path: string): Promise<ReadArchive | null> {
  const vaultId = await getActiveVaultId();
  let password: string | null = null;
  try {
    for (;;) {
      let error: string | null;
      try {
        return await invoke<ReadArchive>('read_emerald_file', { vaultId, path, password });
      } catch (err) {
        const code = keyErrorOf(err);
        if (code === EMERALD_ERRORS.locked) error = null;
        else if (code === KEY_ERRORS.wrongPassword) error = i18n.t('emeraldKey.wrongPassword');
        else throw err;
      }
      try {
        // A `.emerald` file has no recovery key: the answer is always a password.
        const secret = await askBackupSecret(error, 'emerald');
        password = 'password' in secret ? secret.password : null;
      } catch (cancelled) {
        if (keyErrorOf(cancelled) === BACKUP_UNLOCK_CANCELLED) return null;
        throw cancelled;
      }
    }
  } finally {
    endBackupSecret();
  }
}

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

/** What an import created, in the order of the file. */
export interface EmeraldImportResult {
  entries: string[];
  templates: string[];
}

/**
 * Reads a `.emerald` file at `path` into the active vault — without the open
 * dialog, so a check can call it; it still asks for a password when the file
 * needs one. `null`: cancelled at the password.
 */
export async function importEmeraldFile(path: string): Promise<EmeraldImportResult | null> {
  let archive: ReadArchive | null;
  try {
    archive = await readArchiveAsking(path);
  } catch (err) {
    const notice = noticeFor(err);
    throw notice ? new EmeraldImportNotice(notice) : err;
  }
  if (!archive) return null;
  const manifest = parseManifest(archive.manifest);
  // Checked before anything is created (format, version and item count already
  // by Rust, before it stored the pictures): a refused file leaves the vault as it is.
  if (typeof manifest === 'string') throw new EmeraldImportNotice(i18n.t(`emeraldImport.${manifest}`));
  return importManifest(manifest, archive);
}

/**
 * Creates the items of a manifest. Entries are created first, all of them, so
 * that links between items of the same file can point at the new ones; then
 * each gets its content, category, tags, icon and cover. If a step fails, what
 * was created is removed again.
 */
async function importManifest(manifest: EmeraldManifest, archive: ReadArchive): Promise<EmeraldImportResult> {
  const result: EmeraldImportResult = { entries: [], templates: [] };
  const entryStore = useEntryStore.getState();
  try {
    const imageNames = new Map(Object.entries(archive.images));
    if (manifest.omittedImages.length > 0) {
      const placeholder = await placeholderImage();
      for (const name of manifest.omittedImages) {
        const stem = storedNameStem(name);
        if (!imageNames.has(stem)) imageNames.set(stem, placeholder);
      }
    }
    const iconNames = new Map(Object.entries(archive.icons));
    // Created blank, so that the IDs are there before any content refers to them.
    // The link targets of this vault as they were before the import: a blank
    // entry it creates must not be found by title ("Untitled …") for a link
    // that pointed elsewhere.
    const linkItems = linkItemsSnapshot();
    const idMap = new Map<string, string>();
    const createdAt = new Map<string, string | undefined>();
    for (const item of manifest.items) {
      if (item.kind !== 'entry') continue;
      const categoryId = item.category ? await ensureCategoryByName(item.category.name, item.category.icon) : null;
      const at = importedCreatedAt(item.createdAt);
      const entry = await entryStore.createEntry({ categoryId, blank: true, createdAt: at });
      idMap.set(item.id, entry.id);
      createdAt.set(entry.id, at);
      result.entries.push(entry.id);
    }

    const ownIds = new Set(idMap.values());
    const contentOf = (item: ManifestItem): string => {
      const raw = blocksToContent(item.blocks);
      const renamed = renameStoredFiles(renameStoredFiles(raw, iconNames), imageNames);
      const relinked = remapImportedLinks(relinkWithinFile(renamed, idMap), manifest.links, linkItems, ownIds);
      return sanitizeImportedHtml(relinked);
    };
    const iconOf = (icon: string): string | undefined => {
      if (!icon) return undefined;
      if (isIconFile(icon)) return iconNames.get(storedNameStem(icon));
      return plausibleEmoji(icon) || undefined;
    };

    for (const item of manifest.items) {
      const content = contentOf(item);
      const tags = await ensureTagIds(item.tags);
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

/** The menu's import: the open dialog, the import, then the first imported item opened. */
export async function importFromEmerald(): Promise<void> {
  const picked = await openDialog({
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
    multiple: false,
  });
  const filePath = Array.isArray(picked) ? picked[0] : picked;
  if (!filePath) return;

  let result: EmeraldImportResult | null;
  try {
    result = await importEmeraldFile(filePath);
  } catch (e) {
    const text = e instanceof EmeraldImportNotice ? e.message : `${i18n.t('emeraldImport.failed')}\n${e}`;
    await message(text, { title: i18n.t('emeraldImport.title'), kind: 'error' });
    return;
  }
  if (!result) return;

  await reloadModules(['entries']);
  const [firstEntry] = result.entries;
  if (firstEntry) useUIStore.getState().setActiveView(entryView(firstEntry));
  else if (result.templates[0]) useUIStore.getState().setActiveView({ type: 'templates', id: result.templates[0] });
  await message(
    i18n.t('emeraldImport.done', { entries: result.entries.length, templates: result.templates.length }),
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

export async function importFromMarkdown(): Promise<void> {
  const result = await openDialog({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    multiple: false,
  });
  const filePath = Array.isArray(result) ? result[0] : result;
  if (!filePath) return;

  let raw: string;
  try {
    raw = await invoke<string>('read_file', { path: filePath });
  } catch (e) {
    await message(`Failed to read file: ${e}`, { title: 'Import', kind: 'error' });
    return;
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
  const html   = await marked.parse(bodyMd) as string;

  // A file that names its category lands there, in "All entries". One
  // without asks for a dashboard instead of silently picking one: the entry
  // starts in that dashboard's first category and opens inside it.
  const categoryName = stripIconPrefix(frontMeta['category'] ?? '');
  let dashboardId = 'all';
  if (!categoryName) {
    const chosen = await useImportStore.getState().askDestination(title);
    if (!chosen) return;
    dashboardId = chosen;
  }

  const tagIds = await ensureTagIds(
    (frontMeta['tags'] ?? '').split(',').map(t => t.trim()).filter(Boolean),
  );

  let newId: string;
  try {
    newId = await importMarkdownEntry(dashboardId, categoryName, title, html, tagIds);
  } catch (e) {
    await message(`Import failed: ${e}`, { title: 'Import', kind: 'error' });
    return;
  }

  await reloadModules(['entries']);
  useUIStore.getState().setActiveView(entryView(newId, dashboardId));
  await message('Entry imported successfully!', { title: 'Import', kind: 'info' });
}

/**
 * An entry from Markdown: in the category its front matter names, else in
 * the first category of the chosen dashboard. It is created now — with
 * today's moon phase if it lands in the category Journal.
 */
async function importMarkdownEntry(
  dashboardId: string, categoryName: string, title: string, html: string, tagIds: string[],
): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();
  const categoryId = await ensureCategoryByName(categoryName) ?? startCategoryOf(dashboardId);
  const entry = await createEntry({ categoryId, blank: true });
  await updateEntry(entry.id, { title, content: sanitizeImportedHtml(html), tags: tagIds });
  return entry.id;
}
