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
    'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY created_at DESC'
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
 * Die Aufgaben im Papierkorb, die für sich gingen — eine Unteraufgabe mit dem
 * Stempel ihrer Oberaufgabe gehört zu dieser (`deleteTask`) und kommt mit ihr
 * zurück (`restoreTask`). Für die Liste des Papierkorbs.
 */
export async function selectTrashedTaskRoots(db: Database): Promise<{ id: string; title: string; deleted_at: string }[]> {
  return db.select(
    `SELECT t.id, t.title, t.deleted_at FROM tasks t
      WHERE t.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_task_id AND p.deleted_at = t.deleted_at)`
  );
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
       -- UNION statt UNION ALL: ein Kreis A → B → A (aus einem kaputten Backup) endet so.
       UNION
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
      `INSERT INTO tasks (id, title, category_id, priority, completed, parent_task_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, '', categoryId, 'medium', 0, parentTaskId, now, now]
    );

    const newTask: Task = {
      // Leer — angezeigt wird „Unbenannte Aufgabe" (`displayTitle`).
      id, title: '', category_id: categoryId,
      priority: 'medium', completed: false,
      parent_task_id: parentTaskId, created_at: now, updated_at: now,
      deleted_at: null,
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
        completed=$4, parent_task_id=$5, updated_at=$6
       WHERE id=$7`,
      [
        merged.title, merged.category_id, merged.priority,
        toInt(merged.completed), merged.parent_task_id ?? null,
        merged.updated_at, id,
      ]
    );

    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? merged : t)) }));
  }),

  /**
   * Kippt `id` und bringt die Unteraufgaben auf denselben Stand. „Zuletzt
   * geändert" springt nur an der abgehakten Aufgabe; an den Unteraufgaben ist
   * es eine Folge (`lib/stamp.ts`), und wer schon so stand, wird nicht geschrieben.
   */
  toggleComplete: (id: string) => serialized(serialKey('task', id), async () => {
    const db = await getDb();
    const now = nowIso();
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;

    const newCompleted = !task.completed;
    const subtree = new Set(collectDescendantIds(get().tasks, id));
    const changed = get().tasks.filter((t) => subtree.has(t.id) && (t.id === id || t.completed !== newCompleted));
    const stamps = new Map(changed.map((t) => [t.id, t.id === id ? now : t.updated_at]));

    for (const t of changed) {
      const write = () => db.execute(
        'UPDATE tasks SET completed=$1, updated_at=$2 WHERE id=$3',
        [toInt(newCompleted), stamps.get(t.id), t.id]
      );
      // Nachfahren über deren eigene Kette, damit ein gleichzeitiges updateTask
      // auf ein Kind dessen completed-Spalte nicht zurückdreht. Die Wurzel
      // selbst läuft schon unter diesem Schlüssel — einreihen wartete auf sich.
      if (t.id === id) await write();
      else await serialized(serialKey('task', t.id), write);
    }

    set((s) => ({
      tasks: s.tasks.map((t) => {
        const updated_at = stamps.get(t.id);
        return updated_at ? { ...t, completed: newCompleted, updated_at } : t;
      }),
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
    // räumen sie permanentlyDeleteTask, das Leeren des Papierkorbs und — per
    // ON DELETE CASCADE — `runPeriodicCleanup` ab.
    set((s) => ({
      tasks: s.tasks.filter((t) => !idsToDelete.includes(t.id)),
      links: s.links.filter((l) => !idsToDelete.includes(l.task_id)),
    }));
  },

  restoreTask: async (id: string) => {
    const db = await getDb();
    const [row] = await db.select<{ deleted_at: string | null }[]>('SELECT deleted_at FROM tasks WHERE id=$1', [id]);
    // Schon zurück — über ihre Oberaufgabe oder ein zweites Rückgängig.
    if (!row?.deleted_at) return;
    // Mit den Unteraufgaben, die mit ihr gingen.
    for (const tid of await selectTrashedSubtree(db, id, row.deleted_at)) {
      await db.execute('UPDATE tasks SET deleted_at=NULL WHERE id=$1', [tid]);
    }
    // Liegt die Oberaufgabe noch im Papierkorb, rückt die Aufgabe nach oben —
    // unter einer unsichtbaren Oberaufgabe bliebe sie selbst unsichtbar.
    await db.execute(
      'UPDATE tasks SET parent_task_id=NULL WHERE id=$1 AND parent_task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)',
      [id]
    );
    set({ tasks: await selectAllTasks(db), links: await selectLiveLinks(db) });
  },

  permanentlyDeleteTask: async (id: string) => {
    const db = await getDb();
    // Nur aus dem Papierkorb: alle Unteraufgaben darin mit, auch die, die
    // schon vorher für sich gingen — ohne ihre Oberaufgabe wären sie Wurzeln.
    const idsToDelete = await selectTrashedSubtree(db, id);

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
