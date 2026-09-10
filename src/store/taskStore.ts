import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { serialKey, serialized } from '../lib/serialize';
import { fromRow, toInt, type DbRow } from '../lib/row';
import type { ContentType, Task, TaskLink } from '../types';

function collectDescendantIds(tasks: Task[], parentId: string): string[] {
  const ids: string[] = [];
  const walk = (pid: string) => {
    for (const t of tasks) {
      if (t.parent_task_id === pid) {
        ids.push(t.id);
        walk(t.id);
      }
    }
  };
  walk(parentId);
  ids.unshift(parentId);
  return ids;
}

interface TaskState {
  tasks: Task[];
  links: TaskLink[];

  fetchAll: () => Promise<void>;
  createTask: (categoryId?: string | null, parentTaskId?: string | null) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  permanentlyDeleteTask: (id: string) => Promise<void>;
  getTask: (id: string) => Task | undefined;
  getSubtasks: (parentId: string) => Task[];
  getRootTasks: () => Task[];

  addLink: (taskId: string, targetId: string, targetType: ContentType) => Promise<void>;
  removeLink: (id: string) => Promise<void>;
  getLinksForTask: (taskId: string) => TaskLink[];
  getLinksForTarget: (targetId: string) => TaskLink[];
}

async function selectAllTasks(db: Database): Promise<Task[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at DESC'
  );
  return rows.map(fromRow.task);
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  links: [],

  fetchAll: async () => {
    const db = await getDb();
    const linkRows = await db.select<DbRow[]>('SELECT * FROM task_links');
    set({
      tasks: await selectAllTasks(db),
      links: linkRows.map(fromRow.taskLink),
    });
  },

  createTask: async (categoryId: string | null = null, parentTaskId: string | null = null) => {
    const db = await getDb();
    const id = generateId();
    const now = nowIso();

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

  // serialized: siehe lib/serialize.ts. Gleicher Schlüssel wie toggleComplete —
  // updateTask schreibt die ganze Zeile aus einem Snapshot-Merge, toggleComplete
  // liest den Zustand vor dem Kippen; überlappend überschriebe einer den anderen.
  updateTask: (id: string, patch: Partial<Task>) => serialized(serialKey('task', id), async () => {
    const db = await getDb();
    const now = nowIso();
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;

    const merged = { ...task, ...patch, updated_at: now };

    await db.execute(
      `UPDATE tasks SET
        title=$1, description=$2, category_id=$3, priority=$4, due_date=$5,
        completed=$6, completed_at=$7, parent_task_id=$8, sort_order=$9,
        updated_at=$10, tags=$11
       WHERE id=$12`,
      [
        merged.title, merged.description, merged.category_id, merged.priority,
        merged.due_date ?? null, toInt(merged.completed),
        merged.completed_at ?? null, merged.parent_task_id ?? null,
        merged.sort_order, merged.updated_at, JSON.stringify(merged.tags), id,
      ]
    );

    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? merged : t)) }));
  }),

  toggleComplete: (id: string) => serialized(serialKey('task', id), async () => {
    const db = await getDb();
    const now = nowIso();
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;

    const newCompleted = !task.completed;
    const newCompletedAt = newCompleted ? now : null;
    const idsToUpdate = collectDescendantIds(get().tasks, id);

    for (const tid of idsToUpdate) {
      const write = () => db.execute(
        'UPDATE tasks SET completed=$1, completed_at=$2, updated_at=$3 WHERE id=$4',
        [toInt(newCompleted), newCompletedAt, now, tid]
      );
      // Nachfahren über deren eigene Kette, damit ein gleichzeitiges updateTask
      // auf ein Kind dessen completed-Spalten nicht zurückdreht. Die Wurzel
      // selbst läuft schon unter diesem Schlüssel — einreihen wartete auf sich.
      if (tid === id) await write();
      else await serialized(serialKey('task', tid), write);
    }

    set((s) => ({
      tasks: s.tasks.map((t) =>
        idsToUpdate.includes(t.id)
          ? { ...t, completed: newCompleted, completed_at: newCompletedAt, updated_at: now }
          : t
      ),
    }));
  }),

  deleteTask: async (id: string) => {
    const db = await getDb();
    const now = nowIso();
    const idsToDelete = collectDescendantIds(get().tasks, id);

    for (const tid of idsToDelete) {
      await db.execute('UPDATE tasks SET deleted_at=$1 WHERE id=$2', [now, tid]);
    }
    // Nur die eigene (task_id-)Seite: der Soft-Delete ist umkehrbar, und
    // Zeilen, die auf die Aufgabe ZEIGEN (task_links.target_id, links),
    // bleiben stehen — sweepDanglingLinks zählt Papierkorb-Inhalte als
    // gültig, endgültig räumt erst permanentlyDeleteTask ab.
    for (const tid of idsToDelete) {
      await db.execute('DELETE FROM task_links WHERE task_id=$1', [tid]);
    }

    set((s) => ({
      tasks: s.tasks.filter((t) => !idsToDelete.includes(t.id)),
      links: s.links.filter((l) => !idsToDelete.includes(l.task_id)),
    }));
  },

  restoreTask: async (id: string) => {
    const db = await getDb();
    await db.execute('UPDATE tasks SET deleted_at=NULL WHERE id=$1', [id]);
    const tasks = await selectAllTasks(db);
    set((s) => ({ ...s, tasks }));
  },

  permanentlyDeleteTask: async (id: string) => {
    const db = await getDb();
    const idsToDelete = collectDescendantIds(get().tasks, id);

    for (const tid of idsToDelete) {
      await db.execute('DELETE FROM task_links WHERE task_id=$1 OR target_id=$1', [tid]);
      // Aufgaben sind Link-Ziele der Editoren (nie Quellen) — wie bei
      // journal/wikiStore räumt das endgültige Löschen die links-Zeilen mit ab.
      await db.execute('DELETE FROM links WHERE target_id=$1', [tid]);
      await db.execute('DELETE FROM tasks WHERE id=$1', [tid]);
    }
    set((s) => ({
      tasks: s.tasks.filter((t) => !idsToDelete.includes(t.id)),
      links: s.links.filter((l) => !idsToDelete.includes(l.task_id) && !idsToDelete.includes(l.target_id)),
    }));
  },

  getTask: (id: string) => get().tasks.find((t) => t.id === id),

  getSubtasks: (parentId: string) => get().tasks.filter((t) => t.parent_task_id === parentId),

  getRootTasks: () => get().tasks.filter((t) => t.parent_task_id === null),

  addLink: async (taskId: string, targetId: string, targetType: ContentType) => {
    const db = await getDb();
    const id = generateId();
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
