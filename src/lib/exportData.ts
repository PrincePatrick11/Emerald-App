import { useEntryStore } from '../store/entryStore';
import { liveTagNames } from '../store/tagStore';
import { renderBlocksForExport, type ExportText } from './blocks/exportRender';
import { blockLabel, fieldFallbackText } from './blocks/blockAttrs';
import { formatIsoDateLong } from './formatDate';
import { useCategoryStore } from '../store/categoryStore';
import { entryMoonPhase, MOON_PHASE_SYMBOLS } from './moonPhase';
import { useSettingsStore } from '../store/settingsStore';
import { displayTitle } from './entryTitle';
import { categoryLabel } from './categories';
import i18n from '../i18n';
import { portableIcon } from './icons';
import { entryIcon } from './entryIcon';

export interface ChipData {
  id?: string;            // ID of what the chip stands for
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
  /** The entry's ID — the anchor links of the HTML export jump to. */
  id: string;
  title: string;
  entryNumber?: number;
  content: string;
  createdAt: string;
  // journal
  moonPhase?: string;         // emoji + label, e.g. "🌕 Full Moon"
  // the entry's category, shown in the header line; its ID groups the HTML export's sidebar
  category?: ChipData;
  // the entry's icon by the app's rule (`entryIcon`): emoji or data-URL
  icon: string;
  // common
  tagNames?: string[];
}

function moonLabel(phase: string): string {
  return phase.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** An entry as the PDF, HTML and Markdown exports read it — `null` if it is gone. */
export async function collectExportDataFor(id: string): Promise<ExportData | null> {
  // Right after startup an entry's content may still be pending.
  await useEntryStore.getState().ensureEntryContent(id);
  const entry = useEntryStore.getState().getEntry(id);
  if (!entry) return null;

  const cat = useCategoryStore.getState().categories.find((c) => c.id === entry.category_id);
  const showMoon = useSettingsStore.getState().settings.journal.moonPhase;
  const phase = entryMoonPhase(entry, showMoon);

  return {
    id: entry.id,
    title: displayTitle(i18n.t, 'entry', entry.title),
    entryNumber: entry.entry_number,
    content: renderBlocksForExport(entry.content, exportText()),
    createdAt: entry.created_at,
    moonPhase: phase ? `${MOON_PHASE_SYMBOLS[phase]} ${moonLabel(phase)}` : undefined,
    category: cat ? { id: cat.id, label: categoryLabel(i18n.t, cat), icon: cat.emoji } : undefined,
    // An uploaded icon as a data URL: the export document cannot reach the vault's files.
    icon: await portableIcon(entryIcon(entry, cat, showMoon)),
    tagNames: liveTagNames(entry.tags),
  };
}
