import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { categoryLabel, lookupCategory } from '../lib/categories';
import { entryDateOf } from '../lib/dashboards';
import { entryIcon } from '../lib/entryIcon';
import { displayTitle } from '../lib/entryTitle';
import { formatEntryDate } from '../lib/formatDate';
import { blockValueLine, blockValueText } from '../lib/blockValueText';
import { entryBlockSummary } from '../lib/blocks/entrySummary';
import type { InfoForm, ShownListInfoPart } from '../lib/blocks/listInfo';
import { setDragItem } from '../lib/dragState';
import { useCategoryStore } from '../store/categoryStore';
import { useEntryStore } from '../store/entryStore';
import { deleteEntryWithUndo } from '../store/entryActions';
import { entryView } from '../store/entryViews';
import { useUIStore } from '../store/uiStore';
import ContextMenu, { type ContextMenuAction } from '../components/ui/ContextMenu';
import DashboardItem, { CardContent, ItemGlyph, RENAME_INPUT_CLASS, RowContent } from '../components/ui/DashboardItem';
import RenameField from '../components/ui/RenameField';
import { useOpenInNewTabAction } from './useOpenInNewTabAction';
import { useSaveAsTemplateAction } from './useSaveAsTemplateAction';
import { useLinkTitle } from './useLinkItems';
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
  /** Category · date. */
  meta: (entry: Entry) => string;
  /**
   * The narrow left list: the date — with the category only while the
   * blocks add nothing, so that both dates are seen whole (#173).
   */
  narrowMeta: (entry: Entry) => string;
  /**
   * What the entry's blocks add to the info line (`ListInfoPart`), one node
   * per part, never cut: short as icon and short value (the long form as
   * tooltip), long as "Label: value". Empty without any.
   */
  info: (entry: Entry, form: InfoForm) => ReactNode[];
  /** The date the row shows, for sorting by the same. */
  date: (entry: Entry) => string;
  view: (entry: Entry) => ActiveView;
  rename: (entry: Entry, title: string) => Promise<void>;
  dragStart: (entry: Entry) => void;
  /** The context menu: new tab, duplicate, save as template, rename, delete (with Undo). */
  actions: (entry: Entry, startRename: () => void) => ContextMenuAction[];
}

/** A part of the info line in its short form: its icon (if it has one) and short value. */
function ShortInfo({ part, text }: { part: ShownListInfoPart; text: string }) {
  const Icon = part.icon;
  return <>{Icon && <Icon size={12} className="flex-shrink-0" aria-hidden />}{text}</>;
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

  // A link field shows its target's current title, not the one stored with it.
  const linkTitle = useLinkTitle();

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const view = (e: Entry) => entryView(e.id, dashboardId);
  const date = (e: Entry) => entryDateOf(e, dateField);

  const parts = (e: Entry, form: InfoForm) => entryBlockSummary(e).info[form];
  // No fallback to the raw category_id: for a deleted category the label is omitted.
  const category = (e: Entry) => categoryLabel(t, lookupCategory(catById, e.category_id));
  const meta = (e: Entry) => [category(e), formatEntryDate(date(e))].filter(Boolean).join(' · ');
  const longInfo = (part: ShownListInfoPart) => blockValueLine(t, part, linkTitle);

  const duplicate = async (e: Entry) => {
    const copy = await duplicateEntry(e.id);
    if (copy) setActiveView(view(copy));
  };

  return {
    icon: (e) => entryIcon(e, lookupCategory(catById, e.category_id)),
    title: (e) => displayTitle(t, 'entry', e.title),
    editTitle: (e) => e.title,
    meta,
    // #173: while the blocks add something, the date alone — so both dates fit.
    narrowMeta: (e) => (parts(e, 'short').length ? formatEntryDate(date(e)) : meta(e)),
    info: (e, form) => parts(e, form).map((part) => {
      // A typed text or a link's name may be cut; values of a known width (dates, numbers) never are.
      const className = `entry-list-info${part.value.kind === 'text' || part.value.kind === 'link' ? ' entry-list-info--free' : ''}`;
      return form === 'short'
        ? (
          <span key={part.key} className={className} title={longInfo(part)}>
            <ShortInfo part={part} text={blockValueText(t, part.value, { form: 'short', titleOf: linkTitle })} />
          </span>
        )
        : <span key={part.key} className={className} title={longInfo(part)}>{longInfo(part)}</span>;
    }),
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
 * `form` is the info line's (`InfoForm`): a dashboard's setting, long elsewhere.
 */
export function useEntryItems(rows: EntryRows, entries: readonly Entry[], form: InfoForm = 'long') {
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
          ? <CardContent icon={<ItemGlyph icon={rows.icon(e)} large />} title={title} meta={rows.meta(e)} info={rows.info(e, form)}>{below}</CardContent>
          : <RowContent icon={<ItemGlyph icon={rows.icon(e)} />} title={title} meta={rows.meta(e)} info={rows.info(e, form)} />}
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
