import { invoke } from '@tauri-apps/api/core';
import { todayIso, withoutConcealed } from './blocks/sigil';
import { readImageAsBase64, rewriteImageRefs, saveImage, storedImageName } from './images';
import { storedImageNamesIn } from './schema';
import { parseBlocks } from './blocks/blockHtml';
import { blockRefs } from './blocks/blockRefs';
import { open as openDialog, save, message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useUIStore } from '../store/uiStore';
import { useEntryStore } from '../store/entryStore';
import { liveTagNames, useTagStore } from '../store/tagStore';
import { useSettingsStore } from '../store/settingsStore';
import { entryMoonPhase } from './moonPhase';
import { reloadModules } from '../store/moduleWiring';
import { useImportStore } from '../store/importStore';
import { useTaskStore } from '../store/taskStore';
import { getDb } from './db';
import { categoryKey, categoryLabel } from './categories';
import { useCategoryStore } from '../store/categoryStore';
import { useTemplateStore } from '../store/templateStore';
import i18n from '../i18n';
import { buildLinkItems, linkItemKey, linkItemsByKey } from './linkItems';
import { extractInternalLinks, remapInternalLinks } from './internalLinkHtml';
import type { SuggestionItem } from '../components/editors/text/SuggestionList';
import type { Category } from '../types';
import type { WriteOptions } from './stamp';
import { displayTitle, hasOwnTitle } from './entryTitle';
import { prepareImageDataUrl } from './imageLimits';

// ── Link chips across vault boundaries ───────────────────────────────────────

/** `buildLinkItems` over the current stores — the React-free variant of
 *  `useLinkItems`, for the import/export paths. */
function linkItemsSnapshot(): SuggestionItem[] {
  return buildLinkItems({
    entries: useEntryStore.getState().entries.journal,
    tasks: useTaskStore.getState().tasks,
    operations: useEntryStore.getState().entries.operation,
    articles: useEntryStore.getState().entries.wiki,
    categories: useCategoryStore.getState().categories,
    showMoonPhase: useSettingsStore.getState().settings.journal.moonPhase,
  }, i18n.t);
}

/** The title of every link chip in the content — travels along as `meta.contentLinks`. */
function collectContentLinks(content: string): EmeraldMeta['contentLinks'] {
  const byKey = linkItemsByKey(linkItemsSnapshot());
  const seen = new Set<string>();
  const out: NonNullable<EmeraldMeta['contentLinks']> = [];
  for (const link of extractInternalLinks(content)) {
    const key = linkItemKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: link.id, entryType: link.entryType, title: byKey.get(key)?.label ?? '' });
  }
  return out.length ? out : undefined;
}

/**
 * Points every link chip of the imported content at the target IN THIS vault:
 * first via the ID (the same vault or an already matching entry),
 * then via the title from `meta.contentLinks`, otherwise via the
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
  manifest: EmeraldMeta['contentLinks'],
  items: SuggestionItem[],
): string {
  const byKey = linkItemsByKey(items);
  const titleByKey = new Map((manifest ?? []).map((l) => [linkItemKey(l), l.title]));
  return remapInternalLinks(content, (link) => resolveImportedTarget(link, titleByKey.get(linkItemKey(link)), items, byKey));
}

/**
 * A link target from a foreign file in this vault: the same ID, otherwise
 * the same title under the same kind — or `null`.
 */
function resolveImportedTarget(
  link: { id: string; entryType: string; label: string },
  manifestTitle: string | undefined,
  items: SuggestionItem[],
  byKey = linkItemsByKey(items),
): { id: string; label: string } | null {
  const local = byKey.get(linkItemKey({ id: link.id, entryType: link.entryType as SuggestionItem['entryType'] }));
  if (local) return { id: local.id, label: local.label };
  const title = manifestTitle || link.label;
  if (!title) return null;
  const match = items.find((i) => i.entryType === link.entryType && i.label === title);
  return match ? { id: match.id, label: match.label } : null;
}

// ── File format ──────────────────────────────────────────────────────────────

/**
 * The format of a `.emerald` file. '4' is the first since the fresh start of
 * the schema (`FRESH_START_VERSION` in `schema.ts`), for entries and templates
 * alike (`type` tells them apart). Only this version is read: an older file
 * ('1' to '3') comes from before the fresh start and is refused with a notice —
 * its converters are gone with the old migration chain; a newer one is
 * refused too, since this build cannot know what it carries.
 */
const EMERALD_VERSION = '4';

interface EmeraldFile {
  version: typeof EMERALD_VERSION;
  type: 'journal' | 'wiki' | 'operations' | 'template';
  title: string;
  createdAt: string;
  content: string;
  images: Record<string, string>;  // stored file name → data-URL
  meta: EmeraldMeta;
}

interface EmeraldMeta {
  /** journal: for information only — the import recalculates the phase from `createdAt`. */
  moonPhase?: string;
  /**
   * wiki + operations: the category via its display name (and its emoji,
   * in case it has to be created in the target vault first). The name, not the
   * ID — a `.emerald` file travels between vaults, and the same self-created
   * category has a different ID there.
   */
  categoryName?: string;
  categoryEmoji?: string;
  /** wiki / operations entry icon, a template's icon (emoji or data-URL) */
  icon?: string;
  tags?: string[];
  /**
   * Title for every link chip in `content` — the repair aid for import
   * into a FOREIGN vault, where the same note has a different ID. Without it
   * the chips point at IDs after import that do not exist there.
   */
  contentLinks?: Array<{ id: string; entryType: string; title: string }>;
  /** A template: the title new entries get. */
  newEntryTitle?: string;
}

/**
 * The notice for a file this version does not read — `null` when it does.
 * A version from before '4' is from an older app, a higher one from a newer.
 */
function unreadableVersionNotice(version: unknown): string | null {
  if (version === EMERALD_VERSION) return null;
  const number = Number(version);
  if (Number.isInteger(number) && number >= 1) {
    return i18n.t(number < Number(EMERALD_VERSION) ? 'emeraldImport.oldVersion' : 'emeraldImport.newVersion');
  }
  return i18n.t('emeraldImport.unsupported');
}

const FILE_TYPES: readonly unknown[] = ['journal', 'wiki', 'operations', 'template'] satisfies EmeraldFile['type'][];

/** The file types that open a module — everything except the template. */
type EntryFileType = Exclude<EmeraldFile['type'], 'template'>;

function safeFilename(title: string): string {
  return title.replace(/[^\w\s\-äöüÄÖÜß]/g, '').trim().replace(/\s+/g, '_') || 'export';
}

function exportFilename(title: string, date: string, ext: string): string {
  const base = safeFilename(title);
  const dateStr = format(new Date(date), 'yyyy-MM-dd');
  return `${base}_${dateStr}.${ext}`;
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function exportAsEmerald(): Promise<void> {
  const view = useUIStore.getState().activeView;
  if (view.type === 'templates' && view.id) {
    return exportTemplateAsEmerald(view.id);
  }
  if (!view.id) {
    await message('Please open a journal entry, wiki article, or operation first.', { title: 'Export', kind: 'info' });
    return;
  }
  // Right after startup the content of the open entry may still be pending.
  await useEntryStore.getState().ensureEntryContent(view.id);

  const { journal: entries, wiki: articles, operation: operations } = useEntryStore.getState().entries;
  const { categories }  = useCategoryStore.getState();
  let content = '';
  let title = '';
  let createdAt = '';
  let type: EmeraldFile['type'] = 'journal';
  const meta: EmeraldMeta = {};

  if (view.type === 'journal') {
    const entry = entries.find(e => e.id === view.id);
    if (!entry) return;
    type      = 'journal';
    title     = entry.title;
    content   = entry.content || '';
    createdAt = entry.created_at;

    // For information only: the import recalculates the phase from `createdAt`.
    meta.moonPhase = entryMoonPhase(entry, useSettingsStore.getState().settings.journal.moonPhase) ?? undefined;

    meta.tags = liveTagNames(entry.tags);

  } else if (view.type === 'wiki') {
    const article = articles.find(a => a.id === view.id);
    if (!article) return;
    type      = 'wiki';
    title     = article.title;
    content   = article.content || '';
    createdAt = article.created_at;

    const cat = categories.find(c => c.id === article.category_id);
    meta.categoryName     = categoryLabel(i18n.t, cat) || undefined;
    meta.categoryEmoji    = cat?.emoji;
    meta.icon             = article.icon ?? undefined;
    meta.tags             = liveTagNames(article.tags);

  } else if (view.type === 'operations') {
    const op = operations.find(o => o.id === view.id);
    if (!op) return;
    type      = 'operations';
    title     = op.title;
    content   = op.content || '';
    createdAt = op.created_at;

    const cat = categories.find(c => c.id === op.category_id);
    meta.categoryName   = categoryLabel(i18n.t, cat) || undefined;
    meta.categoryEmoji  = cat?.emoji;
    meta.icon      = op.icon ?? undefined;
    meta.tags      = liveTagNames(op.tags);
  }

  // A loaded, still concealed sigil does not leave — sigil blocks
  // exist in every entry type. Before links, definitions and images, so that
  // the embedded drawing is missing too.
  content = withoutConcealed(content, todayIso());

  // Title for every link chip in the content — applies to all three types, since
  // journal, wiki and operations can link equally.
  meta.contentLinks = collectContentLinks(content);

  const images = await embedImages(content);
  await saveEmeraldFile({
    version: EMERALD_VERSION, type, title, createdAt, content, images, meta,
  });
}

/** Save dialog and writing — the common ending of every `.emerald` export. */
async function saveEmeraldFile(file: EmeraldFile): Promise<void> {
  const savePath = await save({
    defaultPath: exportFilename(file.title, file.createdAt, 'emerald'),
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
  });
  if (!savePath) return;
  await invoke('write_file', { path: savePath, content: JSON.stringify(file, null, 2) });
}

/**
 * The local images of the content as Base64. A missing image is dropped.
 * Taken from the blocks (`blockRefs`), like `block_refs` in the vault: a
 * picture that only stands in a block's JSON — a canvas background, a
 * copy's image prefill — travels along too.
 */
async function embedImages(content: string): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  const refs = parseBlocks(content).flatMap(blockRefs).filter((ref) => ref.kind === 'image').map((ref) => ref.target);
  // And every stored name anywhere in it, as the backup does: a block `blockRefs` cannot fully read keeps its pictures.
  refs.push(...storedImageNamesIn(content));
  for (const ref of new Set(refs)) {
    try {
      images[ref] = await readImageAsBase64(ref);
    } catch { /* skip missing files */ }
  }
  return images;
}

/**
 * A template as `.emerald`: block stack, images and link titles
 * as with an entry, plus icon, title of new entries and tags. The saved state is exported,
 * not an open draft.
 */
export async function exportTemplateAsEmerald(templateId: string): Promise<void> {
  const file = await buildTemplateEmeraldFile(templateId);
  if (!file) {
    await message('Please open a template first.', { title: 'Export', kind: 'info' });
    return;
  }
  await saveEmeraldFile(file);
}

/** The `.emerald` file of a template — without a dialog, so that it can be checked without a file picker too. */
export async function buildTemplateEmeraldFile(templateId: string): Promise<EmeraldFile | null> {
  const template = useTemplateStore.getState().templates.find((tpl) => tpl.id === templateId);
  if (!template) return null;
  // As with the entry: a loaded, concealed sigil does not leave.
  const content = withoutConcealed(template.content, todayIso());
  const meta: EmeraldMeta = {
    icon: template.icon,
    tags: liveTagNames(template.tags),
    newEntryTitle: template.title,
    contentLinks: collectContentLinks(content),
  };
  // An image icon is a data URL and is already in `meta.icon`.
  const images = await embedImages(content);
  return { version: EMERALD_VERSION, type: 'template', title: template.name || 'Template', createdAt: template.created_at, content, images, meta };
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

/**
 * Saves the images of the file into the image folder and rewrites their references.
 * The vault's image limits apply as on insertion; if an image
 * is still too large even downscaled or cannot be downscaled, it is taken
 * unchanged — an import should not lose anything the file brings along.
 */
async function remapImages(content: string, images: Record<string, string>): Promise<string> {
  const map = new Map<string, string>();
  for (const [oldRef, dataUrl] of Object.entries(images)) {
    if (!dataUrl) continue;
    try {
      const prepared = await prepareImageDataUrl(dataUrl).catch(() => dataUrl);
      map.set(oldRef, await saveImage(prepared));
    } catch { /* skip */ }
  }
  let rewritten = rewriteImageRefs(content, (ref) => map.get(ref) ?? null);
  // A canvas names its pictures in its scene JSON too (`ref`, `props.src`,
  // the background): a stored name is a hash, so it is replaced wherever it stands.
  for (const [oldRef, file] of map) {
    if (oldRef !== file && storedImageName(oldRef) === oldRef) rewritten = rewritten.split(oldRef).join(file);
  }
  return rewritten;
}

/** Re-reads the relevant store from DB so the UI reflects the imported data. */
async function refreshAfterImport(type: EntryFileType): Promise<void> {
  await reloadModules([type]);
}

// ── Import from Emerald ──────────────────────────────────────────────────────

export async function importFromEmerald(): Promise<void> {
  const result = await openDialog({
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
    multiple: false,
  });
  const filePath = Array.isArray(result) ? result[0] : result;
  if (!filePath) return;

  let file: EmeraldFile;
  try {
    const json = await invoke<string>('read_file', { path: filePath });
    file = JSON.parse(json);
  } catch (e) {
    await message(`Failed to read file: ${e}`, { title: 'Import', kind: 'error' });
    return;
  }

  // Checked before anything is created: a refused file leaves the vault as it is.
  // A type this version does not know is no file it can read either.
  const notice = unreadableVersionNotice(file?.version)
    ?? (FILE_TYPES.includes(file.type) ? null : i18n.t('emeraldImport.unsupported'));
  if (notice) {
    await message(notice, { title: 'Import', kind: 'error' });
    return;
  }
  if (typeof file.meta !== 'object' || file.meta === null) file.meta = {};

  if (file.type === 'template') {
    let templateId: string;
    try {
      templateId = await importTemplateFile(file);
    } catch (e) {
      await message(`Import failed: ${e}`, { title: 'Import', kind: 'error' });
      return;
    }
    // No entry module affected — only tags and templates.
    await reloadModules([]);
    useUIStore.getState().setActiveView({ type: 'templates', id: templateId });
    await message('Template imported successfully!', { title: 'Import', kind: 'info' });
    return;
  }

  const items = linkItemsSnapshot();
  const content = await importedContent(file, items);
  const tagIds = await importedTags(file.meta);

  let newId: string;
  try {
    if (file.type === 'journal') {
      newId = await importJournalEntry(file, content, tagIds);
    } else if (file.type === 'wiki') {
      newId = await importWikiArticle(file, content, tagIds);
    } else {
      newId = await importOperationEntry(file, content, tagIds);
    }
  } catch (e) {
    await message(`Import failed: ${e}`, { title: 'Import', kind: 'error' });
    return;
  }

  await refreshAfterImport(file.type);
  useUIStore.getState().setActiveView({ type: file.type, id: newId });
  await message('Entry imported successfully!', { title: 'Import', kind: 'info' });
}

/**
 * The content of an imported file, ready to be saved: images into this
 * vault, link targets onto this vault, DOMPurify last.
 *
 * The order is deliberate: the remap parses the HTML and serializes it again, and such a round trip
 * must never come AFTER the sanitizer — otherwise what goes into the database
 * is no longer what it checked. The remap itself only reads
 * data attributes and replaces nodes, so it needs no clean input.
 */
async function importedContent(
  file: EmeraldFile,
  items: SuggestionItem[],
): Promise<string> {
  const raw = typeof file.content === 'string' ? file.content : '';
  const remapped = await remapImages(raw, file.images ?? {});
  const relinked = remapImportedLinks(remapped, file.meta.contentLinks, items);
  return sanitizeImportedHtml(relinked);
}

/**
 * The last step of every import that writes HTML into the database:
 * scripts and event handlers out; TipTap's own data attributes
 * (link chips, image alignment, table column widths, text colours) and inline styles stay.
 */
function sanitizeImportedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: [
      'data-type', 'data-id', 'data-entry-type', 'data-label', 'data-icon',
      'data-entry-number', 'data-align', 'colwidth', 'data-color',
    ],
  });
}

/** The tags of the file as IDs of this vault — strings only, the file is foreign. */
async function importedTags(meta: EmeraldMeta): Promise<string[]> {
  return ensureTagIds(Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : []);
}

/**
 * Reads in a `.emerald` template — like an entry: content and tags. Without
 * a dialog, so that it can be checked without a file picker; the check of
 * type and version is therefore here too.
 */
export async function importTemplateFile(file: EmeraldFile): Promise<string> {
  const notice = unreadableVersionNotice(file.version);
  if (notice) throw new Error(notice);
  if (file.type !== 'template') throw new Error('Not a template file.');
  if (typeof file.meta !== 'object' || file.meta === null) file.meta = {};
  const content = await importedContent(file, linkItemsSnapshot());
  return createImportedTemplate(file, content, await importedTags(file.meta));
}

/**
 * Creates the template from the file — always new, with a new ID, and without an
 * assignment: which template fills new entries is decided by this vault, not by a
 * foreign file.
 */
async function createImportedTemplate(file: EmeraldFile, content: string, tagIds: string[]): Promise<string> {
  const { meta } = file;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const created = await useTemplateStore.getState().createTemplate(text(file.title), {
    icon: text(meta.icon) || undefined,
    title: text(meta.newEntryTitle),
    content,
    tags: tagIds,
  });
  return created.id;
}

/**
 * The creation date from the file, so that an entry lands at its place in the
 * timeline instead of as the newest. The file is foreign: only a readable
 * date with a four-digit year, as ISO like any other — dates are sorted as
 * text, and `+010000-…` would sort before 2024. Otherwise now.
 */
function importedCreatedAt(file: EmeraldFile): string | undefined {
  const time = typeof file.createdAt === 'string' ? Date.parse(file.createdAt) : NaN;
  if (Number.isNaN(time)) return undefined;
  const iso = new Date(time).toISOString();
  return /^\d{4}-/.test(iso) ? iso : undefined;
}

/** The title from the file. */
function importedTitle(file: Pick<EmeraldFile, 'title'>): string {
  if (!hasOwnTitle(file.title)) return '';
  // A Markdown or PDF export writes "Untitled…" for an empty title
  // in the app's language — that comes back empty on re-import.
  const untitled = (['journal', 'wiki', 'operation', 'task'] as const)
    .map((type) => displayTitle(i18n.t, type, ''));
  return untitled.includes(file.title.trim()) ? '' : file.title;
}

/**
 * "Last modified" of an imported entry: its creation date. The file
 * has no modification date, and an import is not an edit — otherwise
 * it would still be at the very top of lists that sort by it (operations).
 */
function importedStamp(createdAt: string | undefined): WriteOptions {
  return { touch: createdAt ?? true };
}

async function importJournalEntry(file: EmeraldFile, content: string, tagIds: string[]): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();
  // The moon phase follows from the file's creation date (`entryMoonPhase`).
  const createdAt = importedCreatedAt(file);
  const entry = await createEntry('journal', { blank: true, createdAt });
  await updateEntry(entry.id, { title: importedTitle(file), content, tags: tagIds }, importedStamp(createdAt));
  return entry.id;
}

/**
 * The one category resolution of the import, for all four modules: the local
 * category with this name (case-insensitive, builtins also via their
 * translated name), otherwise newly created; without a name the entry stays
 * uncategorized.
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
    return (await store.addCategory(trimmed, emoji || '📁')).id;
  } catch {
    // Name conflict from a parallel creation — then it exists now.
    return useCategoryStore.getState().categories.find(matches)?.id ?? null;
  }
}

async function importWikiArticle(file: EmeraldFile, content: string, tagIds: string[]): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();

  const categoryId = await ensureCategoryByName(file.meta.categoryName, file.meta.categoryEmoji ?? '📄');

  const createdAt = importedCreatedAt(file);
  const article = await createEntry('wiki', { categoryId, blank: true, createdAt });
  await updateEntry(article.id, {
    title: importedTitle(file),
    content,
    category_id: categoryId,
    tags: tagIds,
    icon: file.meta.icon ?? undefined,
  }, importedStamp(createdAt));
  return article.id;
}

async function importOperationEntry(file: EmeraldFile, content: string, tagIds: string[]): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();

  const categoryId = await ensureCategoryByName(file.meta.categoryName, file.meta.categoryEmoji ?? '⚡');

  const createdAt = importedCreatedAt(file);
  const op = await createEntry('operation', { categoryId, blank: true, createdAt });
  await updateEntry(op.id, {
    title: importedTitle(file),
    content,
    category_id: categoryId,
    tags: tagIds,
    icon: file.meta.icon ?? undefined,
  }, importedStamp(createdAt));
  return op.id;
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

  // Markdown import only supports journal/wiki/operations as a destination
  // (unlike .emerald files, which also carry templates). A missing or
  // unrecognised `type` frontmatter key is ambiguous, so ask the user
  // instead of silently defaulting to journal.
  const rawType = frontMeta['type'];
  const validTypes = ['journal', 'wiki', 'operations'];
  let type: EntryFileType;
  if (rawType && validTypes.includes(rawType)) {
    type = rawType as EntryFileType;
  } else {
    const chosen = await useImportStore.getState().askDestination(title);
    if (!chosen) return;
    type = chosen;
  }

  const tagIds = await ensureTagIds(
    (frontMeta['tags'] ?? '').split(',').map(t => t.trim()).filter(Boolean),
  );

  let newId: string;
  try {
    if (type === 'journal') {
      newId = await importJournalFromMarkdown(title, html, tagIds);
    } else if (type === 'wiki') {
      newId = await importWikiFromMarkdown(title, html, tagIds, frontMeta);
    } else {
      newId = await importOperationFromMarkdown(title, html, tagIds, frontMeta);
    }
  } catch (e) {
    await message(`Import failed: ${e}`, { title: 'Import', kind: 'error' });
    return;
  }

  await refreshAfterImport(type);
  useUIStore.getState().setActiveView({ type, id: newId });
  await message('Entry imported successfully!', { title: 'Import', kind: 'info' });
}

async function importJournalFromMarkdown(title: string, html: string, tagIds: string[]): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();
  // Without a date in the file the entry is created today — with today's moon phase.
  const entry = await createEntry('journal', { blank: true });
  await updateEntry(entry.id, { title, content: sanitizeImportedHtml(html), tags: tagIds });
  return entry.id;
}
async function importWikiFromMarkdown(
  title: string, html: string, tagIds: string[],
  meta: Record<string, string>,
): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();

  const categoryName = meta['category'] ? stripIconPrefix(meta['category']) : null;
  const categoryId = await ensureCategoryByName(categoryName, '📄');

  const article = await createEntry('wiki', { categoryId, blank: true });
  await updateEntry(article.id, { title, content: sanitizeImportedHtml(html), category_id: categoryId, tags: tagIds });
  return article.id;
}

async function importOperationFromMarkdown(
  title: string, html: string, tagIds: string[],
  meta: Record<string, string>,
): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();

  const categoryName = meta['category'] ? stripIconPrefix(meta['category']) : null;
  const categoryId = await ensureCategoryByName(categoryName, '⚡');

  const op = await createEntry('operation', { categoryId, blank: true });
  await updateEntry(op.id, { title, content: sanitizeImportedHtml(html), category_id: categoryId, tags: tagIds });
  return op.id;
}
