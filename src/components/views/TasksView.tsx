import { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { useAltarStore } from '../../store/altarStore';
import { generateId } from '../../lib/helpers';
import { viewTypeForEntryType } from '../../lib/modules';
import { useCategoryEditor } from '../../hooks/useCategoryEditor';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { FALLBACK_CATEGORY } from '../../lib/schema';
import { sortItems } from '../../lib/sortItems';
import { UNCATEGORIZED_KEY } from '../../lib/groupBy';
import Dashboard from '../ui/Dashboard';
import Dropdown from '../ui/Dropdown';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import LinkPickerModal from '../editor/LinkPickerModal';
import { FilterChipButton } from '../ui/FilterPanel';
import CategoryHeaderRow from '../ui/CategoryHeaderRow';
import CategoryAddModal from '../ui/CategoryAddModal';
import CategorySelect from '../ui/CategorySelect';
import CollapseChevron from '../ui/CollapseChevron';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import {
  Plus, Flag, Trash2,
  CheckSquare, Square, Link2,
} from 'lucide-react';
import type { Task, TaskPriority } from '../../types';

const TASK_PRIORITY_COLORS: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-yellow-400',
  low: 'text-green-400',
};

const TASK_PRIORITY_PILL_CLASSES: Record<string, string> = {
  high: 'task-priority-pill task-priority-pill-high',
  medium: 'task-priority-pill task-priority-pill-medium',
  low: 'task-priority-pill task-priority-pill-low',
};

export default function TasksView() {
  const { t } = useTranslation();
  const tasksPrefs = useUIStore((s) => s.tasksPrefs);
  const setTasksPrefs = useUIStore((s) => s.setTasksPrefs);

  const { categories, tasks, createTask, updateTask, getCategory, addCategory, addLink, updateCategory, deleteCategory, restoreCategory, } = useTaskStore(
    useShallow((s) => ({ categories: s.categories, tasks: s.tasks, createTask: s.createTask, updateTask: s.updateTask, getCategory: s.getCategory, addCategory: s.addCategory, addLink: s.addLink, updateCategory: s.updateCategory, deleteCategory: s.deleteCategory, restoreCategory: s.restoreCategory }))
  );

  const journalEntries = useJournalStore((s) => s.entries);
  const wikiArticles = useWikiStore((s) => s.articles);
  const operations = useOperationStore((s) => s.operations);
  const altars = useAltarStore((s) => s.altars);

  const catEditor = useCategoryEditor({ addCategory, updateCategory, deleteCategory, restoreCategory }, { defaultEmoji: '📋' });

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<Set<string>>(new Set());
  const [filterPriority, setFilterPriority] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false);
  const [hideEmptyCats, setHideEmptyCats] = useState(false);
  const { collapsed: collapsedCategories, toggle: toggleCategoryCollapse, expand: expandCategories } = useCollapsedSet('tasks');
  const [linkModal, setLinkModal] = useState<{ taskId: string } | null>(null);

  // Kein Refetch beim Mount: AppShell laedt die Tasks beim Start und beim
  // Vault-Wechsel; danach haelt der Store sich selbst aktuell.

  const rootTasks = tasks.filter((task) => task.parent_task_id === null);

  const filteredTasks = rootTasks.filter((task) => {
    if (!showCompleted && task.completed) return false;
    if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    // Der „Ohne Kategorie"-Chip wählt die Waisen aus — deren category_id
    // (gelöschte Kategorie) steht nie selbst in der Chip-Auswahl.
    if (filterCategory.size > 0 &&
        !filterCategory.has(task.category_id) &&
        !(filterCategory.has(UNCATEGORIZED_KEY) && !getCategory(task.category_id))) return false;
    if (filterPriority.size > 0 && !filterPriority.has(task.priority)) return false;
    return true;
  });

  const sortedTasks = sortItems(filteredTasks, tasksPrefs.sort, {
    date: (task) => task.created_at,
    category: (task) => getCategory(task.category_id)?.name ?? '',
    tiebreak: (a, b) => a.sort_order - b.sort_order,
  });

  const groupedTasks = tasksPrefs.sort === 'category'
    ? sortedTasks.reduce((acc, task) => {
        const catId = task.category_id;
        if (!acc[catId]) acc[catId] = [];
        acc[catId].push(task);
        return acc;
      }, {} as Record<string, typeof sortedTasks>)
    : null;

  const uncategorized = tasksPrefs.sort === 'category'
    ? sortedTasks.filter((t) => !t.category_id || !getCategory(t.category_id))
    : [];

  const uncatCollapsed = collapsedCategories.has(UNCATEGORIZED_KEY);

  const chipFilteredCategories = filterCategory.size > 0
    ? categories.filter((c) => filterCategory.has(c.id))
    : categories;
  // „Nur mit Einträgen": leere Kategorie-Gruppen ganz weglassen. Tasks rendert
  // im custom-Modus selbst, deshalb greift Dashboards zentrale Auswertung hier
  // nicht. Der Waisen-Block hängt nicht dran — er erscheint nur, wenn er voll ist.
  const visibleCategories = hideEmptyCats && groupedTasks
    ? chipFilteredCategories.filter((c) => (groupedTasks[c.id]?.length ?? 0) > 0)
    : chipFilteredCategories;

  // Der Waisen-Block: auch leer sichtbar, wenn sein Chip gewählt ist — außer
  // „Nur mit Einträgen" blendet Leeres aus (Pendant zu forceUncategorized).
  const showUncatBlock = groupedTasks !== null &&
    (uncategorized.length > 0 || (filterCategory.has(UNCATEGORIZED_KEY) && !hideEmptyCats));

  const handleCreateTask = async (categoryId?: string) => {
    const cat = categoryId ?? FALLBACK_CATEGORY.tasks;
    const task = await createTask(cat);
    setEditingId(task.id);
    setEditValue(task.title);
  };

  const handleSaveEdit = async (id: string) => {
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
   * Der Tiefenlink aus der globalen Suche.
   *
   * Ein Aufgaben-Treffer navigiert nach `{ type: 'tasks', id }`. Aufgaben haben
   * keine eigene Detailseite, die Ansicht holt die Zeile also stattdessen in den
   * Blick — und räumt vorher weg, was sie verdecken könnte: die Suche dieser
   * Ansicht, die Filter, ein zugeklapptes Kategoriefach, eingeklappte
   * Elternzeilen und der ausgeblendete Erledigt-Zustand. Ohne das zeigte der
   * Treffer auf eine Zeile, die gar nicht gerendert wird.
   *
   * Ausgelöst wird das vom `activeView`-*Objekt*, nicht von der id darin:
   * `setActiveView` legt bei jeder Navigation ein frisches an, die id dagegen
   * ist ein String und bliebe gleich, wenn man denselben Treffer zweimal
   * anklickt. `handledView` merkt sich, welches Objekt schon dran war — damit
   * darf `tasks` in den Abhängigkeiten stehen, ohne dass eine Mutation dem
   * Nutzer seine Filter unter den Händen wegräumt, und ein Tiefenlink, der
   * einen noch leeren Store vorfindet, greift beim nächsten Lauf.
   */
  const activeView = useUIStore((s) => s.activeView);
  const handledView = useRef<typeof activeView | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  useEffect(() => {
    if (activeView.type !== 'tasks' || !activeView.id) return;
    if (handledView.current === activeView) return;
    const target = tasks.find((task) => task.id === activeView.id);
    if (!target) return;
    handledView.current = activeView;

    setSearchQuery('');
    setFilterCategory(new Set());
    setFilterPriority(new Set());
    if (target.completed) setShowCompleted(true);
    expandCategories(target.category_id, UNCATEGORIZED_KEY);

    // Eine Unteraufgabe ist nur sichtbar, wenn jede Zeile über ihr offen ist.
    const ancestors: string[] = [];
    for (let parentId = target.parent_task_id; parentId; ) {
      ancestors.push(parentId);
      parentId = tasks.find((task) => task.id === parentId)?.parent_task_id ?? null;
    }
    if (ancestors.length) setExpandedTasks((prev) => new Set([...prev, ...ancestors]));

    setPendingScrollId(target.id);
  }, [activeView, tasks]);

  // Gescrollt wird genau einmal pro Tiefenlink. Das hängt ausdrücklich an
  // `pendingScrollId` und nicht an den aufgeräumten Zuständen: die als
  // Abhängigkeiten zu führen hieße, den Nutzer jedes Mal zurückzuwerfen, wenn
  // er später selbst eine Kategorie auf- oder zuklappt.
  useEffect(() => {
    if (!pendingScrollId) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-task-id="${CSS.escape(pendingScrollId)}"]`)
        ?.scrollIntoView({ block: 'center' });
      setPendingScrollId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingScrollId]);

  const activeFilterCount = filterCategory.size + filterPriority.size + (hideEmptyCats ? 1 : 0);

  const resolveTaskLinkTitle = useCallback((targetType: string, targetId: string) => {
    if (targetType === 'journal') {
      return journalEntries.find((entry) => entry.id === targetId)?.title ?? 'Unknown';
    }
    if (targetType === 'wiki') {
      return wikiArticles.find((article) => article.id === targetId)?.title ?? 'Unknown';
    }
    if (targetType === 'operation') {
      return operations.find((operation) => operation.id === targetId)?.title ?? 'Unknown';
    }
    if (targetType === 'task') {
      return tasks.find((task) => task.id === targetId)?.title ?? 'Unknown';
    }
    if (targetType === 'altar') {
      return altars.find((altar) => altar.id === targetId)?.title ?? 'Unknown';
    }
    return 'Unknown';
  }, [journalEntries, wikiArticles, operations, tasks, altars]);

  const renderTasksContent = () => (
    <>
        {groupedTasks
          ? visibleCategories.map((cat) => {
              const catTasks = groupedTasks[cat.id] || [];
              const isCollapsed = collapsedCategories.has(cat.id);
              const isEmpty = catTasks.length === 0;
              return (
                <div key={cat.id} className="mb-6 space-y-1.5">
                  <CategoryHeaderRow
                    category={cat}
                    label={cat.name}
                    editor={catEditor}
                    canDelete={cat.id !== FALLBACK_CATEGORY.tasks}
                    collapsed={isCollapsed}
                    onToggleCollapse={() => toggleCategoryCollapse(cat.id)}
                    count={catTasks.length}
                    onAdd={() => handleCreateTask(cat.id)}
                    addTitle={t('tasks.newTask')}
                  />
                  {!isCollapsed && (
                    isEmpty ? (
                      <p className="text-xs text-stone-700 px-1 py-1">{t('tasks.empty')}</p>
                    ) : (
                      catTasks.map((task) => (
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
                      )) 
                    )
                  )}
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

        {/* Ganz unten, wie der Waisen-Bucket in Wiki/Operations. Bei
            ausgewähltem „Ohne Kategorie"-Chip auch leer — mit Leer-Hinweis,
            wie jede andere leere Kategorie. */}
        {showUncatBlock && (
          <div className="mb-6 space-y-1.5">
            <CollapsibleGroupHeader
              collapsed={uncatCollapsed}
              onToggleCollapse={() => toggleCategoryCollapse(UNCATEGORIZED_KEY)}
              emoji="📄"
              label={t('tasks.uncategorized')}
              count={uncategorized.length}
            />
            {!uncatCollapsed && uncategorized.length === 0 && (
              <p className="text-xs text-stone-700 px-1 py-1">{t('tasks.empty')}</p>
            )}
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

        {/* Custom-Modus-Pendant zu Dashboards zentralem Rückfall: blenden die
            Filter alle Gruppen aus, kein leerer Content-Bereich, sondern
            „Keine Ergebnisse". */}
        {groupedTasks && visibleCategories.length === 0 && !showUncatBlock && categories.length > 0 && !searchQuery && (
          <p className="text-center py-20 text-stone-600 text-sm">{t('search.noResults')}</p>
        )}

        {categories.length === 0 && sortedTasks.length === 0 && !searchQuery && (
          <div className="py-20 text-center">
            <p className="text-stone-600 text-sm">{t('tasks.empty')}</p>
            <button
              onClick={() => handleCreateTask()}
              className="mt-4 text-sm underline text-stone-500 hover:text-stone-300 transition-colors"
            >
              {t('tasks.newTask')}
            </button>
          </div>
        )}

        {searchQuery && sortedTasks.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-stone-600 text-sm">{t('search.noResults')}</p>
          </div>
        )}
    </>
  );

  return (
    <>
      <Dashboard<Task>
        title={t('nav.tasks')}
        primaryAction={{ label: t('tasks.newTask'), onClick: () => handleCreateTask() }}
        secondaryAction={{ label: t('tasks.newCategory'), onClick: () => catEditor.setAddingCategory(true) }}
        view={tasksPrefs.view}
        sort={tasksPrefs.sort}
        onView={(v) => setTasksPrefs({ view: v })}
        onSort={(s) => setTasksPrefs({ sort: s })}
        viewOptions={[{ value: 'list' as const, label: t('listView.list') }]}
        search={searchQuery}
        onSearch={setSearchQuery}
        filters={{
          showFilters: filterOpen,
          onToggleFilters: () => setFilterOpen((o) => !o),
          activeFilterCount,
          panelProps: {
            chipLabel: t('tasks.filter.category'),
            // „Ohne Kategorie" immer dabei, auch ohne Waisen.
            chips: [
              ...categories.map((c) => ({ value: c.id, label: c.name, emoji: c.emoji })),
              { value: UNCATEGORIZED_KEY, label: t('tasks.uncategorized'), emoji: '📄' },
            ],
            selectedChips: [...filterCategory],
            onChipToggle: (v) => setFilterCategory((prev) => {
              const next = new Set(prev);
              if (next.has(v)) next.delete(v); else next.add(v);
              return next;
            }),
            onAllChips: () => setFilterCategory(new Set()),
            nonEmptyOnly: hideEmptyCats,
            onNonEmptyToggle: () => setHideEmptyCats((v) => !v),
            // „Erledigte anzeigen" ist ein Anzeige-Schalter, kein Filter:
            // zählt nicht in activeFilterCount, „Alle löschen" lässt ihn stehen.
            displayExtras: (
              <FilterChipButton active={showCompleted} onClick={() => setShowCompleted((o) => !o)}>
                <CheckSquare size={12} />
                {t('tasks.showCompleted')}
              </FilterChipButton>
            ),
            // Prioritäten als zweite Chip-Gruppe des FilterPanels (statusChips
            // mit eigenem Label) — dieselbe Mechanik wie der Operations-Status.
            statusLabel: t('tasks.filter.priority'),
            statusChips: (['high', 'medium', 'low'] as const).map((p) => ({
              value: p,
              label: t('tasks.priority.' + p),
              icon: <Flag size={12} />,
            })),
            selectedStatus: [...filterPriority],
            onStatusToggle: (v) => setFilterPriority((prev) => {
              const next = new Set(prev);
              if (next.has(v)) next.delete(v); else next.add(v);
              return next;
            }),
            onClearAll: () => {
              setFilterCategory(new Set());
              setFilterPriority(new Set());
              setHideEmptyCats(false);
            },
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
          onSelect={(item) => { addLink(linkModal.taskId, item.id, item.entryType); }}
          onClose={() => setLinkModal(null)}
        />
      )}

      <CategoryAddModal editor={catEditor} title={t('tasks.newCategory')} placeholder={t('tasks.categoryName')} />
    </>
  );
}

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
  resolveTaskLinkTitle: (targetType: string, targetId: string) => string;
  t: (key: string) => string;
}

const TaskRow = memo(function TaskRow({
  task, editingId, editValue, setEditValue, setEditingId,
  handleSaveEdit, toggleExpand, expandedTasks, setCtxMenu, setLinkModal, resolveTaskLinkTitle, t,
}: TaskRowProps) {
  // Wie `.sidebar-item.active` anderswo: die Markierung haengt am aktiven
  // View, nicht an einem Timer. Sie steht, solange der Tiefenlink auf diese
  // Zeile zeigt, und verschwindet, sobald anderswohin navigiert wird.
  const isTarget = useUIStore((s) => s.activeView.type === 'tasks' && s.activeView.id === task.id);
  const updateTask = useTaskStore((s) => s.updateTask);
  const categories = useTaskStore((s) => s.categories);
  const getSubtasks = useTaskStore((s) => s.getSubtasks);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const restoreTask = useTaskStore((s) => s.restoreTask);
  const links = useTaskStore((s) => s.links);
  const createTask = useTaskStore((s) => s.createTask);
  const toggleComplete = useTaskStore((s) => s.toggleComplete);
  const pushUndo = useUndoStore((s) => s.push);
  const subtasks = getSubtasks(task.id);
  const hasSubtasks = subtasks.length > 0;
  const isExpanded = expandedTasks.has(task.id);
  const isEditing = editingId === task.id;
  const taskLinks = links.filter((l) => l.task_id === task.id);

  const handleDelete = async () => {
    await deleteTask(task.id);
    pushUndo({
      id: generateId(),
      description: t('undo.taskDeleted'),
      undo: () => restoreTask(task.id),
    });
  };

  const handleCreateSubtaskLocal = async () => {
    const subtask = await createTask(task.category_id, task.id);
    toggleExpand(task.id);
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

  const handleCategoryChange = async (categoryId: string) => {
    await updateTask(task.id, { category_id: categoryId });
  };

  const priorityLabels: Record<string, string> = {
    high: t('tasks.priority.high'),
    medium: t('tasks.priority.medium'),
    low: t('tasks.priority.low'),
  };

  return (
    <div>
      <div
        data-task-id={task.id}
        className={`panel-interactive flex items-center gap-3 px-4 py-2 group ${task.completed ? 'opacity-50' : ''} ${isTarget ? 'task-row-target' : ''}`}
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
          className="text-stone-400 hover:text-jade-400 flex-shrink-0"
        >
          {task.completed ? (
            <CheckSquare size={16} className="text-jade-400" />
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
              if (e.key === 'Escape') setEditingId(null);
            }}
            className="flex-1 bg-stone-800 border border-stone-600 rounded px-2 py-0.5 text-sm text-stone-200 outline-none focus:border-jade-500"
            autoFocus
          />
        ) : (
          <span
            className={`flex-1 text-sm truncate cursor-default ${task.completed ? 'line-through text-stone-500' : 'text-stone-200'}`}
            onDoubleClick={() => {
              setEditingId(task.id);
              setEditValue(task.title);
            }}
          >
            {task.title}
          </span>
        )}

        {resolvedLinks.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            {resolvedLinks.map((link) => (
              <span
                key={link.id}
                className="tasks-linked-entry text-xs cursor-pointer px-1.5 py-0.5 rounded transition-colors"
                title={`${link.target_type}: ${link.title}`}
                onClick={() => {
                  useUIStore.getState().setActiveView({ type: viewTypeForEntryType(link.target_type), id: link.target_id, mode: 'view' });
                }}
              >
                {link.title}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCreateSubtaskLocal}
            className="task-action-btn text-stone-500 hover:text-jade-400 p-0.5"
            title={t('tasks.addSubtask')}
          >
            <Plus size={12} />
          </button>

          <CategorySelect
            categories={categories}
            value={task.category_id}
            onChange={handleCategoryChange}
            getLabel={(c) => c.name}
            variant="chip"
            align="right"
            title={t('tasks.filter.category')}
          />

          <button
            onClick={() => setLinkModal({ taskId: task.id })}
            className="task-action-btn text-stone-500 hover:text-jade-400 p-0.5"
            title={t('tasks.linkEntry')}
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
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${TASK_PRIORITY_PILL_CLASSES[task.priority]}`}
                title={t('tasks.priority.' + task.priority)}
              >
                <Flag size={12} />
              </button>
            )}
          />

          <button
            onClick={handleDelete}
            className="task-action-btn text-stone-500 hover:text-red-400 p-0.5"
            title={t('contextMenu.delete')}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

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

