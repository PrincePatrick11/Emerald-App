import { memo, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { useJournalStore } from '../../store/journalStore';
import { useWikiStore } from '../../store/wikiStore';
import { useOperationStore } from '../../store/operationStore';
import { generateId } from '../../lib/helpers';
import { useCategoryEditor } from '../../hooks/useCategoryEditor';
import { FALLBACK_CATEGORY } from '../../lib/schema';
import Dashboard from '../ui/Dashboard';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import LinkPickerModal from '../editor/LinkPickerModal';
import EmojiPicker from '../ui/EmojiPicker';
import Button from '../ui/Button';
import {
  Plus, ChevronDown, ChevronRight, Flag, Trash2,
  CheckSquare, Square, X, Check, Link2, Pencil,
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

  const {
    categories, tasks, fetchAll, createTask, updateTask,
    getCategory, addCategory, addLink,
    updateCategory, deleteCategory, restoreCategory,
  } = useTaskStore();

  const journalEntries = useJournalStore((s) => s.entries);
  const wikiArticles = useWikiStore((s) => s.articles);
  const operations = useOperationStore((s) => s.operations);

  const {
    addingCategory, setAddingCategory,
    newCatName, setNewCatName,
    newCatEmoji, setNewCatEmoji,
    editingCatId, setEditingCatId,
    editCatName, setEditCatName,
    editCatEmoji, setEditCatEmoji,
    confirmDeleteCatId, setConfirmDeleteCatId,
    handleAddCategory,
    startEditCat,
    handleSaveEditCat,
    handleDeleteCat,
  } = useCategoryEditor({ addCategory, updateCategory, deleteCategory, restoreCategory }, { defaultEmoji: '📋' });

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number; actions: ContextMenuAction[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<Set<string>>(new Set());
  const [filterPriority, setFilterPriority] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [linkModal, setLinkModal] = useState<{ taskId: string } | null>(null);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const rootTasks = tasks.filter((task) => task.parent_task_id === null);

  const filteredTasks = rootTasks.filter((task) => {
    if (!showCompleted && task.completed) return false;
    if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterCategory.size > 0 && !filterCategory.has(task.category_id)) return false;
    if (filterPriority.size > 0 && !filterPriority.has(task.priority)) return false;
    return true;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (tasksPrefs.sort === 'alpha_asc') return a.title.localeCompare(b.title);
    if (tasksPrefs.sort === 'alpha_desc') return b.title.localeCompare(a.title);
    if (tasksPrefs.sort === 'date_desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (tasksPrefs.sort === 'date_asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (tasksPrefs.sort === 'category') {
      const catA = getCategory(a.category_id)?.name ?? '';
      const catB = getCategory(b.category_id)?.name ?? '';
      const catCmp = catA.localeCompare(catB);
      return catCmp !== 0 ? catCmp : a.sort_order - b.sort_order;
    }
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
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

  const uncatCollapsed = collapsedCategories.has('__uncategorized__');

  const visibleCategories = filterCategory.size > 0
    ? categories.filter((c) => filterCategory.has(c.id))
    : categories;

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

  const toggleCategoryCollapse = useCallback((catId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  const activeFilterCount = filterCategory.size + filterPriority.size;

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
    return 'Unknown';
  }, [journalEntries, wikiArticles, operations]);

  const renderTasksContent = () => (
    <>
        {/* Add Category at top */}
        {addingCategory ? (
          <div className="flex items-center gap-2 mb-4 px-2">
            <EmojiPicker
              value={newCatEmoji}
              onChange={setNewCatEmoji}
              trigger={({ toggle }) => (
                <button
                  onClick={toggle}
                  className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
                >
                  {newCatEmoji}
                </button>
              )}
            />
            <input
              autoFocus
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') { setAddingCategory(false); } }}
              placeholder="Name…"
              className="flex-1 bg-stone-800/60 rounded px-2 py-0.5 text-xs text-stone-200 outline-none"
            />
            <button onClick={handleAddCategory} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
            <button onClick={() => setAddingCategory(false)} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
          </div>
        ) : (
          <button
            onClick={() => setAddingCategory(true)}
            className="flex items-center gap-2 mb-2 w-full text-stone-600 hover:text-stone-400 transition-colors"
          >
            <span className="w-5 flex items-center justify-center flex-shrink-0"><Plus size={18} /></span>
            <span className="flex-1 text-left text-xs font-semibold uppercase tracking-wider">{t('tasks.newCategory')}</span>
          </button>
        )}

        {uncategorized.length > 0 && (
          <div className="mb-6 space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => toggleCategoryCollapse('__uncategorized__')}
                className="text-stone-500 hover:text-stone-300 flex-shrink-0"
              >
                {uncatCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <span className="w-5 text-center flex-shrink-0 text-base">📄</span>
              <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider">{t('tasks.uncategorized')}</p>
              <span className="text-xs text-stone-500">({uncategorized.length})</span>
            </div>
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

        {groupedTasks
          ? visibleCategories.map((cat) => {
              const catTasks = groupedTasks[cat.id] || [];
              const isCollapsed = collapsedCategories.has(cat.id);
              const isEmpty = catTasks.length === 0;
              return (
                <div key={cat.id} className="mb-6 space-y-1.5">
                  {editingCatId === cat.id ? (
                    <div className="flex items-center gap-2 mb-2">
                      <EmojiPicker
                        value={editCatEmoji}
                        onChange={setEditCatEmoji}
                        trigger={({ toggle }) => (
                          <button
                            onClick={toggle}
                            className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
                          >
                            {editCatEmoji}
                          </button>
                        )}
                      />
                      <input
                        autoFocus
                        value={editCatName}
                        onChange={(e) => setEditCatName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditCat(); if (e.key === 'Escape') { setEditingCatId(null); } }}
                        className="flex-1 bg-stone-800/60 rounded px-2 py-0.5 text-xs text-stone-200 outline-none"
                      />
                      <Button onClick={handleSaveEditCat} variant="ghost" className="text-jade-400"><Check size={12} /></Button>
                      <Button onClick={() => setEditingCatId(null)} variant="ghost"><X size={12} /></Button>
                      {confirmDeleteCatId === cat.id ? (
                          <>
                            <Button onClick={() => handleDeleteCat(cat.id)} variant="danger" className="text-xs px-1">{t('trash.confirmYes')}</Button>
                            <Button onClick={() => setConfirmDeleteCatId(null)} variant="ghost" className="text-xs">{t('trash.confirmNo')}</Button>
                          </>
                        ) : (
                          <Button onClick={() => handleDeleteCat(cat.id)} variant="danger" className="p-0.5 ml-1">
                            <Trash2 size={12} />
                          </Button>
                        )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => toggleCategoryCollapse(cat.id)}
                        className="text-stone-500 hover:text-stone-300 flex-shrink-0"
                      >
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <span className="w-5 text-center flex-shrink-0 text-base">{cat.emoji}</span>
                      <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider flex-1">{cat.name}</p>
                      <span className="text-xs text-stone-500">({catTasks.length})</span>
                      <Button
                        onClick={() => handleCreateTask(cat.id)}
                        variant="ghost"
                        className="ml-auto p-1"
                        title={t('tasks.newTask')}
                      >
                        <Plus size={14} />
                      </Button>
                      <button
                        onClick={() => startEditCat(cat)}
                        className="text-stone-500 hover:text-stone-300 transition-colors p-0.5"
                        title={t('editor.edit')}
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                  )}
                  {!isCollapsed && (
                    isEmpty ? (
                      <p className="text-xs text-stone-700 px-1 py-1">— {t('tasks.emptyCategory')} —</p>
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
        view={tasksPrefs.view}
        sort={tasksPrefs.sort}
        onView={(v) => setTasksPrefs({ view: v })}
        onSort={(s) => setTasksPrefs({ sort: s })}
        viewOptions={[{ value: 'list' as const, label: t('listView.list') }]}
        search={searchQuery}
        onSearch={setSearchQuery}
        toolbarExtraActions={
          <button
            onClick={() => setShowCompleted((o) => !o)}
            className={`flex items-center justify-center p-1.5 rounded-md transition-colors ${
              showCompleted
                ? 'bg-jade-900/50 border border-jade-800/40 text-jade-400'
                : 'bg-stone-800/70 hover:bg-stone-700/70 text-stone-500 hover:text-stone-300'
            }`}
            title={showCompleted ? t('tasks.showCompleted') : t('tasks.hideCompleted')}
          >
            <CheckSquare size={13} />
          </button>
        }
        filters={{
          showFilters: filterOpen,
          onToggleFilters: () => setFilterOpen((o) => !o),
          activeFilterCount,
          panelProps: {
            chipLabel: t('tasks.filter.category'),
            chips: categories.map((c) => ({ value: c.id, label: c.name, emoji: c.emoji })),
            selectedChips: [...filterCategory],
            onChipToggle: (v) => setFilterCategory((prev) => {
              const next = new Set(prev);
              if (next.has(v)) next.delete(v); else next.add(v);
              return next;
            }),
            onClearAll: () => {
              setFilterCategory(new Set());
              setFilterPriority(new Set());
            },
          },
          extraPanelContent: (
            <div className="px-8 py-2 border-b border-stone-700/40 bg-stone-900/50 flex items-center gap-2">
              <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">{t('tasks.filter.priority')}</span>
              {(['high', 'medium', 'low'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setFilterPriority((prev) => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p); else next.add(p);
                    return next;
                  })}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                    filterPriority.has(p)
                      ? 'bg-jade-900/50 border-jade-800/40 text-jade-400'
                      : 'bg-stone-800/60 border-stone-700/60 text-stone-500 hover:text-stone-300 hover:border-stone-600'
                  }`}
                >
                  <Flag size={12} />
                  {t('tasks.priority.' + p)}
                </button>
              ))}
            </div>
          ),
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
  const updateTask = useTaskStore((s) => s.updateTask);
  const getCategory = useTaskStore((s) => s.getCategory);
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

  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const priorityRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showPriorityMenu && priorityRef.current && !priorityRef.current.contains(e.target as Node)) {
        setShowPriorityMenu(false);
      }
      if (showCategoryMenu && categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setShowCategoryMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPriorityMenu, showCategoryMenu]);

  const handlePriorityChange = async (priority: TaskPriority) => {
    await updateTask(task.id, { priority });
    setShowPriorityMenu(false);
  };

  const handleCategoryChange = async (categoryId: string) => {
    await updateTask(task.id, { category_id: categoryId });
    setShowCategoryMenu(false);
  };

  const priorityLabels: Record<string, string> = {
    high: t('tasks.priority.high'),
    medium: t('tasks.priority.medium'),
    low: t('tasks.priority.low'),
  };

  const currentCategory = getCategory(task.category_id);

  return (
    <div>
      <div
        className={`panel-interactive flex items-center gap-3 px-4 py-2 group ${task.completed ? 'opacity-50' : ''}`}
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
          <button
            onClick={() => toggleExpand(task.id)}
            className="text-stone-500 hover:text-stone-300 flex-shrink-0"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
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
                  const typeMap: Record<string, string> = { journal: 'journal', wiki: 'wiki', operation: 'operations' };
                  useUIStore.getState().setActiveView({ type: typeMap[link.target_type] as any, id: link.target_id, mode: 'view' });
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

          <div className="relative" ref={categoryRef}>
            <button
              onClick={() => setShowCategoryMenu((o) => !o)}
              className="tasks-category-trigger text-xs text-stone-500 hover:text-stone-300 px-1.5 py-0.5 rounded hover:bg-stone-700/50"
              title={t('tasks.filter.category')}
            >
              {currentCategory ? `${currentCategory.emoji} ${currentCategory.name}` : '—'}
            </button>
            {showCategoryMenu && (
              <div className="tasks-menu absolute right-0 top-full mt-1 z-50 rounded-lg shadow-xl py-1 min-w-[140px]">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryChange(cat.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                      task.category_id === cat.id
                        ? 'tasks-menu-item-active text-jade-400'
                        : 'tasks-menu-item-idle text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    <span>{cat.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setLinkModal({ taskId: task.id })}
            className="task-action-btn text-stone-500 hover:text-jade-400 p-0.5"
            title={t('tasks.linkEntry')}
          >
            <Link2 size={12} />
          </button>

          <div className="relative" ref={priorityRef}>
            <button
              onClick={() => setShowPriorityMenu((o) => !o)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${TASK_PRIORITY_PILL_CLASSES[task.priority]}`}
              title={t('tasks.priority.' + task.priority)}
            >
              <Flag size={11} />
            </button>
            {showPriorityMenu && (
              <div className="tasks-menu absolute right-0 top-full mt-1 z-50 rounded-lg shadow-xl py-1 min-w-[120px]">
                {(['high', 'medium', 'low'] as TaskPriority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePriorityChange(p)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                      task.priority === p
                        ? `tasks-menu-item-active ${TASK_PRIORITY_COLORS[p]}`
                        : 'tasks-menu-item-idle text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    <Flag size={11} />
                    <span>{priorityLabels[p]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

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

