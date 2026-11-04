import { addDays, startOfDay } from 'date-fns';
import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useUIStore } from '../store/uiStore';
import { getDb } from './db';
import { getCategoryEmoji } from '../components/wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from './moonPhase';
import type { CustomProperty, WikiCategoryDef } from '../types';

export interface ChipData {
  id?: string;            // entry ID (for import resolution)
  label: string;
  icon?: string;          // emoji or data-URL
  fallbackIcon?: string;  // plain emoji to use when icon is a data-URL (markdown export)
}

export type ExportEntryType = 'journal' | 'wiki' | 'operations';

/** Identifies one exportable entry, independent of what's open in the UI. */
export interface ExportTarget {
  type: ExportEntryType;
  id: string;
}

export interface ExportData {
  id: string;
  type: ExportEntryType;
  title: string;
  entryNumber?: number;
  content: string;
  createdAt: string;
  // journal
  moonPhase?: string;         // emoji + label, e.g. "🌕 Full Moon"
  paradigma?: ChipData;
  bannung?: ChipData;
  meditation?: ChipData & { duration?: number };
  linkedOps?: ChipData[];
  linkedWiki?: ChipData[];
  // wiki
  wikiCategory?: ChipData;
  // operation
  opCategory?: ChipData;
  // custom icon on the entry itself (wiki article or operation), may be data-URL or emoji
  entryIcon?: string;
  isActive?: boolean;
  endDate?: string | null;
  version?: string | null;
  // common
  tagNames?: string[];
  customProps?: Pick<CustomProperty, 'name' | 'value' | 'type' | 'meta'>[];
}

function wikiIcon(article: { icon?: string; category: string }, cats: WikiCategoryDef[]): string {
  if (article.icon?.startsWith('data:')) return article.icon;
  const cat = cats.find(c => c.id === article.category);
  return cat?.emoji ?? getCategoryEmoji(article.category);
}

function moonLabel(phase: string): string {
  return phase.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export type ExportCustomProp = Pick<CustomProperty, 'name' | 'value' | 'type' | 'meta' | 'show_in_entry' | 'sort_order'>;

/**
 * Reads an entry's custom properties straight from the DB, for exports.
 * Deliberately bypasses `useCustomPropertyStore.fetchProperties`, which
 * replaces the store's state — exporting an entry that isn't open (e.g. a
 * bundled linked entry) would otherwise swap the open entry's properties panel.
 */
export async function loadCustomProps(entryId: string, entryType: string): Promise<ExportCustomProp[]> {
  const db = await getDb();
  const rows = await db.select<Array<Omit<ExportCustomProp, 'show_in_entry'> & { show_in_entry: number }>>(
    `SELECT name, value, type, meta, show_in_entry, sort_order FROM custom_properties
     WHERE entry_id = $1 AND entry_type = $2 ORDER BY sort_order ASC`,
    [entryId, entryType]
  );
  return rows.map(r => ({ ...r, show_in_entry: r.show_in_entry !== 0 }));
}

async function loadVisibleCustomProps(entryId: string, entryType: string): Promise<ExportData['customProps']> {
  return (await loadCustomProps(entryId, entryType)).filter(p => p.show_in_entry);
}

/** The entry open in the active view, if it's an exportable journal / wiki / operations entry. */
export function activeExportTarget(): ExportTarget | null {
  const view = useUIStore.getState().activeView;
  if (!view.id) return null;
  if (view.type === 'journal' || view.type === 'wiki' || view.type === 'operations') {
    return { type: view.type, id: view.id };
  }
  return null;
}

export async function collectExportDataFor(view: ExportTarget): Promise<ExportData | null> {

  const { entries }                     = useJournalStore.getState();
  const { articles, wikiCategories }    = useWikiStore.getState();
  const { operations, categories: opCats } = useOperationStore.getState();
  // entry.tags stores tag names directly (not IDs)

  // ── Journal ──────────────────────────────────────────────────────────────
  if (view.type === 'journal') {
    const entry = entries.find(e => e.id === view.id);
    if (!entry) return null;

    const customProps = await loadVisibleCustomProps(entry.id, 'journal');

    const paradigmaArt   = entry.paradigm_id            ? articles.find(a => a.id === entry.paradigm_id)            : undefined;
    const bannungArt     = entry.bannung_type_wiki_id    ? articles.find(a => a.id === entry.bannung_type_wiki_id)    : undefined;
    const meditationArt  = entry.meditation_type_wiki_id ? articles.find(a => a.id === entry.meditation_type_wiki_id) : undefined;

    const linkedOps = (entry.linked_operation_ids ?? [])
      .map(id => operations.find(o => o.id === id)).filter(Boolean)
      .map(op => {
        const cat = opCats.find(c => c.id === op!.category_id);
        const fallback = cat?.emoji ?? '⚡';
        return { id: op!.id, label: op!.title, icon: op!.icon ?? fallback, fallbackIcon: fallback };
      });

    const linkedWiki = (entry.linked_wiki_ids ?? [])
      .map(id => articles.find(a => a.id === id)).filter(Boolean)
      .filter(a => a!.category !== 'paradigm')
      .map(a => {
        const cat = wikiCategories.find(c => c.id === a!.category);
        const fallback = cat?.emoji ?? getCategoryEmoji(a!.category);
        return { id: a!.id, label: a!.title, icon: wikiIcon(a!, wikiCategories), fallbackIcon: fallback };
      });

    const phaseKey = entry.moon_phase as keyof typeof MOON_PHASE_SYMBOLS;
    const moonPhase = phaseKey && MOON_PHASE_SYMBOLS[phaseKey]
      ? `${MOON_PHASE_SYMBOLS[phaseKey]} ${moonLabel(phaseKey)}`
      : undefined;

    return {
      id: entry.id,
      type: 'journal',
      title: entry.title || 'Untitled',
      entryNumber: entry.entry_number,
      content: entry.content,
      createdAt: entry.created_at,
      moonPhase,
      paradigma: paradigmaArt ? (() => {
        const cat = wikiCategories.find(c => c.id === paradigmaArt.category);
        const fallback = cat?.emoji ?? getCategoryEmoji(paradigmaArt.category);
        return { id: paradigmaArt.id, label: paradigmaArt.title, icon: wikiIcon(paradigmaArt, wikiCategories), fallbackIcon: fallback };
      })() : undefined,
      bannung: entry.is_bannung ? {
        id: bannungArt?.id,
        label: bannungArt?.title ?? 'Bannung',
        icon: bannungArt ? wikiIcon(bannungArt, wikiCategories) : '🚫',
        fallbackIcon: '🚫',
      } : undefined,
      meditation: entry.is_meditation ? {
        id: meditationArt?.id,
        label: meditationArt?.title ?? 'Meditation',
        icon: meditationArt ? wikiIcon(meditationArt, wikiCategories) : '🧘',
        fallbackIcon: '🧘',
        duration: entry.meditation_duration ?? undefined,
      } : undefined,
      linkedOps,
      linkedWiki,
      tagNames: (entry.tags ?? []) as string[],
      customProps,
    };
  }

  // ── Wiki ─────────────────────────────────────────────────────────────────
  if (view.type === 'wiki') {
    const article = articles.find(a => a.id === view.id);
    if (!article) return null;

    const customProps = await loadVisibleCustomProps(article.id, 'wiki');

    const cat = wikiCategories.find(c => c.id === article.category);

    return {
      id: article.id,
      type: 'wiki',
      title: article.title || 'Untitled',
      entryNumber: article.entry_number,
      content: article.content,
      createdAt: article.created_at,
      wikiCategory: { label: cat?.name ?? article.category, icon: cat?.emoji ?? getCategoryEmoji(article.category) },
      entryIcon: article.icon || undefined,
      tagNames: (article.tags ?? []) as string[],
      customProps,
    };
  }

  // ── Operations ───────────────────────────────────────────────────────────
  if (view.type === 'operations') {
    const op = operations.find(o => o.id === view.id);
    if (!op) return null;

    const customProps = await loadVisibleCustomProps(op.id, 'operation');

    const cat = opCats.find(c => c.id === op.category_id);

    return {
      id: op.id,
      type: 'operations',
      title: op.title || 'Untitled',
      entryNumber: op.entry_number,
      content: op.content,
      createdAt: op.created_at,
      opCategory: cat ? { label: cat.name, icon: cat.emoji } : undefined,
      entryIcon: op.icon || undefined,
      isActive: !!op.is_active,
      endDate: op.end_date,
      version: op.version,
      tagNames: (op.tags ?? []) as string[],
      customProps,
    };
  }

  return null;
}

// ── Linked entries ──────────────────────────────────────────────────────────

/** Sigil operations have their own view (`OperationSigilView`) and their export isn't implemented yet. */
function isExportableOperation(id: string): boolean {
  const op = useOperationStore.getState().operations.find(o => o.id === id);
  return !!op && op.category_id !== 'sigils';
}

function targetExists(t: ExportTarget): boolean {
  if (t.type === 'journal') return useJournalStore.getState().entries.some(e => e.id === t.id);
  if (t.type === 'wiki') return useWikiStore.getState().articles.some(a => a.id === t.id);
  return isExportableOperation(t.id);
}

function normalizeLinkType(entryType: string | null): ExportEntryType | null {
  if (entryType === 'journal' || entryType === 'wiki') return entryType;
  if (entryType === 'operation' || entryType === 'operations') return 'operations';
  return null;
}

/** Targets of the inline internal links in an entry's HTML content. */
export function internalLinksIn(html: string): ExportTarget[] {
  if (!html) return [];
  const out: ExportTarget[] = [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('span[data-type="internalLink"]')) {
    const id = el.getAttribute('data-id');
    const type = normalizeLinkType(el.getAttribute('data-entry-type'));
    if (id && type) out.push({ type, id });
  }
  return out;
}

/** All entries one target points to: inline links in its content plus the journal's property links. */
function directLinks(t: ExportTarget): ExportTarget[] {
  let content = '';
  const out: ExportTarget[] = [];

  if (t.type === 'journal') {
    const entry = useJournalStore.getState().entries.find(e => e.id === t.id);
    if (!entry) return [];
    content = entry.content;
    for (const id of [entry.paradigm_id, entry.bannung_type_wiki_id, entry.meditation_type_wiki_id, ...(entry.linked_wiki_ids ?? [])]) {
      if (id) out.push({ type: 'wiki', id });
    }
    for (const id of entry.linked_operation_ids ?? []) out.push({ type: 'operations', id });
  } else if (t.type === 'wiki') {
    content = useWikiStore.getState().articles.find(a => a.id === t.id)?.content ?? '';
  } else {
    content = useOperationStore.getState().operations.find(o => o.id === t.id)?.content ?? '';
  }

  return [...out, ...internalLinksIn(content)];
}

/** Identity of a target across modules, e.g. for sets of selected entries. */
export const targetKey = (t: ExportTarget) => `${t.type}:${t.id}`;

/**
 * Collects the entries linked from `roots` — one entry, or the entries of a
 * bulk selection — in discovery order (breadth-first), without duplicates and
 * without the roots themselves or anything in `skip` (a bulk export's
 * unchecked entries). With `recursive`, links of linked entries are followed
 * too, so the bundle is closed under linking.
 */
export function collectLinkedTargets(
  roots: readonly ExportTarget[],
  recursive: boolean,
  skip: readonly ExportTarget[] = [],
): ExportTarget[] {
  const key = targetKey;
  const seen = new Set<string>([...roots, ...skip].map(key));
  const result: ExportTarget[] = [];
  let frontier: ExportTarget[] = [...roots];

  while (frontier.length) {
    const next: ExportTarget[] = [];
    for (const t of frontier) {
      for (const link of directLinks(t)) {
        const k = key(link);
        if (seen.has(k) || !targetExists(link)) continue;
        seen.add(k);
        result.push(link);
        next.push(link);
      }
    }
    if (!recursive) break;
    frontier = next;
  }
  return result;
}

/**
 * Every exportable entry of the given modules created within `[from, to]`
 * (inclusive days; `null` means unbounded), oldest first — for the bulk
 * export. Trashed entries are never in the stores; Sigil operations are left
 * out like everywhere else in export.
 */
export function collectTargetsInRange(types: readonly ExportEntryType[], from: Date | null, to: Date | null): ExportTarget[] {
  const start = from ? startOfDay(from).getTime() : -Infinity;
  const end = to ? addDays(startOfDay(to), 1).getTime() : Infinity;
  const inRange = (createdAt: string) => {
    const t = new Date(createdAt).getTime();
    return t >= start && t < end;
  };

  const found: Array<ExportTarget & { createdAt: string }> = [];
  if (types.includes('journal')) {
    for (const e of useJournalStore.getState().entries) {
      if (inRange(e.created_at)) found.push({ type: 'journal', id: e.id, createdAt: e.created_at });
    }
  }
  if (types.includes('operations')) {
    for (const o of useOperationStore.getState().operations) {
      if (o.category_id !== 'sigils' && inRange(o.created_at)) found.push({ type: 'operations', id: o.id, createdAt: o.created_at });
    }
  }
  if (types.includes('wiki')) {
    for (const a of useWikiStore.getState().articles) {
      if (inRange(a.created_at)) found.push({ type: 'wiki', id: a.id, createdAt: a.created_at });
    }
  }
  found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return found.map(({ type, id }) => ({ type, id }));
}

/** Display info for a target, used by the export modal's entry list. */
export function describeTarget(t: ExportTarget): { title: string; icon: string; createdAt?: string } {
  if (t.type === 'journal') {
    const entry = useJournalStore.getState().entries.find(e => e.id === t.id);
    const phase = entry?.moon_phase as keyof typeof MOON_PHASE_SYMBOLS | null | undefined;
    return { title: entry?.title || 'Untitled', icon: (phase && MOON_PHASE_SYMBOLS[phase]) || '📓', createdAt: entry?.created_at };
  }
  if (t.type === 'wiki') {
    const { articles, wikiCategories } = useWikiStore.getState();
    const a = articles.find(x => x.id === t.id);
    if (!a) return { title: 'Untitled', icon: '📖' };
    return { title: a.title || 'Untitled', icon: wikiIcon(a, wikiCategories), createdAt: a.created_at };
  }
  const { operations, categories } = useOperationStore.getState();
  const op = operations.find(o => o.id === t.id);
  const cat = op ? categories.find(c => c.id === op.category_id) : undefined;
  return { title: op?.title || 'Untitled', icon: op?.icon || cat?.emoji || '⚡', createdAt: op?.created_at };
}
