import { create } from 'zustand';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import type { Routine } from '../types';

interface RoutineState {
  routines: Routine[];
  fetchRoutines: () => Promise<void>;
  createRoutine: (name: string, emoji: string, content: string, tags: string[], operation_ids: string[], wiki_ids: string[]) => Promise<Routine>;
  updateRoutine: (id: string, patch: Partial<Pick<Routine, 'name' | 'emoji' | 'content' | 'tags' | 'operation_ids' | 'wiki_ids'>>) => Promise<void>;
  deleteRoutine: (id: string) => Promise<void>;
  restoreRoutine: (routine: Routine) => Promise<void>;
}

export const useRoutineStore = create<RoutineState>((set, get) => ({
  routines: [],

  fetchRoutines: async () => {
    const db = await getDb();
    const rows = await db.select<DbRow[]>('SELECT * FROM routines ORDER BY created_at DESC');
    set({ routines: rows.map(fromRow.routine) });
  },

  createRoutine: async (name, emoji, content, tags, operation_ids, wiki_ids) => {
    const db = await getDb();
    const now = nowIso();
    const routine: Routine = { id: generateId(), name, emoji, content, tags, operation_ids, wiki_ids, created_at: now, updated_at: now };
    await db.execute(
      `INSERT INTO routines (id, name, emoji, content, tags, operation_ids, wiki_ids, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [routine.id, routine.name, routine.emoji, routine.content, JSON.stringify(routine.tags), JSON.stringify(routine.operation_ids), JSON.stringify(routine.wiki_ids), routine.created_at, routine.updated_at]
    );
    set((s) => ({ routines: [routine, ...s.routines] }));
    return routine;
  },

  updateRoutine: async (id, patch) => {
    const db = await getDb();
    const now = nowIso();
    const routine = get().routines.find((r) => r.id === id);
    if (!routine) return;
    const merged = { ...routine, ...patch, updated_at: now };
    await db.execute(
      `UPDATE routines SET name=$1, emoji=$2, content=$3, tags=$4, operation_ids=$5, wiki_ids=$6, updated_at=$7 WHERE id=$8`,
      [merged.name, merged.emoji, merged.content, JSON.stringify(merged.tags), JSON.stringify(merged.operation_ids), JSON.stringify(merged.wiki_ids), merged.updated_at, id]
    );
    set((s) => ({ routines: s.routines.map((r) => r.id === id ? merged : r) }));
  },

  deleteRoutine: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM routines WHERE id=$1', [id]);
    set((s) => ({ routines: s.routines.filter((r) => r.id !== id) }));
  },

  restoreRoutine: async (routine) => {
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO routines (id, name, emoji, content, tags, operation_ids, wiki_ids, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [routine.id, routine.name, routine.emoji, routine.content, JSON.stringify(routine.tags), JSON.stringify(routine.operation_ids), JSON.stringify(routine.wiki_ids), routine.created_at, routine.updated_at]
    );
    set((s) => ({ routines: [routine, ...s.routines.filter((r) => r.id !== routine.id)] }));
  },
}));
