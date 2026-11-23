import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { categoryLabel, lookupCategory } from '../lib/categories';
import { entryDateOf } from '../lib/dashboards';
import { entryIcon } from '../lib/entryIcon';
import { displayTitle } from '../lib/entryTitle';
import { formatEntryDate, formatIsoDate, formatIsoDateShort } from '../lib/formatDate';
import { entryBlockSummary } from '../lib/blocks/entrySummary';
import type { ShownListInfoPart } from '../lib/blocks/listInfo';
import { setDragItem } from '../lib/dragState';
import { useCategoryStore } from '../store/categoryStore';
import { useEntryStore } from '../store/entryStore';
import { deleteEntryWithUndo } from '../store/entryActions';
import { entryView } from '../store/entryViews';
import { useSettingsStore } from '../store/settingsStore';
import { useUIStore } from '../store/uiStore';
import ContextMenu, { type ContextMenuAction } from '../components/ui/ContextMenu';
import DashboardItem, { CardContent, ItemGlyph, RENAME_INPUT_CLASS, RowContent } from '../components/ui/DashboardItem';
import RenameField from '../components/ui/RenameField';
import { useOpenInNewTabAction } from './useOpenInNewTabAction';
import { useSaveAsTemplateAction } from './useSaveAsTemplateAction';
import type { ActiveView, Entry } from '../types';

interface EntryRowOptions {
  /** The dashboard the entries open in; without one, "All entries". */
  dashboardId?: string;
  /** The date the row shows — the one its list sorts by. */
  dateField: 'created' | 'updated';
}

/** What a row of an entry is, wherever a list shows it; the frame around it is the list's own. */
export interface EntryRows {
  /** The icon value (emoji or image file) — the list draws it at its size. */
  icon: (entry: Entry) => string;
  title: (entry: Entry) => string;
  /** What renaming starts with: the stored title, without "Untitled …". */
  editTitle: (entry: Entry) => string;
  /** Category · date, then what the entry's blocks add (`ListInfoPart`), written out. */
  meta: (entry: Entry) => string;
  /** The narrow left list: category · date only, without what the blocks add… */
  shortMeta: (entry: Entry) => string;
  /** …and what the blocks add as icon and short value, the long form as tooltip — `null` without any. */
  shortInfo: (entry: Entry) => ReactNode;
  /** The date the row shows, for sorting by the same. */
  date: (entry: Entry) => string;
  view: (entry: Entry) => ActiveView;
  rename: (entry: Entry, title: string) => Promise<void>;
  dragStart: (entry: Entry) => void;
  /** The context menu: new tab, duplicate, save as template, rename, delete (with Undo). */
  actions: (entry: Entry, startRename: () => void) => ContextMenuAction[];
}

/** The value of a part, its date in the given form. */
function infoValue(part: ShownListInfoPart, formatDate: (iso: string) => string): string {
  return part.value.kind === 'date' ? formatDate(part.value.iso) : part.value.text;
}

/**
 * The one row of an entry — in the left list, on a dashboard and under a tag:
 * icon, title, the info line, where it opens and its context menu.
 */
export function useEntryRows({ dashboardId, dateField }: EntryRowOptions): EntryRows {
  const { t } = useTranslation();
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const duplicateEntry = useEntryStore((s) => s.duplicateEntry);
  const updateEntry = useEntryStore((s) => s.updateEntry);
  const categories = useCategoryStore((s) => s.categories);
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const view = (e: Entry) => entryView(e.id, dashboardId);
  const date = (e: Entry) => entryDateOf(e, dateField);

  const info = (e: Entry) => entryBlockSummary(e.id, e.content).listInfo;
  // No fallback to the raw category_id: for a deleted category the label is omitted.
  const baseMeta = (e: Entry) => [categoryLabel(t, lookupCategory(catById, e.category_id)), formatEntryDate(date(e))];
  // "Label: value" as a key: French puts a space before the colon.
  const longInfo = (part: ShownListInfoPart) => t('common.labelValue', { label: t(part.labelKey), value: infoValue(part, formatIsoDate) });

  const duplicate = async (e: Entry) => {
    const copy = await duplicateEntry(e.id);
    if (copy) setActiveView(view(copy));
  };

  return {
    icon: (e) => entryIcon(e, lookupCategory(catById, e.category_id), showMoonPhase),
    title: (e) => displayTitle(t, 'entry', e.title),
    editTitle: (e) => e.title,
    meta: (e) => [...baseMeta(e), ...info(e).map(longInfo)].filter(Boolean).join(' · '),
    shortMeta: (e) => baseMeta(e).filter(Boolean).join(' · '),
    shortInfo: (e) => {
      const parts = info(e);
      if (parts.length === 0) return null;
      return parts.map((part) => (
        <span key={part.key} className="entry-list-info" title={longInfo(part)}>
          <part.icon size={12} className="flex-shrink-0" aria-hidden />
          {infoValue(part, formatIsoDateShort)}
        </span>
      ));
    },
    date,
    view,
    rename: async (e, title) => {
      const trimmed = title.trim();
      if (trimmed) await updateEntry(e.id, { title: trimmed });
    },
    dragStart: (e) => setDragItem({
      id: e.id, targetKind: 'entry', label: displayTitle(t, 'entry', e.title),
      category: lookupCategory(catById, e.category_id)?.emoji,
    }),
    actions: (e, startRename) => [
      openInNewTabAction(view(e)),
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => void duplicate(e) },
      saveAsTemplateAction(e.id),
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => void deleteEntryWithUndo(e.id), danger: true },
    ],
  };
}

/**
 * The entry rows of the main area — a dashboard, the entries under a tag: each
 * a `DashboardItem` as row or card, renamed in place, with the shared context
 * menu. `menu` goes into the view once (a `Dashboard`'s `contextMenuSlot`).
 */
export function useEntryItems(rows: EntryRows, entries: readonly Entry[]) {
  // Keyed by the row (`place`), not the entry: under tags one entry can stand
  // in several rows, and only the one clicked opens its menu or renames.
  const [ctxMenu, setCtxMenu] = useState<{ id: string; place: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; place: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const startRename = (e: Entry, place: string) => {
    setRenameValue(rows.editTitle(e));
    setRenaming({ id: e.id, place });
  };

  const commitRename = async () => {
    const entry = renaming ? entries.find((e) => e.id === renaming.id) : undefined;
    if (entry) await rows.rename(entry, renameValue);
    setRenaming(null);
  };

  /** One entry; `below` follows the card's info line (its tags). `place` tells
   *  apart rows of the same entry (default: the entry's ID). */
  const render = (e: Entry, layout: 'row' | 'card', below?: ReactNode, place: string = e.id) => {
    const isRenaming = renaming?.place === place;
    const title = isRenaming
      ? <RenameField value={renameValue} onChange={setRenameValue} onCommit={() => void commitRename()}
          onCancel={() => setRenaming(null)} className={RENAME_INPUT_CLASS} />
      : rows.title(e);
    return (
      <DashboardItem
        view={rows.view(e)}
        layout={layout}
        editing={isRenaming}
        onContextMenu={(ev) => { ev.preventDefault(); setCtxMenu({ id: e.id, place, x: ev.clientX, y: ev.clientY }); }}
      >
        {layout === 'card'
          ? <CardContent icon={<ItemGlyph icon={rows.icon(e)} large />} title={title} meta={rows.meta(e)}>{below}</CardContent>
          : <RowContent icon={<ItemGlyph icon={rows.icon(e)} />} title={title} meta={rows.meta(e)} />}
      </DashboardItem>
    );
  };

  const ctxEntry = ctxMenu ? entries.find((e) => e.id === ctxMenu.id) : undefined;
  const menu = ctxMenu && ctxEntry ? (
    <ContextMenu
      x={ctxMenu.x} y={ctxMenu.y}
      onClose={() => setCtxMenu(null)}
      actions={rows.actions(ctxEntry, () => startRename(ctxEntry, ctxMenu.place))}
    />
  ) : null;

  return { render, menu };
}
