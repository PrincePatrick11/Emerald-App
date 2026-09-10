import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from '../lib/db';
import { syncLinks } from '../lib/links';
import { generateId, nowIso } from '../lib/helpers';
import { serialKey, serialized } from '../lib/serialize';
import { fromRow, type DbRow } from '../lib/row';
import { serializeBlocks } from '../lib/blocks/blockHtml';
import { defaultBlocksFor } from '../lib/blocks/layouts';
import { withChargeUnloaded } from '../lib/blocks/sigil';
import type { Operation } from '../types';
import i18n from '../i18n';

interface OperationState {
  operations: Operation[];

  fetchAll: () => Promise<void>;
  createOperation: (categoryId: string) => Promise<Operation>;
  duplicateOperation: (id: string) => Promise<Operation | undefined>;
  updateOperation: (id: string, patch: Partial<Operation>) => Promise<void>;
  deleteOperation: (id: string) => Promise<void>;
  restoreOperation: (id: string) => Promise<void>;
  permanentlyDeleteOperation: (id: string) => Promise<void>;
  getOperation: (id: string) => Operation | undefined;
}

/**
 * Die Spalten, die die App liest und schreibt. Status/Enddatum/Version (v40)
 * und alles, was die Sigille ausmachte — Absicht, Buchstaben, Zeichnung,
 * Ladung, Notizen (v41) —, sind Blöcke im Inhalt. Die Spalten stehen noch im
 * Schema, für ältere Backups.
 */
const OPERATION_COLUMNS = 'id, title, content, category_id, entry_number, icon, cover_image, tags, created_at, updated_at, deleted_at';

async function selectAllOperations(db: Database): Promise<Operation[]> {
  const rows = await db.select<DbRow[]>(
    `SELECT ${OPERATION_COLUMNS} FROM operations WHERE deleted_at IS NULL ORDER BY updated_at DESC`
  );
  return rows.map(fromRow.operation);
}

export const useOperationStore = create<OperationState>((set, get) => ({
  operations: [],

  fetchAll: async () => {
    const db = await getDb();
    set({ operations: await selectAllOperations(db) });
  },

  createOperation: async (categoryId) => {
    const db = await getDb();
    const now = nowIso();
    const op: Operation = {
      entry_number: await nextEntryNumber(db, 'operations'),
      id: generateId(),
      title: 'Untitled Operation',
      // Die Kategorie „Sigillen" beginnt mit Rechner, Zeichnung und Ladung.
      content: serializeBlocks(defaultBlocksFor('operation', categoryId)),
      category_id: categoryId, created_at: now, updated_at: now, tags: [], deleted_at: null,
    };
    await db.execute(
      `INSERT INTO operations (id, title, content, category_id, created_at, updated_at, tags, entry_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [op.id, op.title, op.content, op.category_id, op.created_at, op.updated_at, JSON.stringify(op.tags), op.entry_number ?? null]
    );
    set((s) => ({ operations: [op, ...s.operations] }));
    return op;
  },

  /**
   * Kopiert alle Inhaltsfelder. Eine geladene Sigille kommt entladen mit:
   * eine Kopie, die man nie bearbeiten kann, wäre sinnlos — das
   * Enthüllungsdatum bleibt.
   */
  duplicateOperation: async (id) => {
    const src = get().operations.find((o) => o.id === id);
    if (!src) return undefined;
    const copy = await get().createOperation(src.category_id);
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      deleted_at: _deleted,
      entry_number: _number,
      ...fields
    } = src;
    await get().updateOperation(copy.id, {
      ...fields,
      title: src.title + i18n.t('common.copySuffix'),
      content: withChargeUnloaded(src.content),
    });
    return get().operations.find((o) => o.id === copy.id) ?? copy;
  },

  // serialized: siehe lib/serialize.ts.
  updateOperation: (id, patch) => serialized(serialKey('operation', id), async () => {
    const db = await getDb();
    const now = nowIso();
    const op = get().operations.find((o) => o.id === id);
    if (!op) return;
    const merged = { ...op, ...patch, updated_at: now };
    // Die $N-Platzhalter MUESSEN in Textreihenfolge aufsteigen: SQLite vergibt
    // die Bind-Indizes nach dem ersten Auftreten, nicht nach der Ziffer, und
    // tauri-plugin-sql bindet rein positionell.
    await db.execute(
      `UPDATE operations SET
        title=$1, content=$2, category_id=$3, updated_at=$4, tags=$5, icon=$6, cover_image=$7
       WHERE id=$8`,
      [
        merged.title, merged.content, merged.category_id, merged.updated_at, JSON.stringify(merged.tags),
        merged.icon ?? null, merged.cover_image ?? null,
        id,
      ]
    );
    set((s) => ({
      operations: s.operations.map((o) => (o.id === id ? { ...o, ...patch, updated_at: now } : o)),
    }));
    // Eigener Schlüssel statt awaiten — wie in journalStore.updateEntry.
    void serialized(serialKey('links', id), () => syncLinks(id, 'operation', merged.content));
  }),

  deleteOperation: async (id) => {
    const db = await getDb();
    const now = nowIso();
    await db.execute('UPDATE operations SET deleted_at=$1 WHERE id=$2', [now, id]);
    await db.execute('DELETE FROM links WHERE source_id=$1 OR target_id=$1', [id]);
    set((s) => ({ operations: s.operations.filter((o) => o.id !== id) }));
  },

  restoreOperation: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE operations SET deleted_at=NULL WHERE id=$1', [id]);
    set({ operations: await selectAllOperations(db) });
  },

  permanentlyDeleteOperation: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM operations WHERE id=$1', [id]);
  },

  getOperation: (id) => get().operations.find((o) => o.id === id),
}));
