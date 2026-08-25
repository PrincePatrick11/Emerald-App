import type { ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { BookOpen, Wand2, Library, Flame, CheckSquare, Square, Copy, Pencil, Trash2, PanelTopOpen, LayoutList } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useJournalStore } from '../../store/journalStore';
import { useOperationStore } from '../../store/operationStore';
import { useWikiStore } from '../../store/wikiStore';
import { useTaskStore } from '../../store/taskStore';
import { useAltarStore } from '../../store/altarStore';
import { useUndoStore } from '../../store/undoStore';
import { setDragItem } from '../../lib/dragState';
import { FALLBACK_CATEGORY } from '../../lib/schema';
import { generateId, isImageIcon } from '../../lib/helpers';
import { getCategoryEmoji } from '../wiki/WikiList';
import { MOON_PHASE_SYMBOLS } from '../../lib/moonPhase';
import type { AltarRecord, JournalEntry, MoonPhase, Operation, Task, WikiArticle } from '../../types';
import TabIconButton from '../ui/TabIconButton';
import EntryListTab, { type EntryListTabProps } from '../ui/EntryListTab';
import type { ContextMenuAction } from '../ui/ContextMenu';

/** Die Tabs ohne ihre Beschriftungen, die `t()` brauchen und deshalb in der
 *  Komponente bleiben. Auf Modulebene, damit `ENTRY_LIST_TABS_WIDTH` unten
 *  ihre Anzahl zaehlen kann, statt sie danebenzuschreiben. */
const TABS: Array<{ id: 'all' | 'journal' | 'tasks' | 'operations' | 'wiki' | 'altar'; icon: ReactNode }> = [
  { id: 'all', icon: <LayoutList size={14} /> },
  { id: 'journal', icon: <BookOpen size={14} /> },
  { id: 'tasks', icon: <CheckSquare size={14} /> },
  { id: 'operations', icon: <Wand2 size={14} /> },
  { id: 'wiki', icon: <Library size={14} /> },
  { id: 'altar', icon: <Flame size={14} /> },
];

/* Die Geometrie der Tab-Leiste, in Zahlen statt nur in Utility-Klassen: die
   Standardbreite der Eintragsliste ist genau die Breite, die ihre Tabs
   brauchen (`AppShell`s ENTRY_LIST_DEFAULT). Die Werte spiegeln die Klassen
   der Leiste unten — `px-3` (12), `TabIconButton`s `p-2` + 14px-Icon + 1px
   Rahmen (32), `gap-0.5` (2). Wer eine davon aendert, muss hier mit.

   Die Zahlen gelten fuer 16px Grundschrift — die Utilities darunter rechnen
   in rem. Auf WebKitGTK, das seine Grundschrift aus der GTK-Textskalierung
   zieht, kann die Leiste deshalb schon bei Standardbreite umbrechen. Schlimm
   ist das nicht: der Umbruch ist der behandelte Fall, nicht der Fehlerfall.
   Falsch laufen kann hier nur die Standardbreite selbst. */
const TAB_SIZE = 32;
const TAB_GAP = 2;
const TAB_STRIP_PADDING_X = 12;
export const ENTRY_LIST_TABS_WIDTH =
  TAB_STRIP_PADDING_X * 2 + TABS.length * TAB_SIZE + (TABS.length - 1) * TAB_GAP;

export default function LeftSidebarEntryList() {
  const { t } = useTranslation();
  const { leftListTab, setLeftListTab } = useUIStore(
    useShallow((s) => ({ leftListTab: s.leftListTab, setLeftListTab: s.setLeftListTab }))
  );


  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* `flex-wrap` + `min-h-14` statt `h-14`: bei voller Breite unveraendert
          (eine 32px-Reihe, mit `py-2` = 48px unter der Mindesthoehe, weiterhin
          zentriert), darunter rutschen die ueberzaehligen Tabs in eine zweite
          Reihe statt stumm ueber den Rand zu laufen. Flexbox entscheidet das
          selbst — keine Schwelle, kein ResizeObserver, kein Oszillieren. */}
      <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 min-h-14 border-b border-stone-700/60 flex-shrink-0">
        {TABS.map(({ id, icon }) => (
          <TabIconButton key={id} active={leftListTab === id} onClick={() => setLeftListTab(id)} title={t(`nav.${id}`)}>
            {icon}
          </TabIconButton>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {leftListTab === 'all' && <AllList />}
        {leftListTab === 'journal' && <JournalList />}
        {leftListTab === 'tasks' && <TasksList />}
        {leftListTab === 'operations' && <OperationsList />}
        {leftListTab === 'wiki' && <WikiList />}
        {leftListTab === 'altar' && <AltarList />}
      </div>
    </div>
  );
}

// ── All ──────────────────────────────────────────────────────────────────────
// One flat, type-erased row per entry, so the combined list reuses each tab's
// real handlers (duplicate, delete-with-undo, rename) instead of copying them.
// EntryListTab<T> is single-typed, so the erasure has to happen somewhere; the
// closures below are that seam. Four config fields cannot survive it and are
// dropped on purpose: renderRow (only Tasks has one — in "All" its rows fall
// back to the plain icon/title layout), plus onCreate, createTitle and
// emptyMessage, which "All" answers for itself.

type EntryKind = 'journal' | 'task' | 'operation' | 'wiki' | 'altar';

interface AllRow {
  id: string;
  title: string;
  sortDate: string;
  icon: ReactNode;
  dateStr: string;
  active: boolean;
  open: () => void;
  /** Absent for Tasks, which have no standalone view to open in a tab. */
  openNewTab?: () => void;
  /** Absent for Tasks and Altars, which are not drag sources. */
  dragStart?: () => void;
  rename: (title: string) => void | Promise<void>;
  actions: (startRename: () => void) => ContextMenuAction[];
}

function toAllRows<T>(
  kind: EntryKind,
  kindLabel: string,
  cfg: EntryListTabProps<T>,
  getSortDate: (item: T) => string,
): AllRow[] {
  const { onOpen, onOpenNewTab, onDragStart } = cfg;
  return cfg.items.map((item) => ({
    id: `${kind}:${cfg.getId(item)}`,
    title: cfg.getTitle(item),
    sortDate: getSortDate(item),
    icon: cfg.getIcon?.(item),
    // Reuse the tab's own subtitle so an entry never shows one date here and
    // another there; the kind label is what "All" adds on top.
    dateStr: [kindLabel, cfg.getDateStr?.(item)].filter(Boolean).join(' · '),
    active: cfg.isActive?.(item) ?? false,
    open: () => onOpen?.(item),
    openNewTab: onOpenNewTab && (() => onOpenNewTab(item)),
    dragStart: onDragStart && (() => onDragStart(item)),
    rename: (title: string) => cfg.onRename(item, title),
    actions: (startRename: () => void) => cfg.contextMenuActions(item, startRename),
  }));
}

function AllList() {
  const { t } = useTranslation();
  const journal = useJournalConfig();
  const tasks = useTasksConfig();
  const operations = useOperationsConfig();
  const wiki = useWikiConfig();
  const altar = useAltarConfig();

  const rows = [
    ...toAllRows('journal', t('nav.journal'), journal, (e) => e.updated_at),
    ...toAllRows('task', t('nav.tasks'), tasks, (task) => task.updated_at),
    ...toAllRows('operation', t('nav.operations'), operations, (op) => op.updated_at),
    ...toAllRows('wiki', t('nav.wiki'), wiki, (a) => a.updated_at),
    ...toAllRows('altar', t('nav.altar'), altar, (a) => a.updated_at),
  ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  return (
    <EntryListTab
      items={rows}
      getId={(r) => r.id}
      getTitle={(r) => r.title}
      getDateStr={(r) => r.dateStr}
      getIcon={(r) => r.icon}
      isActive={(r) => r.active}
      onOpen={(r) => r.open()}
      onOpenNewTab={(r) => r.openNewTab?.()}
      onDragStart={(r) => r.dragStart?.()}
      canDrag={(r) => Boolean(r.dragStart)}
      onRename={(r, title) => r.rename(title)}
      contextMenuActions={(r, startRename) => r.actions(startRename)}
      emptyMessage={t('sidebar.allEmpty')}
    />
  );
}

// ── Journal ──────────────────────────────────────────────────────────────────
function useJournalConfig(): EntryListTabProps<JournalEntry> {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { entries, createEntry, duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useJournalStore(
    useShallow((s) => ({ entries: s.entries, createEntry: s.createEntry, duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const handleNewJournalEntry = async () => {
    const entry = await createEntry();
    setActiveView({ type: 'journal', id: entry.id, mode: 'edit' });
  };

  const handleDuplicate = async (entry: (typeof entries)[number]) => {
    const newEntry = await duplicateEntry(entry.id);
    if (newEntry) setActiveView({ type: 'journal', id: newEntry.id, mode: 'view' });
  };

  const handleDelete = async (entry: (typeof entries)[number]) => {
    await deleteEntry(entry.id);
    pushUndo({ id: generateId(), description: t('undo.entryDeleted'), undo: () => restoreEntry(entry.id) });
    if (activeView.id === entry.id) setActiveView({ type: 'journal' });
  };

  return {
    items: entries,
    getId: (e) => e.id,
    getTitle: (e) => e.title,
    getDateStr: (e) => format(new Date(e.created_at), 'MMM d, yyyy'),
    getIcon: (e) => <span className="text-base leading-none flex-shrink-0">{MOON_PHASE_SYMBOLS[e.moon_phase as MoonPhase] ?? '📓'}</span>,
    isActive: (e) => activeView.id === e.id,
    onOpen: (e) => setActiveView({ type: 'journal', id: e.id, mode: 'view' }),
    onOpenNewTab: (e) => openViewInNewTab({ type: 'journal', id: e.id, mode: 'view' }),
    onDragStart: (e) => setDragItem({ id: e.id, entryType: 'journal', label: e.title }),
    onRename: (e, title) => updateEntry(e.id, { title }),
    contextMenuActions: (e, startRename) => [
      { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'journal', id: e.id, mode: 'view' }) },
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(e) },
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(e), danger: true },
    ],
    emptyMessage: t('journal.noEntries'),
    onCreate: handleNewJournalEntry,
    createTitle: t('journal.newEntry'),
  };
}

function JournalList() {
  return <EntryListTab {...useJournalConfig()} />;
}

// ── Operations ───────────────────────────────────────────────────────────────
function useOperationsConfig(): EntryListTabProps<Operation> {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { categories, operations, createOperation, updateOperation, deleteOperation, restoreOperation } = useOperationStore(
    useShallow((s) => ({ categories: s.categories, operations: s.operations, createOperation: s.createOperation, updateOperation: s.updateOperation, deleteOperation: s.deleteOperation, restoreOperation: s.restoreOperation }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const opCatName = (c: (typeof categories)[number]) => (c.is_builtin ? t(`operations.categories.${c.id}`) : c.name);

  const handleNewOperation = async () => {
    const categoryId = categories[0]?.id;
    if (!categoryId) return;
    const op = await createOperation(categoryId);
    setActiveView({ type: 'operations', id: op.id, mode: 'edit' });
  };

  const handleDuplicate = async (op: (typeof operations)[number]) => {
    const newOp = await createOperation(op.category_id);
    await updateOperation(newOp.id, {
      title: op.title + ' (Copy)', content: op.content,
      tags: op.tags, is_active: op.is_active, end_date: op.end_date,
      version: op.version, icon: op.icon ?? undefined, cover_image: op.cover_image ?? undefined,
    });
    setActiveView({ type: 'operations', id: newOp.id, mode: 'view' });
  };

  const handleDelete = async (op: (typeof operations)[number]) => {
    await deleteOperation(op.id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(op.id) });
    if (activeView.id === op.id) setActiveView({ type: 'operations' });
  };

  const sorted = operations.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return {
    items: sorted,
    getId: (op) => op.id,
    getTitle: (op) => op.title,
    getDateStr: (op) => {
      const cat = catById[op.category_id];
      const catDisplayName = cat ? opCatName(cat) : '';
      return `${catDisplayName}${catDisplayName ? ' · ' : ''}${format(new Date(op.updated_at), 'MMM d, yyyy')}`;
    },
    getIcon: (op) => {
      const cat = catById[op.category_id];
      const iconValue = op.icon || cat?.emoji || '⚡';
      return isImageIcon(iconValue)
        ? <img src={iconValue} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
        : <span className="text-base leading-none flex-shrink-0">{iconValue}</span>;
    },
    isActive: (op) => activeView.id === op.id,
    onOpen: (op) => setActiveView({ type: 'operations', id: op.id, mode: 'view' }),
    onOpenNewTab: (op) => openViewInNewTab({ type: 'operations', id: op.id, mode: 'view' }),
    onDragStart: (op) => setDragItem({ id: op.id, entryType: 'operation', label: op.title, category: catById[op.category_id]?.emoji }),
    onRename: (op, title) => updateOperation(op.id, { title }),
    contextMenuActions: (op, startRename) => [
      { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'operations', id: op.id, mode: 'view' }) },
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(op) },
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(op), danger: true },
    ],
    emptyMessage: t('operations.none'),
    onCreate: handleNewOperation,
    createTitle: t('operations.new'),
  };
}

function OperationsList() {
  return <EntryListTab {...useOperationsConfig()} />;
}

// ── Wiki ─────────────────────────────────────────────────────────────────────
function useWikiConfig(): EntryListTabProps<WikiArticle> {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { articles, wikiCategories, createArticle, updateArticle, deleteArticle, restoreArticle } = useWikiStore(
    useShallow((s) => ({ articles: s.articles, wikiCategories: s.wikiCategories, createArticle: s.createArticle, updateArticle: s.updateArticle, deleteArticle: s.deleteArticle, restoreArticle: s.restoreArticle }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(wikiCategories.map((c) => [c.id, c]));

  const handleNewArticle = async () => {
    const category = wikiCategories[0]?.id ?? 'other';
    const article = await createArticle(category);
    setActiveView({ type: 'wiki', id: article.id, mode: 'edit' });
  };

  const handleDuplicate = async (article: (typeof articles)[number]) => {
    const newArt = await createArticle(article.category_id);
    await updateArticle(newArt.id, {
      title: article.title + ' (Copy)', content: article.content,
      tags: article.tags, icon: article.icon ?? undefined, cover_image: article.cover_image ?? undefined,
    });
    setActiveView({ type: 'wiki', id: newArt.id, mode: 'view' });
  };

  const handleDelete = async (article: (typeof articles)[number]) => {
    await deleteArticle(article.id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreArticle(article.id) });
    if (activeView.id === article.id) setActiveView({ type: 'wiki' });
  };

  const sorted = articles.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return {
    items: sorted,
    getId: (a) => a.id,
    getTitle: (a) => a.title,
    getDateStr: (a) => {
      const cat = catById[a.category_id];
      const catLabel = cat ? (cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name) : a.category_id;
      return `${catLabel} · ${format(new Date(a.updated_at), 'MMM d, yyyy')}`;
    },
    getIcon: (a) => {
      const cat = catById[a.category_id];
      return isImageIcon(a.icon)
        ? <img src={a.icon} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
        : <span className="text-base leading-none flex-shrink-0">{cat?.emoji ?? getCategoryEmoji(a.category_id)}</span>;
    },
    isActive: (a) => activeView.id === a.id,
    onOpen: (a) => setActiveView({ type: 'wiki', id: a.id, mode: 'view' }),
    onOpenNewTab: (a) => openViewInNewTab({ type: 'wiki', id: a.id, mode: 'view' }),
    onDragStart: (a) => setDragItem({ id: a.id, entryType: 'wiki', label: a.title, category: a.category_id }),
    onRename: (a, title) => updateArticle(a.id, { title }),
    contextMenuActions: (a, startRename) => [
      { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'wiki', id: a.id, mode: 'view' }) },
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(a) },
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(a), danger: true },
    ],
    emptyMessage: t('wiki.noArticles'),
    onCreate: handleNewArticle,
    createTitle: t('wiki.newArticle'),
  };
}

function WikiList() {
  return <EntryListTab {...useWikiConfig()} />;
}

// ── Altar ────────────────────────────────────────────────────────────────────
function useAltarConfig(): EntryListTabProps<AltarRecord> {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { altars, createAltar, updateAltar } = useAltarStore(
    useShallow((s) => ({ altars: s.altars, createAltar: s.createAltar, updateAltar: s.updateAltar }))
  );

  const handleNewAltar = async () => {
    const altar = await createAltar();
    setActiveView({ type: 'altar', id: altar.id, mode: 'edit' });
  };

  const sorted = altars.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return {
    items: sorted,
    getId: (a) => a.id,
    getTitle: (a) => a.title,
    getDateStr: (a) => format(new Date(a.updated_at), 'MMM d, yyyy'),
    getIcon: (a) => (isImageIcon(a.icon_data)
      ? <img src={a.icon_data!} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
      : <Flame size={16} className="flex-shrink-0 text-stone-600" />),
    isActive: (a) => activeView.id === a.id,
    onOpen: (a) => setActiveView({ type: 'altar', id: a.id, mode: 'view' }),
    onOpenNewTab: (a) => openViewInNewTab({ type: 'altar', id: a.id, mode: 'view' }),
    onRename: (a, title) => updateAltar(a.id, { title }),
    contextMenuActions: (a, startRename) => [
      { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'altar', id: a.id, mode: 'view' }) },
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
    ],
    emptyMessage: t('altar.none'),
    onCreate: handleNewAltar,
    createTitle: t('altar.newAltar'),
  };
}

function AltarList() {
  return <EntryListTab {...useAltarConfig()} />;
}

// ── Tasks ────────────────────────────────────────────────────────────────────
function useTasksConfig(): EntryListTabProps<Task> {
  const { t } = useTranslation();
  const { activeView, setActiveView } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView }))
  );
  const { categories, tasks, createTask, updateTask, deleteTask, restoreTask } = useTaskStore(
    useShallow((s) => ({ categories: s.categories, tasks: s.tasks, createTask: s.createTask, updateTask: s.updateTask, deleteTask: s.deleteTask, restoreTask: s.restoreTask }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  /** Aufgaben haben keine eigene Seite; die id waehlt die Zeile in `TasksView`
   *  aus, die sich daraufhin sichtbar macht und markiert. */
  const openTask = (id: string) => setActiveView({ type: 'tasks', id });

  const handleNewTask = async () => {
    const task = await createTask(FALLBACK_CATEGORY.tasks);
    openTask(task.id);
    return task;
  };

  const handleDelete = async (task: (typeof tasks)[number]) => {
    await deleteTask(task.id);
    pushUndo({ id: generateId(), description: t('undo.taskDeleted'), undo: () => restoreTask(task.id) });
  };

  const dateStrFor = (task: (typeof tasks)[number]) => {
    const cat = catById[task.category_id];
    return `${cat?.name ?? ''}${cat?.name && task.due_date ? ' · ' : ''}${task.due_date ? format(new Date(task.due_date), 'MMM d, yyyy') : ''}`;
  };

  const sorted = tasks.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // The checkbox needs to be clickable independently of the title, so the row
  // content is custom — search bar, empty-state, "+" and the context menu
  // popup itself still come from EntryListTab. getIcon/getDateStr/onOpen go
  // unused behind renderRow here, but let the "All" tab render tasks plainly.
  // `isActive` is the exception: EntryListTab hands it to the row, so both tabs
  // mark the selected task from the same predicate.
  return {
    items: sorted,
    getId: (task) => task.id,
    getTitle: (task) => task.title,
    getDateStr: dateStrFor,
    getIcon: (task) => (task.completed
      ? <CheckSquare size={16} className="flex-shrink-0 text-stone-600" />
      : <Square size={16} className="flex-shrink-0 text-stone-600" />),
    isActive: (task) => activeView.id === task.id,
    onOpen: (task) => openTask(task.id),
    onRename: (task, title) => updateTask(task.id, { title }),
    contextMenuActions: (task, startRename) => [
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(task), danger: true },
    ],
    emptyMessage: t('tasks.empty'),
    onCreate: handleNewTask,
    createTitle: t('tasks.newTask'),
    renderRow: ({ item: task, isActive, isRenaming, renameValue, setRenameValue, commitRename, cancelRename, openCtxMenu }) => {
      const dateStr = dateStrFor(task);

      if (isRenaming) {
        return (
          <div className={`sidebar-item ${isActive ? 'active' : ''}`}>
            <CheckSquare size={16} className="flex-shrink-0 text-stone-600" />
            <div className="flex-1 min-w-0">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
                className="w-full bg-transparent text-sm text-stone-300 outline-none selectable truncate"
              />
              {dateStr && <div className="text-xs text-stone-600 mt-0.5">{dateStr}</div>}
            </div>
          </div>
        );
      }

      return (
        <div onContextMenu={openCtxMenu} className={`sidebar-item w-full text-left ${isActive ? 'active' : ''}`}>
          <button
            onClick={(e) => { e.stopPropagation(); updateTask(task.id, { completed: !task.completed }); }}
            className="flex-shrink-0 text-stone-500 hover:text-stone-300"
            title={task.completed ? t('tasks.markActive') : t('tasks.markCompleted')}
          >
            {task.completed ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
          <button onClick={() => openTask(task.id)} className="flex-1 min-w-0 text-left">
            <div className={`truncate ${task.completed ? 'line-through text-stone-500' : ''}`}>{task.title}</div>
            {dateStr && <div className="text-xs text-stone-600 mt-0.5">{dateStr}</div>}
          </button>
        </div>
      );
    },
  };
}

function TasksList() {
  return <EntryListTab {...useTasksConfig()} />;
}
