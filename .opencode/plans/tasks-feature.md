# Tasks Feature - Implementierungsplan

## 1. Types (`src/types/index.ts`)

Füge folgende Types hinzu:

```typescript
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskCategory {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
  is_builtin: boolean;
  deleted_at: string | null;
}

export interface TaskLink {
  id: string;
  task_id: string;
  target_id: string;
  target_type: ContentType;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  category_id: string;
  priority: TaskPriority;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  parent_task_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tags: string[];
  deleted_at: string | null;
  entry_number?: number;
}
```

Und erweitere `ActiveView`:

```typescript
export interface ActiveView {
  type: ContentType | 'home' | 'tags' | 'trash' | 'altar' | 'operations' | 'tasks';
  id?: string;
  mode?: 'view' | 'edit';
}
```

---

## 2. DB Migration (`src/lib/db.ts`)

Am Ende von `runMigrations()` hinzufügen:

```typescript
// Task categories table
await db.execute(`
  CREATE TABLE IF NOT EXISTS task_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📋',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT
  )
`);

// Tasks table
await db.execute(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled Task',
    description TEXT NOT NULL DEFAULT '',
    category_id TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    parent_task_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    deleted_at TEXT
  )
`);

// Task links table
await db.execute(`
  CREATE TABLE IF NOT EXISTS task_links (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )
`);

await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id)'
);

await db.execute(
  'CREATE INDEX IF NOT EXISTS idx_task_links_target ON task_links(target_id)'
);

// Seed built-in task categories
const taskCatCount = await db.select<{ n: number }[]>('SELECT COUNT(*) as n FROM task_categories WHERE is_builtin=1');
if ((taskCatCount[0]?.n ?? 0) === 0) {
  await db.execute(
    `INSERT INTO task_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
    ['general', 'Allgemein', '📋', 0, 1]
  );
  await db.execute(
    `INSERT INTO task_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
    ['ritual', 'Ritual', '🕯️', 1, 1]
  );
  await db.execute(
    `INSERT INTO task_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
    ['daily', 'Daily', '☀️', 2, 1]
  );
}

// Auto-purge tasks from trash
await db.execute(
  `DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
  [cutoff]
);
await db.execute(
  `DELETE FROM task_categories WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
  [cutoff]
);
```

---

## 3. Task Store (`src/store/taskStore.ts`)

Neue Datei erstellen:

```typescript
import { create } from 'zustand';
import { getDb } from '../lib/db';
import { safeParseArray } from '../lib/exportData';
import type { Task, TaskCategory, TaskLink } from '../types';
import { useUIStore } from './uiStore';
import { useTrashStore } from './trashStore';
import { useUndoStore } from './undoStore';
import { get } from 'svelte/store'; // NEIN - das ist Svelte! Verwende i18next direkt.

// Besser:
import i18n from '../i18n';

interface TaskState {
  categories: TaskCategory[];
  tasks: Task[];
  links: TaskLink[];

  fetchAll: () => Promise<void>;
  createTask: (categoryId: string, parentTaskId?: string | null) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  permanentlyDeleteTask: (id: string) => Promise<void>;
  getTask: (id: string) => Task | undefined;
  getSubtasks: (parentId: string) => Task[];
  getRootTasks: () => Task[];

  addCategory: (name: string, emoji: string) => Promise<void>;
  updateCategory: (id: string, patch: Partial<TaskCategory>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  restoreCategory: (id: string) => Promise<void>;
  getCategory: (id: string) => TaskCategory | undefined;

  addLink: (taskId: string, targetId: string, targetType: 'journal' | 'wiki' | 'operation') => Promise<void>;
  removeLink: (id: string) => Promise<void>;
  getLinksForTask: (taskId: string) => TaskLink[];
  getLinksForTarget: (targetId: string) => TaskLink[];
}

export const useTaskStore = create<TaskState>((set, get) => ({
  categories: [],
  tasks: [],
  links: [],

  fetchAll: async () => {
    const db = await getDb();
    const categories = await db.select<TaskCategory[]>(
      'SELECT * FROM task_categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
    );
    const tasks = await db.select<any[]>(
      'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at DESC'
    );
    const links = await db.select<TaskLink[]>('SELECT * FROM task_links');

    set({
      categories,
      tasks: tasks.map((row) => ({
        ...row,
        completed: (row.completed as unknown as number) !== 0,
        tags: safeParseArray<string>(row.tags),
      })),
      links,
    });
  },

  createTask: async (categoryId: string, parentTaskId: string | null = null) => {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO tasks (id, title, description, category_id, priority, due_date, completed, completed_at, parent_task_id, sort_order, created_at, updated_at, tags, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, 'New Task', '', categoryId, 'medium', null, 0, null, parentTaskId, 0, now, now, '[]', null]
    );

    const newTask: Task = {
      id, title: 'New Task', description: '', category_id: categoryId,
      priority: 'medium', due_date: null, completed: false, completed_at: null,
      parent_task_id: parentTaskId, sort_order: 0, created_at: now, updated_at: now,
      tags: [], deleted_at: null,
    };

    set((s) => ({ tasks: [newTask, ...s.tasks] }));
    return newTask;
  },

  updateTask: async (id: string, patch: Partial<Task>) => {
    const db = await getDb();
    const current = get().tasks.find((t) => t.id === id);
    if (!current) return;

    const updated = { ...current, ...patch, updated_at: new Date().toISOString() };

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'tags') {
        fields.push(`${key}=$${idx}`);
        values.push(JSON.stringify(value));
      } else if (typeof value === 'boolean') {
        fields.push(`${key}=$${idx}`);
        values.push(value ? 1 : 0);
      } else {
        fields.push(`${key}=$${idx}`);
        values.push(value);
      }
      idx++;
    }
    fields.push(`updated_at=$${idx}`);
    values.push(updated.updated_at);
    values.push(id);

    await db.execute(
      `UPDATE tasks SET ${fields.join(', ')} WHERE id=$${idx + 1}`,
      values
    );

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTask: async (id: string) => {
    const db = await getDb();
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;

    const now = new Date().toISOString();
    await db.execute('UPDATE tasks SET deleted_at=$1 WHERE id=$2', [now, id]);

    // Soft delete subtasks
    const subtasks = get().tasks.filter((t) => t.parent_task_id === id);
    for (const sub of subtasks) {
      await db.execute('UPDATE tasks SET deleted_at=$1 WHERE id=$2', [now, sub.id]);
    }

    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id && t.parent_task_id !== id),
    }));

    useTrashStore.getState().addTrashItem({
      id: crypto.randomUUID(),
      title: task.title,
      type: 'task',
      deleted_at: now,
    });

    useUndoStore.getState().pushUndo({
      id: crypto.randomUUID(),
      description: i18n.t('undo.taskDeleted'),
      undo: () => get().restoreTask(id),
    });
  },

  restoreTask: async (id: string) => {
    const db = await getDb();
    await db.execute('UPDATE tasks SET deleted_at=NULL WHERE id=$1', [id]);
    await get().fetchAll();
  },

  permanentlyDeleteTask: async (id: string) => {
    const db = await getDb();
    await db.execute('DELETE FROM tasks WHERE id=$1', [id]);
    await db.execute('DELETE FROM task_links WHERE task_id=$1', [id]);
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      links: s.links.filter((l) => l.task_id !== id),
    }));
  },

  getTask: (id: string) => get().tasks.find((t) => t.id === id),

  getSubtasks: (parentId: string) => get().tasks.filter((t) => t.parent_task_id === parentId),

  getRootTasks: () => get().tasks.filter((t) => t.parent_task_id === null),

  addCategory: async (name: string, emoji: string) => {
    const db = await getDb();
    const id = crypto.randomUUID();
    const sortOrder = get().categories.length;

    await db.execute(
      'INSERT INTO task_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)',
      [id, name, emoji, sortOrder, 0]
    );

    const newCat: TaskCategory = { id, name, emoji, sort_order: sortOrder, is_builtin: false, deleted_at: null };
    set((s) => ({ categories: [...s.categories, newCat] }));
  },

  updateCategory: async (id: string, patch: Partial<TaskCategory>) => {
    const db = await getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(patch)) {
      fields.push(`${key}=$${idx}`);
      values.push(value);
      idx++;
    }
    values.push(id);

    await db.execute(
      `UPDATE task_categories SET ${fields.join(', ')} WHERE id=$${idx}`,
      values
    );

    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  },

  deleteCategory: async (id: string) => {
    const db = await getDb();
    const cat = get().categories.find((c) => c.id === id);
    if (!cat || cat.is_builtin) return;

    const now = new Date().toISOString();
    await db.execute('UPDATE task_categories SET deleted_at=$1 WHERE id=$2', [now, id]);

    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));

    useTrashStore.getState().addTrashItem({
      id: crypto.randomUUID(),
      title: cat.name,
      type: 'task_category',
      deleted_at: now,
    });
  },

  restoreCategory: async (id: string) => {
    const db = await getDb();
    await db.execute('UPDATE task_categories SET deleted_at=NULL WHERE id=$1', [id]);
    await get().fetchAll();
  },

  getCategory: (id: string) => get().categories.find((c) => c.id === id),

  addLink: async (taskId: string, targetId: string, targetType: 'journal' | 'wiki' | 'operation') => {
    const db = await getDb();
    const id = crypto.randomUUID();

    await db.execute(
      'INSERT INTO task_links (id, task_id, target_id, target_type) VALUES ($1,$2,$3,$4)',
      [id, taskId, targetId, targetType]
    );

    const newLink: TaskLink = { id, task_id: taskId, target_id: targetId, target_type: targetType };
    set((s) => ({ links: [...s.links, newLink] }));
  },

  removeLink: async (id: string) => {
    const db = await getDb();
    await db.execute('DELETE FROM task_links WHERE id=$1', [id]);
    set((s) => ({ links: s.links.filter((l) => l.id !== id) }));
  },

  getLinksForTask: (taskId: string) => get().links.filter((l) => l.task_id === taskId),

  getLinksForTarget: (targetId: string) => get().links.filter((l) => l.target_id === targetId),
}));
```

---

## 4. UI Store erweitern (`src/store/uiStore.ts`)

Füge hinzu:

```typescript
// In UIState interface:
tasksPrefs: ListPrefs;

// In set(...) initial values:
tasksPrefs: { view: 'list', sort: 'category' },

// Neue Setter-Methode:
setTasksPrefs: (p: Partial<ListPrefs>) => set((s) => ({ tasksPrefs: { ...s.tasksPrefs, ...p } })),
```

Und in `setActiveView`:

```typescript
const usesEditorSidebar = view.type === 'journal' || view.type === 'wiki' || view.type === 'operations' || view.type === 'tasks';
```

---

## 5. Tasks View (`src/components/views/TasksView.tsx`)

Neue Datei erstellen - orientiere dich stark an `OperationsView.tsx` und `WikiView.tsx`.

Grundstruktur:

```tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTaskStore } from '../../store/taskStore';
import { useUIStore } from '../../store/uiStore';
import { useTranslation } from 'react-i18next';
import ListToolbar from '../ui/ListToolbar';
import FilterPanel from '../ui/FilterPanel';
import ContextMenu from '../ui/ContextMenu';
import { CheckSquare, Plus, ChevronDown, ChevronRight, Flag, Calendar, Link2, Trash2 } from 'lucide-react';

export default function TasksView() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const tasksPrefs = useUIStore((s) => s.tasksPrefs);
  const setTasksPrefs = useUIStore((s) => s.setTasksPrefs);
  const setActiveView = useUIStore((s) => s.setActiveView);

  const { tasks, categories, fetchAll, createTask, updateTask, deleteTask, getCategory } = useTaskStore();

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Filter & Sort Logic
  const rootTasks = tasks.filter((t) => t.parent_task_id === null);
  const filteredTasks = rootTasks.filter((task) => {
    if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterCategory && task.category_id !== filterCategory) return false;
    if (filterPriority && task.priority !== filterPriority) return false;
    if (filterStatus === 'completed' && !task.completed) return false;
    if (filterStatus === 'active' && task.completed) return false;
    return true;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (tasksPrefs.sort === 'alpha_asc') return a.title.localeCompare(b.title);
    if (tasksPrefs.sort === 'alpha_desc') return b.title.localeCompare(a.title);
    if (tasksPrefs.sort === 'date_desc') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (tasksPrefs.sort === 'date_asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (tasksPrefs.sort === 'priority') {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    }
    if (tasksPrefs.sort === 'category') {
      const catA = getCategory(a.category_id)?.name ?? '';
      const catB = getCategory(b.category_id)?.name ?? '';
      const catCmp = catA.localeCompare(catB);
      return catCmp !== 0 ? catCmp : a.title.localeCompare(b.title);
    }
    return 0;
  });

  // Group by category if sort === 'category'
  const groupedTasks = tasksPrefs.sort === 'category'
    ? sortedTasks.reduce((acc, task) => {
        const catId = task.category_id;
        if (!acc[catId]) acc[catId] = [];
        acc[catId].push(task);
        return acc;
      }, {} as Record<string, typeof sortedTasks>)
    : null;

  const toggleExpand = (id: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateTask = async (categoryId?: string) => {
    const cat = categoryId || categories[0]?.id;
    if (!cat) return;
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

  const handleToggleComplete = async (task: Task) => {
    await updateTask(task.id, {
      completed: !task.completed,
      completed_at: !task.completed ? new Date().toISOString() : null,
    });
  };

  const handleDeleteTask = async (id: string) => {
    await deleteTask(id);
    setCtxMenu(null);
  };

  const priorityColors = {
    high: 'text-red-400',
    medium: 'text-yellow-400',
    low: 'text-green-400',
  };

  // ... JSX Rendering
  return (
    <div className="flex flex-col h-full">
      <ListToolbar
        prefs={tasksPrefs}
        setPrefs={setTasksPrefs}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sortOptions={[
          { value: 'category', label: t('tasks.sort.category') },
          { value: 'date_desc', label: t('tasks.sort.newest') },
          { value: 'date_asc', label: t('tasks.sort.oldest') },
          { value: 'alpha_asc', label: t('tasks.sort.az') },
          { value: 'alpha_desc', label: t('tasks.sort.za') },
          { value: 'priority', label: t('tasks.sort.priority') },
        ]}
        filterOpen={filterOpen}
        setFilterOpen={setFilterOpen}
        onCreate={() => handleCreateTask()}
        createLabel={t('tasks.newTask')}
      />

      {filterOpen && (
        <FilterPanel
          filters={[
            {
              label: t('tasks.filter.category'),
              options: categories.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` })),
              value: filterCategory,
              onChange: setFilterCategory,
            },
            {
              label: t('tasks.filter.priority'),
              options: [
                { value: 'high', label: t('tasks.priority.high') },
                { value: 'medium', label: t('tasks.priority.medium') },
                { value: 'low', label: t('tasks.priority.low') },
              ],
              value: filterPriority,
              onChange: setFilterPriority,
            },
            {
              label: t('tasks.filter.status'),
              options: [
                { value: 'active', label: t('tasks.status.active') },
                { value: 'completed', label: t('tasks.status.completed') },
              ],
              value: filterStatus,
              onChange: setFilterStatus,
            },
          ]}
        />
      )}

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {groupedTasks
          ? Object.entries(groupedTasks).map(([catId, catTasks]) => {
              const cat = getCategory(catId);
              if (!cat) return null;
              return (
                <div key={catId} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span>{cat.emoji}</span>
                    <h3 className="text-sm font-semibold text-stone-300">{cat.name}</h3>
                    <span className="text-xs text-stone-500">({catTasks.length})</span>
                    <button
                      onClick={() => handleCreateTask(catId)}
                      className="ml-auto btn-ghost"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  {catTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      editingId={editingId}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      setEditingId={setEditingId}
                      handleSaveEdit={handleSaveEdit}
                      handleToggleComplete={handleToggleComplete}
                      handleDeleteTask={handleDeleteTask}
                      toggleExpand={toggleExpand}
                      expandedTasks={expandedTasks}
                      priorityColors={priorityColors}
                      setCtxMenu={setCtxMenu}
                    />
                  ))}
                </div>
              );
            })
          : sortedTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                editingId={editingId}
                editValue={editValue}
                setEditValue={setEditValue}
                setEditingId={setEditingId}
                handleSaveEdit={handleSaveEdit}
                handleToggleComplete={handleToggleComplete}
                handleDeleteTask={handleDeleteTask}
                toggleExpand={toggleExpand}
                expandedTasks={expandedTasks}
                priorityColors={priorityColors}
                setCtxMenu={setCtxMenu}
              />
            ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            { label: t('common.delete'), icon: <Trash2 size={14} />, onClick: () => handleDeleteTask(ctxMenu.id) },
          ]}
        />
      )}
    </div>
  );
}

// TaskRow Sub-Komponente
function TaskRow({ task, editingId, editValue, setEditValue, setEditingId, handleSaveEdit, handleToggleComplete, handleDeleteTask, toggleExpand, expandedTasks, priorityColors, setCtxMenu }) {
  const { tasks, getSubtasks } = useTaskStore();
  const subtasks = getSubtasks(task.id);
  const hasSubtasks = subtasks.length > 0;
  const isExpanded = expandedTasks.has(task.id);
  const isEditing = editingId === task.id;

  return (
    <div>
      <div
        className={`sidebar-item flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer ${task.completed ? 'opacity-50' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ id: task.id, x: e.clientX, y: e.clientY });
        }}
      >
        <button onClick={() => handleToggleComplete(task)} className="text-stone-400 hover:text-jade-400">
          <CheckSquare size={16} className={task.completed ? 'text-jade-400' : ''} />
        </button>

        {hasSubtasks && (
          <button onClick={() => toggleExpand(task.id)} className="text-stone-500">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}

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
            className="flex-1 bg-stone-800 border border-stone-600 rounded px-2 py-0.5 text-sm"
            autoFocus
          />
        ) : (
          <span
            className={`flex-1 text-sm ${task.completed ? 'line-through text-stone-500' : 'text-stone-200'}`}
            onDoubleClick={() => {
              setEditingId(task.id);
              setEditValue(task.title);
            }}
          >
            {task.title}
          </span>
        )}

        <Flag size={12} className={priorityColors[task.priority]} />

        {task.due_date && (
          <span className="text-xs text-stone-500 flex items-center gap-1">
            <Calendar size={12} />
            {new Date(task.due_date).toLocaleDateString()}
          </span>
        )}
      </div>

      {isExpanded && subtasks.map((sub) => (
        <div key={sub.id} className="ml-6">
          <TaskRow
            task={sub}
            editingId={editingId}
            editValue={editValue}
            setEditValue={setEditValue}
            setEditingId={setEditingId}
            handleSaveEdit={handleSaveEdit}
            handleToggleComplete={handleToggleComplete}
            handleDeleteTask={handleDeleteTask}
            toggleExpand={toggleExpand}
            expandedTasks={expandedTasks}
            priorityColors={priorityColors}
            setCtxMenu={setCtxMenu}
          />
        </div>
      ))}
    </div>
  );
}
```

---

## 6. MainArea erweitern (`src/components/layout/MainArea.tsx`)

```tsx
import TasksView from '../views/TasksView';

// Im Switch:
case 'tasks':
  return <TasksView />;
```

---

## 7. LeftSidebar erweitern (`src/components/layout/LeftSidebar.tsx`)

Füge einen neuen Nav-Button hinzu:

```tsx
import { CheckSquare } from 'lucide-react';

<button
  onClick={() => setActiveView({ type: 'tasks' })}
  className="sidebar-item flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-stone-400 hover:text-stone-200"
>
  <CheckSquare size={14} />
  {t('nav.tasks')}
</button>
```

---

## 8. i18n Übersetzungen

### `src/i18n/locales/en.json`
```json
{
  "nav.tasks": "Tasks",
  "tasks.title": "Tasks",
  "tasks.newTask": "New Task",
  "tasks.newCategory": "New Category",
  "tasks.sort.category": "Category",
  "tasks.sort.newest": "Newest",
  "tasks.sort.oldest": "Oldest",
  "tasks.sort.az": "A-Z",
  "tasks.sort.za": "Z-A",
  "tasks.sort.priority": "Priority",
  "tasks.filter.category": "Category",
  "tasks.filter.priority": "Priority",
  "tasks.filter.status": "Status",
  "tasks.priority.high": "High",
  "tasks.priority.medium": "Medium",
  "tasks.priority.low": "Low",
  "tasks.status.active": "Active",
  "tasks.status.completed": "Completed",
  "tasks.subtasks": "Subtasks",
  "tasks.links": "Links",
  "tasks.linkEntry": "Link Entry",
  "undo.taskDeleted": "Task deleted"
}
```

### `src/i18n/locales/de.json`
```json
{
  "nav.tasks": "Aufgaben",
  "tasks.title": "Aufgaben",
  "tasks.newTask": "Neue Aufgabe",
  "tasks.newCategory": "Neue Kategorie",
  "tasks.sort.category": "Kategorie",
  "tasks.sort.newest": "Neueste",
  "tasks.sort.oldest": "Älteste",
  "tasks.sort.az": "A-Z",
  "tasks.sort.za": "Z-A",
  "tasks.sort.priority": "Priorität",
  "tasks.filter.category": "Kategorie",
  "tasks.filter.priority": "Priorität",
  "tasks.filter.status": "Status",
  "tasks.priority.high": "Hoch",
  "tasks.priority.medium": "Mittel",
  "tasks.priority.low": "Niedrig",
  "tasks.status.active": "Aktiv",
  "tasks.status.completed": "Erledigt",
  "tasks.subtasks": "Unteraufgaben",
  "tasks.links": "Verlinkungen",
  "tasks.linkEntry": "Eintrag verlinken",
  "undo.taskDeleted": "Aufgabe gelöscht"
}
```

### `src/i18n/locales/es.json`
```json
{
  "nav.tasks": "Tareas",
  "tasks.title": "Tareas",
  "tasks.newTask": "Nueva Tarea",
  "tasks.newCategory": "Nueva Categoría",
  "tasks.sort.category": "Categoría",
  "tasks.sort.newest": "Más Reciente",
  "tasks.sort.oldest": "Más Antiguo",
  "tasks.sort.az": "A-Z",
  "tasks.sort.za": "Z-A",
  "tasks.sort.priority": "Prioridad",
  "tasks.filter.category": "Categoría",
  "tasks.filter.priority": "Prioridad",
  "tasks.filter.status": "Estado",
  "tasks.priority.high": "Alta",
  "tasks.priority.medium": "Media",
  "tasks.priority.low": "Baja",
  "tasks.status.active": "Activa",
  "tasks.status.completed": "Completada",
  "tasks.subtasks": "Subtareas",
  "tasks.links": "Enlaces",
  "tasks.linkEntry": "Enlazar Entrada",
  "undo.taskDeleted": "Tarea eliminada"
}
```

### `src/i18n/locales/fr.json`
```json
{
  "nav.tasks": "Tâches",
  "tasks.title": "Tâches",
  "tasks.newTask": "Nouvelle Tâche",
  "tasks.newCategory": "Nouvelle Catégorie",
  "tasks.sort.category": "Catégorie",
  "tasks.sort.newest": "Plus Récent",
  "tasks.sort.oldest": "Plus Ancien",
  "tasks.sort.az": "A-Z",
  "tasks.sort.za": "Z-A",
  "tasks.sort.priority": "Priorité",
  "tasks.filter.category": "Catégorie",
  "tasks.filter.priority": "Priorité",
  "tasks.filter.status": "Statut",
  "tasks.priority.high": "Haute",
  "tasks.priority.medium": "Moyenne",
  "tasks.priority.low": "Basse",
  "tasks.status.active": "Active",
  "tasks.status.completed": "Terminée",
  "tasks.subtasks": "Sous-tâches",
  "tasks.links": "Liens",
  "tasks.linkEntry": "Lier une Entrée",
  "undo.taskDeleted": "Tâche supprimée"
}
```

---

## 9. Trash Integration (`src/store/trashStore.ts`)

Erweitere den `type` in `TrashedItem`:

```typescript
type: 'journal' | 'wiki' | 'tag' | 'operation' | 'creation' | 'wiki_category' | 'operation_category' | 'task' | 'task_category';
```

Und im TrashView einen Case für `task` und `task_category` hinzufügen mit restore/permanent delete.

---

## Zusammenfassung der Dateien

| Datei | Aktion |
|-------|--------|
| `src/types/index.ts` | Types hinzufügen |
| `src/lib/db.ts` | Migration hinzufügen |
| `src/store/taskStore.ts` | Neue Datei |
| `src/store/uiStore.ts` | tasksPrefs hinzufügen |
| `src/store/trashStore.ts` | Type erweitern |
| `src/components/views/TasksView.tsx` | Neue Datei |
| `src/components/layout/MainArea.tsx` | Case 'tasks' hinzufügen |
| `src/components/layout/LeftSidebar.tsx` | Nav-Button hinzufügen |
| `src/components/views/TrashView.tsx` | Task restore/delete |
| `src/i18n/locales/en.json` | Übersetzungen |
| `src/i18n/locales/de.json` | Übersetzungen |
| `src/i18n/locales/es.json` | Übersetzungen |
| `src/i18n/locales/fr.json` | Übersetzungen |
