import { create } from 'zustand';
import type Database from '@tauri-apps/plugin-sql';
import { getDb, nextEntryNumber } from '../lib/db';
import { FALLBACK_CATEGORY, reassignCategoryContent } from '../lib/schema';
import { syncLinks } from '../lib/links';
import { generateId, nowIso } from '../lib/helpers';
import { fromRow, toInt, type DbRow } from '../lib/row';
import type { Operation, OperationCategory } from '../types';
import i18n from '../i18n';

interface OperationState {
  categories: OperationCategory[];
  operations: Operation[];

  fetchAll: () => Promise<void>;
  createOperation: (categoryId: string) => Promise<Operation>;
  duplicateOperation: (id: string) => Promise<Operation | undefined>;
  updateOperation: (id: string, patch: Partial<Operation>) => Promise<void>;
  deleteOperation: (id: string) => Promise<void>;
  restoreOperation: (id: string) => Promise<void>;
  permanentlyDeleteOperation: (id: string) => Promise<void>;
  getOperation: (id: string) => Operation | undefined;
  ensureDrawingLoaded: (id: string) => Promise<void>;
  addCategory: (name: string, emoji: string) => Promise<OperationCategory>;
  updateCategory: (id: string, name: string, emoji: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<boolean>;
  restoreCategory: (id: string) => Promise<void>;
  permanentlyDeleteCategory: (id: string) => Promise<void>;
}

/**
 * Alle Spalten AUSSER drawing_data — das sind die vollen Sigil-Zeichnungen als
 * Base64, mit Abstand die groesste Spalte der Tabelle. Listen und Dashboard
 * brauchen nur thumbnail_data; die Zeichnung laedt `ensureDrawingLoaded` erst,
 * wenn der Sigil-Editor sie oeffnet. Im Store heisst `drawing_data: undefined`
 * daher "noch nicht geladen", `null` "hat keine Zeichnung".
 */
const OPERATION_LIST_COLUMNS =
  'id, title, content, category_id, entry_number, description, icon, cover_image, version, ' +
  'is_active, end_date, target_reveal_date, charging_technique_wiki_id, is_loaded, ' +
  'intention_text, letter_bank, implemented_letters, show_intention_in_properties, ' +
  'show_letter_bank_in_properties, show_sigil, thumbnail_data, tags, created_at, updated_at, deleted_at';

async function selectAllOperations(db: Database): Promise<Operation[]> {
  const rows = await db.select<DbRow[]>(
    `SELECT ${OPERATION_LIST_COLUMNS} FROM operations WHERE deleted_at IS NULL ORDER BY updated_at DESC`
  );
  return rows.map(fromRow.operation);
}

/**
 * Ein Refetch liefert alle Zeichnungen als "nicht geladen" zurueck. Bereits
 * geladene bleiben erhalten — sonst wuerde ein Import oder Undo-Restore den
 * offenen Sigil-Editor unmounten und ungespeicherte Striche verwerfen.
 */
function preserveLoadedDrawings(prev: Operation[], fresh: Operation[]): Operation[] {
  const loaded = new Map(
    prev.filter((o) => o.drawing_data !== undefined).map((o) => [o.id, o.drawing_data])
  );
  return fresh.map((o) => (loaded.has(o.id) ? { ...o, drawing_data: loaded.get(o.id) } : o));
}

export const useOperationStore = create<OperationState>((set, get) => ({
  categories: [],
  operations: [],

  fetchAll: async () => {
    const db = await getDb();
    // is_builtin kam hier früher ohne Umwandlung durch und lag als 0/1 im
    // State, obwohl als boolean deklariert — deshalb musste deleteCategory den
    // Wert an der Verzweigung zu number zurückcasten.
    const categoryRows = await db.select<DbRow[]>(
      'SELECT * FROM operation_categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'
    );
    const fresh = await selectAllOperations(db);
    set((s) => ({
      categories: categoryRows.map(fromRow.category),
      operations: preserveLoadedDrawings(s.operations, fresh),
    }));
  },

  createOperation: async (categoryId) => {
    const db = await getDb();
    const now = nowIso();
    const op: Operation = {
      entry_number: await nextEntryNumber(db, 'operations'),
      id: generateId(), title: 'Untitled Operation', content: '',
      category_id: categoryId, created_at: now, updated_at: now, tags: [], deleted_at: null,
      is_active: true, end_date: null, version: null,
      description: '',
      target_reveal_date: null,
      charging_technique_wiki_id: null,
      is_loaded: false,
      intention_text: '',
      letter_bank: [],
      implemented_letters: [],
      show_intention_in_properties: true,
      show_letter_bank_in_properties: true,
      show_sigil: true,
      drawing_data: null,
      thumbnail_data: null,
    };
    await db.execute(
      `INSERT INTO operations (
        id, title, content, category_id, created_at, updated_at, tags, is_active, description,
        target_reveal_date, charging_technique_wiki_id, is_loaded, intention_text, letter_bank,
        implemented_letters, show_intention_in_properties, show_letter_bank_in_properties,
        show_sigil, drawing_data, thumbnail_data, entry_number
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        op.id, op.title, op.content, op.category_id, op.created_at, op.updated_at, JSON.stringify(op.tags), 1,
        op.description, op.target_reveal_date, op.charging_technique_wiki_id, 0, op.intention_text,
        JSON.stringify(op.letter_bank), JSON.stringify(op.implemented_letters),
        1, 1, 1, op.drawing_data, op.thumbnail_data, op.entry_number ?? null,
      ]
    );
    set((s) => ({ operations: [op, ...s.operations] }));
    return op;
  },

  /**
   * Kopiert alle Inhaltsfelder — auch die Sigil-Felder samt Zeichnung, die
   * dafuer zuerst nachgeladen wird. Die drei Aufrufer zaehlten die Felder
   * frueher jeweils selbst auf, mit drei verschiedenen (und allesamt
   * unvollstaendigen) Listen; Sigil-Zeichnungen gingen dabei immer verloren.
   */
  duplicateOperation: async (id) => {
    await get().ensureDrawingLoaded(id);
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
    // is_loaded wird bewusst NICHT uebernommen: eine "geladene" Sigil-
    // Operation ist gesperrt und ihr Sigil versiegelt — eine Kopie, die man
    // nie bearbeiten kann, waere sinnlos. target_reveal_date bleibt erhalten.
    await get().updateOperation(copy.id, {
      ...fields,
      title: src.title + i18n.t('common.copySuffix'),
      is_loaded: false,
    });
    return get().operations.find((o) => o.id === copy.id) ?? copy;
  },

  updateOperation: async (id, patch) => {
    const db = await getDb();
    const now = nowIso();
    const op = get().operations.find((o) => o.id === id);
    if (!op) return;
    const merged = { ...op, ...patch, updated_at: now };
    // drawing_data wird nur mitgeschrieben, wenn es geladen ist oder im Patch
    // steckt — sonst wuerde ein Rename aus der Sidebar den `undefined`-Platz-
    // halter als NULL persistieren und die Zeichnung loeschen.
    //
    // Die $N-Platzhalter MUESSEN in Textreihenfolge aufsteigen: SQLite vergibt
    // die Bind-Indizes nach dem ersten Auftreten, nicht nach der Ziffer, und
    // tauri-plugin-sql bindet rein positionell. Ein $23 vor dem $22 wuerde
    // id und drawing_data vertauschen und das UPDATE traefe keine Zeile.
    const writeDrawing = merged.drawing_data !== undefined;
    await db.execute(
      `UPDATE operations SET
        title=$1, content=$2, category_id=$3, updated_at=$4, tags=$5, is_active=$6, end_date=$7, version=$8,
        icon=$9, cover_image=$10, description=$11, target_reveal_date=$12, charging_technique_wiki_id=$13,
        is_loaded=$14, intention_text=$15, letter_bank=$16, implemented_letters=$17,
        show_intention_in_properties=$18, show_letter_bank_in_properties=$19, show_sigil=$20,
        thumbnail_data=$21${writeDrawing ? ', drawing_data=$22' : ''}
       WHERE id=${writeDrawing ? '$23' : '$22'}`,
      [
        merged.title, merged.content, merged.category_id, merged.updated_at, JSON.stringify(merged.tags),
        toInt(merged.is_active, true), merged.end_date ?? null, merged.version ?? null,
        merged.icon ?? null, merged.cover_image ?? null, merged.description ?? '',
        merged.target_reveal_date ?? null, merged.charging_technique_wiki_id ?? null,
        toInt(merged.is_loaded), merged.intention_text ?? '',
        JSON.stringify(merged.letter_bank ?? []), JSON.stringify(merged.implemented_letters ?? []),
        toInt(merged.show_intention_in_properties, true),
        toInt(merged.show_letter_bank_in_properties, true),
        toInt(merged.show_sigil, true),
        merged.thumbnail_data ?? null,
        ...(writeDrawing ? [merged.drawing_data] : []),
        id,
      ]
    );
    // Aus dem aktuellen State mergen, nicht `merged` einsetzen: zwischen dem
    // Snapshot oben und diesem set() kann ensureDrawingLoaded gelaufen sein,
    // und `merged` truege dann noch drawing_data: undefined.
    set((s) => ({
      operations: s.operations.map((o) => (o.id === id ? { ...o, ...patch, updated_at: now } : o)),
    }));
    syncLinks(id, 'operation', merged.content).catch(console.error);
  },

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
    const fresh = await selectAllOperations(db);
    set((s) => ({ operations: preserveLoadedDrawings(s.operations, fresh) }));
  },

  permanentlyDeleteOperation: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM operations WHERE id=$1', [id]);
  },

  getOperation: (id) => get().operations.find((o) => o.id === id),

  ensureDrawingLoaded: async (id) => {
    const op = get().operations.find((o) => o.id === id);
    if (!op || op.drawing_data !== undefined) return;
    const db = await getDb();
    const rows = await db.select<DbRow[]>('SELECT drawing_data FROM operations WHERE id=$1', [id]);
    const value = rows[0]?.drawing_data == null ? null : String(rows[0].drawing_data);
    set((s) => ({
      operations: s.operations.map((o) =>
        o.id === id && o.drawing_data === undefined ? { ...o, drawing_data: value } : o
      ),
    }));
  },

  addCategory: async (name, emoji) => {
    const db = await getDb();
    const cat: OperationCategory = {
      id: generateId(), name, emoji, sort_order: 99, is_builtin: false,
    };
    await db.execute(
      `INSERT INTO operation_categories (id, name, emoji, sort_order, is_builtin) VALUES ($1,$2,$3,$4,$5)`,
      [cat.id, cat.name, cat.emoji, cat.sort_order, 0]
    );
    set((s) => ({ categories: [...s.categories, cat] }));
    return cat;
  },

  updateCategory: async (id, name, emoji) => {
    const db = await getDb();
    await db.execute('UPDATE operation_categories SET name=$1, emoji=$2 WHERE id=$3', [name, emoji, id]);
    set((s) => ({ categories: s.categories.map((c) => c.id === id ? { ...c, name, emoji } : c) }));
  },

  deleteCategory: async (id) => {
    const db = await getDb();
    const cat = get().categories.find((c) => c.id === id);
    if (!cat || cat.is_builtin) return false;
    await db.execute('UPDATE operation_categories SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
    return true;
  },

  restoreCategory: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE operation_categories SET deleted_at=NULL WHERE id=$1', [id]);
    const rows = await db.select<DbRow[]>('SELECT * FROM operation_categories WHERE id=$1', [id]);
    if (rows[0]) {
      const cat = fromRow.category(rows[0]);
      set((s) => ({ categories: [...s.categories, cat].sort((a, b) => a.sort_order - b.sort_order) }));
    }
  },

  permanentlyDeleteCategory: async (id) => {
    const db = await getDb();
    await reassignCategoryContent(db, 'operations', id);
    await db.execute('DELETE FROM operation_categories WHERE id=$1', [id]);
    // Auch im Speicher umhaengen: ein spaeterer updateOperation wuerde die
    // geloeschte category_id sonst zurueckschreiben und am Foreign Key
    // scheitern. (Frueher heilte das der Mount-Refetch der View.)
    set((s) => ({
      operations: s.operations.map((o) =>
        o.category_id === id ? { ...o, category_id: FALLBACK_CATEGORY.operations } : o
      ),
    }));
  },
}));
