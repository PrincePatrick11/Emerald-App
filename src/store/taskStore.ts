import { create } from 'zustand';
import { getDb } from '../lib/db';
import type { Task, TaskPriority } from '../types';

type TaskRow = Omit<Task, 'is_done'> & { is_done: number };

interface TaskState {
  tasks: Task[];
  loading: boolean;
  fetchTasks: () => Promise<void>;
  createTask: (title?: string) => Promise<Task>;
  updateTask: (id: string, changes: Partial<Pick<Task, 'title' | 'description' | 'is_done' | 'priority' | 'due_date' | 'sort_order'>>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  permanentlyDeleteTask: (id: string) => Promise<void>;
  getTask: (id: string) => Task | undefined;
}

function normalizeTask(row: TaskRow): Task {
  return { ...row, is_done: row.is_done !== 0, priority: (row.priority || 'normal') as TaskPriority };
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const db = await getDb();
      const rows = await db.select<TaskRow[]>(
        `SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY is_done ASC, sort_order ASC, created_at DESC`
      );
      set({ tasks: rows.map(normalizeTask) });
    } finally {
      set({ loading: false });
    }
  },

  createTask: async (title = 'Untitled Task') => {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const sort_order = get().tasks.length;
    await db.execute(
      `INSERT INTO tasks (id, title, description, is_done, priority, due_date, created_at, updated_at, deleted_at, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, title.trim() || 'Untitled Task', '', 0, 'normal', null, now, now, null, sort_order]
    );
    const task: Task = {
      id,
      title: title.trim() || 'Untitled Task',
      description: '',
      is_done: false,
      priority: 'normal',
      due_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      sort_order,
    };
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  updateTask: async (id, changes) => {
    const db = await getDb();
    const task = get().tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    const updated: Task = { ...task, ...changes, updated_at: new Date().toISOString() };
    await db.execute(
      `UPDATE tasks SET title=$1, description=$2, is_done=$3, priority=$4, due_date=$5, updated_at=$6, sort_order=$7 WHERE id=$8`,
      [
        updated.title.trim() || 'Untitled Task',
        updated.description,
        updated.is_done ? 1 : 0,
        updated.priority,
        updated.due_date || null,
        updated.updated_at,
        updated.sort_order,
        id,
      ]
    );
    set((s) => ({ tasks: s.tasks.map((candidate) => (candidate.id === id ? updated : candidate)) }));
  },

  deleteTask: async (id) => {
    const db = await getDb();
    const deleted_at = new Date().toISOString();
    await db.execute(`UPDATE tasks SET deleted_at=$1, updated_at=$1 WHERE id=$2`, [deleted_at, id]);
    set((s) => ({ tasks: s.tasks.filter((task) => task.id !== id) }));
  },

  restoreTask: async (id) => {
    const db = await getDb();
    const updated_at = new Date().toISOString();
    await db.execute(`UPDATE tasks SET deleted_at=NULL, updated_at=$1 WHERE id=$2`, [updated_at, id]);
    await get().fetchTasks();
  },

  permanentlyDeleteTask: async (id) => {
    const db = await getDb();
    await db.execute(`DELETE FROM tasks WHERE id=$1`, [id]);
    set((s) => ({ tasks: s.tasks.filter((task) => task.id !== id) }));
  },

  getTask: (id) => get().tasks.find((task) => task.id === id),
}));
