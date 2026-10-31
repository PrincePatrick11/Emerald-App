import { invoke } from '@tauri-apps/api/core';
import { todayIso, withoutConcealed } from './blocks/sigil';
import { imageRefsInHtml, isStoredImage, readImageAsBase64, rewriteImageRefs, saveImage } from './images';
import { open as openDialog, save, message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useUIStore } from '../store/uiStore';
import { useEntryStore } from '../store/entryStore';
import { liveTagNames, useTagStore } from '../store/tagStore';
import { useSettingsStore } from '../store/settingsStore';
import { entryMoonPhase } from './moonPhase';
import { useAltarStore } from '../store/altarStore';
import { reloadModules } from '../store/moduleWiring';
import { useImportStore } from '../store/importStore';
import { useTaskStore } from '../store/taskStore';
import { getDb } from './db';
import { LEGACY_WIKI_CATEGORIES } from './schemaV37';
import { categoryKey } from './categoryMerge';
import { categoryLabel } from './categories';
import { useCategoryStore } from '../store/categoryStore';
import { useBlockDefinitionStore } from '../store/blockDefinitionStore';
import { useTemplateStore } from '../store/templateStore';
import {
  ALL_CATEGORIES, assignedCategoryId, MAX_ASSIGNMENTS, parseAssignments, type TemplateAssignment,
} from './blocks/templates';
import { fromRow, toInt } from './row';
import { definitionImageRefs, isDefinitionId, remapDefinitionDefaults } from './blocks/definitions';
import {
  hasLegacyStatus, legacyStatusOfRow, statusDefinition, STATUS_DEFINITION_ID, withLegacyStatus, type LegacyStatus,
} from './blocks/legacyStatus';
import { definitionById } from './blockDefinitionRows';
import { entryBlockSummary } from './blocks/entrySummary';
import { generateId, nowIso } from './helpers';
import i18n from '../i18n';
import { buildLinkItems, linkItemKey, linkItemsByKey } from './linkItems';
import {
  extractInternalLinks, internalLinkBlockHtml, isBlankContent, plainBlockHtml, remapInternalLinks,
} from './internalLinkHtml';
import {
  LEGACY_JOURNAL_FIELDS, type LegacyJournalField,
} from './migrateJournalFieldsToContent';
import type { SuggestionItem } from '../components/editor/SuggestionList';
import type { Category } from '../types';
import type { WriteOptions } from './stamp';
import { displayTitle, hasOwnTitle, isLegacyUntitled } from './entryTitle';
import { prepareImageDataUrl } from './imageLimits';
import {
  ALTAR_BACKGROUND_MAX_BYTES, DEFAULT_ALTAR_BACKGROUND, DEFAULT_ALTAR_RESOLUTION, DEFAULT_BACKGROUND_OVERLAY,
  DEFAULT_OVERLAY_COLOR, DEFAULT_GRID_COLOR, DEFAULT_GRID_OPACITY, DEFAULT_GRID_SIZE,
} from './altarConstants';
import { noAltarOpenMessage } from './altarExport';

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
    altars: useAltarStore.getState().altars,
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
 * then via the title from `meta.contentLinks` — and for old files without that
 * meta via the `data-label` that sits in the chip itself. If nothing is found,
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
 * the same title under the same kind — or `null`. For chips in the content and
 * for the link presets of imported custom blocks.
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

/** A resolved target from the replaced columns, plus optional text
 *  after it (the meditation duration, which has no target of its own). */
interface LegacyLinkTarget {
  id: string | null;
  entryType: 'operation' | 'wiki';
  suffix?: string;
  /**
   * What appears as a plain text paragraph when no target can be resolved.
   * Without it, a value would be lost that has no counterpart in this vault
   * — exactly the case that migration v37 catches with `plainBlockHtml`.
   */
  fallbackText?: string;
}

/**
 * Appends the links from the replaced journal columns as blocks to the
 * content — so that a `.emerald` or Markdown file from before the migrations
 * v36/v37 ends up where links live today, instead of in columns with no
 * display. That concerns `linked_operation_ids`/`linked_wiki_ids` as well as
 * Paradigm, Banishing and Meditation.
 *
 * The IDs must already be resolved to THIS vault; the resolving itself
 * differs per file format and is left to the caller.
 */
function appendLegacyLinks(
  content: string,
  items: SuggestionItem[],
  targets: LegacyLinkTarget[],
): string {
  // What the content already links is not appended again — across all
  // sources, hence one shared set.
  const already = new Set(extractInternalLinks(content).map(linkItemKey));
  let separator = !isBlankContent(content);
  let out = content;

  for (const { id, entryType, suffix, fallbackText } of targets) {
    const key = id ? linkItemKey({ id, entryType }) : null;
    const item = key && !already.has(key) ? items.find((i) => linkItemKey(i) === key) : undefined;
    if (!item) {
      // No target in this vault — the words at least stay as text,
      // provided the caller supplied some.
      if (!fallbackText || (key && already.has(key))) continue;
      out += plainBlockHtml(suffix ? `${fallbackText} ${suffix}` : fallbackText, { separator });
      separator = true;
      continue;
    }
    already.add(key!);
    out += internalLinkBlockHtml(
      {
        id: item.id,
        entryType,
        label: item.label,
        icon: item.icon ?? null,
        entry_number: item.entry_number ?? null,
      },
      item.categoryLabel ?? '',
      { separator, suffix },
    );
    separator = true;
  }
  return out;
}

/**
 * The three replaced journal fields as blocks. `active` is the old checkbox
 * from `is_bannung`/`is_meditation`: if it was set without an article being
 * found for it in THIS vault, at least a text paragraph remains — as in
 * migration v37 — instead of nothing at all.
 */
function legacyFieldTargets(fields: Array<{
  key: LegacyJournalField;
  id: string | null;
  /** The title from the file; still stays there even if it matches nothing here. */
  title?: string | null;
  active?: boolean;
  suffix?: string;
}>): LegacyLinkTarget[] {
  return fields
    .filter((f) => f.id || f.title || f.active)
    .map((f) => ({
      id: f.id,
      entryType: 'wiki' as const,
      suffix: f.suffix,
      fallbackText: `${LEGACY_JOURNAL_FIELDS[f.key].emoji} ${
        f.title || i18n.t(`wiki.categories.${f.key}`) || LEGACY_JOURNAL_FIELDS[f.key].fallbackName
      }`,
    }));
}

// ── File format ──────────────────────────────────────────────────────────────

/**
 * '1' = up to v38; '2' = the file carries `meta.blockDefinitions`. Only then —
 * an entry without custom blocks (and every altar) stays '1', so that an
 * older app keeps accepting it. '3' = a template (`type: 'template'`,
 * since v43): an older app does not know the type and would otherwise take the file
 * for an operation — with '3' it rejects it.
 */
type EmeraldVersion = '1' | '2' | '3';

interface EmeraldFile {
  version: EmeraldVersion;
  type: 'journal' | 'wiki' | 'operations' | 'altar' | 'template';
  title: string;
  createdAt: string;
  content: string;
  images: Record<string, string>;  // original absolute path → data-URL
  meta: EmeraldMeta;
}

interface EmeraldMeta {
  // journal
  moonPhase?: string;
  paradigmaTitle?: string;
  isBannung?: boolean;
  bannungTitle?: string;
  isMeditation?: boolean;
  meditationTitle?: string;
  meditationDuration?: number;
  // Legacy: the two replaced journal columns. Since migration v36
  // journal links live in `content` and travel via `contentLinks`;
  // these fields are only still filled for entries whose columns a backup
  // from before v36 restored.
  linkedOps?: Array<{ id: string; title: string }>;
  linkedWiki?: Array<{ id: string; title: string }>;
  // legacy (v1 files written before ID was stored)
  linkedOpsTitles?: string[];
  linkedWikiTitles?: string[];
  /**
   * wiki + operations: the category via its display name (and its emoji,
   * in case it has to be created in the target vault first). The name, not the
   * ID — a `.emerald` file travels between vaults, and the same self-created
   * category has a different ID there.
   */
  categoryName?: string;
  categoryEmoji?: string;
  // Legacy from before v38: wiki named the category via ID (builtins) or
  // name, operations only via name. Still read and, for older
  // app versions, still written.
  wikiCategoryId?: string;
  wikiCategoryName?: string;
  opCategoryName?: string;
  // Legacy up to v40 (operations): becomes the status block on import
  // (lib/blocks/legacyStatus.ts), it is no longer written.
  isActive?: boolean;
  endDate?: string | null;
  version?: string | null;
  // wiki / operations entry icon (emoji or data-URL)
  icon?: string;
  // common
  tags?: string[];
  /**
   * Title for every link chip in `content` — the repair aid for import
   * into a FOREIGN vault, where the same note has a different ID. Without it
   * the chips point at IDs after import that do not exist there.
   *
   * Replaces `linkedOps`/`linkedWiki` in this role and covers all five
   * module types, not only operations and wiki articles.
   */
  contentLinks?: Array<{ id: string; entryType: string; title: string }>;
  /**
   * The custom blocks the content carries copies of (since '2'). The
   * copies work without them — rendering happens from the copy. With them,
   * the target vault recognizes the origin and offers "Update".
   * Created by ID on import if they do not exist there.
   */
  blockDefinitions?: Array<Record<string, unknown>>;
  /**
   * Templates only (the name is in `title`, icon and tags in `icon`/`tags`):
   * the title of new entries and the assignments —
   * categories as with an entry via name and emoji, built-in ones additionally
   * via their ID (their name depends on the language); `all` for "all
   * categories", with neither "no category". Stars do not travel along.
   */
  newEntryTitle?: string;
  templateAssignments?: Array<{
    entryType: string;
    all?: boolean;
    categoryName?: string;
    categoryEmoji?: string;
    builtinCategoryId?: string;
  }>;
  // altar — background_image_data is a stored image filename, so it's routed
  // through `images` like content images. icon_data, thumbnail_data, and item
  // images are already data: URLs (or a plain emoji, for icon) in the DB, so
  // they're embedded directly rather than treated as paths.
  altarBackgroundPreset?: string;
  altarBackgroundImagePath?: string;
  altarBackgroundOverlay?: number;
  altarBackgroundOverlayColor?: string;
  altarThumbnailData?: string;
  altarIconData?: string;
  altarGridEnabled?: boolean;
  altarGridSize?: number;
  altarGridOpacity?: number;
  altarGridColor?: string;
  altarSnapToGrid?: boolean;
  altarRotationSnapEnabled?: boolean;
  altarRotationSnapAngle?: number;
  altarSnapScaleToGrid?: boolean;
  altarResolution?: string;
  altarCategories?: Array<{ name: string; emoji: string }>;
  altarItems?: Array<{
    id: string;
    name: string;
    emoji: string;
    /**
     * Category *name*, not the ID. A `.emerald` file travels between
     * vaults, and the same self-created category has different
     * IDs there. The import therefore matches by name and resolves it
     * locally. The database holds the ID since v33.
     */
    category: string;
    note: string;
    imageData?: string;
    /** Missing in files from before the library sorting — the import then stamps
     *  the import time, as it always did before. */
    createdAt?: string;
  }>;
  altarPlacements?: Array<{
    itemId: string;
    x: number;
    y: number;
    z_index: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    locked: boolean;
    hidden: boolean;
  }>;
}

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
  if (view.type === 'altar') {
    return exportAltarAsEmerald();
  }
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
    meta.wikiCategoryId   = article.category_id ?? undefined;
    // No fallback to the raw ID: a category in the trash is not loaded
    // here, and the import would turn the UUID into a name.
    meta.wikiCategoryName = cat?.name;
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
    meta.opCategoryName = cat?.name;
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
  const blockDefinitions = definitionsUsedIn(view.id, content);
  if (blockDefinitions.length) meta.blockDefinitions = blockDefinitions;

  const images = await embedImages(content, meta.blockDefinitions);
  await saveEmeraldFile({
    version: meta.blockDefinitions ? '2' : '1', type, title, createdAt, content, images, meta,
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
 * The local images of the content as Base64 — plus the image presets of the
 * custom blocks sent along, otherwise a new copy would show a dead image.
 * A missing image is dropped.
 */
async function embedImages(content: string, blockDefinitions: EmeraldMeta['blockDefinitions']): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  const definitionImages = (blockDefinitions ?? []).flatMap((d) =>
    definitionImageRefs(Array.isArray(d.elements) ? d.elements : []));
  for (const ref of new Set([...imageRefsInHtml(content), ...definitionImages])) {
    try {
      images[ref] = await readImageAsBase64(ref);
    } catch { /* skip missing files */ }
  }
  return images;
}

/**
 * A template as `.emerald` (version '3'): block stack, images, link titles
 * and custom blocks as with an entry, plus icon, description, title of new
 * entries, tags and assignments. The saved state is exported,
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
    templateAssignments: await exportedAssignments(template.assignments),
    contentLinks: collectContentLinks(content),
  };
  const blockDefinitions = definitionsUsedIn(template.id, content);
  if (blockDefinitions.length) meta.blockDefinitions = blockDefinitions;
  // An image icon is a data URL and is already in `meta.icon`.
  const images = await embedImages(content, blockDefinitions);
  return { version: '3', type: 'template', title: template.name || 'Template', createdAt: template.created_at, content, images, meta };
}

/**
 * The assignments for the file format. Categories in the trash travel along too
 * (the import brings them back) — without them the template might end up in the target
 * without an assignment, i.e. in every entry. That is why the categories come from the
 * database, not from the store, which only knows the active ones.
 */
async function exportedAssignments(assignments: readonly TemplateAssignment[]): Promise<NonNullable<EmeraldMeta['templateAssignments']>> {
  if (!assignments.length) return [];
  const rows = await (await getDb()).select<{ id: string; name: string; emoji: string | null; is_builtin: number }[]>(
    'SELECT id, name, emoji, is_builtin FROM categories'
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return assignments.flatMap((a): NonNullable<EmeraldMeta['templateAssignments']> => {
    const id = assignedCategoryId(a);
    if (id === null) return [a.category === ALL_CATEGORIES ? { entryType: a.entryType, all: true } : { entryType: a.entryType }];
    const cat = byId.get(id);
    if (!cat) return [];
    const isBuiltin = !!cat.is_builtin;
    return [{
      entryType: a.entryType,
      categoryName: categoryLabel(i18n.t, { id: cat.id, name: cat.name, is_builtin: isBuiltin }),
      categoryEmoji: cat.emoji ?? undefined,
      ...(isBuiltin ? { builtinCategoryId: cat.id } : {}),
    }];
  });
}

async function exportAltarAsEmerald(): Promise<void> {
  const { altars, activeAltarId, items, placements } = useAltarStore.getState();
  const { categories } = useCategoryStore.getState();
  const altar = altars.find(a => a.id === activeAltarId);
  if (!altar) {
    await noAltarOpenMessage();
    return;
  }

  // Only background_image_data is a stored image filename — read it via Rust like
  // content images. icon_data, thumbnail_data, and item images are already
  // data: URLs (or a plain emoji for icon_data) straight from the DB.
  const images: Record<string, string> = {};
  const bgPath = altar.background_image_data;
  if (isStoredImage(bgPath)) {
    try {
      images[bgPath!] = await readImageAsBase64(bgPath!);
    } catch { /* skip missing file */ }
  }

  const placedItemIds = new Set(placements.map(p => p.item_id));
  const altarItems = items.filter(i => placedItemIds.has(i.id));
  const usedCategoryIds = new Set(altarItems.map(i => i.category_id));
  const usedCategories = categories.filter(c => usedCategoryIds.has(c.id));
  // Translated names, so that a German "Sigillen" in the target vault hits the
  // built-in category again instead of creating a second one.
  const categoryNameById = new Map(categories.map(c => [c.id, categoryLabel(i18n.t, c)]));

  const meta: EmeraldMeta = {
    altarBackgroundPreset: altar.background_preset,
    altarBackgroundImagePath: altar.background_image_data ?? undefined,
    altarBackgroundOverlay: altar.background_overlay,
    altarBackgroundOverlayColor: altar.background_overlay_color,
    altarThumbnailData: altar.thumbnail_data ?? undefined,
    altarIconData: altar.icon_data ?? undefined,
    altarGridEnabled: altar.grid_enabled,
    altarGridSize: altar.grid_size,
    altarGridOpacity: altar.grid_opacity,
    altarGridColor: altar.grid_color,
    altarSnapToGrid: altar.snap_to_grid,
    altarRotationSnapEnabled: altar.rotation_snap_enabled,
    altarRotationSnapAngle: altar.rotation_snap_angle,
    altarSnapScaleToGrid: altar.snap_scale_to_grid,
    altarResolution: altar.resolution,
    altarCategories: usedCategories.map(c => ({ name: categoryLabel(i18n.t, c), emoji: c.emoji })),
    altarItems: altarItems.map(i => ({
      id: i.id, name: i.name, emoji: i.emoji,
      // Empty if the item has no category or its category is in the trash
      // — the import then leaves it without one as well, instead of creating an English
      // "Other" next to "Sonstiges".
      category: (i.category_id && categoryNameById.get(i.category_id)) || '', note: i.note,
      imageData: i.image_data ?? undefined,
      createdAt: i.created_at,
    })),
    altarPlacements: placements.map(p => ({
      itemId: p.item_id, x: p.x, y: p.y, z_index: p.z_index, width: p.width, height: p.height,
      rotation: p.rotation, opacity: p.opacity, locked: p.locked, hidden: p.hidden,
    })),
  };

  const file: EmeraldFile = {
    version: '1',
    type: 'altar',
    title: altar.title,
    createdAt: altar.created_at,
    content: '',
    images,
    meta,
  };

  await saveEmeraldFile(file);
}

/** The active custom blocks the content carries copies of — for `meta.blockDefinitions`. */
function definitionsUsedIn(entryId: string, content: string): NonNullable<EmeraldMeta['blockDefinitions']> {
  const ids = new Set(entryBlockSummary(entryId, content).origins.map((o) => o.id));
  if (!ids.size) return [];
  return useBlockDefinitionStore.getState().definitions
    .filter((d) => ids.has(d.id))
    .map(({ id, name, icon, elements, display, revision }) => ({
      id, name, icon, elements, display, revision,
    }));
}

/**
 * Creates the imported custom blocks, as far as they do not exist here.
 * The file is foreign: every definition goes through the same check as a
 * database row, one without a usable ID is dropped.
 */
async function importBlockDefinitions(raw: EmeraldMeta['blockDefinitions'], items: SuggestionItem[]): Promise<void> {
  if (!Array.isArray(raw) || !raw.length) return;
  const now = nowIso();
  const byKey = linkItemsByKey(items);
  const defs = raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && isDefinitionId(r.id))
    // Link presets remapped to this vault like the chips in the content; images are named after their content and stay.
    .map((r) => ({ ...r, elements: remapDefinitionDefaults(r.elements, (name) => name, (t) => resolveImportedTarget(t, undefined, items, byKey)) }))
    .map((r) => fromRow.blockDefinition({ ...r, created_at: now, updated_at: now, deleted_at: null }));
  await useBlockDefinitionStore.getState().importDefinitions(defs);
}

/**
 * Status/end date/version from a file from before v41 as a status block in front of the
 * content — like migration v41, using the same definition: the existing one
 * (also from the trash), otherwise a new one.
 */
async function withImportedStatus(content: string, status: LegacyStatus): Promise<string> {
  if (!hasLegacyStatus(status)) return content;
  const existing = await definitionById(await getDb(), STATUS_DEFINITION_ID);
  const def = existing ?? statusDefinition(i18n.t, nowIso());
  if (!existing) await useBlockDefinitionStore.getState().importDefinitions([def]);
  return withLegacyStatus(content, status, def, i18n.t);
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
  return rewriteImageRefs(content, (ref) => map.get(ref) ?? null);
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

  // A template only comes as '3', and '3' is only a template.
  const knownVersion = file.version === '1' || file.version === '2' || file.version === '3';
  if (!knownVersion || (file.version === '3') !== (file.type === 'template')) {
    await message('Unsupported Emerald file version.', { title: 'Import', kind: 'error' });
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
    // No entry module affected — only tags, categories, custom blocks and templates.
    await reloadModules([]);
    useUIStore.getState().setActiveView({ type: 'templates', id: templateId });
    await message('Template imported successfully!', { title: 'Import', kind: 'info' });
    return;
  }

  if (file.type === 'altar') {
    let newAltarId: string;
    try {
      newAltarId = await importAltarEntry(file);
    } catch (e) {
      await message(`Import failed: ${e}`, { title: 'Import', kind: 'error' });
      return;
    }
    await refreshAfterImport(file.type);
    useUIStore.getState().setActiveView({ type: 'altar', id: newAltarId });
    await message('Altar imported successfully!', { title: 'Import', kind: 'info' });
    return;
  }

  // One snapshot for the whole import: the remap and, for the journal, the
  // legacy links need the same list, and nothing changes in the stock
  // between the two.
  const items = linkItemsSnapshot();
  // Status/end date/version of an operation from before v41 as a block (the values
  // come from the file and are checked like a backup row), the
  // legacy links of a journal entry as chips — both before the filter.
  const content = await importedContent(file, items, (html) => file.type === 'operations'
    ? withImportedStatus(html, legacyStatusOfRow({
        is_active: file.meta.isActive, end_date: file.meta.endDate, version: file.meta.version,
      }))
    : file.type === 'journal' ? appendLegacyLinks(html, items, legacyJournalTargets(file)) : html);
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
    // After the entry: if that fails, no definition is left orphaned
    // behind. The copies in the content do not need them to work.
    await importBlockDefinitions(file.meta.blockDefinitions, items);
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
 * vault, link targets onto this vault, `beforeSanitize`, DOMPurify last.
 *
 * The order is deliberate: the remap (and a `beforeSanitize` that inserts
 * blocks) parses the HTML and serializes it again, and such a round trip
 * must never come AFTER the sanitizer — otherwise what goes into the database
 * is no longer what it checked. The remap itself only reads
 * data attributes and replaces nodes, so it needs no clean input.
 */
async function importedContent(
  file: EmeraldFile,
  items: SuggestionItem[],
  beforeSanitize: (html: string) => string | Promise<string> = (html) => html,
): Promise<string> {
  const remapped = await remapImages(typeof file.content === 'string' ? file.content : '', file.images ?? {});
  const relinked = remapImportedLinks(remapped, file.meta.contentLinks, items);
  return sanitizeImportedHtml(await beforeSanitize(relinked));
}

/**
 * The last step of every import that writes HTML into the database:
 * scripts and event handlers out; TipTap's own data attributes
 * (link chips, image alignment) and inline styles stay.
 */
function sanitizeImportedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: [
      'data-type', 'data-id', 'data-entry-type', 'data-label', 'data-icon',
      'data-entry-number', 'data-align',
    ],
  });
}

/** The tags of the file as IDs of this vault — strings only, the file is foreign. */
async function importedTags(meta: EmeraldMeta): Promise<string[]> {
  return ensureTagIds(Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : []);
}

/**
 * Reads in a `.emerald` template — like an entry: content and tags, then
 * the custom blocks. Without a dialog, so that it can be checked without a file picker;
 * the check of type and version is therefore here too.
 */
export async function importTemplateFile(file: EmeraldFile): Promise<string> {
  if (file.type !== 'template' || file.version !== '3') throw new Error('Not a template file.');
  if (typeof file.meta !== 'object' || file.meta === null) file.meta = {};
  const items = linkItemsSnapshot();
  const content = await importedContent(file, items);
  const id = await createImportedTemplate(file, content, await importedTags(file.meta));
  // After the template: if that fails, no definition is left orphaned behind.
  await importBlockDefinitions(file.meta.blockDefinitions, items);
  return id;
}

/** This many distinct categories a template file may create or bring back — the rest of its assignments is dropped. */
const MAX_IMPORTED_CATEGORIES = 20;

/**
 * Creates the template from the file — always new, with a new ID, and without a star:
 * which template fills new entries is decided by this vault, not by a
 * foreign file. `parseAssignments` checks types, journal and duplicates.
 */
async function createImportedTemplate(file: EmeraldFile, content: string, tagIds: string[]): Promise<string> {
  const { meta } = file;
  const raw = Array.isArray(meta.templateAssignments) ? meta.templateAssignments.slice(0, MAX_ASSIGNMENTS) : [];
  const resolvedByName = new Map<string, string | null>();
  const assignments: unknown[] = [];
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    const category = await importedAssignmentCategory(a, resolvedByName);
    if (category !== undefined) assignments.push({ entryType: a.entryType, category, isDefault: false });
  }
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const created = await useTemplateStore.getState().createTemplate(text(file.title), {
    icon: text(meta.icon) || undefined,
    title: text(meta.newEntryTitle),
    content,
    tags: tagIds,
    assignments: parseAssignments(assignments),
  });
  return created.id;
}

/**
 * The category of an imported assignment: `'*'`, `null` ("no
 * category"), an ID — or `undefined` if the assignment is dropped.
 * Built-in categories via their ID, otherwise via the name as with an entry
 * (missing ones are created, at most `MAX_IMPORTED_CATEGORIES`).
 */
async function importedAssignmentCategory(
  a: NonNullable<EmeraldMeta['templateAssignments']>[number],
  resolvedByName: Map<string, string | null>,
): Promise<string | null | undefined> {
  if (a.entryType === 'journal' || a.all === true) return ALL_CATEGORIES;
  const builtin = typeof a.builtinCategoryId === 'string'
    ? useCategoryStore.getState().categories.find((c) => c.is_builtin && c.id === a.builtinCategoryId)
    : undefined;
  if (builtin) return builtin.id;
  if (typeof a.categoryName !== 'string' || !a.categoryName.trim()) return null;
  const key = categoryKey(a.categoryName);
  if (!resolvedByName.has(key)) {
    if (resolvedByName.size >= MAX_IMPORTED_CATEGORIES) return undefined;
    resolvedByName.set(key, await ensureCategoryByName(a.categoryName, typeof a.categoryEmoji === 'string' ? a.categoryEmoji : undefined));
  }
  return resolvedByName.get(key) ?? undefined;
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

/** The title from the file — an old English default title becomes empty, as in the database (v48). */
function importedTitle(file: Pick<EmeraldFile, 'title'>): string {
  if (!hasOwnTitle(file.title) || isLegacyUntitled(file.title)) return '';
  // A Markdown or PDF export writes "Untitled…" for an empty title
  // in the app's language — that comes back empty on re-import.
  const untitled = (['journal', 'wiki', 'operation', 'task', 'altar'] as const)
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

/**
 * Files from before the migrations v36/v37 carry their links and the
 * three fields Paradigm/Banishing/Meditation in the meta instead of in the content. On
 * import they become blocks in the text (`appendLegacyLinks`, before the filter)
 * — written to the columns they would no longer be displayed: no chip, no
 * backlink, no search hit.
 */
function legacyJournalTargets(file: EmeraldFile): Parameters<typeof appendLegacyLinks>[2] {
  const { wiki: articles, operation: operations } = useEntryStore.getState().entries;

  const paradigmId = file.meta.paradigmaTitle
    ? (articles.find(a => a.title === file.meta.paradigmaTitle)?.id ?? null)
    : null;
  const bannungId = file.meta.bannungTitle
    ? (articles.find(a => a.title === file.meta.bannungTitle)?.id ?? null)
    : null;
  const meditationId = file.meta.meditationTitle
    ? (articles.find(a => a.title === file.meta.meditationTitle)?.id ?? null)
    : null;
  const resolveOpId = (id: string, title: string) =>
    operations.find(o => o.id === id)?.id ?? operations.find(o => o.title === title)?.id;
  const resolveWikiId = (id: string, title: string) =>
    articles.find(a => a.id === id)?.id ?? articles.find(a => a.title === title)?.id;

  const linkedOpIds = (
    file.meta.linkedOps
      ? file.meta.linkedOps.map(({ id, title }) => resolveOpId(id, title))
      : (file.meta.linkedOpsTitles ?? []).map(t => operations.find(o => o.title === t)?.id)
  ).filter(Boolean) as string[];
  const linkedWikiIds = (
    file.meta.linkedWiki
      ? file.meta.linkedWiki.map(({ id, title }) => resolveWikiId(id, title))
      : (file.meta.linkedWikiTitles ?? []).map(t => articles.find(a => a.title === t)?.id)
  ).filter(Boolean) as string[];

  return [
    ...linkedOpIds.map((id) => ({ id, entryType: 'operation' as const })),
    ...linkedWikiIds.map((id) => ({ id, entryType: 'wiki' as const })),
    ...legacyFieldTargets([
      { key: 'paradigm', id: paradigmId, title: file.meta.paradigmaTitle },
      { key: 'bannung', id: bannungId, title: file.meta.bannungTitle, active: file.meta.isBannung },
      {
        key: 'meditation', id: meditationId, title: file.meta.meditationTitle,
        active: file.meta.isMeditation,
        suffix: file.meta.meditationDuration ? `(${file.meta.meditationDuration} min)` : undefined,
      },
    ]),
  ];
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
 * Before, wiki, operations and altar each had a strategy of their own.
 */
async function ensureCategoryByName(name: string | null | undefined, emoji = '📁'): Promise<string | null> {
  const trimmed = name?.trim();
  // Without a name the entry stays uncategorized — until v38 it fell into the
  // catch-all, which no longer exists as a special case.
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

const LEGACY_WIKI_BY_ID = new Map(LEGACY_WIKI_CATEGORIES.map(([id, , emoji]) => [id, emoji]));

/**
 * Name and emoji of the wiki category from the file. Files from before v38 name
 * builtins only via their ID — which is translated via the old locale key into the name
 * that the same category carries in this vault after the migration.
 */
function legacyWikiCategory(meta: EmeraldMeta): { name: string | undefined; emoji: string | undefined } {
  const id = meta.wikiCategoryId;
  if (id && LEGACY_WIKI_BY_ID.has(id)) {
    const key = `wiki.categories.${id}`;
    return {
      name: i18n.exists(key) ? i18n.t(key) : meta.wikiCategoryName,
      emoji: LEGACY_WIKI_BY_ID.get(id),
    };
  }
  return { name: meta.wikiCategoryName, emoji: undefined };
}

async function importWikiArticle(file: EmeraldFile, content: string, tagIds: string[]): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();

  const legacy = legacyWikiCategory(file.meta);
  const categoryId = await ensureCategoryByName(
    file.meta.categoryName ?? legacy.name,
    file.meta.categoryEmoji ?? legacy.emoji ?? '📄',
  );

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

  const categoryId = await ensureCategoryByName(
    file.meta.categoryName ?? file.meta.opCategoryName,
    file.meta.categoryEmoji ?? '⚡',
  );

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

// ── Import altar from Emerald ────────────────────────────────────────────────

/**
 * Reuses a matching existing altar item or creates a new one.
 * Matches by name + category + image, comparing the image by its actual
 * data: URL content (altar item images are stored inline, never as a local
 * file path — see the note on EmeraldMeta above). The item's id is
 * deliberately not treated as a match on its own — it only proves the two
 * items were assigned the same UUID, not that they're the same artwork, and a
 * file imported from an unrelated vault has no guarantee its ids mean
 * anything here.
 */
async function resolveOrCreateItem(
  itemMeta: NonNullable<EmeraldMeta['altarItems']>[number],
): Promise<{ id: string; created: boolean }> {
  const { items, addItem } = useAltarStore.getState();
  // `importAltarEntry` has already created the file's categories; here the
  // name only resolves.
  const categoryId = await ensureCategoryByName(itemMeta.category);

  const existingMatch = items.find(i =>
    i.name === itemMeta.name &&
    i.category_id === categoryId &&
    (i.image_data ?? null) === (itemMeta.imageData ?? null),
  );
  if (existingMatch) return { id: existingMatch.id, created: false };

  // createdAt comes from a foreign file and lands in a NOT NULL
  // column: only a string is passed through, anything else falls back to now
  // (as with files that do not know the field yet).
  const createdAt = typeof itemMeta.createdAt === 'string' ? itemMeta.createdAt : undefined;
  const created = await addItem(itemMeta.name, itemMeta.emoji, categoryId, itemMeta.note, itemMeta.imageData, createdAt);
  return { id: created.id, created: true };
}

/**
 * The background of an imported altar: subject to the same limits as when
 * uploading in the sidebar (vault limits plus `ALTAR_BACKGROUND_MAX_BYTES`).
 * If it is still too large even downscaled, it is taken unchanged — like images in the content
 * (`remapImages`).
 */
async function remapAltarImagePath(path: string | undefined, images: Record<string, string>): Promise<string | null> {
  if (!path) return null;
  const dataUrl = images[path];
  if (!dataUrl) return path;
  try {
    const prepared = await prepareImageDataUrl(dataUrl, { capBytes: ALTAR_BACKGROUND_MAX_BYTES }).catch(() => dataUrl);
    return await saveImage(prepared);
  } catch {
    return null;
  }
}

async function importAltarEntry(file: EmeraldFile): Promise<string> {
  const { createAltar, updateAltar, updateAltarGrid, updateAltarResolution, permanentlyDeleteAltar, permanentlyDeleteItem } = useAltarStore.getState();
  const altar = await createAltar({ createdAt: importedCreatedAt(file) });
  // Only items actually *created* (not reused) get rolled back on failure —
  // altar_items is a shared library, so a partial import must not leave
  // undetectable debris in it the way it briefly leaves the (fully deleted)
  // altar behind. See the catch block below.
  const createdItemIds: string[] = [];

  try {
    const images = file.images ?? {};
    const meta = file.meta;

    const backgroundImageData = await remapAltarImagePath(meta.altarBackgroundImagePath, images);

    await updateAltar(altar.id, {
      title: importedTitle(file),
      background_preset: meta.altarBackgroundPreset || DEFAULT_ALTAR_BACKGROUND,
      background_image_data: backgroundImageData,
      background_overlay: meta.altarBackgroundOverlay ?? DEFAULT_BACKGROUND_OVERLAY,
      background_overlay_color: meta.altarBackgroundOverlayColor ?? DEFAULT_OVERLAY_COLOR,
      thumbnail_data: meta.altarThumbnailData ?? null,
      icon_data: meta.altarIconData ?? null,
    });

    await updateAltarGrid(altar.id, {
      grid_enabled: meta.altarGridEnabled ?? false,
      grid_size: meta.altarGridSize ?? DEFAULT_GRID_SIZE,
      grid_opacity: meta.altarGridOpacity ?? DEFAULT_GRID_OPACITY,
      grid_color: meta.altarGridColor ?? DEFAULT_GRID_COLOR,
      snap_to_grid: meta.altarSnapToGrid ?? false,
      rotation_snap_enabled: meta.altarRotationSnapEnabled ?? false,
      rotation_snap_angle: meta.altarRotationSnapAngle ?? 15,
      snap_scale_to_grid: meta.altarSnapScaleToGrid ?? false,
    });

    await updateAltarResolution(altar.id, meta.altarResolution || DEFAULT_ALTAR_RESOLUTION);

    for (const cat of meta.altarCategories ?? []) {
      await ensureCategoryByName(cat.name, cat.emoji);
    }

    const idMap = new Map<string, string>();
    for (const itemMeta of meta.altarItems ?? []) {
      const { id, created } = await resolveOrCreateItem(itemMeta);
      idMap.set(itemMeta.id, id);
      if (created) createdItemIds.push(id);
    }

    // Insert placements directly via SQL (like duplicateAltar does) rather than
    // through placeItem()/updatePlacement() — those read the store's
    // activeAltarId, which AltarView's view-sync effect can reassign out from
    // under a bulk import as soon as createAltar() changes it, silently
    // dropping every placement onto the wrong altar (or nowhere).
    const db = await getDb();
    for (const placementMeta of meta.altarPlacements ?? []) {
      const realItemId = idMap.get(placementMeta.itemId);
      if (!realItemId) continue;
      await db.execute(
        'INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          generateId(),
          altar.id,
          realItemId,
          placementMeta.x,
          placementMeta.y,
          placementMeta.z_index,
          placementMeta.width,
          placementMeta.height,
          placementMeta.rotation,
          placementMeta.opacity,
          toInt(placementMeta.locked),
          toInt(placementMeta.hidden),
        ],
      );
    }

    // Grid and format stamp "now" when writing — in the end, as with the
    // entries, the file's creation date applies.
    await updateAltar(altar.id, {}, importedStamp(importedCreatedAt(file)));

    return altar.id;
  } catch (e) {
    await permanentlyDeleteAltar(altar.id).catch(() => {});
    for (const itemId of createdItemIds) {
      await permanentlyDeleteItem(itemId).catch(() => {});
    }
    throw e;
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

/** Parses a comma-separated linked-items string. Each item may be "Icon Title [id]" or just "Icon Title". */
function parseLinkedItems(raw: string): Array<{ id: string | null; title: string }> {
  return raw.split(',').map(s => {
    const stripped = stripIconPrefix(s.trim());
    const idMatch = /\[([^\]]+)\]$/.exec(stripped);
    if (idMatch) {
      return { id: idMatch[1], title: stripped.slice(0, idMatch.index).trim() };
    }
    return { id: null, title: stripped };
  }).filter(item => item.title);
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
  // (unlike .emerald files, which also carry 'altar'). A missing or
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
      newId = await importJournalFromMarkdown(title, html, tagIds, frontMeta);
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

async function importJournalFromMarkdown(
  title: string, html: string, tagIds: string[],
  meta: Record<string, string>,
): Promise<string> {
  const { createEntry, updateEntry } = useEntryStore.getState();
  const { wiki: articles, operation: operations } = useEntryStore.getState().entries;

  const paradigmaName = meta['paradigma'] ? stripIconPrefix(meta['paradigma']) : null;
  const paradigmId = paradigmaName
    ? (articles.find(a => a.title === paradigmaName)?.id ?? null)
    : null;

  const bannungName = meta['bannung'] ? stripIconPrefix(meta['bannung']) : null;
  const bannungId = bannungName
    ? (articles.find(a => a.title === bannungName)?.id ?? null)
    : null;

  let meditationName: string | null = null;
  let meditationDuration: number | null = null;
  if (meta['meditation']) {
    const raw = stripIconPrefix(meta['meditation']);
    const durMatch = /\((\d+)\s*min\)$/.exec(raw);
    meditationDuration = durMatch ? parseInt(durMatch[1], 10) : null;
    meditationName     = durMatch ? raw.slice(0, durMatch.index).trim() : raw;
  }
  const meditationId = meditationName
    ? (articles.find(a => a.title === meditationName)?.id ?? null)
    : null;

  const linkedOpIds = parseLinkedItems(meta['operations'] ?? '')
    .map(({ id, title }) => id
      ? (operations.find(o => o.id === id)?.id ?? operations.find(o => o.title === title)?.id)
      : operations.find(o => o.title === title)?.id
    ).filter(Boolean) as string[];

  const linkedWikiIds = parseLinkedItems(meta['wiki'] ?? '')
    .map(({ id, title }) => id
      ? (articles.find(a => a.id === id)?.id ?? articles.find(a => a.title === title)?.id)
      : articles.find(a => a.title === title)?.id
    ).filter(Boolean) as string[];

  // As with the `.emerald` import: everything from the Markdown header lands as a
  // block in the text, not in the replaced columns.
  const content = sanitizeImportedHtml(appendLegacyLinks(html, linkItemsSnapshot(), [
    ...linkedOpIds.map((id) => ({ id, entryType: 'operation' as const })),
    ...linkedWikiIds.map((id) => ({ id, entryType: 'wiki' as const })),
    ...legacyFieldTargets([
      { key: 'paradigm', id: paradigmId, title: paradigmaName },
      { key: 'bannung', id: bannungId, title: bannungName },
      {
        key: 'meditation', id: meditationId, title: meditationName,
        suffix: meditationDuration ? `(${meditationDuration} min)` : undefined,
      },
    ]),
  ]));

  // Without a date in the file the entry is created today — with today's moon phase.
  const entry = await createEntry('journal', { blank: true });
  await updateEntry(entry.id, { title, content, tags: tagIds });
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

  // "Status"/"End Date"/"Version" in the header come from exports up to v40. Before
  // creating: if the conversion fails, no empty operation is left behind.
  const content = sanitizeImportedHtml(await withImportedStatus(html, {
    isActive: meta['status'] ? meta['status'].toLowerCase() === 'active' : true,
    endDate: meta['end date'] ?? null,
    version: meta['version'] ?? null,
  }));
  const op = await createEntry('operation', { categoryId, blank: true });
  await updateEntry(op.id, { title, content, category_id: categoryId, tags: tagIds });
  return op.id;
}
