import { create } from 'zustand';
import type Database from '../lib/sqlite';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { serialKey, serialized } from '../lib/serialize';
import { fromRow, toInt, type DbRow } from '../lib/row';
import type { LinkTargetKind, Task, TaskLink } from '../types';

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

  addLink: (taskId: string, targetId: string, targetType: LinkTargetKind) => Promise<void>;
  removeLink: (id: string) => Promise<void>;
}

async function selectAllTasks(db: Database): Promise<Task[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY created_at DESC'
  );
  return rows.map(fromRow.task);
}

/** The links of the tasks outside the trash — those in the trash keep theirs for the way back. */
async function selectLiveLinks(db: Database): Promise<TaskLink[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM task_links WHERE task_id IN (SELECT id FROM tasks WHERE deleted_at IS NULL)'
  );
  return rows.map(fromRow.taskLink);
}

/**
 * The tasks in the trash that went on their own — a subtask with the
 * stamp of its parent task belongs to that one (`deleteTask`) and comes back
 * with it (`restoreTask`). For the trash list.
 */
export async function selectTrashedTaskRoots(db: Database): Promise<{ id: string; title: string; deleted_at: string }[]> {
  return db.select(
    `SELECT t.id, t.title, t.deleted_at FROM tasks t
      WHERE t.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_task_id AND p.deleted_at = t.deleted_at)`
  );
}

/**
 * `id` and its subtasks in the trash, from the database instead of from the
 * store, which knows only the active ones. With `trashedWith` only those that
 * arrived there with this stamp — i.e. with it, not earlier on their own.
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
      // Empty — "Unnamed task" is shown (`displayTitle`).
      id, title: '', category_id: categoryId,
      priority: 'medium', completed: false,
      parent_task_id: parentTaskId, created_at: now, updated_at: now,
      deleted_at: null,
    };

    set((s) => ({ tasks: [newTask, ...s.tasks] }));
    return newTask;
  },

  // serialized: see lib/serialize.ts. Same key as toggleComplete —
  // updateTask writes the whole row from a snapshot merge, toggleComplete
  // reads the state before flipping; overlapping, one would overwrite the other.
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
   * Toggles `id` and brings the subtasks to the same state. "Last
   * modified" jumps only on the ticked task; on the subtasks it is
   * a consequence (`lib/stamp.ts`), and any that already had that state are not written.
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
      // Descendants through their own chain, so that a simultaneous updateTask
      // on a child does not revert its completed column. The root
      // itself already runs under this key — queueing would wait on itself.
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

    // One stamp for all: `restoreTask` uses it to recognise what went together.
    await db.batch(idsToDelete.map((tid) => ['UPDATE tasks SET deleted_at=$1 WHERE id=$2', [now, tid]] as const));
    // The links stay in the database, for the way back; they are cleared
    // permanently by permanentlyDeleteTask, emptying the trash and — via
    // ON DELETE CASCADE — `runPeriodicCleanup`.
    set((s) => ({
      tasks: s.tasks.filter((t) => !idsToDelete.includes(t.id)),
      links: s.links.filter((l) => !idsToDelete.includes(l.task_id)),
    }));
  },

  restoreTask: async (id: string) => {
    const db = await getDb();
    const [row] = await db.select<{ deleted_at: string | null }[]>('SELECT deleted_at FROM tasks WHERE id=$1', [id]);
    // Already back — via its parent task or a second undo.
    if (!row?.deleted_at) return;
    // Along with the subtasks that went with it.
    const subtree = await selectTrashedSubtree(db, id, row.deleted_at);
    await db.batch([
      ...subtree.map((tid) => ['UPDATE tasks SET deleted_at=NULL WHERE id=$1', [tid]] as const),
      // If the parent task is still in the trash, the task moves up —
      // under an invisible parent task it would itself stay invisible.
      ['UPDATE tasks SET parent_task_id=NULL WHERE id=$1 AND parent_task_id IN (SELECT id FROM tasks WHERE deleted_at IS NOT NULL)', [id]],
    ]);
    set({ tasks: await selectAllTasks(db), links: await selectLiveLinks(db) });
  },

  permanentlyDeleteTask: async (id: string) => {
    const db = await getDb();
    // Only from the trash: all subtasks in it go too, including those that
    // went on their own earlier — without their parent task they would be roots.
    const idsToDelete = await selectTrashedSubtree(db, id);

    await db.batch(idsToDelete.flatMap((tid) => [
      ['DELETE FROM task_links WHERE task_id=$1 OR target_id=$1', [tid]] as const,
      ['DELETE FROM tasks WHERE id=$1', [tid]] as const,
    ]));
    set((s) => ({
      tasks: s.tasks.filter((t) => !idsToDelete.includes(t.id)),
      links: s.links.filter((l) => !idsToDelete.includes(l.task_id) && !idsToDelete.includes(l.target_id)),
    }));
  },

  getSubtasks: (parentId: string) => get().tasks.filter((t) => t.parent_task_id === parentId),

  addLink: async (taskId: string, targetId: string, targetType: LinkTargetKind) => {
    // Already linked: nothing to do (the table holds each link only once).
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
