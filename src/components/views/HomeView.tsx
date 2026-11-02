import { useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { HOME_COUNTS, useUIStore } from '../../store/uiStore';
import { useEntryStore } from '../../store/entryStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import ContextMenu from '../ui/ContextMenu';
import Dashboard from '../ui/Dashboard';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { ENTRY_TITLE_HEADING_CLASSES } from '../ui/EntryDetailFrame';
import DashboardItem, { CardContent, ItemGlyph, RENAME_INPUT_CLASS, RowContent } from '../ui/DashboardItem';
import RenameField from '../ui/RenameField';
import Dropdown from '../ui/Dropdown';
import EmptyState from '../ui/EmptyState';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';
import { getMoonPhase, journalIcon, MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { generateId } from '../../lib/helpers';
import { entryIcon, MODULES, viewTypeForEntryType, type ViewId } from '../../lib/modules';
import { displayTitle, hasOwnTitle } from '../../lib/entryTitle';
import { categoryLabel } from '../../lib/categories';
import { formatDayHeading, formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import type { HomeSort, HomeView, HomeSectionPrefs } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { createItem } from '../../lib/createItem';

type CtxTarget =
  | { kind: 'journal'; id: string }
  | { kind: 'wiki'; id: string }
  | { kind: 'operation'; id: string };

/** The undo notice after deleting, per entry type. */
const UNDO_DELETED = {
  journal: 'undo.entryDeleted',
  wiki: 'undo.articleDeleted',
  operation: 'undo.operationDeleted',
} as const satisfies Record<CtxTarget['kind'], string>;

// ── Section toolbar (sort + view + count) ─────────────────────────────────────

function SectionToolbar({
  prefs, setPrefs,
}: {
  prefs: HomeSectionPrefs;
  setPrefs: (p: Partial<HomeSectionPrefs>) => void;
}) {
  const { t } = useTranslation();
  const sortOptions: { value: HomeSort; label: string }[] = [
    { value: 'date_desc',  label: t('home.newest') },
    { value: 'date_asc',   label: t('home.oldest') },
    { value: 'alpha_asc',  label: t('listView.alphaAsc') },
    { value: 'alpha_desc', label: t('listView.alphaDesc') },
  ];
  const viewOptions: { value: HomeView; label: string }[] = [
    { value: 'list',  label: t('listView.list') },
    { value: 'cards', label: t('listView.cards') },
  ];
  const countOptions = HOME_COUNTS.map((count) => ({ value: String(count), label: count ? String(count) : t('operations.all') }));

  return (
    <div className="flex items-center gap-2">
      <Dropdown label={t('home.view') + ': '}  value={prefs.view}          options={viewOptions}  onChange={(v) => setPrefs({ view: v })} />
      <Dropdown label={t('home.sort') + ': '}  value={prefs.sort}          options={sortOptions}  onChange={(v) => setPrefs({ sort: v })} />
      <Dropdown label={t('home.show') + ': '}  value={String(prefs.count)} options={countOptions} onChange={(v) => setPrefs({ count: Number(v) })} />
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

/**
 * One of Home's three lists. Each has its own view, sorting and length, which
 * is why these controls sit in the heading here and not in the sidebar, whose
 * column has room for one list's: the one exception to that rule.
 */
function HomeSection<T>({
  icon: Icon, label, moduleView, prefs, setPrefs, items, empty, renderItem,
}: {
  icon: LucideIcon;
  label: string;
  moduleView: ViewId;
  prefs: HomeSectionPrefs;
  setPrefs: (p: Partial<HomeSectionPrefs>) => void;
  items: T[];
  /** Shown when the module has nothing at all, not when `count` cuts the list. */
  empty: ReactNode;
  renderItem: (item: T, layout: 'row' | 'card') => ReactNode;
}) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  return (
    <section>
      <CollapsibleGroupHeader
        leading={<Icon size={12} className="text-subtle" />}
        label={label}
        meta={(
          <button onClick={() => setActiveView({ type: moduleView })} className="text-xs text-subtle hover:text-raise transition-colors flex-shrink-0">
            {t('home.viewAll')}
          </button>
        )}
        actions={<SectionToolbar prefs={prefs} setPrefs={setPrefs} />}
      />
      {empty || (prefs.view === 'list'
        ? <div className="space-y-1.5">{items.map((item) => renderItem(item, 'row'))}</div>
        : <div className="grid grid-cols-3 gap-3">{items.map((item) => renderItem(item, 'card'))}</div>)}
    </section>
  );
}

function applyCount<T>(items: T[], count: number): T[] {
  return count === 0 ? items : items.slice(0, count);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HomeView() {
  const { t } = useTranslation();
  const { setActiveView, homeJournalPrefs, setHomeJournalPrefs, homeOpsPrefs, setHomeOpsPrefs, homeWikiPrefs, setHomeWikiPrefs, } = useUIStore(
    useShallow((s) => ({ setActiveView: s.setActiveView, homeJournalPrefs: s.homeJournalPrefs, setHomeJournalPrefs: s.setHomeJournalPrefs, homeOpsPrefs: s.homeOpsPrefs, setHomeOpsPrefs: s.setHomeOpsPrefs, homeWikiPrefs: s.homeWikiPrefs, setHomeWikiPrefs: s.setHomeWikiPrefs }))
  );
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { entries, articles, operations, duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useEntryStore(
    useShallow((s) => ({
      entries: s.entries.journal, articles: s.entries.wiki, operations: s.entries.operation,
      duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry,
      deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry,
    }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const [ctxMenu, setCtxMenu] = useState<{ target: CtxTarget; x: number; y: number } | null>(null);

  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);
  const today = new Date();
  const moonPhase = getMoonPhase(today);

  const handleNewEntry = () => createItem('journal');

  const openCtx = (e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    setCtxMenu({ target, x: e.clientX, y: e.clientY });
  };

  const handleDuplicate = async (target: CtxTarget) => {
    const copy = await duplicateEntry(target.id);
    if (copy) setActiveView({ type: viewTypeForEntryType(copy.type), id: copy.id, mode: 'view' });
  };

  // Renaming in place, as in the modules' lists.
  const [renaming, setRenaming] = useState<CtxTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const isRenaming = (kind: CtxTarget['kind'], id: string) => renaming?.kind === kind && renaming.id === id;

  const handleRename = (target: CtxTarget) => {
    const pool = target.kind === 'journal' ? entries : target.kind === 'wiki' ? articles : operations;
    const title = pool.find((item) => item.id === target.id)?.title;
    setRenameValue(hasOwnTitle(title) ? title : '');
    setRenaming(target);
  };

  /** An empty name changes nothing, as in the modules' lists. */
  const commitRename = async () => {
    if (!renaming) return;
    const title = renameValue.trim();
    setRenaming(null);
    if (!title) return;
    await updateEntry(renaming.id, { title });
  };

  /** The title of a row or card — while renaming, the input field. */
  const itemTitle = (kind: CtxTarget['kind'], id: string, title: string) => (isRenaming(kind, id)
    ? <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename} onCancel={() => setRenaming(null)}
        className={RENAME_INPUT_CLASS} />
    : displayTitle(t, kind, title));

  /** One item of a section: the same for all three kinds, in either layout. */
  const renderHomeItem = (kind: CtxTarget['kind'], id: string, title: string, icon: string, meta: string, layout: 'row' | 'card') => {
    const Content = layout === 'row' ? RowContent : CardContent;
    return (
      <DashboardItem
        key={id}
        view={{ type: viewTypeForEntryType(kind), id, mode: 'view' }}
        layout={layout}
        editing={isRenaming(kind, id)}
        onContextMenu={(e) => openCtx(e, { kind, id })}
      >
        <Content icon={<ItemGlyph icon={icon} large={layout === 'card'} />} title={itemTitle(kind, id, title)} meta={meta} />
      </DashboardItem>
    );
  };

  /** A wiki article's or operation's item: category and date as the metadata.
   *  No fallback to the raw category_id, a deleted category's label is omitted. */
  const renderCategorized = (kind: 'wiki' | 'operation') => (entry: typeof articles[number], layout: 'row' | 'card') => {
    const cat = categories.find((c) => c.id === entry.category_id);
    const catLabel = categoryLabel(t, cat);
    return renderHomeItem(kind, entry.id, entry.title, entryIcon(kind, entry, cat),
      `${catLabel ? `${catLabel} · ` : ''}${formatEntryDate(entry.updated_at)}`, layout);
  };

  const handleDelete = async (target: CtxTarget) => {
    await deleteEntry(target.id);
    pushUndo({ id: generateId(), description: t(UNDO_DELETED[target.kind]), undo: () => restoreEntry(target.id) });
  };

  const ctxActions = ctxMenu
    ? [
        openInNewTabAction({ type: viewTypeForEntryType(ctxMenu.target.kind), id: ctxMenu.target.id, mode: 'view' }),
        { label: t('contextMenu.duplicate'), icon: <Copy size={12} />,   onClick: () => handleDuplicate(ctxMenu.target) },
        saveAsTemplateAction(ctxMenu.target.kind, ctxMenu.target.id),
        { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => handleRename(ctxMenu.target) },
        { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleDelete(ctxMenu.target), danger: true },
      ]
    : [];

  // Sorted + sliced data
  const journalItems = applyCount(sortItems(entries, homeJournalPrefs.sort, { date: (e) => e.created_at }), homeJournalPrefs.count);
  const opsItems     = applyCount(sortItems(operations, homeOpsPrefs.sort, { date: (o) => o.updated_at }), homeOpsPrefs.count);
  const wikiItems    = applyCount(sortItems(articles, homeWikiPrefs.sort, { date: (a) => a.updated_at }), homeWikiPrefs.count);

  // Date and moon phase as the title — two lines, fits in the h-14 header row.
  // Via `Dashboard`, so the header sits in the right sidebar as in the
  // modules; there is no toolbar, every section brings its
  // own.
  const headerLeft = (
    <div className="min-w-0">
      <h1 className={`${ENTRY_TITLE_HEADING_CLASSES} leading-tight truncate`}>
        {formatDayHeading(today)}
      </h1>
      <p className="text-xs text-subtle truncate">
        {MOON_PHASE_SYMBOLS[moonPhase]}{' '}{t(`moonPhase.${moonPhase}`)}
      </p>
    </div>
  );

  return (
    <Dashboard<never>
      headerLeft={headerLeft}
      primaryAction={{ label: t('journal.newEntry'), onClick: handleNewEntry }}
      items={[]}
      itemKey={() => ''}
      contextMenuSlot={ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={ctxActions}
          onClose={() => setCtxMenu(null)}
        />
      )}
      grouping={{ mode: 'custom', render: () => (
          <div className="space-y-8">
            <HomeSection
              icon={MODULES.journal.icon}
              label={t('nav.journal')}
              moduleView="journal"
              prefs={homeJournalPrefs}
              setPrefs={setHomeJournalPrefs}
              items={journalItems}
              empty={entries.length === 0 && (
                <EmptyState
                  icon={MODULES.journal.icon}
                  title={t('emptyState.journal.title')}
                  description={t('emptyState.journal.description')}
                  actionLabel={t('emptyState.journal.action')}
                  onAction={handleNewEntry}
                />
              )}
              renderItem={(entry, layout) => renderHomeItem('journal', entry.id, entry.title,
                journalIcon(entry, showMoonPhase), formatEntryDate(entry.created_at), layout)}
            />
            <HomeSection
              icon={MODULES.operations.icon}
              label={t('nav.operations')}
              moduleView="operations"
              prefs={homeOpsPrefs}
              setPrefs={setHomeOpsPrefs}
              items={opsItems}
              empty={operations.length === 0 && (
                <EmptyState icon={MODULES.operations.icon} title={t('emptyState.operations.title')} description={t('emptyState.operations.description')} />
              )}
              renderItem={renderCategorized('operation')}
            />
            <HomeSection
              icon={MODULES.wiki.icon}
              label={t('nav.wiki')}
              moduleView="wiki"
              prefs={homeWikiPrefs}
              setPrefs={setHomeWikiPrefs}
              items={wikiItems}
              empty={articles.length === 0 && (
                <EmptyState icon={MODULES.wiki.icon} title={t('emptyState.wiki.title')} description={t('emptyState.wiki.description')} />
              )}
              renderItem={renderCategorized('wiki')}
            />
          </div>
      )}}
    />
  );
}
