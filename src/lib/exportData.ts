import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useUIStore } from '../store/uiStore';
import { getCategoryEmoji } from '../components/wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from './moonPhase';
import type { WikiCategoryDef } from '../types';

export interface ChipData {
  id?: string;            // entry ID (for import resolution)
  label: string;
  icon?: string;          // emoji or data-URL
  fallbackIcon?: string;  // plain emoji to use when icon is a data-URL (markdown export)
}

export interface ExportData {
  type: 'journal' | 'wiki' | 'operations';
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
}

function wikiIcon(article: { icon?: string; category_id: string }, cats: WikiCategoryDef[]): string {
  if (article.icon?.startsWith('data:')) return article.icon;
  const cat = cats.find(c => c.id === article.category_id);
  return cat?.emoji ?? getCategoryEmoji(article.category_id);
}

function moonLabel(phase: string): string {
  return phase.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export async function collectExportData(): Promise<ExportData | null> {
  const view = useUIStore.getState().activeView;
  if (!view.id) return null;

  const { entries }                     = useJournalStore.getState();
  const { articles, wikiCategories }    = useWikiStore.getState();
  const { operations, categories: opCats } = useOperationStore.getState();
  // entry.tags stores tag names directly (not IDs)

  // ── Journal ──────────────────────────────────────────────────────────────
  if (view.type === 'journal') {
    const entry = entries.find(e => e.id === view.id);
    if (!entry) return null;

    const paradigmaArt   = entry.paradigm_id            ? articles.find(a => a.id === entry.paradigm_id)            : undefined;
    const bannungArt     = entry.bannung_type_wiki_id    ? articles.find(a => a.id === entry.bannung_type_wiki_id)    : undefined;
    const meditationArt  = entry.meditation_type_wiki_id ? articles.find(a => a.id === entry.meditation_type_wiki_id) : undefined;

    // Altbestands-Brücke. Seit Migration v36 stehen Journal-Verknüpfungen als
    // Chips IM Inhalt, und `export.ts` rendert sie von dort (resolveInternalLinkIcons /
    // transformInternalLinks) — für migrierte Einträge sind diese beiden Listen
    // deshalb leer, und das ist richtig: sonst stünde derselbe Link zweimal im
    // Export, einmal als eigener Abschnitt und einmal im Text. Gefüllt sind sie
    // nur noch bei Einträgen, die ein Backup oder ein .emerald-Import aus der
    // Zeit davor wieder in die Spalten geschrieben hat.
    const linkedOps = (entry.linked_operation_ids ?? [])
      .map(id => operations.find(o => o.id === id)).filter(Boolean)
      .map(op => {
        const cat = opCats.find(c => c.id === op!.category_id);
        const fallback = cat?.emoji ?? '⚡';
        return { id: op!.id, label: op!.title, icon: op!.icon ?? fallback, fallbackIcon: fallback };
      });

    const linkedWiki = (entry.linked_wiki_ids ?? [])
      .map(id => articles.find(a => a.id === id)).filter(Boolean)
      .filter(a => a!.category_id !== 'paradigm')
      .map(a => {
        const cat = wikiCategories.find(c => c.id === a!.category_id);
        const fallback = cat?.emoji ?? getCategoryEmoji(a!.category_id);
        return { id: a!.id, label: a!.title, icon: wikiIcon(a!, wikiCategories), fallbackIcon: fallback };
      });

    const phaseKey = entry.moon_phase as keyof typeof MOON_PHASE_SYMBOLS;
    const moonPhase = phaseKey && MOON_PHASE_SYMBOLS[phaseKey]
      ? `${MOON_PHASE_SYMBOLS[phaseKey]} ${moonLabel(phaseKey)}`
      : undefined;

    return {
      type: 'journal',
      title: entry.title || 'Untitled',
      entryNumber: entry.entry_number,
      content: entry.content,
      createdAt: entry.created_at,
      moonPhase,
      paradigma: paradigmaArt ? (() => {
        const cat = wikiCategories.find(c => c.id === paradigmaArt.category_id);
        const fallback = cat?.emoji ?? getCategoryEmoji(paradigmaArt.category_id);
        return { label: paradigmaArt.title, icon: wikiIcon(paradigmaArt, wikiCategories), fallbackIcon: fallback };
      })() : undefined,
      bannung: entry.is_bannung ? {
        label: bannungArt?.title ?? 'Bannung',
        icon: bannungArt ? wikiIcon(bannungArt, wikiCategories) : '🚫',
        fallbackIcon: '🚫',
      } : undefined,
      meditation: entry.is_meditation ? {
        label: meditationArt?.title ?? 'Meditation',
        icon: meditationArt ? wikiIcon(meditationArt, wikiCategories) : '🧘',
        fallbackIcon: '🧘',
        duration: entry.meditation_duration ?? undefined,
      } : undefined,
      linkedOps,
      linkedWiki,
      tagNames: (entry.tags ?? []) as string[],
    };
  }

  // ── Wiki ─────────────────────────────────────────────────────────────────
  if (view.type === 'wiki') {
    const article = articles.find(a => a.id === view.id);
    if (!article) return null;

    const cat = wikiCategories.find(c => c.id === article.category_id);

    return {
      type: 'wiki',
      title: article.title || 'Untitled',
      entryNumber: article.entry_number,
      content: article.content,
      createdAt: article.created_at,
      wikiCategory: { label: cat?.name ?? article.category_id, icon: cat?.emoji ?? getCategoryEmoji(article.category_id) },
      entryIcon: article.icon || undefined,
      tagNames: (article.tags ?? []) as string[],
    };
  }

  // ── Operations ───────────────────────────────────────────────────────────
  if (view.type === 'operations') {
    const op = operations.find(o => o.id === view.id);
    if (!op) return null;

    const cat = opCats.find(c => c.id === op.category_id);

    return {
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
    };
  }

  return null;
}
