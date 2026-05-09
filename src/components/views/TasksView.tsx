import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isPast, isToday } from 'date-fns';
import { CheckSquare, Circle, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useTaskStore } from '../../store/taskStore';
import { useUndoStore } from '../../store/undoStore';
import type { Task, TaskPriority } from '../../types';

type TaskFilter = 'open' | 'all' | 'done';

const priorityOrder: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

function priorityClass(priority: TaskPriority) {
  if (priority === 'high') return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (priority === 'low') return 'text-stone-500 bg-stone-800/60 border-stone-700/40';
  return 'text-jade-300 bg-jade-500/10 border-jade-500/20';
}

function dueDateClass(task: Task) {
  if (!task.due_date || task.is_done) return 'text-stone-500';
  const due = new Date(task.due_date);
  if (isPast(due) && !isToday(due)) return 'text-red-400';
  if (isToday(due)) return 'text-amber-300';
  return 'text-stone-400';
}

export default function TasksView() {
  const { t } = useTranslation();
  const { tasks, loading, fetchTasks, createTask, updateTask, deleteTask, restoreTask } = useTaskStore();
  const pushUndo = useUndoStore((s) => s.push);
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [query, setQuery] = useState('');
  const [draftTitle, setDraftTitle] = useState('');

  useEffect(() => { fetchTasks(); }, []);

  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks
      .filter((task) => filter === 'all' || (filter === 'done' ? task.is_done : !task.is_done))
      .filter((task) => !q || task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
        if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
        if (a.due_date && !b.due_date) return -1;
        if (!a.due_date && b.due_date) return 1;
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) return priorityOrder[a.priority] - priorityOrder[b.priority];
        return a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at);
      });
  }, [tasks, filter, query]);

  const counts = {
    all: tasks.length,
    open: tasks.filter((task) => !task.is_done).length,
    done: tasks.filter((task) => task.is_done).length,
  };

  const handleCreate = async () => {
    const title = draftTitle.trim();
    if (!title) return;
    await createTask(title);
    setDraftTitle('');
  };

  const handleDelete = async (task: Task) => {
    await deleteTask(task.id);
    pushUndo({
      id: crypto.randomUUID(),
      description: t('undo.taskDeleted'),
      undo: () => restoreTask(task.id),
    });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-stone-500 text-sm mb-1">
              <CheckSquare size={16} />
              <span>{t('tasks.subtitle')}</span>
            </div>
            <h1 className="text-2xl font-semibold text-stone-100 tracking-tight">{t('tasks.title')}</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-stone-700/50 bg-stone-800/40 px-3 py-1.5 text-xs text-stone-500">
            <span className="text-jade-400 font-medium">{counts.open}</span>
            {t('tasks.openCount')}
          </div>
        </div>

        <div className="panel p-4 space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-stone-700/50 bg-stone-900/50 px-3 py-2">
              <Plus size={15} className="text-stone-500" />
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                placeholder={t('tasks.newPlaceholder')}
                className="w-full bg-transparent text-sm text-stone-300 placeholder-stone-600 outline-none selectable"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!draftTitle.trim()}
              className="rounded-lg bg-jade-700/80 px-4 py-2 text-sm font-medium text-stone-100 transition-colors hover:bg-jade-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('tasks.add')}
            </button>
          </div>

          <div className="flex flex-col gap-3 border-t border-stone-700/40 pt-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(['open', 'all', 'done'] as TaskFilter[]).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${filter === value ? 'bg-jade-500/15 text-jade-300 border border-jade-500/30' : 'bg-stone-800/60 text-stone-500 border border-stone-700/40 hover:text-stone-300'}`}
                >
                  {t(`tasks.filters.${value}`)} <span className="text-stone-600">{counts[value]}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-stone-700/50 bg-stone-900/50 px-3 py-2 md:w-64">
              <Search size={14} className="text-stone-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('tasks.searchPlaceholder')}
                className="w-full bg-transparent text-xs text-stone-300 placeholder-stone-600 outline-none selectable"
              />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-stone-700/50 bg-stone-900/35">
          <div className="grid grid-cols-[44px_minmax(220px,1fr)_140px_140px_52px] items-center border-b border-stone-700/50 bg-stone-800/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-stone-600">
            <span />
            <span>{t('tasks.columns.task')}</span>
            <span>{t('tasks.columns.due')}</span>
            <span>{t('tasks.columns.priority')}</span>
            <span />
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-stone-500">{t('tasks.loading')}</div>
          ) : visibleTasks.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Circle size={26} className="mx-auto mb-3 text-stone-700" />
              <p className="text-sm text-stone-400">{t('tasks.empty')}</p>
              <p className="mt-1 text-xs text-stone-600">{t('tasks.emptyHint')}</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-800/80">
              {visibleTasks.map((task) => (
                <div key={task.id} className={`grid grid-cols-[44px_minmax(220px,1fr)_140px_140px_52px] items-center gap-0 px-3 py-2.5 transition-colors hover:bg-stone-800/30 ${task.is_done ? 'opacity-60' : ''}`}>
                  <button
                    onClick={() => updateTask(task.id, { is_done: !task.is_done })}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${task.is_done ? 'text-jade-400 hover:bg-jade-500/10' : 'text-stone-600 hover:bg-stone-800 hover:text-jade-400'}`}
                    title={task.is_done ? t('tasks.markOpen') : t('tasks.markDone')}
                  >
                    {task.is_done ? <CheckSquare size={17} /> : <Circle size={17} />}
                  </button>

                  <div className="min-w-0 pr-3">
                    <input
                      value={task.title}
                      onChange={(e) => updateTask(task.id, { title: e.target.value })}
                      className={`w-full bg-transparent text-sm outline-none selectable placeholder-stone-700 ${task.is_done ? 'text-stone-500 line-through' : 'text-stone-200'}`}
                    />
                    <input
                      value={task.description}
                      onChange={(e) => updateTask(task.id, { description: e.target.value })}
                      placeholder={t('tasks.descriptionPlaceholder')}
                      className="mt-0.5 w-full bg-transparent text-xs text-stone-500 outline-none selectable placeholder-stone-700"
                    />
                  </div>

                  <input
                    type="date"
                    value={task.due_date ?? ''}
                    onChange={(e) => updateTask(task.id, { due_date: e.target.value || null })}
                    className={`mr-3 rounded-md border border-stone-700/40 bg-stone-800/50 px-2 py-1.5 text-xs outline-none [color-scheme:dark] ${dueDateClass(task)}`}
                  />

                  <select
                    value={task.priority}
                    onChange={(e) => updateTask(task.id, { priority: e.target.value as TaskPriority })}
                    className={`mr-3 rounded-md border px-2 py-1.5 text-xs outline-none [color-scheme:dark] ${priorityClass(task.priority)}`}
                  >
                    <option value="low">{t('tasks.priority.low')}</option>
                    <option value="normal">{t('tasks.priority.normal')}</option>
                    <option value="high">{t('tasks.priority.high')}</option>
                  </select>

                  <button
                    onClick={() => handleDelete(task)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-700 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    title={t('tasks.moveToTrash')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-stone-600">
          <RotateCcw size={12} />
          {t('tasks.trashHint')}
        </div>
      </div>
    </div>
  );
}
