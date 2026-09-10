/**
 * Die eigenen Blöcke der Blöcke-Ansicht (Tabelle `block_definitions`, seit
 * v39). Eine Definition ist nur die Vorlage — eingefügte Blöcke sind Kopien im
 * Inhalt ihres Eintrags (siehe `lib/blocks/definitions.ts`). Löschen,
 * Wiederherstellen und Umbenennen berühren deshalb keinen Eintrag; was mit den
 * Kopien geschieht, entscheidet `blockCopies.ts` ausdrücklich.
 *
 * Import-Regel wie `categoryStore`: keine Inhalts-Stores, alle Zugriffe über
 * `getState()` zur Laufzeit.
 */
import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb } from '../lib/db';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, type DbRow } from '../lib/row';
import { serialized, serialKey } from '../lib/serialize';
import {
  DEFAULT_DEFINITION_DISPLAY, DEFAULT_DEFINITION_ICON, sameShape, type BlockDefinition,
} from '../lib/blocks/definitions';

export type BlockDefinitionPatch = Partial<Pick<BlockDefinition, 'name' | 'icon' | 'description' | 'elements' | 'display'>>;

interface BlockDefinitionState {
  /** Aktive Definitionen in Anzeigereihenfolge. */
  definitions: BlockDefinition[];

  fetchDefinitions: () => Promise<void>;
  createDefinition: (name: string) => Promise<BlockDefinition>;
  /** Hebt die Revision, sobald sich etwas ändert, das die Kopien betrifft (Name, Icon, Elemente, Anzeige). */
  updateDefinition: (id: string, patch: BlockDefinitionPatch) => Promise<void>;
  /** Soft-Delete. Kopien in Einträgen bleiben unberührt. */
  deleteDefinition: (id: string) => Promise<void>;
  restoreDefinition: (id: string) => Promise<void>;
  permanentlyDeleteDefinition: (id: string) => Promise<void>;
  /**
   * `.emerald`-Import: Definitionen, die hier fehlen, mit ihrer ID anlegen —
   * dann erkennen die mitgebrachten Kopien ihre Herkunft wieder. Eine
   * vorhandene (auch im Papierkorb) bleibt, wie sie ist.
   */
  importDefinitions: (defs: readonly BlockDefinition[]) => Promise<void>;
}

async function selectActive(db: Database): Promise<BlockDefinition[]> {
  const rows = await db.select<DbRow[]>(
    'SELECT * FROM block_definitions WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
  );
  return rows.map(fromRow.blockDefinition);
}

async function nextSortOrder(db: Database): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM block_definitions');
  return rows[0]?.n ?? 0;
}

async function insertDefinition(db: Database, def: BlockDefinition): Promise<void> {
  await db.execute(
    `INSERT INTO block_definitions
       (id, name, icon, description, elements, display, revision, sort_order, created_at, updated_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      def.id, def.name, def.icon, def.description, JSON.stringify(def.elements), JSON.stringify(def.display),
      def.revision, def.sort_order, def.created_at, def.updated_at, def.deleted_at,
    ]
  );
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
      description: '',
      elements: [],
      display: DEFAULT_DEFINITION_DISPLAY,
      revision: 1,
      sort_order: await nextSortOrder(db),
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    await insertDefinition(db, def);
    set((s) => ({ definitions: [...s.definitions, def] }));
    return def;
  },

  // serialized: siehe lib/serialize.ts — zwei schnelle Speichervorgänge
  // sollen die Revision zweimal heben, nicht beide von derselben aus.
  updateDefinition: (id, patch) => serialized(serialKey('blockDefinition', id), async () => {
    const current = get().definitions.find((d) => d.id === id);
    if (!current) return;
    const merged: BlockDefinition = { ...current, ...patch, name: (patch.name ?? current.name).trim() };
    const updated: BlockDefinition = {
      ...merged,
      revision: sameShape(current, merged) ? current.revision : current.revision + 1,
      updated_at: nowIso(),
    };
    const db = await getDb();
    await db.execute(
      `UPDATE block_definitions
          SET name=$1, icon=$2, description=$3, elements=$4, display=$5, revision=$6, updated_at=$7
        WHERE id=$8`,
      [
        updated.name, updated.icon, updated.description, JSON.stringify(updated.elements),
        JSON.stringify(updated.display), updated.revision, updated.updated_at, id,
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
    // Ans Ende der Liste: der alte Platz ist inzwischen womöglich vergeben.
    await db.execute(
      'UPDATE block_definitions SET deleted_at=NULL, sort_order=$1 WHERE id=$2',
      [await nextSortOrder(db), id]
    );
    set({ definitions: await selectActive(db) });
  },

  permanentlyDeleteDefinition: async (id) => {
    const db = await getDb();
    // Nur aus dem Papierkorb erreichbar — in `definitions` (aktive) steht sie nicht.
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
