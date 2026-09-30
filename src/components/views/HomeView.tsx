import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { BookOpen, Library, Wand2, Copy, Pencil, Trash2 } from 'lucide-react';
import { HOME_COUNTS, useUIStore } from '../../store/uiStore';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import ContextMenu from '../ui/ContextMenu';
import Dashboard from '../ui/Dashboard';
import { ENTRY_TITLE_HEADING_CLASSES } from '../ui/EntryDetailFrame';
import DashboardItem from '../ui/DashboardItem';
import RenameField from '../ui/RenameField';
import Dropdown from '../ui/Dropdown';
import EmptyState from '../ui/EmptyState';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';
import { getMoonPhase, MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import { generateId, isImageIcon } from '../../lib/helpers';
import { entryIcon, MODULES, viewTypeForEntryType } from '../../lib/modules';
import { displayTitle, hasOwnTitle } from '../../lib/entryTitle';
import { categoryLabel } from '../../lib/categories';
import { formatDayHeading, formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import type { MoonPhase } from '../../types';
import type { HomeSort, HomeView, HomeSectionPrefs } from '../../store/uiStore';

type CtxTarget =
  | { kind: 'journal'; id: string }
  | { kind: 'wiki'; id: string }
  | { kind: 'operation'; id: string };

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

// ── Sort helpers ──────────────────────────────────────────────────────────────

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
  const { entries, createEntry, duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useJournalStore(
    useShallow((s) => ({ entries: s.entries, createEntry: s.createEntry, duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const { articles, duplicateArticle, updateArticle, deleteArticle, restoreArticle } = useWikiStore(
    useShallow((s) => ({ articles: s.articles, duplicateArticle: s.duplicateArticle, updateArticle: s.updateArticle, deleteArticle: s.deleteArticle, restoreArticle: s.restoreArticle }))
  );
  const { operations, duplicateOperation, updateOperation, deleteOperation, restoreOperation } = useOperationStore(
    useShallow((s) => ({ operations: s.operations, duplicateOperation: s.duplicateOperation, updateOperation: s.updateOperation, deleteOperation: s.deleteOperation, restoreOperation: s.restoreOperation }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const [ctxMenu, setCtxMenu] = useState<{ target: CtxTarget; x: number; y: number } | null>(null);

  const today = new Date();
  const moonPhase = getMoonPhase(today);

  const handleNewEntry = async () => {
    const entry = await createEntry();
    setActiveView({ type: 'journal', id: entry.id, mode: 'edit', isNew: true });
  };

  const openCtx = (e: React.MouseEvent, target: CtxTarget) => {
    e.preventDefault();
    setCtxMenu({ target, x: e.clientX, y: e.clientY });
  };

  const handleDuplicate = async (target: CtxTarget) => {
    if (target.kind === 'journal') {
      const ne = await duplicateEntry(target.id);
      if (ne) setActiveView({ type: 'journal', id: ne.id, mode: 'view' });
    } else if (target.kind === 'wiki') {
      const na = await duplicateArticle(target.id);
      if (na) setActiveView({ type: 'wiki', id: na.id, mode: 'view' });
    } else if (target.kind === 'operation') {
      const no = await duplicateOperation(target.id);
      if (no) setActiveView({ type: 'operations', id: no.id, mode: 'view' });
    }
  };

  // Umbenennen an Ort und Stelle, wie in den Listen der Module.
  const [renaming, setRenaming] = useState<CtxTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const isRenaming = (kind: CtxTarget['kind'], id: string) => renaming?.kind === kind && renaming.id === id;

  const handleRename = (target: CtxTarget) => {
    const pool = target.kind === 'journal' ? entries : target.kind === 'wiki' ? articles : operations;
    const title = pool.find((item) => item.id === target.id)?.title;
    setRenameValue(hasOwnTitle(title) ? title : '');
    setRenaming(target);
  };

  /** Ein leerer Name ändert nichts, wie in den Listen der Module. */
  const commitRename = async () => {
    if (!renaming) return;
    const title = renameValue.trim();
    setRenaming(null);
    if (!title) return;
    if (renaming.kind === 'journal') await updateEntry(renaming.id, { title });
    else if (renaming.kind === 'wiki') await updateArticle(renaming.id, { title });
    else await updateOperation(renaming.id, { title });
  };

  /** Der Titel einer Zeile oder Karte — beim Umbenennen das Eingabefeld. */
  const itemTitle = (kind: CtxTarget['kind'], id: string, title: string) => (isRenaming(kind, id)
    ? <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename} onCancel={() => setRenaming(null)}
        className="home-item-title text-sm font-medium w-full bg-transparent outline-none selectable" />
    : <div className="home-item-title text-sm font-medium truncate">{displayTitle(t, kind, title)}</div>);

  const handleDelete = async (target: CtxTarget) => {
    if (target.kind === 'journal') {
      await deleteEntry(target.id);
      pushUndo({ id: generateId(), description: t('undo.entryDeleted'),     undo: () => restoreEntry(target.id) });
    } else if (target.kind === 'wiki') {
      await deleteArticle(target.id);
      pushUndo({ id: generateId(), description: t('undo.articleDeleted'),   undo: () => restoreArticle(target.id) });
    } else if (target.kind === 'operation') {
      await deleteOperation(target.id);
      pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(target.id) });
    }
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

  // Datum und Mondphase als Titel — zweizeilig, passt in die h-14-Kopfzeile.
  // Über `Dashboard`, damit der Kopf wie in den Modulen in der rechten
  // Seitenleiste steht; Toolbar gibt es keine, jede Sektion bringt ihre
  // eigene mit.
  const headerLeft = (
    <div className="min-w-0">
      <h1 className={`${ENTRY_TITLE_HEADING_CLASSES} leading-tight truncate`}>
        {formatDayHeading(today)}
      </h1>
      <p className="text-xs text-stone-500 truncate">
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
      contentClassName="flex-1 overflow-y-auto"
      contextMenuSlot={ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={ctxActions}
          onClose={() => setCtxMenu(null)}
        />
      )}
      grouping={{ mode: 'custom', render: () => (
          <div className="max-w-3xl mx-auto px-8 py-10">

            {/* ── Journal ── */}
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => setActiveView({ type: 'journal' })} className="flex items-center gap-2 group flex-shrink-0">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 group-hover:text-stone-400 flex items-center gap-2 transition-colors">
                    <BookOpen size={12} />
                    {t('nav.journal')}
                  </h2>
                  <span className="text-xs text-stone-600 group-hover:text-stone-400 transition-colors">{t('home.viewAll')}</span>
                </button>
                <div className="ml-auto flex-shrink-0">
                  <SectionToolbar prefs={homeJournalPrefs} setPrefs={setHomeJournalPrefs} />
                </div>
              </div>
              {entries.length === 0 ? (
                <EmptyState
                  icon={MODULES.journal.icon}
                  title={t('emptyState.journal.title')}
                  description={t('emptyState.journal.description')}
                  actionLabel={t('emptyState.journal.action')}
                  onAction={handleNewEntry}
                />
              ) : homeJournalPrefs.view === 'list' ? (
                <div className="space-y-2">
                  {journalItems.map((entry) => (
                    <DashboardItem
                      key={entry.id}
                      view={{ type: 'journal', id: entry.id, mode: 'view' }}
                      layout="row"
                      editing={isRenaming('journal', entry.id)}
                      onContextMenu={(e) => openCtx(e, { kind: 'journal', id: entry.id })}
                    >
                      <span className="text-xl">{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase] ?? '📓'}</span>
                      <div className="flex-1 min-w-0">
                        {itemTitle('journal', entry.id, entry.title)}
                        <div className="home-item-meta text-xs mt-0.5">
                          {formatEntryDate(entry.created_at)}
                        </div>
                      </div>
                    </DashboardItem>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {journalItems.map((entry) => (
                    <DashboardItem
                      key={entry.id}
                      view={{ type: 'journal', id: entry.id, mode: 'view' }}
                      layout="card"
                      editing={isRenaming('journal', entry.id)}
                      onContextMenu={(e) => openCtx(e, { kind: 'journal', id: entry.id })}
                    >
                      <div className="text-lg mb-1">{MOON_PHASE_SYMBOLS[entry.moon_phase as MoonPhase] ?? '📓'}</div>
                      {itemTitle('journal', entry.id, entry.title)}
                      <div className="home-item-meta text-xs mt-0.5">
                        {formatEntryDate(entry.created_at)}
                      </div>
                    </DashboardItem>
                  ))}
                </div>
              )}
            </section>

            {/* ── Operations ── */}
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => setActiveView({ type: 'operations' })} className="flex items-center gap-2 group flex-shrink-0">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 group-hover:text-stone-400 flex items-center gap-2 transition-colors">
                    <Wand2 size={12} />
                    {t('nav.operations')}
                  </h2>
                  <span className="text-xs text-stone-600 group-hover:text-stone-400 transition-colors">{t('home.viewAll')}</span>
                </button>
                <div className="ml-auto flex-shrink-0">
                  <SectionToolbar prefs={homeOpsPrefs} setPrefs={setHomeOpsPrefs} />
                </div>
              </div>
              {operations.length === 0 ? (
                <EmptyState icon={MODULES.operations.icon} title={t('emptyState.operations.title')} description={t('emptyState.operations.description')} />
              ) : homeOpsPrefs.view === 'list' ? (
                <div className="space-y-2">
                  {opsItems.map((op) => {
                    const cat = categories.find((c) => c.id === op.category_id);
                    const icon = entryIcon('operation', op, cat);
                    return (
                      <DashboardItem
                        key={op.id}
                        view={{ type: 'operations', id: op.id, mode: 'view' }}
                        layout="row"
                        editing={isRenaming('operation', op.id)}
                        onContextMenu={(e) => openCtx(e, { kind: 'operation', id: op.id })}
                      >
                        {isImageIcon(icon)
                          ? <img src={icon} alt="" className="w-6 h-6 object-cover rounded flex-shrink-0" />
                          : <span className="text-xl">{icon}</span>
                        }
                        <div className="flex-1 min-w-0">
                          {itemTitle('operation', op.id, op.title)}
                          <div className="home-item-meta text-xs mt-0.5">
                            {categoryLabel(t, cat)} · {formatEntryDate(op.updated_at)}
                          </div>
                        </div>
                      </DashboardItem>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {opsItems.map((op) => {
                    const cat = categories.find((c) => c.id === op.category_id);
                    const icon = entryIcon('operation', op, cat);
                    return (
                      <DashboardItem
                        key={op.id}
                        view={{ type: 'operations', id: op.id, mode: 'view' }}
                        layout="card"
                        editing={isRenaming('operation', op.id)}
                        onContextMenu={(e) => openCtx(e, { kind: 'operation', id: op.id })}
                      >
                        {isImageIcon(icon)
                          ? <img src={icon} alt="" className="w-6 h-6 object-cover rounded mb-1" />
                          : <div className="text-lg mb-1">{icon}</div>
                        }
                        {itemTitle('operation', op.id, op.title)}
                        <div className="home-item-meta text-xs mt-0.5">
                          {categoryLabel(t, cat)} · {formatEntryDate(op.updated_at)}
                        </div>
                      </DashboardItem>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── Wiki ── */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => setActiveView({ type: 'wiki' })} className="flex items-center gap-2 group flex-shrink-0">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 group-hover:text-stone-400 flex items-center gap-2 transition-colors">
                    <Library size={12} />
                    {t('nav.wiki')}
                  </h2>
                  <span className="text-xs text-stone-600 group-hover:text-stone-400 transition-colors">{t('home.viewAll')}</span>
                </button>
                <div className="ml-auto flex-shrink-0">
                  <SectionToolbar prefs={homeWikiPrefs} setPrefs={setHomeWikiPrefs} />
                </div>
              </div>
              {articles.length === 0 ? (
                <EmptyState icon={MODULES.wiki.icon} title={t('emptyState.wiki.title')} description={t('emptyState.wiki.description')} />
              ) : homeWikiPrefs.view === 'list' ? (
                <div className="space-y-2">
                  {wikiItems.map((article) => {
                    const cat = categories.find((c) => c.id === article.category_id);
                    const icon = entryIcon('wiki', article, cat);
                    // Kein Fallback auf die rohe category_id — bei gelöschter
                    // Kategorie entfällt das Label.
                    const catLabel = categoryLabel(t, cat);
                    return (
                      <DashboardItem
                        key={article.id}
                        view={{ type: 'wiki', id: article.id, mode: 'view' }}
                        layout="row"
                        editing={isRenaming('wiki', article.id)}
                        onContextMenu={(e) => openCtx(e, { kind: 'wiki', id: article.id })}
                      >
                        {isImageIcon(icon)
                          ? <img src={icon} alt="" className="w-6 h-6 object-cover rounded flex-shrink-0" />
                          : <span className="text-xl flex-shrink-0">{icon}</span>
                        }
                        <div className="flex-1 min-w-0">
                          {itemTitle('wiki', article.id, article.title)}
                          <div className="home-item-meta text-xs capitalize mt-0.5">
                            {catLabel ? `${catLabel} · ` : ''}{formatEntryDate(article.updated_at)}
                          </div>
                        </div>
                      </DashboardItem>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {wikiItems.map((article) => {
                    const cat = categories.find((c) => c.id === article.category_id);
                    const icon = entryIcon('wiki', article, cat);
                    const catLabel = categoryLabel(t, cat);
                    return (
                      <DashboardItem
                        key={article.id}
                        view={{ type: 'wiki', id: article.id, mode: 'view' }}
                        layout="card"
                        editing={isRenaming('wiki', article.id)}
                        onContextMenu={(e) => openCtx(e, { kind: 'wiki', id: article.id })}
                      >
                        {isImageIcon(icon)
                          ? <img src={icon} alt="" className="w-6 h-6 object-cover rounded mb-1" />
                          : <div className="text-lg mb-1">{icon}</div>
                        }
                        {itemTitle('wiki', article.id, article.title)}
                        <div className="home-item-meta text-xs capitalize mt-0.5">
                          {catLabel ? `${catLabel} · ` : ''}{formatEntryDate(article.updated_at)}
                        </div>
                      </DashboardItem>
                    );
                  })}
                </div>
              )}
            </section>

          </div>
      )}}
    />
  );
}
