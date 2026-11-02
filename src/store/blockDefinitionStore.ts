/**
 * The custom blocks of the blocks view (table `block_definitions`, since
 * v40). A definition is only the template — inserted blocks are copies in the
 * content of their entry (see `lib/blocks/definitions.ts`). Deleting,
 * restoring and changing therefore touch no entry.
 *
 * Import rule as in `categoryStore`: no content stores, all access via
 * `getState()` at runtime.
 */
import { create } from 'zustand';
import type Database from '../lib/sqlite';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { needsWrite, stampFor } from '../lib/stamp';
import { fromRow, type DbRow } from '../lib/row';
import { serialized, serialKey } from '../lib/serialize';
import {
  insertDefinitionRow as insertDefinition, nextDefinitionSortOrder as nextSortOrder,
} from '../lib/blockDefinitionRows';
import {
  DEFAULT_DEFINITION_DISPLAY, DEFAULT_DEFINITION_ICON, type BlockDefinition,
} from '../lib/blocks/definitions';

export type BlockDefinitionPatch = Partial<Pick<BlockDefinition, 'name' | 'icon' | 'elements' | 'display'>>;

interface BlockDefinitionState {
  /** Active definitions in display order. */
  definitions: BlockDefinition[];

  fetchDefinitions: () => Promise<void>;
  createDefinition: (name: string) => Promise<BlockDefinition>;
  updateDefinition: (id: string, patch: BlockDefinitionPatch) => Promise<void>;
  /** Soft delete. Copies in entries stay untouched. */
  deleteDefinition: (id: string) => Promise<void>;
  restoreDefinition: (id: string) => Promise<void>;
  permanentlyDeleteDefinition: (id: string) => Promise<void>;
  /**
   * `.emerald` import: create definitions that are missing here with their ID.
   * An existing one (even in the trash) stays as it is.
   */
  importDefinitions: (defs: readonly BlockDefinition[]) => Promise<void>;
}

async function selectActive(db: Database): Promise<BlockDefinition[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM block_definitions WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  );
  return rows.map(fromRow.blockDefinition);
}


export const useBlockDefinitionStore = create<BlockDefinitionState>((set, get) => ({
  definitions: [],

  fetchDefinitions: async () => {
    const db = await getDb();
    set({ definitions: await selectActive(db) });
  },

  createDefinition: async (name) => {
    const db = await getDb();
    const now = nowIso();
    const def: BlockDefinition = {
      id: generateId(),
      name: name.trim(),
      icon: DEFAULT_DEFINITION_ICON,
      elements: [],
      display: DEFAULT_DEFINITION_DISPLAY,
      sort_order: await nextSortOrder(db),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await insertDefinition(db, def);
    set((s) => ({ definitions: [...s.definitions, def] }));
    return def;
  },

  // serialized: see lib/serialize.ts.
  updateDefinition: (id, patch) => serialized(serialKey('blockDefinition', id), async () => {
    const current = get().definitions.find((d) => d.id === id);
    if (!current || !needsWrite(current, patch)) return;
    const updated: BlockDefinition = {
      ...current,
      ...patch,
      name: (patch.name ?? current.name).trim(),
      updated_at: stampFor(current.updated_at),
    };
    const db = await getDb();
    await db.execute(
      `UPDATE block_definitions
          SET name=$1, icon=$2, elements=$3, display=$4, updated_at=$5
        WHERE id=$6`,
      [
        updated.name, updated.icon, JSON.stringify(updated.elements),
        JSON.stringify(updated.display), updated.updated_at, id,
      ]
    );
    set((s) => ({ definitions: s.definitions.map((d) => (d.id === id ? updated : d)) }));
  }),

  deleteDefinition: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE block_definitions SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ definitions: s.definitions.filter((d) => d.id !== id) }));
  },

  restoreDefinition: async (id) => {
    const db = await getDb();
    // To the end of the list: the old slot may have been taken in the meantime.
    await db.execute(
      'UPDATE block_definitions SET deleted_at=NULL, sort_order=$1 WHERE id=$2',
      [await nextSortOrder(db), id]
    );
    set({ definitions: await selectActive(db) });
  },

  permanentlyDeleteDefinition: async (id) => {
    const db = await getDb();
    // Reachable only from the trash — it is not in `definitions` (active).
    await db.execute('DELETE FROM block_definitions WHERE id=$1', [id]);
  },

  importDefinitions: async (defs) => {
    if (!defs.length) return;
    const db = await getDb();
    const known = new Set((await db.select<{ id: string }[]>('SELECT id FROM block_definitions')).map((r) => r.id));
    let sortOrder = await nextSortOrder(db);
    let added = 0;
    for (const def of defs) {
      if (known.has(def.id)) continue;
      await insertDefinition(db, { ...def, sort_order: sortOrder++, deleted_at: null });
      known.add(def.id);
      added++;
    }
    if (added) set({ definitions: await selectActive(db) });
  },
}));
