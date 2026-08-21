import { invoke } from '@tauri-apps/api/core';
import { imageRefsInHtml, isStoredImage, readImageAsBase64, rewriteImageRefs, saveImage } from './images';
import { open as openDialog, save, message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useUIStore } from '../store/uiStore';
import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useTagStore } from '../store/tagStore';
import { useAltarStore } from '../store/altarStore';
import { useImportStore } from '../store/importStore';
import { getDb } from './db';
import { BUILTIN_WIKI_CATEGORIES } from './schema';
import { toInt } from './row';
import { generateId } from './helpers';
import {
  DEFAULT_ALTAR_BACKGROUND, DEFAULT_ALTAR_RESOLUTION, DEFAULT_BACKGROUND_OVERLAY,
  DEFAULT_OVERLAY_COLOR, DEFAULT_GRID_COLOR, DEFAULT_GRID_OPACITY, DEFAULT_GRID_SIZE,
} from './altarConstants';
import { MOON_PHASE_SYMBOLS } from './moonPhase';
import { noAltarOpenMessage } from './altarExport';

// ── File format ──────────────────────────────────────────────────────────────

interface EmeraldFile {
  version: '1';
  type: 'journal' | 'wiki' | 'operations' | 'altar';
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
  linkedOps?: Array<{ id: string; title: string }>;
  linkedWiki?: Array<{ id: string; title: string }>;
  // legacy (v1 files written before ID was stored)
  linkedOpsTitles?: string[];
  linkedWikiTitles?: string[];
  // wiki
  wikiCategoryId?: string;
  wikiCategoryName?: string;
  // operations
  opCategoryName?: string;
  isActive?: boolean;
  endDate?: string | null;
  version?: string | null;
  // wiki / operations entry icon (emoji or data-URL)
  icon?: string;
  // common
  tags?: string[];
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
     * Kategorie-*Name*, nicht die ID. Eine `.emerald`-Datei wandert zwischen
     * Vaults, und dieselbe selbst angelegte Kategorie hat dort verschiedene
     * IDs. Der Import gleicht deshalb über den Namen ab und löst ihn lokal
     * auf. In der Datenbank steht seit v33 die ID.
     */
    category: string;
    note: string;
    imageData?: string;
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
  if (!view.id) {
    await message('Please open a journal entry, wiki article, or operation first.', { title: 'Export', kind: 'info' });
    return;
  }

  const { entries }                           = useJournalStore.getState();
  const { articles, wikiCategories }          = useWikiStore.getState();
  const { operations, categories: opCats }    = useOperationStore.getState();
  let content = '';
  let title = '';
  let createdAt = '';
  let type: EmeraldFile['type'] = 'journal';
  const meta: EmeraldMeta = {};

  if (view.type === 'journal') {
    const entry = entries.find(e => e.id === view.id);
    if (!entry) return;
    type      = 'journal';
    title     = entry.title || 'Untitled';
    content   = entry.content || '';
    createdAt = entry.created_at;

    meta.moonPhase = entry.moon_phase ?? undefined;

    if (entry.paradigm_id) {
      meta.paradigmaTitle = articles.find(a => a.id === entry.paradigm_id)?.title;
    }
    meta.isBannung  = !!entry.is_bannung;
    meta.bannungTitle = entry.bannung_type_wiki_id
      ? articles.find(a => a.id === entry.bannung_type_wiki_id)?.title : undefined;
    meta.isMeditation = !!entry.is_meditation;
    meta.meditationTitle = entry.meditation_type_wiki_id
      ? articles.find(a => a.id === entry.meditation_type_wiki_id)?.title : undefined;
    if (entry.meditation_duration) meta.meditationDuration = entry.meditation_duration;

    const linkedOpIds   = (entry.linked_operation_ids ?? []) as string[];
    const linkedWikiIds = (entry.linked_wiki_ids       ?? []) as string[];
    if (linkedOpIds.length)
      meta.linkedOps  = linkedOpIds.map(id => ({ id, title: operations.find(o => o.id === id)?.title ?? '' }));
    if (linkedWikiIds.length)
      meta.linkedWiki = linkedWikiIds.map(id => ({ id, title: articles.find(a => a.id === id)?.title ?? '' }));

    meta.tags = (entry.tags ?? []) as string[];

  } else if (view.type === 'wiki') {
    const article = articles.find(a => a.id === view.id);
    if (!article) return;
    type      = 'wiki';
    title     = article.title || 'Untitled';
    content   = article.content || '';
    createdAt = article.created_at;

    const cat = wikiCategories.find(c => c.id === article.category_id);
    meta.wikiCategoryId   = article.category_id;
    meta.wikiCategoryName = cat?.name ?? article.category_id;
    meta.icon             = article.icon ?? undefined;
    meta.tags             = (article.tags ?? []) as string[];

  } else if (view.type === 'operations') {
    const op = operations.find(o => o.id === view.id);
    if (!op) return;
    type      = 'operations';
    title     = op.title || 'Untitled';
    content   = op.content || '';
    createdAt = op.created_at;

    const cat = opCats.find(c => c.id === op.category_id);
    meta.opCategoryName = cat?.name;
    meta.isActive  = !!op.is_active;
    meta.endDate   = op.end_date;
    meta.version   = op.version;
    meta.icon      = op.icon ?? undefined;
    meta.tags      = (op.tags ?? []) as string[];
  }

  // Embed all local images from content as base64
  const images: Record<string, string> = {};
  for (const ref of new Set(imageRefsInHtml(content))) {
    try {
      images[ref] = await readImageAsBase64(ref);
    } catch { /* skip missing files */ }
  }

  const file: EmeraldFile = { version: '1', type, title, createdAt, content, images, meta };

  const savePath = await save({
    defaultPath: exportFilename(title, createdAt, 'emerald'),
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
  });
  if (!savePath) return;
  await invoke('write_file', { path: savePath, content: JSON.stringify(file, null, 2) });
}

async function exportAltarAsEmerald(): Promise<void> {
  const { altars, activeAltarId, items, placements, categories } = useAltarStore.getState();
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
  const categoryNameById = new Map(categories.map(c => [c.id, c.name]));

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
    altarCategories: usedCategories.map(c => ({ name: c.name, emoji: c.emoji })),
    altarItems: altarItems.map(i => ({
      id: i.id, name: i.name, emoji: i.emoji,
      category: categoryNameById.get(i.category_id) ?? 'Other', note: i.note,
      imageData: i.image_data ?? undefined,
    })),
    altarPlacements: placements.map(p => ({
      itemId: p.item_id, x: p.x, y: p.y, z_index: p.z_index, width: p.width, height: p.height,
      rotation: p.rotation, opacity: p.opacity, locked: p.locked, hidden: p.hidden,
    })),
  };

  const file: EmeraldFile = {
    version: '1',
    type: 'altar',
    title: altar.title || 'Untitled Altar',
    createdAt: altar.created_at,
    content: altar.intention || '',
    images,
    meta,
  };

  const savePath = await save({
    defaultPath: exportFilename(file.title, file.createdAt, 'emerald'),
    filters: [{ name: 'Emerald', extensions: ['emerald'] }],
  });
  if (!savePath) return;
  await invoke('write_file', { path: savePath, content: JSON.stringify(file, null, 2) });
}

// ── Import helpers ───────────────────────────────────────────────────────────

/** Ensures each tag name exists in the tags table, then returns the names unchanged.
 *  entry.tags stores tag NAMES (not IDs) — ensureTag just keeps the tags table in sync. */
async function ensureTagNames(names: string[]): Promise<string[]> {
  for (const name of names) {
    await useTagStore.getState().ensureTag(name);
  }
  return names;
}

/** Re-saves images into local storage and returns content with updated paths. */
async function remapImages(content: string, images: Record<string, string>): Promise<string> {
  const map = new Map<string, string>();
  for (const [oldRef, dataUrl] of Object.entries(images)) {
    if (!dataUrl) continue;
    try {
      map.set(oldRef, await saveImage(dataUrl));
    } catch { /* skip */ }
  }
  return rewriteImageRefs(content, (ref) => map.get(ref) ?? null);
}

/** Re-reads the relevant store from DB so the UI reflects the imported data. */
async function refreshAfterImport(type: EmeraldFile['type']): Promise<void> {
  await useTagStore.getState().fetchTags();
  if (type === 'journal') {
    await useJournalStore.getState().fetchEntries();
  } else if (type === 'wiki') {
    await useWikiStore.getState().fetchArticles();
  } else {
    await useOperationStore.getState().fetchAll();
  }
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

  if (file.version !== '1') {
    await message('Unsupported Emerald file version.', { title: 'Import', kind: 'error' });
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
    await useAltarStore.getState().fetchAltars();
    useUIStore.getState().setActiveView({ type: 'altar', id: newAltarId });
    await message('Altar imported successfully!', { title: 'Import', kind: 'info' });
    return;
  }

  const remapped = await remapImages(file.content, file.images ?? {});
  // Sanitize imported HTML — strip scripts and event handlers while preserving
  // TipTap-specific data-* attributes (internal link chips) and inline styles (image widths).
  const content = DOMPurify.sanitize(remapped, {
    ADD_ATTR: ['data-type', 'data-id', 'data-entry-type', 'data-label', 'data-icon'],
  });
  const tagNames = await ensureTagNames(file.meta.tags ?? []);

  let newId: string;
  try {
    if (file.type === 'journal') {
      newId = await importJournalEntry(file, content, tagNames);
    } else if (file.type === 'wiki') {
      newId = await importWikiArticle(file, content, tagNames);
    } else {
      newId = await importOperationEntry(file, content, tagNames);
    }
  } catch (e) {
    await message(`Import failed: ${e}`, { title: 'Import', kind: 'error' });
    return;
  }

  await refreshAfterImport(file.type);
  useUIStore.getState().setActiveView({ type: file.type, id: newId });
  await message('Entry imported successfully!', { title: 'Import', kind: 'info' });
}

async function importJournalEntry(file: EmeraldFile, content: string, tagNames: string[]): Promise<string> {
  const { createEntry, updateEntry } = useJournalStore.getState();
  const { articles }   = useWikiStore.getState();
  const { operations } = useOperationStore.getState();

  const paradigmId = file.meta.paradigmaTitle
    ? (articles.find(a => a.title === file.meta.paradigmaTitle && a.category_id === 'paradigm')?.id ?? null)
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

  const entry = await createEntry();
  await updateEntry(entry.id, {
    title: file.title,
    content,
    tags: tagNames,
    moon_phase: file.meta.moonPhase ?? null,
    paradigm_id: paradigmId,
    is_bannung: file.meta.isBannung ?? false,
    bannung_type_wiki_id: bannungId,
    is_meditation: file.meta.isMeditation ?? false,
    meditation_type_wiki_id: meditationId,
    meditation_duration: file.meta.meditationDuration ?? null,
    linked_operation_ids: linkedOpIds,
    linked_wiki_ids: linkedWikiIds,
  });
  return entry.id;
}

// Aus schema.ts abgeleitet statt handgepflegt: Die frühere Kopie hing seit
// Migration v12 hinterher — 'sigil_charging' fehlte, weshalb ein Artikel dieser
// Kategorie beim Import still in 'other' landete.
const BUILTIN_WIKI_CATEGORY_IDS = BUILTIN_WIKI_CATEGORIES.map(([id]) => id);

async function importWikiArticle(file: EmeraldFile, content: string, tagNames: string[]): Promise<string> {
  const { createArticle, updateArticle, wikiCategories } = useWikiStore.getState();

  let categoryId = 'other';
  if (file.meta.wikiCategoryId) {
    if (BUILTIN_WIKI_CATEGORY_IDS.includes(file.meta.wikiCategoryId)) {
      categoryId = file.meta.wikiCategoryId;
    } else {
      // custom category: match by name
      const found = wikiCategories.find(c => c.name === file.meta.wikiCategoryName && !c.is_builtin);
      categoryId = found?.id ?? 'other';
    }
  }

  const article = await createArticle(categoryId);
  await updateArticle(article.id, {
    title: file.title,
    content,
    category_id: categoryId,
    tags: tagNames,
    icon: file.meta.icon ?? undefined,
  });
  return article.id;
}

async function importOperationEntry(file: EmeraldFile, content: string, tagNames: string[]): Promise<string> {
  const { createOperation, updateOperation, categories: opCats, addCategory } = useOperationStore.getState();

  let categoryId: string;
  const existing = opCats.find(c => c.name === file.meta.opCategoryName);
  if (existing) {
    categoryId = existing.id;
  } else if (file.meta.opCategoryName) {
    const created = await addCategory(file.meta.opCategoryName, '⚡');
    categoryId = created.id;
  } else {
    categoryId = opCats[0]?.id ?? '';
  }

  const op = await createOperation(categoryId);
  await updateOperation(op.id, {
    title: file.title,
    content,
    category_id: categoryId,
    tags: tagNames,
    is_active: file.meta.isActive ?? true,
    end_date: file.meta.endDate ?? null,
    version: file.meta.version ?? null,
    icon: file.meta.icon ?? undefined,
  });
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
  const categoryId = localAltarCategoryId(itemMeta.category);

  const existingMatch = items.find(i =>
    i.name === itemMeta.name &&
    i.category_id === categoryId &&
    (i.image_data ?? null) === (itemMeta.imageData ?? null),
  );
  if (existingMatch) return { id: existingMatch.id, created: false };

  const created = await addItem(itemMeta.name, itemMeta.emoji, categoryId, itemMeta.note, itemMeta.imageData);
  return { id: created.id, created: true };
}

/**
 * Der Kategorie-Name aus der Datei, übersetzt in die ID dieses Vaults.
 * `ensureAltarCategory` hat den Namen zuvor angelegt, falls er fehlte; bleibt
 * er unauffindbar, fängt 'other' den Fall ab — ohne gültige ID wuerde der
 * Foreign Key das Item ablehnen.
 */
function localAltarCategoryId(name: string): string {
  const { categories } = useAltarStore.getState();
  const match = categories.find(c => c.name.toLowerCase() === name.toLowerCase())
    ?? categories.find(c => c.id === name);
  return match?.id ?? 'other';
}

/** Creates the category if no local category has this name yet (case-insensitive). */
async function ensureAltarCategory(name: string, emoji: string): Promise<void> {
  const { categories, addCategory } = useAltarStore.getState();
  if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return;
  try { await addCategory(name, emoji); } catch { /* created concurrently, or name conflict — keep going */ }
}

async function remapAltarImagePath(path: string | undefined, images: Record<string, string>): Promise<string | null> {
  if (!path) return null;
  const dataUrl = images[path];
  if (!dataUrl) return path;
  try {
    return await saveImage(dataUrl);
  } catch {
    return null;
  }
}

async function importAltarEntry(file: EmeraldFile): Promise<string> {
  const { createAltar, updateAltar, updateAltarGrid, updateAltarResolution, deleteAltar, deleteItem } = useAltarStore.getState();
  const altar = await createAltar();
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
      title: file.title || 'Untitled Altar',
      intention: file.content || '',
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
      await ensureAltarCategory(cat.name, cat.emoji);
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

    return altar.id;
  } catch (e) {
    await deleteAltar(altar.id).catch(() => {});
    for (const itemId of createdItemIds) {
      await deleteItem(itemId).catch(() => {});
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

/** Reverse-maps a moon phase display string (e.g. "🌕 Full") to its DB key (e.g. "full"). */
function parseMoonPhaseKey(display: string): string | null {
  const text = stripIconPrefix(display).toLowerCase().replace(/\s+/g, '_');
  return (text in MOON_PHASE_SYMBOLS) ? text : null;
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
  let title = 'Untitled';
  const frontMeta: Record<string, string> = {};
  let bodyStart = 0;

  if (lines[0]?.startsWith('# ')) {
    title = lines[0].slice(2).trim();
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
  let type: EmeraldFile['type'];
  if (rawType && validTypes.includes(rawType)) {
    type = rawType as EmeraldFile['type'];
  } else {
    const chosen = await useImportStore.getState().askDestination(title);
    if (!chosen) return;
    type = chosen;
  }

  const tagNames = await ensureTagNames(
    (frontMeta['tags'] ?? '').split(',').map(t => t.trim()).filter(Boolean),
  );

  let newId: string;
  try {
    if (type === 'journal') {
      newId = await importJournalFromMarkdown(title, html, tagNames, frontMeta);
    } else if (type === 'wiki') {
      newId = await importWikiFromMarkdown(title, html, tagNames, frontMeta);
    } else {
      newId = await importOperationFromMarkdown(title, html, tagNames, frontMeta);
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
  title: string, html: string, tagNames: string[],
  meta: Record<string, string>,
): Promise<string> {
  const { createEntry, updateEntry } = useJournalStore.getState();
  const { articles }   = useWikiStore.getState();
  const { operations } = useOperationStore.getState();

  const moonPhase = meta['moon'] ? parseMoonPhaseKey(meta['moon']) : null;

  const paradigmaName = meta['paradigma'] ? stripIconPrefix(meta['paradigma']) : null;
  const paradigmId = paradigmaName
    ? (articles.find(a => a.title === paradigmaName && a.category_id === 'paradigm')?.id ?? null)
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

  const entry = await createEntry();
  await updateEntry(entry.id, {
    title, content: html, tags: tagNames,
    moon_phase: moonPhase,
    paradigm_id: paradigmId,
    is_bannung: !!bannungName,
    bannung_type_wiki_id: bannungId,
    is_meditation: !!meditationName,
    meditation_type_wiki_id: meditationId,
    meditation_duration: meditationDuration,
    linked_operation_ids: linkedOpIds,
    linked_wiki_ids: linkedWikiIds,
  });
  return entry.id;
}

async function importWikiFromMarkdown(
  title: string, html: string, tagNames: string[],
  meta: Record<string, string>,
): Promise<string> {
  const { createArticle, updateArticle, wikiCategories } = useWikiStore.getState();

  const categoryName = meta['category'] ? stripIconPrefix(meta['category']) : null;
  let categoryId = 'other';
  if (categoryName) {
    const found = wikiCategories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (found) categoryId = found.id;
  }

  const article = await createArticle(categoryId);
  await updateArticle(article.id, { title, content: html, category_id: categoryId, tags: tagNames });
  return article.id;
}

async function importOperationFromMarkdown(
  title: string, html: string, tagNames: string[],
  meta: Record<string, string>,
): Promise<string> {
  const { createOperation, updateOperation, categories: opCats, addCategory } = useOperationStore.getState();

  const categoryName = meta['category'] ? stripIconPrefix(meta['category']) : null;
  let categoryId: string;
  const found = categoryName
    ? opCats.find(c => c.name.toLowerCase() === categoryName.toLowerCase())
    : null;
  if (found) {
    categoryId = found.id;
  } else if (categoryName) {
    const created = await addCategory(categoryName, '⚡');
    categoryId = created.id;
  } else {
    categoryId = opCats[0]?.id ?? '';
  }

  const op = await createOperation(categoryId);
  await updateOperation(op.id, {
    title, content: html, category_id: categoryId, tags: tagNames,
    is_active: meta['status'] ? meta['status'].toLowerCase() === 'active' : true,
    end_date: meta['end date'] ?? null,
    version: meta['version'] ?? null,
  });
  return op.id;
}
