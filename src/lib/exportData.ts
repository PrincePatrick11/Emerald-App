import { useEntryStore } from '../store/entryStore';
import { liveTagNames } from '../store/tagStore';
import { renderBlocksForExport, type ExportText } from './blocks/exportRender';
import { linkedIdsOf } from './blocks/blockRefs';
import type { BlockExportFormat } from './blocks/blockType';
import { blockLabel } from './blocks/blockAttrs';
import { entryDate, translatedOr } from './blocks/toolkit';
import { linkTitleSnapshot } from './linkItemsSnapshot';
import { withCurrentLinkTitles } from './internalLinkHtml';
import type { LinkTitleOf } from './blocks/blockValue';
import { formatIsoDateLong } from './formatDate';
import { useCategoryStore } from '../store/categoryStore';
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

/** The texts the blocks are exported with, in the current language; `linkTitle` names a link target as the app does. */
function exportText(linkTitle: LinkTitleOf): ExportText {
  const t = i18n.t;
  return {
    title: (block) => blockLabel(t, block),
    yes: translatedOr(t, 'blocks.fields.yes', 'Yes'),
    no: translatedOr(t, 'blocks.fields.no', 'No'),
    date: formatIsoDateLong,
    number: (value) => value.toLocaleString(i18n.language),
    t: (key) => t(key),
    concealed: (until) => until
      ? t('exportMenu.html.concealedUntil', { date: formatIsoDateLong(until) })
      : t('exportMenu.html.concealed'),
    reveal: t('exportMenu.html.reveal'),
    conceal: t('exportMenu.html.conceal'),
    linkTitle,
  };
}

export interface ExportData {
  /** The entry's ID — the anchor links of the HTML export jump to. */
  id: string;
  title: string;
  entryNumber?: number;
  content: string;
  /** The entries and tasks it links to — what its blocks report (`linkedIdsOf` over the stored blocks, not the rendered `content`). */
  linkedIds: string[];
  createdAt: string;
  // the entry's category, shown in the header line; its ID groups the HTML export's sidebar
  category?: ChipData;
  // the entry's icon by the app's rule (`entryIcon`): emoji or data-URL
  icon: string;
  // common
  tagNames?: string[];
}

/** An entry as the PDF, HTML or Markdown export (`format`) reads it — `null` if it is gone. */
export async function collectExportDataFor(id: string, format: BlockExportFormat): Promise<ExportData | null> {
  // Right after startup an entry's content may still be pending.
  await useEntryStore.getState().ensureEntryContent(id);
  const entry = useEntryStore.getState().getEntry(id);
  if (!entry) return null;

  const cat = useCategoryStore.getState().categories.find((c) => c.id === entry.category_id);
  const linkTitle = linkTitleSnapshot();

  return {
    id: entry.id,
    title: displayTitle(i18n.t, 'entry', entry.title),
    entryNumber: entry.entry_number,
    // Every link — a chip in a text, a link field — names its target's current
    // title, as in the app; the stored one only once the target is gone.
    content: withCurrentLinkTitles(renderBlocksForExport(entry.content, format, exportText(linkTitle), { entryDate: entryDate(entry) }), linkTitle),
    // Exactly what "Linked entries" lists (`linkedIdsOf`).
    linkedIds: [...linkedIdsOf(entry.content)],
    createdAt: entry.created_at,
    category: cat ? { id: cat.id, label: categoryLabel(i18n.t, cat), icon: cat.emoji } : undefined,
    // An uploaded icon as a data URL: the export document cannot reach the vault's files.
    icon: await portableIcon(entryIcon(entry, cat)),
    tagNames: liveTagNames(entry.tags),
  };
}
