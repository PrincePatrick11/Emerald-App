import { memo, useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../store/taskStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUIStore } from '../../store/uiStore';
import { deleteTaskWithUndo } from '../../store/entryActions';
import { takeTaskToName } from '../../lib/createItem';
import { displayTitle, hasOwnTitle } from '../../lib/entryTitle';
import { TASKS_VIEW } from '../../lib/modules';
import { linkTargetKindOf } from '../../lib/internalLinkHtml';
import { viewOfLinkTarget } from '../../store/entryViews';
import EmptyState, { NoResults } from '../ui/EmptyState';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { usePersistedFlag } from '../../hooks/usePersistedFlag';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useLinkTitle } from '../../hooks/useLinkItems';
import { categoriesUsedBy, categoryLabel, hasUncategorized } from '../../lib/categories';
import { sortItems } from '../../lib/sortItems';
import { countBy, countByCategory, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import Dashboard from '../ui/Dashboard';
import Dropdown from '../ui/Dropdown';
import { DashboardRow } from '../ui/DashboardItem';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import { LinkPickerModal } from '../editors/text';
import CategorySelect from '../ui/CategorySelect';
import CollapseChevron from '../ui/CollapseChevron';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import {
  Plus, Flag, Trash2,
  CheckSquare, Square, Link2, Pencil,
} from 'lucide-react';
import type { Task, TaskPriority } from '../../types';
import { useSessionState } from '../../store/sessionStore';

const TASK_PRIORITY_COLORS: Record<string, string> = {
  high: 'text-danger',
  medium: 'text-warning',
  low: 'text-success',
};

const TASK_PRIORITY_PILL_CLASSES: Record<string, string> = {
  high: 'task-priority-pill task-priority-pill-high',
  medium: 'task-priority-pill task-priority-pill-medium',
  low: 'task-priority-pill task-priority-pill-low',
};

const SHOW_COMPLETED_FLAG = 'tasks-show-completed';

export default function TasksView() {
  const { t } = useTranslation();
  const tasksPrefs = useUIStore((s) => s.tasksPrefs);
  const setTasksPrefs = useUIStore((s) => s.setTasksPrefs);

  const { tasks, createTask, updateTask, addLink } = useTaskStore(
    useShallow((s) => ({ tasks: s.tasks, createTask: s.createTask, updateTask: s.updateTask, addLink: s.addLink }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const getCategory = useCategoryStore((s) => s.getCategory);
  /** A task's category — undefined without one and for one in the trash. */
  const categoryOf = (task: { category_id: string | null }) =>
    (task.category_id ? getCategory(task.category_id) : undefined);


  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedTasks, setExpandedTasks] = useSessionState<Set<string>>('tasks.expanded', new Set());
  const [searchQuery, setSearchQuery] = useSessionState('tasks.search', '');
  const [filterCategory, setFilterCategory] = useSessionState<Set<string>>('tasks.filterCategory', new Set());
  const [filterPriority, setFilterPriority] = useSessionState<Set<string>>('tasks.filterPriority', new Set());
  // "Show completed" is a preference like a dashboard's view, not a
  // filter: permanent per vault (`vaultPrefs`), a reset leaves it alone.
  const [showCompleted, , setShowCompleted] = usePersistedFlag(SHOW_COMPLETED_FLAG);
  const { isCollapsed: isCategoryCollapsed, toggle: toggleCategoryCollapse, expand: expandCategories } = useCollapsedSet('tasks');
  const [linkModal, setLinkModal] = useState<{ taskId: string } | null>(null);

  // No refetch on mount: AppShell loads the tasks at startup and on vault
  // switch; after that the store keeps itself up to date.

  const rootTasks = tasks.filter((task) => task.parent_task_id === null);

  // Completed and search apply to everything, including the filter counts.
  const query = searchQuery.trim().toLowerCase();
  const visibleRootTasks = rootTasks.filter((task) =>
    (showCompleted || !task.completed)
    && (!query || task.title.toLowerCase().includes(query)));
  // The "No category" filter selects the orphans — their category_id
  // (deleted category) is never itself in the selection.
  const matchesCategory = (task: Task) => filterCategory.size === 0
    || (!!task.category_id && filterCategory.has(task.category_id))
    || (filterCategory.has(UNCATEGORIZED_KEY) && !categoryOf(task));
  const matchesPriority = (task: Task) => filterPriority.size === 0 || filterPriority.has(task.priority);

  const filteredTasks = visibleRootTasks.filter((task) => matchesCategory(task) && matchesPriority(task));

  // Each filter group counts under the other one, not under itself: the
  // numbers stay put while you select and deselect within a group.
  const categoryBase = visibleRootTasks.filter(matchesPriority);
  const priorityBase = visibleRootTasks.filter(matchesCategory);
  const categoryCounts = countByCategory(categoryBase, (id) => !!getCategory(id), (task) => task.category_id);
  const priorityCounts = countBy(priorityBase, (task) => task.priority);

  const sortedTasks = sortItems(filteredTasks, tasksPrefs.sort, { date: (task) => task.created_at });

  const groupedTasks = tasksPrefs.grouping === 'grouped'
    ? sortedTasks.reduce((acc, task) => {
        // No category and a category in the trash end up in the same
        // bucket — to the reader both mean "no category".
        const catId = categoryOf(task) ? task.category_id! : UNCATEGORIZED_KEY;
        if (!acc[catId]) acc[catId] = [];
        acc[catId].push(task);
        return acc;
      }, {} as Record<string, typeof sortedTasks>)
    : null;

  const uncategorized = tasksPrefs.grouping === 'grouped'
    ? sortedTasks.filter((t) => !t.category_id || !getCategory(t.category_id))
    : [];

  const uncatCollapsed = isCategoryCollapsed(UNCATEGORIZED_KEY);

  // Chips and groups only show what occurs among the tasks (plus Other).
  const usedCategories = categoriesUsedBy(categories, tasks);
  // Orphans: their category is in the trash. Without them there is nothing to
  // filter, so the "No category" chip goes away — unless it is still
  // selected; otherwise a filter would stay active that nothing displays.
  // Over `rootTasks`, not all of them: the orphan block only shows roots,
  // so a chip for an orphaned subtask would find nothing.
  const showUncatChip = hasUncategorized(categories, rootTasks) || filterCategory.has(UNCATEGORIZED_KEY);
  const chipFilteredCategories = filterCategory.size > 0
    ? usedCategories.filter((c) => filterCategory.has(c.id))
    : usedCategories;
  // Empty category groups drop out — Tasks renders itself in custom mode,
  // so the Dashboard's central evaluation does not apply here.
  const visibleCategories = groupedTasks
    ? chipFilteredCategories.filter((c) => (groupedTasks[c.id]?.length ?? 0) > 0)
    : chipFilteredCategories;

  // The orphan block only appears if it contains something.
  const showUncatBlock = groupedTasks !== null && uncategorized.length > 0;

  const startNaming = (task: Task) => {
    freshTaskIds.add(task.id);
    setEditingId(task.id);
    setEditValue(task.title);
  };

  const handleCreateTask = async (categoryId?: string | null) => {
    startNaming(await createTask(categoryId ?? null));
  };

  const handleSaveEdit = async (id: string) => {
    freshTaskIds.delete(id);
    if (editValue.trim()) {
      await updateTask(id, { title: editValue.trim() });
    }
    setEditingId(null);
  };

  const toggleExpand = useCallback((id: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);


  /**
   * The deep link from the global search. Tasks have no detail page of their
   * own, so the view brings the row into sight instead — and first clears away
   * whatever could hide it: this view's search, the filters, a collapsed
   * category section, collapsed parent rows and the hidden completed state.
   * Without that, the hit would point at a row that is not rendered at all.
   */
  useDeepLink({
    type: 'tasks',
    items: tasks,
    rowAttribute: 'data-task-id',
    block: 'center',
    onOpen: (target) => {
      setSearchQuery('');
      setFilterCategory(new Set());
      setFilterPriority(new Set());
      if (target.completed) setShowCompleted(true);
      expandCategories(target.category_id ?? UNCATEGORIZED_KEY, UNCATEGORIZED_KEY);

      // A subtask is only visible if every row above it is open.
      const ancestors: string[] = [];
      for (let parentId = target.parent_task_id; parentId; ) {
        ancestors.push(parentId);
        parentId = tasks.find((task) => task.id === parentId)?.parent_task_id ?? null;
      }
      if (ancestors.length) setExpandedTasks((prev) => new Set([...prev, ...ancestors]));

      // Created by the rail's plus: name it, as after this view's own button.
      if (takeTaskToName(target.id)) startNaming(target);
    },
  });

  const activeFilterCount = filterCategory.size + filterPriority.size;
  const isFiltering = !!query || activeFilterCount > 0;
  // When grouped, what counts is whether a group is left (a category chip can
  // hide all of them although tasks match), when ungrouped the list itself.
  const nothingVisible = groupedTasks
    ? visibleCategories.length === 0 && !showUncatBlock
    : sortedTasks.length === 0;
  const clearFilters = () => {
    setFilterCategory(new Set());
    setFilterPriority(new Set());
  };
  // Custom mode: the Dashboard's own "No results" does not apply here.
  const noResults = (
    <NoResults
      query={searchQuery}
      filtered={activeFilterCount > 0}
      onReset={() => { setSearchQuery(''); clearFilters(); }}
    />
  );

  /**
   * The title of a link target — the app's one lookup (`useLinkTitle`), as
   * link chips and the picker show it. If it is in the trash or gone, "Deleted".
   */
  const linkTitle = useLinkTitle();
  // `null`: the target is in the trash or deleted for good.
  const resolveTaskLinkTitle = useCallback((targetKind: string, targetId: string) =>
    linkTitle({ id: targetId, targetKind }) ?? null,
  [linkTitle]);

  const renderTasksContent = () => (
    <>
        {groupedTasks
          ? visibleCategories.map((cat) => {
              const catTasks = groupedTasks[cat.id] || [];
              const isCollapsed = isCategoryCollapsed(cat.id);
              // There are no empty groups here: `visibleCategories` already filters them out.
              return (
                <div key={cat.id} className="mb-6 space-y-1.5">
                  <CollapsibleGroupHeader
                    emoji={cat.emoji}
                    label={categoryLabel(t, cat)}
                    collapsed={isCollapsed}
                    onToggleCollapse={() => toggleCategoryCollapse(cat.id)}
                    count={catTasks.length}
                    add={{ title: t('tasks.newTask'), onClick: () => handleCreateTask(cat.id) }}
                  />
                  {!isCollapsed && catTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      editingId={editingId}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      setEditingId={setEditingId}
                      handleSaveEdit={handleSaveEdit}
                      toggleExpand={toggleExpand}
                      expandedTasks={expandedTasks}
                      setCtxMenu={setCtxMenu}
                      setLinkModal={setLinkModal}
                      resolveTaskLinkTitle={resolveTaskLinkTitle}
                      t={t}
                    />
                  ))}
                </div>
              );
            })
          : <div className="space-y-1.5">{sortedTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                editingId={editingId}
                editValue={editValue}
                setEditValue={setEditValue}
                setEditingId={setEditingId}
                handleSaveEdit={handleSaveEdit}
                toggleExpand={toggleExpand}
                expandedTasks={expandedTasks}
                setCtxMenu={setCtxMenu}
                setLinkModal={setLinkModal}
                resolveTaskLinkTitle={resolveTaskLinkTitle}
                t={t}
              />
            ))}</div>}

        {/* At the very bottom, like the orphan bucket of the grouped dashboards — and
            as there, only if it contains something. */}
        {showUncatBlock && (
          <div className="mb-6 space-y-1.5">
            <CollapsibleGroupHeader
              collapsed={uncatCollapsed}
              onToggleCollapse={() => toggleCategoryCollapse(UNCATEGORIZED_KEY)}
              emoji="📄"
              label={t('categories.uncategorized')}
              count={uncategorized.length}
            />
            {!uncatCollapsed && uncategorized.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    editingId={editingId}
                    editValue={editValue}
                    setEditValue={setEditValue}
                    setEditingId={setEditingId}
                    handleSaveEdit={handleSaveEdit}
                    toggleExpand={toggleExpand}
                    expandedTasks={expandedTasks}
                    setCtxMenu={setCtxMenu}
                    setLinkModal={setLinkModal}
                    resolveTaskLinkTitle={resolveTaskLinkTitle}
                    t={t}
                  />
                ))}
          </div>
        )}

        {/* Custom-mode counterpart to the Dashboard's central fallback. If
            nothing is shown, all that matters is whether a search or filter is
            active: then "No results", otherwise there is no open task (the
            toggle hides completed ones) — whether categories exist does not
            matter, the global ones always do. */}
        {nothingVisible && (isFiltering ? noResults : (
          <EmptyState
            icon={TASKS_VIEW.icon}
            title={t('emptyState.tasks.title')}
            description={t('emptyState.tasks.description')}
            actionLabel={t('tasks.newTask')}
            onAction={() => handleCreateTask()}
          />
        ))}
    </>
  );

  return (
    <>
      <Dashboard<Task>
        title={t('nav.tasks')}
        primaryAction={{ label: t('tasks.newTask'), onClick: () => handleCreateTask() }}
        view={tasksPrefs.view}
        sort={tasksPrefs.sort}
        onView={(v) => setTasksPrefs({ view: v })}
        onSort={(s) => setTasksPrefs({ sort: s })}
        groupBy={{ value: tasksPrefs.grouping, onChange: (g) => setTasksPrefs({ grouping: g }) }}
        // Tasks are a list and nothing else: subtasks and inline editing have
        // no card to live on. So the view section holds only this toggle.
        viewOptions={[{ value: 'list' as const, label: t('listView.list') }]}
        displayToggles={[{
          label: t('tasks.showCompleted'),
          icon: CheckSquare,
          checked: showCompleted,
          onChange: setShowCompleted,
        }]}
        search={searchQuery}
        onSearch={setSearchQuery}
        filters={{
          activeFilterCount,
          onClearAll: clearFilters,
          panelProps: {
            chipLabel: t('filters.category'),
            // "No category" only if there are orphans.
            chips: [
              ...usedCategories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji, count: categoryCounts.get(c.id) ?? 0 })),
              ...(showUncatChip ? [{ value: UNCATEGORIZED_KEY, label: t('categories.uncategorized'), emoji: '📄', count: categoryCounts.get(UNCATEGORIZED_KEY) ?? 0 }] : []),
            ],
            allChipsCount: categoryBase.length,
            selectedChips: [...filterCategory],
            onChipToggle: (v) => setFilterCategory((prev) => {
              const next = new Set(prev);
              if (next.has(v)) next.delete(v); else next.add(v);
              return next;
            }),
            onAllChips: () => setFilterCategory(new Set()),
            // Priorities as the FilterPanel's second filter group
            // (statusChips with their own label).
            statusLabel: t('tasks.filter.priority'),
            statusChips: (['high', 'medium', 'low'] as const).map((p) => ({
              value: p,
              label: t('tasks.priority.' + p),
              // The same priority colours as in the row's priority menu —
              // the only fixed colour in the filter list, on purpose: the
              // flag should look here the way it does on the task.
              icon: <Flag size={14} className={TASK_PRIORITY_COLORS[p]} />,
              count: priorityCounts.get(p) ?? 0,
            })),
            onAllStatus: () => setFilterPriority(new Set()),
            allStatusCount: priorityBase.length,
            selectedStatus: [...filterPriority],
            onStatusToggle: (v) => setFilterPriority((prev) => {
              const next = new Set(prev);
              if (next.has(v)) next.delete(v); else next.add(v);
              return next;
            }),
          },
        }}
        items={sortedTasks}
        itemKey={(task) => task.id}
        grouping={{ mode: 'custom', render: renderTasksContent }}
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={ctxMenu.actions}
          />
        )}
      />

      {linkModal && (
        <LinkPickerModal
          onSelect={(item) => { addLink(linkModal.taskId, item.id, linkTargetKindOf(item.targetKind)); }}
          onClose={() => setLinkModal(null)}
        />
      )}
    </>
  );
}

/**
 * The tasks just created whose title has never been confirmed. Escape
 * puts such a task away again (into the trash, with undo) — like
 * "Cancel" on a new entry. For the session only.
 */
const freshTaskIds = new Set<string>();

interface TaskRowProps {
  task: Task;
  editingId: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  setEditingId: (id: string | null) => void;
  handleSaveEdit: (id: string) => void;
  toggleExpand: (id: string) => void;
  expandedTasks: Set<string>;
  setCtxMenu: (menu: { id: string; x: number; y: number; actions: ContextMenuAction[] } | null) => void;
  setLinkModal: (modal: { taskId: string } | null) => void;
  resolveTaskLinkTitle: (targetType: string, targetId: string) => string | null;
  t: (key: string) => string;
}

const TaskRow = memo(function TaskRow({
  task, editingId, editValue, setEditValue, setEditingId,
  handleSaveEdit, toggleExpand, expandedTasks, setCtxMenu, setLinkModal, resolveTaskLinkTitle, t,
}: TaskRowProps) {
  // Like `.sidebar-item.active` elsewhere: the highlight hangs on the active
  // view, not on a timer. It stays as long as the deep link points at this
  // row, and disappears as soon as navigation goes elsewhere.
  const isTarget = useUIStore((s) => s.activeView.type === 'tasks' && s.activeView.id === task.id);
  const updateTask = useTaskStore((s) => s.updateTask);
  const categories = useCategoryStore((s) => s.categories);
  const getSubtasks = useTaskStore((s) => s.getSubtasks);
  const links = useTaskStore((s) => s.links);
  const createTask = useTaskStore((s) => s.createTask);
  const toggleComplete = useTaskStore((s) => s.toggleComplete);
  // "Show completed" applies at every level, not only the top ones.
  const [showCompleted] = usePersistedFlag(SHOW_COMPLETED_FLAG);
  const subtasks = getSubtasks(task.id).filter((sub) => showCompleted || !sub.completed);
  const hasSubtasks = subtasks.length > 0;
  const isExpanded = expandedTasks.has(task.id);
  const isEditing = editingId === task.id;
  const taskLinks = links.filter((l) => l.task_id === task.id);

  const handleDelete = () => deleteTaskWithUndo(task.id);

  const startRename = () => {
    setEditingId(task.id);
    setEditValue(hasOwnTitle(task.title) ? task.title : '');
  };

  const handleCreateSubtaskLocal = async () => {
    const subtask = await createTask(task.category_id, task.id);
    freshTaskIds.add(subtask.id);
    // Only expand: an already open task would otherwise collapse and hide the new row.
    if (!isExpanded) toggleExpand(task.id);
    setEditingId(subtask.id);
    setEditValue(subtask.title);
  };

  const resolvedLinks = useMemo(() => taskLinks.map((link) => ({
    ...link,
    title: resolveTaskLinkTitle(link.target_type, link.target_id),
  })), [taskLinks, resolveTaskLinkTitle]);

  const handlePriorityChange = async (priority: TaskPriority) => {
    await updateTask(task.id, { priority });
  };

  const handleCategoryChange = async (categoryId: string | null) => {
    await updateTask(task.id, { category_id: categoryId });
  };

  const priorityLabels: Record<string, string> = {
    high: t('tasks.priority.high'),
    medium: t('tasks.priority.medium'),
    low: t('tasks.priority.low'),
  };

  return (
    <div>
      <DashboardRow
        data-task-id={task.id}
        className={`${task.completed ? 'opacity-50' : ''} ${isTarget ? 'row-target' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          const actions: ContextMenuAction[] = [
            {
              label: task.completed ? t('tasks.markActive') : t('tasks.markCompleted'),
              icon: task.completed ? <Square size={14} /> : <CheckSquare size={14} />,
              onClick: () => { toggleComplete(task.id); setCtxMenu(null); },
            },
            {
              label: t('tasks.addSubtask'),
              icon: <Plus size={14} />,
              onClick: () => { handleCreateSubtaskLocal(); setCtxMenu(null); },
            },
            {
              label: t('tasks.linkEntry'),
              icon: <Link2 size={14} />,
              onClick: () => { setLinkModal({ taskId: task.id }); setCtxMenu(null); },
            },
            {
              label: t('contextMenu.rename'),
              icon: <Pencil size={14} />,
              onClick: startRename,
            },
            {
              label: t('contextMenu.delete'),
              icon: <Trash2 size={14} />,
              onClick: () => { handleDelete(); setCtxMenu(null); },
              danger: true,
            },
          ];
          setCtxMenu({ id: task.id, x: e.clientX, y: e.clientY, actions });
        }}
      >
        <button
          onClick={() => toggleComplete(task.id)}
          className="text-muted hover:text-accent-raise flex-shrink-0"
        >
          {task.completed ? (
            <CheckSquare size={16} className="text-accent" />
          ) : (
            <Square size={16} />
          )}
        </button>

        {hasSubtasks && (
          <CollapseChevron collapsed={!isExpanded} onToggle={() => toggleExpand(task.id)} />
        )}

        {!hasSubtasks && <span className="w-3.5 flex-shrink-0" />}

        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => handleSaveEdit(task.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit(task.id);
              if (e.key === 'Escape') {
                setEditingId(null);
                if (freshTaskIds.delete(task.id)) void handleDelete();
              }
            }}
            className="flex-1 bg-well-solid border border-edge-strong rounded-md px-2 py-0.5 text-sm text-secondary outline-none focus:border-accent-edge"
            autoFocus
          />
        ) : (
          <span
            className={`flex-1 min-w-0 text-sm truncate cursor-default ${task.completed ? 'line-through text-subtle' : 'text-soft'}`}
            onDoubleClick={startRename}
          >
            {displayTitle(t, 'task', task.title)}
          </span>
        )}

        {resolvedLinks.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            {resolvedLinks.map((link) => link.title === null ? (
              <span
                key={link.id}
                className="tasks-linked-entry is-gone text-xs px-1.5 py-0.5 rounded-md"
                title={t('properties.linkGoneHint')}
              >
                {t('properties.linkGone')}
              </span>
            ) : (
              <span
                key={link.id}
                className="tasks-linked-entry text-xs cursor-pointer px-1.5 py-0.5 rounded-md transition-colors"
                title={link.title}
                onClick={() => {
                  useUIStore.getState().setActiveView(viewOfLinkTarget(link.target_type, link.target_id));
                }}
              >
                {link.title}
              </span>
            ))}
          </div>
        )}

        {/* The task's everyday controls show on hover: subtask, category, link,
            priority. Rename and delete are in the context menu. */}
        <div className="row-hover-controls items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleCreateSubtaskLocal}
            className="task-action-btn text-subtle hover:text-accent-raise p-0.5"
            title={t('tasks.addSubtask')}
            aria-label={t('tasks.addSubtask')}
          >
            <Plus size={12} />
          </button>

          <CategorySelect
            categories={categories}
            value={task.category_id}
            onChange={handleCategoryChange}
            getLabel={(c) => categoryLabel(t, c)}
            align="right"
            title={t('filters.category')}
          />

          <button
            onClick={() => setLinkModal({ taskId: task.id })}
            className="task-action-btn text-subtle hover:text-accent-raise p-0.5"
            title={t('tasks.linkEntry')}
            aria-label={t('tasks.linkEntry')}
          >
            <Link2 size={12} />
          </button>

          <Dropdown<TaskPriority>
            value={task.priority}
            options={(['high', 'medium', 'low'] as TaskPriority[]).map((p) => ({
              value: p,
              label: priorityLabels[p],
              icon: <Flag size={12} />,
              className: task.priority === p ? TASK_PRIORITY_COLORS[p] : undefined,
            }))}
            onChange={handlePriorityChange}
            align="right"
            trigger={({ open, toggle }) => (
              <button
                onClick={toggle}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs ${TASK_PRIORITY_PILL_CLASSES[task.priority]}`}
                title={t('tasks.priority.' + task.priority)}
              >
                <Flag size={12} />
              </button>
            )}
          />
        </div>
      </DashboardRow>

      {isExpanded && (
        <div className="ml-6 mt-1.5 space-y-1.5">
          {subtasks.map((sub) => (
            <TaskRow
              key={sub.id}
              task={sub}
              editingId={editingId}
              editValue={editValue}
              setEditValue={setEditValue}
              setEditingId={setEditingId}
              handleSaveEdit={handleSaveEdit}
              toggleExpand={toggleExpand}
              expandedTasks={expandedTasks}
              setCtxMenu={setCtxMenu}
              setLinkModal={setLinkModal}
              resolveTaskLinkTitle={resolveTaskLinkTitle}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
});

