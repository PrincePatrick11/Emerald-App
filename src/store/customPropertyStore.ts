import { create } from 'zustand';
import { getDb } from '../lib/db';
import type { CustomProperty, CustomPropertyType } from '../types';

interface CustomPropertyState {
  properties: CustomProperty[];
  fetchProperties: (entryId: string, entryType: string) => Promise<void>;
  addProperty: (entryId: string, entryType: string, name: string, type: CustomPropertyType, meta?: string | null, showInEntry?: boolean) => Promise<CustomProperty>;
  updateProperty: (id: string, changes: Partial<Pick<CustomProperty, 'name' | 'value' | 'meta' | 'show_in_entry'>>) => Promise<void>;
  deleteProperty: (id: string) => Promise<void>;
  restoreProperty: (prop: CustomProperty) => Promise<void>;
}

export const useCustomPropertyStore = create<CustomPropertyState>((set, get) => ({
  properties: [],

  fetchProperties: async (entryId, entryType) => {
    const db = await getDb();
    const rows = await db.select<(Omit<CustomProperty, 'show_in_entry'> & { show_in_entry: number })[]>(
      `SELECT * FROM custom_properties WHERE entry_id = $1 AND entry_type = $2 ORDER BY sort_order ASC`,
      [entryId, entryType]
    );
    set({ properties: rows.map((r) => ({ ...r, show_in_entry: r.show_in_entry !== 0 })) });
  },

  addProperty: async (entryId, entryType, name, type, meta = null, showInEntry = false) => {
    const db = await getDb();
    const id = crypto.randomUUID();
    const sort_order = get().properties.length;
    await db.execute(
      `INSERT INTO custom_properties (id, entry_id, entry_type, name, type, value, meta, show_in_entry, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, entryId, entryType, name, type, null, meta, showInEntry ? 1 : 0, sort_order]
    );
    const prop: CustomProperty = {
      id, entry_id: entryId, entry_type: entryType as CustomProperty['entry_type'],
      name, type, value: null, meta, show_in_entry: showInEntry, sort_order,
    };
    set((s) => ({ properties: [...s.properties, prop] }));
    return prop;
  },

  updateProperty: async (id, changes) => {
    const db = await getDb();
    const prop = get().properties.find((p) => p.id === id);
    if (!prop) return;
    const updated = { ...prop, ...changes };
    await db.execute(
      `UPDATE custom_properties SET name=$1, value=$2, meta=$3, show_in_entry=$4 WHERE id=$5`,
      [updated.name, updated.value, updated.meta, updated.show_in_entry ? 1 : 0, id]
    );
    set((s) => ({ properties: s.properties.map((p) => (p.id === id ? updated : p)) }));
  },

  deleteProperty: async (id) => {
    const db = await getDb();
    await db.execute(`DELETE FROM custom_properties WHERE id=$1`, [id]);
    set((s) => ({ properties: s.properties.filter((p) => p.id !== id) }));
  },

  restoreProperty: async (prop) => {
    const db = await getDb();
    await db.execute(
      `INSERT OR REPLACE INTO custom_properties (id, entry_id, entry_type, name, type, value, meta, show_in_entry, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [prop.id, prop.entry_id, prop.entry_type, prop.name, prop.type, prop.value, prop.meta, prop.show_in_entry ? 1 : 0, prop.sort_order]
    );
    set((s) => {
      const exists = s.properties.some((p) => p.id === prop.id);
      return { properties: exists ? s.properties.map((p) => (p.id === prop.id ? prop : p)) : [...s.properties, prop] };
    });
  },
}));
