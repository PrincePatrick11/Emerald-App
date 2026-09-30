import { useJournalStore } from '../store/journalStore';
import { renderBlocksForExport, type ExportText } from './blocks/exportRender';
import { blockLabel, fieldFallbackText } from './blocks/blockAttrs';
import { formatIsoDateLong } from './formatDate';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useCategoryStore } from '../store/categoryStore';
import { useAltarStore } from '../store/altarStore';
import { useUIStore } from '../store/uiStore';
import { entryMoonPhase, MOON_PHASE_SYMBOLS } from './moonPhase';
import { useSettingsStore } from '../store/settingsStore';
import { displayTitle } from './entryTitle';
import { categoryLabel } from './categories';
import i18n from '../i18n';

export interface ChipData {
  id?: string;            // entry ID (for import resolution)
  label: string;
  icon?: string;          // emoji or data-URL
  fallbackIcon?: string;  // plain emoji to use when icon is a data-URL (markdown export)
}

/** Die Texte, mit denen die Blöcke in der aktuellen Sprache exportiert werden. */
function exportText(): ExportText {
  const t = i18n.t;
  return {
    title: (block, meta) => blockLabel(t, block, meta),
    fields: fieldFallbackText(t),
    date: formatIsoDateLong,
    number: (value) => value.toLocaleString(i18n.language),
    targetDate: t('creation.targetDate'),
    technique: t('creation.chargingTechnique'),
    loaded: t('blocks.sigil.loaded'),
    notLoaded: t('blocks.sigil.notLoaded'),
    drawing: t('blocks.types.sigilCanvas.label'),
    altar: (id) => {
      const altar = useAltarStore.getState().altars.find((a) => a.id === id);
      return altar ? { title: displayTitle(i18n.t, 'altar', altar.title), image: altar.thumbnail_data ?? null } : null;
    },
  };
}

export interface ExportData {
  type: 'journal' | 'wiki' | 'operations';
  title: string;
  entryNumber?: number;
  content: string;
  createdAt: string;
  // journal
  moonPhase?: string;         // emoji + label, e.g. "🌕 Full Moon"
  // wiki + operation: die Kategorie des Eintrags, in der Kopfzeile gezeigt
  category?: ChipData;
  // custom icon on the entry itself (wiki article or operation), may be data-URL or emoji
  entryIcon?: string;
  // common
  tagNames?: string[];
}

function moonLabel(phase: string): string {
  return phase.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export async function collectExportData(): Promise<ExportData | null> {
  const view = useUIStore.getState().activeView;
  if (!view.id) return null;

  const { entries }    = useJournalStore.getState();
  const { articles }   = useWikiStore.getState();
  const { operations } = useOperationStore.getState();
  const { categories } = useCategoryStore.getState();
  // entry.tags stores tag names directly (not IDs)

  // ── Journal ──────────────────────────────────────────────────────────────
  if (view.type === 'journal') {
    const entry = entries.find(e => e.id === view.id);
    if (!entry) return null;

    const phase = entryMoonPhase(entry, useSettingsStore.getState().settings.journal.moonPhase);
    const moonPhase = phase ? `${MOON_PHASE_SYMBOLS[phase]} ${moonLabel(phase)}` : undefined;

    return {
      type: 'journal',
      title: displayTitle(i18n.t, 'journal', entry.title),
      entryNumber: entry.entry_number,
      content: renderBlocksForExport(entry.content, exportText()),
      createdAt: entry.created_at,
      moonPhase,
      tagNames: (entry.tags ?? []) as string[],
    };
  }

  // ── Wiki ─────────────────────────────────────────────────────────────────
  if (view.type === 'wiki') {
    const article = articles.find(a => a.id === view.id);
    if (!article) return null;

    const cat = categories.find(c => c.id === article.category_id);

    return {
      type: 'wiki',
      title: displayTitle(i18n.t, 'wiki', article.title),
      entryNumber: article.entry_number,
      content: renderBlocksForExport(article.content, exportText()),
      createdAt: article.created_at,
      category: cat ? { label: categoryLabel(i18n.t, cat), icon: cat.emoji } : undefined,
      entryIcon: article.icon || undefined,
      tagNames: (article.tags ?? []) as string[],
    };
  }

  // ── Operations ───────────────────────────────────────────────────────────
  if (view.type === 'operations') {
    const op = operations.find(o => o.id === view.id);
    if (!op) return null;

    const cat = categories.find(c => c.id === op.category_id);

    return {
      type: 'operations',
      title: displayTitle(i18n.t, 'operation', op.title),
      entryNumber: op.entry_number,
      content: renderBlocksForExport(op.content, exportText()),
      createdAt: op.created_at,
      category: cat ? { label: categoryLabel(i18n.t, cat), icon: cat.emoji } : undefined,
      entryIcon: op.icon || undefined,
      tagNames: (op.tags ?? []) as string[],
    };
  }

  return null;
}
