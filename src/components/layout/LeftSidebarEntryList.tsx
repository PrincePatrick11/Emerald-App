import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { lookupCategory } from '../../lib/categories';
import type { LeftListTabId } from '../../lib/modules';
import { dashboardDateField, dashboardSort, entryDateOf, sortModeOf } from '../../lib/dashboards';
import { sortItems } from '../../lib/sortItems';
import { displayTitle } from '../../lib/entryTitle';
import { CheckSquare, Square, Pencil, Trash2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useEntryStore } from '../../store/entryStore';
import { useDashboardEntries } from '../../hooks/useDashboardEntries';
import { dashboardOrAll, useDashboardStore } from '../../store/dashboardStore';
import { useTaskStore } from '../../store/taskStore';
import { useCategoryStore } from '../../store/categoryStore';
import { deleteTaskWithUndo } from '../../store/entryActions';
import { setDragItem } from '../../lib/dragState';
import { isImageIcon } from '../../lib/helpers';
import { iconSrc } from '../../lib/icons';
import type { Entry, Task } from '../../types';
import EntryListTab, { type EntryListTabProps } from '../ui/EntryListTab';
import { useEntryRows } from '../../hooks/useEntryRows';

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
// One flat, type-erased row per entry and task, in the order of "All entries",
// so the combined list reuses each list's real handlers (duplicate,
// delete-with-undo, rename) instead of copying them. EntryListTab<T> is
// single-typed, so the erasure has to happen somewhere; the closures below
// are that seam. Two config fields cannot
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
  const entries = useEntryStore((s) => s.entries);
  const entryConfig = useEntriesConfig(entries, 'all');
  const tasks = useTasksConfig();
  // In the order of "All entries"; tasks by the same date.
  const sort = dashboardSort(useDashboardStore((s) => dashboardOrAll(s.dashboards, 'all')));
  const dateField = dashboardDateField({ sort });

  const allRows = sortItems([
    // An entry is labelled by its category (in its own subtitle), a task as a task.
    ...toAllRows('entry', () => '', entryConfig, (e) => entryDateOf(e, dateField)),
    ...toAllRows('task', () => t('nav.tasks'), tasks, (task) => entryDateOf(task, dateField)),
  ], sortModeOf(sort), {
    date: (r) => r.sortDate,
    // The stored title, like the dashboard: an untitled one sorts as empty, not as "Untitled …".
    title: (r) => (r.src.cfg.getEditTitle ?? r.src.cfg.getTitle)(r.item),
  });

  return (
    <EntryListTab
      items={allRows}
      getId={(r) => r.id}
      getTitle={(r) => r.src.cfg.getTitle(r.item)}
      getEditTitle={(r) => (r.src.cfg.getEditTitle ?? r.src.cfg.getTitle)(r.item)}
      // Reuse the list's own subtitle so an entry never shows one date here and
      // another there; the task label is what "All" adds on top.
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
 * One config for every list of entries: each entry as the shared entry row
 * (`useEntryRows`), in the order and with the date of the dashboard
 * `dashboardId`. It opens on the entry page inside that dashboard.
 */
function useEntriesConfig(entries: readonly Entry[], dashboardId: string): EntryListTabProps<Entry> {
  const { t } = useTranslation();
  const { activeView, openViewInNewTab } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, openViewInNewTab: s.openViewInNewTab }))
  );
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sort = dashboardSort(useDashboardStore((s) => dashboardOrAll(s.dashboards, dashboardId)));
  const dateField = dashboardDateField({ sort });
  const rows = useEntryRows({ dashboardId, dateField });

  return {
    // In the dashboard's own order: the same list as in the main area.
    items: sortItems(entries, sortModeOf(sort), { date: rows.date }),
    getId: (e) => e.id,
    getTitle: rows.title,
    getEditTitle: rows.editTitle,
    getDateStr: rows.meta,
    getIcon: (e) => {
      const icon = rows.icon(e);
      return isImageIcon(icon)
        ? <img src={iconSrc(icon)} alt="" className="w-4 h-4 object-cover rounded-md flex-shrink-0" />
        : <span className="text-base leading-none flex-shrink-0">{icon}</span>;
    },
    isActive: (e) => activeView.type === 'entry' && activeView.id === e.id,
    onOpen: (e) => setActiveView(rows.view(e)),
    onOpenNewTab: (e) => openViewInNewTab(rows.view(e)),
    onDragStart: rows.dragStart,
    onRename: rows.rename,
    contextMenuActions: rows.actions,
    emptyMessage: t('sidebar.dashboardEmpty'),
  };
}

/** The entries of one dashboard; they open inside it. */
function DashboardList({ id }: { id: string }) {
  return <EntryListTab {...useEntriesConfig(useDashboardEntries(id), id)} />;
}

// ── Tasks ────────────────────────────────────────────────────────────────────
function useTasksConfig(): EntryListTabProps<Task> {
  const { t } = useTranslation();
  const { activeView, setActiveView } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView }))
  );
  const { tasks, updateTask, toggleComplete } = useTaskStore(
    useShallow((s) => ({ tasks: s.tasks, updateTask: s.updateTask, toggleComplete: s.toggleComplete }))
  );
  const categories = useCategoryStore((s) => s.categories);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

  /** Tasks have no page of their own; the id selects the row in `TasksView`,
   *  which then makes itself visible and highlights it. */
  const openTask = (id: string) => setActiveView({ type: 'tasks', id });

  // One payload for both drag spots (default config for the "All" tab and
  // the hand grip in renderRow below), so they do not drift apart.
  const taskDragItem = (task: Task) =>
    setDragItem({ id: task.id, targetKind: 'task', label: displayTitle(t, 'task', task.title), category: lookupCategory(catById, task.category_id)?.emoji });

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
      { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => void deleteTaskWithUndo(task.id), danger: true },
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
