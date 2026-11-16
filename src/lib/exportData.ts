import { useEntryStore } from '../store/entryStore';
import { liveTagNames } from '../store/tagStore';
import { renderBlocksForExport, type ExportText } from './blocks/exportRender';
import { blockLabel, fieldFallbackText } from './blocks/blockAttrs';
import { formatIsoDateLong } from './formatDate';
import { useCategoryStore } from '../store/categoryStore';
import { useUIStore } from '../store/uiStore';
import { entryMoonPhase, MOON_PHASE_SYMBOLS } from './moonPhase';
import { useSettingsStore } from '../store/settingsStore';
import { displayTitle } from './entryTitle';
import { categoryLabel } from './categories';
import i18n from '../i18n';
import { portableIcon } from './icons';

export interface ChipData {
  id?: string;            // entry ID (for import resolution)
  label: string;
  icon?: string;          // emoji or data-URL
  fallbackIcon?: string;  // plain emoji to use when icon is a data-URL (markdown export)
}

/** The texts the blocks are exported with, in the current language. */
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
  };
}

export interface ExportData {
  title: string;
  entryNumber?: number;
  content: string;
  createdAt: string;
  // journal
  moonPhase?: string;         // emoji + label, e.g. "🌕 Full Moon"
  // the entry's category, shown in the header line
  category?: ChipData;
  // custom icon on the entry itself (of any entry), may be data-URL or emoji
  entryIcon?: string;
  // common
  tagNames?: string[];
}

function moonLabel(phase: string): string {
  return phase.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export async function collectExportData(): Promise<ExportData | null> {
  const view = useUIStore.getState().activeView;
  if (!view.id || view.type !== 'entry') return null;
  // Right after startup the content of the open entry may still be pending.
  await useEntryStore.getState().ensureEntryContent(view.id);
  const entry = useEntryStore.getState().getEntry(view.id);
  if (!entry) return null;

  const cat = useCategoryStore.getState().categories.find((c) => c.id === entry.category_id);
  const phase = entryMoonPhase(entry, useSettingsStore.getState().settings.journal.moonPhase);

  return {
    title: displayTitle(i18n.t, 'entry', entry.title),
    entryNumber: entry.entry_number,
    content: renderBlocksForExport(entry.content, exportText()),
    createdAt: entry.created_at,
    moonPhase: phase ? `${MOON_PHASE_SYMBOLS[phase]} ${moonLabel(phase)}` : undefined,
    category: cat ? { label: categoryLabel(i18n.t, cat), icon: cat.emoji } : undefined,
    // An uploaded icon as a data URL: the export document cannot reach the vault's files.
    entryIcon: (await portableIcon(entry.icon)) || undefined,
    tagNames: liveTagNames(entry.tags),
  };
}
