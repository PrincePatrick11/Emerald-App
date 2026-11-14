import type { ComponentType } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { formatEntryDate } from '../../lib/formatDate';
import { categoryLabel, lookupCategory } from '../../lib/categories';
import { entryIcon, type LeftListTabId } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import { CheckSquare, Square, Copy, Pencil, Trash2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useEntryStore } from '../../store/entryStore';
import { useDashboardEntries, useEntriesByKind } from '../../hooks/useDashboardEntries';
import { useTaskStore } from '../../store/taskStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { setDragItem } from '../../lib/dragState';
import { generateId, isImageIcon } from '../../lib/helpers';
import { journalIcon } from '../../lib/moonPhase';
import type { Entry, Task } from '../../types';
import EntryListTab, { type EntryListTabProps } from '../ui/EntryListTab';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';

/**
 * The entry list on the left: the search on top, the list below it. Which list —
 * all entries or those of one module — is determined by the vault's setting
 * (Settings → Sidebar); there is no switcher in the bar,
 * modules are changed via the rail.
 */
export default function LeftSidebarEntryList() {
  const list = useSettingsStore((s) => s.settings.leftList.list);
  // Re-rendered per vault: "Show more" starts again at the limit there.
  const vaultId = useSettingsStore((s) => s.vaultId);

  // `flex-1 min-w-0`: the list fills the column and shrinks with it —
  // without `min-w-0` it would stay as wide as its longest title and run
  // under the sheet when narrowed.
  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      <ActiveList key={vaultId} list={list} />
    </div>
  );
}

/** One component per list; the config hooks per module remain the domain logic. */
const TAB_LISTS: Record<LeftListTabId, ComponentType> = {
  all: AllList,
  journal: JournalList,
  tasks: TasksList,
  operations: OperationsList,
  wiki: WikiList,
};

function ActiveList({ list }: { list: LeftListTabId }) {
  const List = TAB_LISTS[list];
  return <List />;
}

// ── All ──────────────────────────────────────────────────────────────────────
// One flat, type-erased row per entry, so the combined list reuses each tab's
// real handlers (duplicate, delete-with-undo, rename) instead of copying them.
// EntryListTab<T> is single-typed, so the erasure has to happen somewhere; the
// closures below are that seam. Two config fields cannot survive it and are
// dropped on purpose: renderRow (only Tasks has one — in "All" its rows fall
// back to the plain icon/title layout), plus emptyMessage, which "All"
// answers for itself.

type EntryKind = 'journal' | 'task' | 'operation' | 'wiki';

/** A list's config, type-erased: its functions only get items of
 *  the same config back (`AllRow.item`), so the cast in `toAllRows` is
 *  safe. */
interface AllSource {
  kindLabel: string;
  cfg: EntryListTabProps<unknown>;
}

/** Deliberately lean: the list only computes title, date and icon for the
 *  rows it actually draws — with thousands of entries this would otherwise be
 *  the whole list on every click (new `activeView`). */
interface AllRow {
  id: string;
  sortDate: string;
  item: unknown;
  src: AllSource;
}

function toAllRows<T>(
  kind: EntryKind,
  kindLabel: string,
  cfg: EntryListTabProps<T>,
  getSortDate: (item: T) => string,
): AllRow[] {
  const src: AllSource = { kindLabel, cfg: cfg as unknown as EntryListTabProps<unknown> };
  return cfg.items.map((item) => ({ id: `${kind}:${cfg.getId(item)}`, sortDate: getSortDate(item), item, src }));
}

function AllList() {
  const { t } = useTranslation();
  // Every entry once, under the module it opens in — also one no dashboard shows.
  const byKind = useEntriesByKind();
  const journal = useJournalConfig(byKind.journal);
  const tasks = useTasksConfig();
  const operations = useOperationsConfig(byKind.operation);
  const wiki = useWikiConfig(byKind.wiki);

  const rows = [
    ...toAllRows('journal', t('nav.journal'), journal, (e) => e.updated_at),
    ...toAllRows('task', t('nav.tasks'), tasks, (task) => task.updated_at),
    ...toAllRows('operation', t('nav.operations'), operations, (op) => op.updated_at),
    ...toAllRows('wiki', t('nav.wiki'), wiki, (a) => a.updated_at),
  ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  return (
    <EntryListTab
      items={rows}
      getId={(r) => r.id}
      getTitle={(r) => r.src.cfg.getTitle(r.item)}
      getEditTitle={(r) => (r.src.cfg.getEditTitle ?? r.src.cfg.getTitle)(r.item)}
      // Reuse the tab's own subtitle so an entry never shows one date here and
      // another there; the kind label is what "All" adds on top.
      getDateStr={(r) => [r.src.kindLabel, r.src.cfg.getDateStr?.(r.item)].filter(Boolean).join(' · ')}
      getIcon={(r) => r.src.cfg.getIcon?.(r.item)}
      isActive={(r) => r.src.cfg.isActive?.(r.item) ?? false}
      onOpen={(r) => r.src.cfg.onOpen?.(r.item)}
      onOpenNewTab={(r) => r.src.cfg.onOpenNewTab?.(r.item)}
      onDragStart={(r) => r.src.cfg.onDragStart?.(r.item)}
      onRename={(r, title) => r.src.cfg.onRename(r.item, title)}
      contextMenuActions={(r, startRename) => r.src.cfg.contextMenuActions(r.item, startRename)}
      emptyMessage={t('sidebar.allEmpty')}
    />
  );
}

// ── Journal ──────────────────────────────────────────────────────────────────
function useJournalConfig(entries: Entry[]): EntryListTabProps<Entry> {
  const { t } = useTranslation();
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useEntryStore(
    useShallow((s) => ({ duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const pushUndo = useUndoStore((s) => s.push);
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);

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
    getTitle: (e) => displayTitle(t, 'journal', e.title),
    getEditTitle: (e) => e.title,
    getDateStr: (e) => formatEntryDate(e.created_at),
    getIcon: (e) => <span className="text-base leading-none flex-shrink-0">{journalIcon(e, showMoonPhase)}</span>,
    isActive: (e) => activeView.id === e.id,
    onOpen: (e) => setActiveView({ type: 'journal', id: e.id, mode: 'view' }),
    onOpenNewTab: (e) => openViewInNewTab({ type: 'journal', id: e.id, mode: 'view' }),
    onDragStart: (e) => setDragItem({ id: e.id, entryType: 'journal', label: displayTitle(t, 'journal', e.title) }),
    onRename: (e, title) => updateEntry(e.id, { title }),
    contextMenuActions: (e, startRename) => [
      openInNewTabAction({ type: 'journal', id: e.id, mode: 'view' }),
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(e) },
      saveAsTemplateAction(e.id),
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(e), danger: true },
    ],
    emptyMessage: t('emptyState.journal.title'),
  };
}

function JournalList() {
  return <EntryListTab {...useJournalConfig(useDashboardEntries('journal'))} />;
}

// ── Operations ───────────────────────────────────────────────────────────────
function useOperationsConfig(operations: Entry[]): EntryListTabProps<Entry> {
  const { t } = useTranslation();
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useEntryStore(
    useShallow((s) => ({ duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const catName = (c: (typeof categories)[number]) => categoryLabel(t, c);

  const handleDuplicate = async (op: (typeof operations)[number]) => {
    const newOp = await duplicateEntry(op.id);
    if (newOp) setActiveView({ type: 'operations', id: newOp.id, mode: 'view' });
  };

  const handleDelete = async (op: (typeof operations)[number]) => {
    await deleteEntry(op.id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreEntry(op.id) });
    if (activeView.id === op.id) setActiveView({ type: 'operations' });
  };

  const sorted = operations.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return {
    items: sorted,
    getId: (op) => op.id,
    getTitle: (op) => displayTitle(t, 'operation', op.title),
    getEditTitle: (op) => op.title,
    getDateStr: (op) => {
      const cat = lookupCategory(catById, op.category_id);
      const catDisplayName = cat ? catName(cat) : '';
      return `${catDisplayName}${catDisplayName ? ' · ' : ''}${formatEntryDate(op.updated_at)}`;
    },
    getIcon: (op) => {
      const cat = lookupCategory(catById, op.category_id);
      const iconValue = entryIcon('operation', op, cat);
      return isImageIcon(iconValue)
        ? <img src={iconValue} alt="" className="w-4 h-4 object-cover rounded-md flex-shrink-0" />
        : <span className="text-base leading-none flex-shrink-0">{iconValue}</span>;
    },
    isActive: (op) => activeView.id === op.id,
    onOpen: (op) => setActiveView({ type: 'operations', id: op.id, mode: 'view' }),
    onOpenNewTab: (op) => openViewInNewTab({ type: 'operations', id: op.id, mode: 'view' }),
    onDragStart: (op) => setDragItem({ id: op.id, entryType: 'operation', label: displayTitle(t, 'operation', op.title), category: lookupCategory(catById, op.category_id)?.emoji }),
    onRename: (op, title) => updateEntry(op.id, { title }),
    contextMenuActions: (op, startRename) => [
      openInNewTabAction({ type: 'operations', id: op.id, mode: 'view' }),
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(op) },
      saveAsTemplateAction(op.id),
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(op), danger: true },
    ],
    emptyMessage: t('emptyState.operations.title'),
  };
}

function OperationsList() {
  return <EntryListTab {...useOperationsConfig(useDashboardEntries('operations'))} />;
}

// ── Wiki ─────────────────────────────────────────────────────────────────────
function useWikiConfig(articles: Entry[]): EntryListTabProps<Entry> {
  const { t } = useTranslation();
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useEntryStore(
    useShallow((s) => ({ duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const handleDuplicate = async (article: (typeof articles)[number]) => {
    const newArt = await duplicateEntry(article.id);
    if (newArt) setActiveView({ type: 'wiki', id: newArt.id, mode: 'view' });
  };

  const handleDelete = async (article: (typeof articles)[number]) => {
    await deleteEntry(article.id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreEntry(article.id) });
    if (activeView.id === article.id) setActiveView({ type: 'wiki' });
  };

  const sorted = articles.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return {
    items: sorted,
    getId: (a) => a.id,
    getTitle: (a) => displayTitle(t, 'wiki', a.title),
    getEditTitle: (a) => a.title,
    getDateStr: (a) => {
      const cat = lookupCategory(catById, a.category_id);
      // No fallback to the raw category_id — for a deleted category
      // the label is omitted, as one row higher for the operations.
      const catLabel = categoryLabel(t, cat);
      return `${catLabel}${catLabel ? ' · ' : ''}${formatEntryDate(a.updated_at)}`;
    },
    getIcon: (a) => {
      const icon = entryIcon('wiki', a, lookupCategory(catById, a.category_id));
      return isImageIcon(icon)
        ? <img src={icon} alt="" className="w-4 h-4 object-cover rounded-md flex-shrink-0" />
        : <span className="text-base leading-none flex-shrink-0">{icon}</span>;
    },
    isActive: (a) => activeView.id === a.id,
    onOpen: (a) => setActiveView({ type: 'wiki', id: a.id, mode: 'view' }),
    onOpenNewTab: (a) => openViewInNewTab({ type: 'wiki', id: a.id, mode: 'view' }),
    onDragStart: (a) => setDragItem({ id: a.id, entryType: 'wiki', label: displayTitle(t, 'wiki', a.title), category: lookupCategory(catById, a.category_id)?.emoji }),
    onRename: (a, title) => updateEntry(a.id, { title }),
    contextMenuActions: (a, startRename) => [
      openInNewTabAction({ type: 'wiki', id: a.id, mode: 'view' }),
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(a) },
      saveAsTemplateAction(a.id),
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(a), danger: true },
    ],
    emptyMessage: t('emptyState.wiki.title'),
  };
}

function WikiList() {
  return <EntryListTab {...useWikiConfig(useDashboardEntries('wiki'))} />;
}

// ── Tasks ────────────────────────────────────────────────────────────────────
function useTasksConfig(): EntryListTabProps<Task> {
  const { t } = useTranslation();
  const { activeView, setActiveView } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView }))
  );
  const { tasks, updateTask, toggleComplete, deleteTask, restoreTask } = useTaskStore(
    useShallow((s) => ({ tasks: s.tasks, updateTask: s.updateTask, toggleComplete: s.toggleComplete, deleteTask: s.deleteTask, restoreTask: s.restoreTask }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  /** Tasks have no page of their own; the id selects the row in `TasksView`,
   *  which then makes itself visible and highlights it. */
  const openTask = (id: string) => setActiveView({ type: 'tasks', id });

  // One payload for both drag spots (default config for the "All" tab and
  // the hand grip in renderRow below), so they do not drift apart.
  const taskDragItem = (task: Task) =>
    setDragItem({ id: task.id, entryType: 'task', label: displayTitle(t, 'task', task.title), category: lookupCategory(catById, task.category_id)?.emoji });

  const handleDelete = async (task: (typeof tasks)[number]) => {
    await deleteTask(task.id);
    pushUndo({ id: generateId(), description: t('undo.taskDeleted'), undo: () => restoreTask(task.id) });
  };

  const categoryNameOf = (task: (typeof tasks)[number]) => lookupCategory(catById, task.category_id)?.name ?? '';

  const sorted = tasks.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // The checkbox needs to be clickable independently of the title, so the row
  // content is custom — search bar, empty-state and the context menu
  // popup itself still come from EntryListTab. getIcon/getDateStr/onOpen go
  // unused behind renderRow here, but let the "All" tab render tasks plainly.
  // `isActive` is the exception: EntryListTab hands it to the row, so both tabs
  // mark the selected task from the same predicate.
  return {
    items: sorted,
    getId: (task) => task.id,
    getTitle: (task) => displayTitle(t, 'task', task.title),
    getEditTitle: (task) => task.title,
    getDateStr: categoryNameOf,
    getIcon: (task) => (task.completed
      ? <CheckSquare size={14} className="flex-shrink-0 text-subtle" />
      : <Square size={14} className="flex-shrink-0 text-subtle" />),
    isActive: (task) => activeView.id === task.id,
    onOpen: (task) => openTask(task.id),
    onDragStart: taskDragItem,
    onRename: (task, title) => updateTask(task.id, { title }),
    contextMenuActions: (task, startRename) => [
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(task), danger: true },
    ],
    emptyMessage: t('sidebar.tasksEmpty'),
    renderRow: ({ item: task, isActive, isRenaming, renameValue, setRenameValue, commitRename, cancelRename, openCtxMenu }) => {
      const categoryName = categoryNameOf(task);

      if (isRenaming) {
        return (
          <div className={`sidebar-item ${isActive ? 'active' : ''}`}>
            <CheckSquare size={14} className="flex-shrink-0 text-subtle" />
            <div className="flex-1 min-w-0">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
                className="w-full bg-transparent text-sm text-soft outline-none selectable truncate"
              />
              {categoryName && <div className="entry-list-date text-xs">{categoryName}</div>}
            </div>
          </div>
        );
      }

      return (
        <div onContextMenu={openCtxMenu} className={`sidebar-item w-full text-left ${isActive ? 'active' : ''}`}>
          <button
            // Like the checkbox in the tasks view: with subtasks.
            onClick={(e) => { e.stopPropagation(); toggleComplete(task.id); }}
            className="flex-shrink-0 text-subtle hover:text-raise"
            title={task.completed ? t('tasks.markActive') : t('tasks.markCompleted')}
          >
            {task.completed ? <CheckSquare size={14} /> : <Square size={14} />}
          </button>
          <button
            // renderRow bypasses EntryListTabs' central drag wiring, hence
            // the same pointerdown handler here as there: it only sets the drag
            // channel, the click to open still fires normally. The channel
            // is only cleared by the pointerup of a mounted text editor host — after
            // a mere click the value stays around without consequence.
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              taskDragItem(task);
            }}
            onClick={() => openTask(task.id)}
            className="flex-1 min-w-0 text-left cursor-grab active:cursor-grabbing"
          >
            <div className={`entry-list-title truncate ${task.completed ? 'line-through text-subtle' : ''}`}>{displayTitle(t, 'task', task.title)}</div>
            {categoryName && <div className="entry-list-date text-xs">{categoryName}</div>}
          </button>
        </div>
      );
    },
  };
}

function TasksList() {
  return <EntryListTab {...useTasksConfig()} />;
}
