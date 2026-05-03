import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save, message } from '@tauri-apps/plugin-dialog';
import { format } from 'date-fns';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useUIStore } from '../store/uiStore';
import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useTagStore } from '../store/tagStore';
import { useCustomPropertyStore } from '../store/customPropertyStore';
import { MOON_PHASE_SYMBOLS } from './moonPhase';
import type { CustomPropertyType } from '../types';

// ── File format ──────────────────────────────────────────────────────────────

interface EmeraldFile {
  version: '1';
  type: 'journal' | 'wiki' | 'operations';
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
  customProps?: Array<{
    name: string;
    type: string;
    value: string | null;
    meta: string | null;
    showInEntry: boolean;
    sortOrder: number;
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
    await useCustomPropertyStore.getState().fetchProperties(entry.id, 'journal');

  } else if (view.type === 'wiki') {
    const article = articles.find(a => a.id === view.id);
    if (!article) return;
    type      = 'wiki';
    title     = article.title || 'Untitled';
    content   = article.content || '';
    createdAt = article.created_at;

    const cat = wikiCategories.find(c => c.id === article.category);
    meta.wikiCategoryId   = article.category;
    meta.wikiCategoryName = cat?.name ?? article.category;
    meta.icon             = article.icon ?? undefined;
    meta.tags             = (article.tags ?? []) as string[];
    await useCustomPropertyStore.getState().fetchProperties(article.id, 'wiki');

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
    await useCustomPropertyStore.getState().fetchProperties(op.id, 'operation');
  }

  meta.customProps = useCustomPropertyStore.getState().properties.map(p => ({
    name: p.name, type: p.type, value: p.value, meta: p.meta,
    showInEntry: p.show_in_entry, sortOrder: p.sort_order,
  }));

  // Embed all local images from content as base64
  const images: Record<string, string> = {};
  const re = /src="([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const src = m[1];
    if (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('blob:')) {
      try {
        images[src] = await invoke<string>('read_image_as_base64', { path: src });
      } catch { /* skip missing files */ }
    }
  }

  const file: EmeraldFile = { version: '1', type, title, createdAt, content, images, meta };

  const savePath = await save({
    defaultPath: exportFilename(title, createdAt, 'emerald'),
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
  let result = content;
  for (const [oldPath, dataUrl] of Object.entries(images)) {
    if (!dataUrl) continue;
    try {
      const newPath = await invoke<string>('save_image', { dataUrl });
      result = result.split(`src="${oldPath}"`).join(`src="${newPath}"`);
    } catch { /* skip */ }
  }
  return result;
}

async function importCustomProps(
  entryId: string,
  entryType: string,
  props: EmeraldMeta['customProps'],
): Promise<void> {
  if (!props?.length) return;
  // Reset store state for this entry so sort_order starts at 0
  await useCustomPropertyStore.getState().fetchProperties(entryId, entryType);
  const store = useCustomPropertyStore.getState();
  for (const p of props) {
    const prop = await store.addProperty(
      entryId, entryType, p.name, p.type as CustomPropertyType, p.meta, p.showInEntry,
    );
    if (p.value !== null) {
      await useCustomPropertyStore.getState().updateProperty(prop.id, { value: p.value });
    }
  }
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
    ? (articles.find(a => a.title === file.meta.paradigmaTitle && a.category === 'paradigm')?.id ?? null)
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
  await importCustomProps(entry.id, 'journal', file.meta.customProps);
  return entry.id;
}

const BUILTIN_WIKI_CATEGORY_IDS = [
  'paradigm','bannung','meditation','ritual','deity','herb','symbol','tool','concept','spell','other',
];

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
    category: categoryId,
    tags: tagNames,
    icon: file.meta.icon ?? undefined,
  });
  await importCustomProps(article.id, 'wiki', file.meta.customProps);
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
  await importCustomProps(op.id, 'operation', file.meta.customProps);
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

/** Known Emerald-exported frontmatter keys. Everything else → custom property. */
const KNOWN_MD_KEYS = new Set([
  'type', 'moon', 'paradigma', 'bannung', 'meditation', 'operations',
  'wiki', 'category', 'status', 'end date', 'version', 'tags',
]);

type MdCustomProp = { name: string; type: CustomPropertyType; value: string; meta: null; showInEntry: boolean; sortOrder: number };

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
  const type   = (frontMeta['type'] ?? 'journal') as EmeraldFile['type'];
  const tagNames = await ensureTagNames(
    (frontMeta['tags'] ?? '').split(',').map(t => t.trim()).filter(Boolean),
  );

  // All unrecognised keys → custom properties (text type)
  const customProps: MdCustomProp[] = Object.entries(frontMeta)
    .filter(([k]) => !KNOWN_MD_KEYS.has(k))
    .map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      type: 'text' as CustomPropertyType,
      value,
      meta: null,
      showInEntry: true,
      sortOrder: 0,
    }));

  let newId: string;
  try {
    if (type === 'journal') {
      newId = await importJournalFromMarkdown(title, html, tagNames, frontMeta, customProps);
    } else if (type === 'wiki') {
      newId = await importWikiFromMarkdown(title, html, tagNames, frontMeta, customProps);
    } else {
      newId = await importOperationFromMarkdown(title, html, tagNames, frontMeta, customProps);
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
  meta: Record<string, string>, customProps: MdCustomProp[],
): Promise<string> {
  const { createEntry, updateEntry } = useJournalStore.getState();
  const { articles }   = useWikiStore.getState();
  const { operations } = useOperationStore.getState();

  const moonPhase = meta['moon'] ? parseMoonPhaseKey(meta['moon']) : null;

  const paradigmaName = meta['paradigma'] ? stripIconPrefix(meta['paradigma']) : null;
  const paradigmId = paradigmaName
    ? (articles.find(a => a.title === paradigmaName && a.category === 'paradigm')?.id ?? null)
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
  await importCustomProps(entry.id, 'journal', customProps);
  return entry.id;
}

async function importWikiFromMarkdown(
  title: string, html: string, tagNames: string[],
  meta: Record<string, string>, customProps: MdCustomProp[],
): Promise<string> {
  const { createArticle, updateArticle, wikiCategories } = useWikiStore.getState();

  const categoryName = meta['category'] ? stripIconPrefix(meta['category']) : null;
  let categoryId = 'other';
  if (categoryName) {
    const found = wikiCategories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
    if (found) categoryId = found.id;
  }

  const article = await createArticle(categoryId);
  await updateArticle(article.id, { title, content: html, category: categoryId, tags: tagNames });
  await importCustomProps(article.id, 'wiki', customProps);
  return article.id;
}

async function importOperationFromMarkdown(
  title: string, html: string, tagNames: string[],
  meta: Record<string, string>, customProps: MdCustomProp[],
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
  await importCustomProps(op.id, 'operation', customProps);
  return op.id;
}
