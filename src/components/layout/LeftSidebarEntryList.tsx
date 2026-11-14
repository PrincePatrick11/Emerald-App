import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { formatEntryDate } from '../../lib/formatDate';
import { categoryLabel, lookupCategory } from '../../lib/categories';
import { ENTRY_DELETED_UNDO_KEYS, entryIcon, MODULES, viewTypeForKind, type LeftListTabId } from '../../lib/modules';
import { entryKindOf } from '../../lib/dashboards';
import { displayTitle } from '../../lib/entryTitle';
import { CheckSquare, Square, Copy, Pencil, Trash2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useEntryStore } from '../../store/entryStore';
import { useDashboardEntries } from '../../hooks/useDashboardEntries';
import { useDashboardStore } from '../../store/dashboardStore';
import { useTaskStore } from '../../store/taskStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { setDragItem } from '../../lib/dragState';
import { generateId, isImageIcon } from '../../lib/helpers';
import { iconSrc } from '../../lib/icons';
import { journalIcon } from '../../lib/moonPhase';
import type { Entry, Task } from '../../types';
import EntryListTab, { type EntryListTabProps } from '../ui/EntryListTab';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';

/**
 * The entry list on the left: the search on top, the list below it. Which list —
 * All entries, one dashboard's entries or the tasks — is determined by the
 * vault's setting (Settings → Sidebar); there is no switcher in the bar.
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

function ActiveList({ list }: { list: LeftListTabId }) {
  const isOwnList = useDashboardStore((s) => s.dashboards.some((d) => d.id === list && d.builtin !== 'all'));
  if (list === 'tasks') return <TasksList />;
  // A dashboard that is gone, and "All entries" itself, show every entry and task.
  if (!isOwnList) return <AllList />;
  return <DashboardList id={list} />;
}

// ── All ──────────────────────────────────────────────────────────────────────
// One flat, type-erased row per entry and task, so the combined list reuses
// each list's real handlers (duplicate, delete-with-undo, rename) instead of
// copying them. EntryListTab<T> is single-typed, so the erasure has to happen
// somewhere; the closures below are that seam. Two config fields cannot
// survive it and are dropped on purpose: renderRow (only Tasks has one — in
// "All" its rows fall back to the plain icon/title layout), plus emptyMessage,
// which "All" answers for itself.

/** A list's config, type-erased: its functions only get items of
 *  the same config back (`AllRow.item`), so the casts in `toAllRows` are
 *  safe. */
interface AllSource {
  kindLabel: (item: unknown) => string;
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
  prefix: string,
  kindLabel: (item: T) => string,
  cfg: EntryListTabProps<T>,
  getSortDate: (item: T) => string,
): AllRow[] {
  const src: AllSource = { kindLabel: kindLabel as (item: unknown) => string, cfg: cfg as unknown as EntryListTabProps<unknown> };
  return cfg.items.map((item) => ({ id: `${prefix}:${cfg.getId(item)}`, sortDate: getSortDate(item), item, src }));
}

function AllList() {
  const { t } = useTranslation();
  const modules = useDashboardStore((s) => s.modules);
  const entries = useEntryStore((s) => s.entries);
  const entryConfig = useEntriesConfig(entries);
  const tasks = useTasksConfig();

  const rows = [
    // Labelled with the module the entry opens in.
    ...toAllRows('entry', (e) => t(MODULES[viewTypeForKind(entryKindOf(e, modules))].navLabelKey), entryConfig, (e) => e.updated_at),
    ...toAllRows('task', () => t('nav.tasks'), tasks, (task) => task.updated_at),
  ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  return (
    <EntryListTab
      items={rows}
      getId={(r) => r.id}
      getTitle={(r) => r.src.cfg.getTitle(r.item)}
      getEditTitle={(r) => (r.src.cfg.getEditTitle ?? r.src.cfg.getTitle)(r.item)}
      // Reuse the list's own subtitle so an entry never shows one date here and
      // another there; the kind label is what "All" adds on top.
      getDateStr={(r) => [r.src.kindLabel(r.item), r.src.cfg.getDateStr?.(r.item)].filter(Boolean).join(' · ')}
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

// ── Entries ──────────────────────────────────────────────────────────────────
/**
 * One config for every list of entries. Each entry is drawn as its kind:
 * a journal entry with its moon phase and the day it was written, any other
 * with its category and when it changed — newest first, by that date. It
 * opens in the view of its kind.
 */
function useEntriesConfig(entries: readonly Entry[]): EntryListTabProps<Entry> {
  const { t } = useTranslation();
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { activeView, setActiveView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab }))
  );
  const { duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useEntryStore(
    useShallow((s) => ({ duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const modules = useDashboardStore((s) => s.modules);
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const kindOf = (e: Entry) => entryKindOf(e, modules);
  const viewOf = (e: Entry) => ({ type: viewTypeForKind(kindOf(e)), id: e.id, mode: 'view' as const });
  const dateOf = (e: Entry) => (kindOf(e) === 'journal' ? e.created_at : e.updated_at);

  const handleDuplicate = async (entry: Entry) => {
    const copy = await duplicateEntry(entry.id);
    if (copy) setActiveView(viewOf(copy));
  };

  const handleDelete = async (entry: Entry) => {
    const view = viewOf(entry);
    await deleteEntry(entry.id);
    pushUndo({ id: generateId(), description: t(ENTRY_DELETED_UNDO_KEYS[kindOf(entry)]), undo: () => restoreEntry(entry.id) });
    if (activeView.id === entry.id) setActiveView({ type: view.type });
  };

  const sorted = entries.slice().sort((a, b) => dateOf(b).localeCompare(dateOf(a)));

  return {
    items: sorted,
    getId: (e) => e.id,
    getTitle: (e) => displayTitle(t, kindOf(e), e.title),
    getEditTitle: (e) => e.title,
    getDateStr: (e) => {
      if (kindOf(e) === 'journal') return formatEntryDate(e.created_at);
      // No fallback to the raw category_id — for a deleted category the label is omitted.
      const catLabel = categoryLabel(t, lookupCategory(catById, e.category_id));
      return `${catLabel}${catLabel ? ' · ' : ''}${formatEntryDate(e.updated_at)}`;
    },
    getIcon: (e) => {
      const kind = kindOf(e);
      const icon = kind === 'journal' ? journalIcon(e, showMoonPhase) : entryIcon(kind, e, lookupCategory(catById, e.category_id));
      return isImageIcon(icon)
        ? <img src={iconSrc(icon)} alt="" className="w-4 h-4 object-cover rounded-md flex-shrink-0" />
        : <span className="text-base leading-none flex-shrink-0">{icon}</span>;
    },
    isActive: (e) => activeView.id === e.id,
    onOpen: (e) => setActiveView(viewOf(e)),
    onOpenNewTab: (e) => openViewInNewTab(viewOf(e)),
    onDragStart: (e) => {
      const kind = kindOf(e);
      setDragItem({
        id: e.id, entryType: kind, label: displayTitle(t, kind, e.title),
        category: kind === 'journal' ? undefined : lookupCategory(catById, e.category_id)?.emoji,
      });
    },
    onRename: (e, title) => updateEntry(e.id, { title }),
    contextMenuActions: (e, startRename) => [
      openInNewTabAction(viewOf(e)),
      { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(e) },
      saveAsTemplateAction(e.id),
      { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: startRename },
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(e), danger: true },
    ],
    emptyMessage: t('sidebar.dashboardEmpty'),
  };
}

/** The entries of one dashboard — Journal, Wiki, Operations or one of the user's own. */
function DashboardList({ id }: { id: string }) {
  return <EntryListTab {...useEntriesConfig(useDashboardEntries(id))} />;
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
