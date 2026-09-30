import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
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
  updateTask: (id: string, patch: Partial<Task>, options?: WriteOptions) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  permanentlyDeleteTask: (id: string) => Promise<void>;
  getSubtasks: (parentId: string) => Task[];

  addLink: (taskId: string, targetId: string, targetType: ContentType) => Promise<void>;
  removeLink: (id: string) => Promise<void>;
}

async function selectAllTasks(db: Database): Promise<Task[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at DESC'
  );
  return rows.map(fromRow.task);
}

/** Die Verknüpfungen der Aufgaben außerhalb des Papierkorbs — die im Papierkorb behalten ihre für den Rückweg. */
async function selectLiveLinks(db: Database): Promise<TaskLink[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM task_links WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL)'
  );
  return rows.map(fromRow.taskLink);
}

/**
 * `id` und ihre Unteraufgaben im Papierkorb, aus der Datenbank statt aus dem
 * Store, der nur die aktiven kennt. Mit `trashedWith` nur die, die mit diesem
 * Stempel dorthin kamen — also mit ihr, nicht schon vorher für sich.
 */
async function selectTrashedSubtree(db: Database, id: string, trashedWith?: string): Promise<string[]> {
  const rows = await db.select<{ id: string }[]>(
    `WITH RECURSIVE sub(id) AS (
       SELECT $1
       UNION ALL
       SELECT t.id FROM tasks t JOIN sub ON t.parent_task_id = sub.id
        WHERE t.deleted_at IS NOT NULL AND ($2 IS NULL OR t.deleted_at = $2)
     )
     SELECT id FROM sub`,
    [id, trashedWith ?? null]
  );
  return rows.map((r) => r.id);
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  links: [],

  fetchAll: async () => {
    const db = await getDb();
    set({
      tasks: await selectAllTasks(db),
      links: await selectLiveLinks(db),
    });
  },

  createTask: async (categoryId: string | null = null, parentTaskId: string | null = null) => {
    const db = await getDb();
    const id = generateId();
    const now = nowIso();

    await db.execute(
      `INSERT INTO tasks (id, title, category_id, priority, completed, completed_at, parent_task_id, sort_order, created_at, updated_at, tags, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, 'New Task', categoryId, 'medium', 0, null, parentTaskId, 0, now, now, '[]', null]
    );

    const newTask: Task = {
      id, title: 'New Task', category_id: categoryId,
      priority: 'medium', completed: false, completed_at: null,
      parent_task_id: parentTaskId, sort_order: 0, created_at: now, updated_at: now,
      tags: [], deleted_at: null,
    };

    set((s) => ({ tasks: [newTask, ...s.tasks] }));
    return newTask;
  },

  // serialized: siehe lib/serialize.ts. Gleicher Schlüssel wie toggleComplete —
  // updateTask schreibt die ganze Zeile aus einem Snapshot-Merge, toggleComplete
  // liest den Zustand vor dem Kippen; überlappend überschriebe einer den anderen.
  updateTask: (id: string, patch: Partial<Task>, { touch }: WriteOptions = {}) => serialized(serialKey('task', id), async () => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task || !needsWrite(task, patch, touch)) return;
    const db = await getDb();

    const merged = { ...task, ...patch, updated_at: stampFor(task.updated_at, touch) };

    await db.execute(
      `UPDATE tasks SET
        title=$1, category_id=$2, priority=$3,
        completed=$4, completed_at=$5, parent_task_id=$6, sort_order=$7,
        updated_at=$8, tags=$9
       WHERE id=$10`,
      [
        merged.title, merged.category_id, merged.priority,
        toInt(merged.completed),
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

    // Ein Stempel für alle: an ihm erkennt `restoreTask`, was zusammen ging.
    for (const tid of idsToDelete) {
      await db.execute('UPDATE tasks SET deleted_at=$1 WHERE id=$2', [now, tid]);
    }
    // Die Verknüpfungen bleiben in der Datenbank, für den Rückweg; endgültig
    // räumen sie erst permanentlyDeleteTask und das Leeren des Papierkorbs ab.
    set((s) => ({
      tasks: s.tasks.filter((t) => !idsToDelete.includes(t.id)),
      links: s.links.filter((l) => !idsToDelete.includes(l.task_id)),
    }));
  },

  restoreTask: async (id: string) => {
    const db = await getDb();
    const [row] = await db.select<{ deleted_at: string | null; parent_trashed: number }[]>(
      `SELECT t.deleted_at,
              EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_task_id AND p.deleted_at IS NOT NULL) AS parent_trashed
         FROM tasks t WHERE t.id=$1`,
      [id]
    );
    // Schon zurück — über ihre Oberaufgabe oder ein zweites Rückgängig.
    if (!row?.deleted_at) return;
    // Mit den Unteraufgaben, die mit ihr gingen.
    for (const tid of await selectTrashedSubtree(db, id, row.deleted_at)) {
      await db.execute('UPDATE tasks SET deleted_at=NULL WHERE id=$1', [tid]);
    }
    // Liegt die Oberaufgabe noch im Papierkorb, stünde sie sonst unsichtbar
    // unter ihr; so kommt sie oben in die Liste.
    if (row.parent_trashed) await db.execute('UPDATE tasks SET parent_task_id=NULL WHERE id=$1', [id]);
    set({ tasks: await selectAllTasks(db), links: await selectLiveLinks(db) });
  },

  permanentlyDeleteTask: async (id: string) => {
    const db = await getDb();
    const [row] = await db.select<{ deleted_at: string | null }[]>('SELECT deleted_at FROM tasks WHERE id=$1', [id]);
    // Aus dem Papierkorb: alle Unteraufgaben darin mit, auch die, die schon
    // vorher für sich gingen — ohne ihre Oberaufgabe wären sie Wurzeln.
    const idsToDelete = row?.deleted_at
      ? await selectTrashedSubtree(db, id)
      : collectDescendantIds(get().tasks, id);

    for (const tid of idsToDelete) {
      await db.execute('DELETE FROM task_links WHERE task_id=$1 OR target_id=$1', [tid]);
      await db.execute('DELETE FROM tasks WHERE id=$1', [tid]);
    }
    set((s) => ({
      tasks: s.tasks.filter((t) => !idsToDelete.includes(t.id)),
      links: s.links.filter((l) => !idsToDelete.includes(l.task_id) && !idsToDelete.includes(l.target_id)),
    }));
  },

  getSubtasks: (parentId: string) => get().tasks.filter((t) => t.parent_task_id === parentId),

  addLink: async (taskId: string, targetId: string, targetType: ContentType) => {
    // Schon verknüpft: nichts zu tun (die Tabelle hält jede Verknüpfung nur einmal).
    if (get().links.some((l) => l.task_id === taskId && l.target_id === targetId && l.target_type === targetType)) return;
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
}));
