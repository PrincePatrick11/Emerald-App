import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getDb } from '../lib/db';
import type { AltarItem, AltarItemCategory, AltarPlacement, AltarRecord } from '../types';

function generateId() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
const DEFAULT_ALTAR_BACKGROUND = 'midnight';

async function fetchPlacementsForAltar(altarId: string, items: AltarItem[]): Promise<AltarPlacement[]> {
  const db = await getDb();
  const rows = await db.select<{
    id: string; altar_id: string; item_id: string; x: number; y: number; scale: number;
  }[]>('SELECT * FROM altar_placements WHERE altar_id=$1', [altarId]);

  return rows.map((r) => {
    const item = items.find((i) => i.id === r.item_id);
    return {
      id: r.id,
      altar_id: r.altar_id,
      item_id: r.item_id,
      name: item?.name ?? '?',
      emoji: item?.emoji ?? '✨',
      category: item?.category ?? 'other',
      x: r.x,
      y: r.y,
      scale: r.scale ?? 1,
      image_data: item?.image_data,
    };
  });
}

function normalizeAltar(altar: AltarRecord): AltarRecord {
  return {
    ...altar,
    background_preset: altar.background_preset || DEFAULT_ALTAR_BACKGROUND,
    background_image_data: altar.background_image_data ?? null,
  };
}

interface AltarState {
  altars: AltarRecord[];
  activeAltarId: string | null;
  items: AltarItem[];
  placements: AltarPlacement[];
  previewPlacements: Record<string, AltarPlacement[]>;
  intention: string;

  fetchAltars: () => Promise<void>;
  setActiveAltar: (id: string) => Promise<void>;
  createAltar: () => Promise<AltarRecord>;
  duplicateAltar: (id: string) => Promise<AltarRecord | null>;
  updateAltar: (id: string, patch: Partial<Pick<AltarRecord, 'title' | 'intention' | 'background_preset' | 'background_image_data'>>) => Promise<void>;
  deleteAltar: (id: string) => Promise<void>;

  addItem: (name: string, emoji: string, category: AltarItemCategory, note?: string, imageData?: string) => Promise<AltarItem>;
  updateItem: (id: string, patch: Partial<Omit<AltarItem, 'id'>>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  placeItem: (item: AltarItem, x: number, y: number) => Promise<void>;
  movePlacement: (id: string, x: number, y: number) => void;
  savePlacementPosition: (id: string, x: number, y: number) => Promise<void>;
  updatePlacementScale: (id: string, scale: number) => Promise<void>;
  removePlacement: (id: string) => Promise<void>;
  saveIntention: (text: string) => Promise<void>;
  setIntentionLocal: (text: string) => void;
}

export const useAltarStore = create<AltarState>((set, get) => ({
  altars: [],
  activeAltarId: null,
  items: [],
  placements: [],
  previewPlacements: {},
  intention: '',

  fetchAltars: async () => {
    const db = await getDb();
    const items = await db.select<AltarItem[]>('SELECT * FROM altar_items ORDER BY name ASC');
    const altars = (await db.select<AltarRecord[]>('SELECT * FROM altars ORDER BY updated_at DESC, created_at DESC'))
      .map(normalizeAltar);
    for (const altar of altars) {
      if (!altar.background_image_data?.startsWith('data:')) continue;
      try {
        const savedPath = await invoke<string>('save_image', { dataUrl: altar.background_image_data });
        altar.background_image_data = savedPath;
        await db.execute(
          'UPDATE altars SET background_image_data=$1, updated_at=$2 WHERE id=$3',
          [savedPath, altar.updated_at, altar.id]
        );
      } catch (error) {
        console.error('Failed to migrate altar background image:', altar.id, error);
      }
    }
    const activeAltarId = get().activeAltarId ?? altars[0]?.id ?? null;
    const activeAltar = altars.find((altar) => altar.id === activeAltarId) ?? null;
    const placements = activeAltar ? await fetchPlacementsForAltar(activeAltar.id, items) : [];
    const previewResults = await Promise.allSettled(
      altars.map(async (altar) => [altar.id, await fetchPlacementsForAltar(altar.id, items)] as const)
    );
    const previewPlacements = Object.fromEntries(
      previewResults
        .filter((r): r is PromiseFulfilledResult<readonly [string, AltarPlacement[]]> => r.status === 'fulfilled')
        .map((r) => r.value)
    );
    set({
      items,
      altars,
      activeAltarId: activeAltar?.id ?? null,
      placements,
      previewPlacements,
      intention: activeAltar?.intention ?? '',
    });
  },

  setActiveAltar: async (id) => {
    const { items, altars } = get();
    const active = altars.find((altar) => altar.id === id);
    if (!active) return;
    const placements = await fetchPlacementsForAltar(id, items);
    set({ activeAltarId: id, placements, intention: active.intention });
  },

  createAltar: async () => {
    const db = await getDb();
    const now = nowIso();
    const altar: AltarRecord = {
      id: generateId(),
      title: 'Untitled Altar',
      intention: '',
      background_preset: DEFAULT_ALTAR_BACKGROUND,
      background_image_data: null,
      created_at: now,
      updated_at: now,
    };
    await db.execute(
      'INSERT INTO altars (id, title, intention, background_preset, background_image_data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [altar.id, altar.title, altar.intention, altar.background_preset, altar.background_image_data, altar.created_at, altar.updated_at]
    );
    set((s) => ({ altars: [altar, ...s.altars], activeAltarId: altar.id, placements: [], intention: '' }));
    return altar;
  },

  duplicateAltar: async (id) => {
    const db = await getDb();
    const source = get().altars.find((altar) => altar.id === id);
    if (!source) return null;

    const newId = generateId();
    const now = nowIso();
    const copy: AltarRecord = {
      id: newId,
      title: `${source.title} (Copy)`,
      intention: source.intention,
      background_preset: source.background_preset || DEFAULT_ALTAR_BACKGROUND,
      background_image_data: source.background_image_data ?? null,
      created_at: now,
      updated_at: now,
    };

    await db.execute(
      'INSERT INTO altars (id, title, intention, background_preset, background_image_data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [copy.id, copy.title, copy.intention, copy.background_preset, copy.background_image_data, copy.created_at, copy.updated_at]
    );

    const sourcePlacements = await db.select<{
      item_id: string;
      x: number;
      y: number;
      scale: number;
    }[]>('SELECT item_id, x, y, scale FROM altar_placements WHERE altar_id=$1', [id]);

    for (const placement of sourcePlacements) {
      await db.execute(
        'INSERT INTO altar_placements (id, altar_id, item_id, x, y, scale) VALUES ($1,$2,$3,$4,$5,$6)',
        [generateId(), copy.id, placement.item_id, placement.x, placement.y, placement.scale ?? 1]
      );
    }

    set((s) => ({ altars: [copy, ...s.altars] }));
    return copy;
  },

  updateAltar: async (id, patch) => {
    const db = await getDb();
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar) return;
    const updated: AltarRecord = { ...altar, ...patch, updated_at: nowIso() };
    await db.execute(
      'UPDATE altars SET title=$1, intention=$2, background_preset=$3, background_image_data=$4, updated_at=$5 WHERE id=$6',
      [updated.title, updated.intention, updated.background_preset || DEFAULT_ALTAR_BACKGROUND, updated.background_image_data ?? null, updated.updated_at, id]
    );
    set((s) => ({
      altars: s.altars
        .map((entry) => (entry.id === id ? updated : entry))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      intention: s.activeAltarId === id ? updated.intention : s.intention,
    }));
  },

  deleteAltar: async (id) => {
    const db = await getDb();
    const { altars, activeAltarId, items } = get();
    await db.execute('DELETE FROM altar_placements WHERE altar_id=$1', [id]);
    await db.execute('DELETE FROM altars WHERE id=$1', [id]);
    const nextAltars = altars.filter((altar) => altar.id !== id);
    const nextActiveId = activeAltarId === id ? (nextAltars[0]?.id ?? null) : activeAltarId;
    const placements = nextActiveId ? await fetchPlacementsForAltar(nextActiveId, items) : [];
    const active = nextAltars.find((altar) => altar.id === nextActiveId) ?? null;
    set({
      altars: nextAltars,
      activeAltarId: nextActiveId,
      placements,
      intention: active?.intention ?? '',
    });
  },

  addItem: async (name, emoji, category, note = '', imageData) => {
    const db = await getDb();
    const item: AltarItem = { id: generateId(), name, emoji, category, note, image_data: imageData };
    await db.execute(
      'INSERT INTO altar_items (id, name, emoji, category, note, image_data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [item.id, item.name, item.emoji, item.category, item.note, item.image_data ?? null, nowIso()]
    );
    set((s) => ({ items: [...s.items, item].sort((a, b) => a.name.localeCompare(b.name)) }));
    return item;
  },

  updateItem: async (id, patch) => {
    const db = await getDb();
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    const updated = { ...item, ...patch };
    await db.execute(
      'UPDATE altar_items SET name=$1, emoji=$2, category=$3, note=$4, image_data=$5 WHERE id=$6',
      [updated.name, updated.emoji, updated.category, updated.note, updated.image_data ?? null, id]
    );
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? updated : i)).sort((a, b) => a.name.localeCompare(b.name)),
      placements: s.placements.map((p) =>
        p.item_id === id
          ? { ...p, name: updated.name, emoji: updated.emoji, category: updated.category, image_data: updated.image_data }
          : p
      ),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [
          altarId,
          placements.map((p) =>
            p.item_id === id
              ? { ...p, name: updated.name, emoji: updated.emoji, category: updated.category, image_data: updated.image_data }
              : p
          ),
        ])
      ),
    }));
  },

  deleteItem: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM altar_items WHERE id=$1', [id]);
    await db.execute('DELETE FROM altar_placements WHERE item_id=$1', [id]);
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      placements: s.placements.filter((p) => p.item_id !== id),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [
          altarId,
          placements.filter((p) => p.item_id !== id),
        ])
      ),
    }));
  },

  placeItem: async (item, x, y) => {
    const db = await getDb();
    const altarId = get().activeAltarId;
    if (!altarId) return;
    const id = generateId();
    await db.execute(
      'INSERT INTO altar_placements (id, altar_id, item_id, x, y, scale) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, altarId, item.id, x, y, 1]
    );
    const placement: AltarPlacement = {
      id,
      altar_id: altarId,
      item_id: item.id,
      name: item.name,
      emoji: item.emoji,
      category: item.category,
      x,
      y,
      scale: 1,
      image_data: item.image_data,
    };
    set((s) => ({
      placements: [...s.placements, placement],
      previewPlacements: {
        ...s.previewPlacements,
        [altarId]: [...(s.previewPlacements[altarId] ?? []), placement],
      },
    }));
    await get().updateAltar(altarId, {});
  },

  movePlacement: (id, x, y) => {
    set((s) => ({
      placements: s.placements.map((p) => (p.id === id ? { ...p, x, y } : p)),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [
          altarId,
          placements.map((p) => (p.id === id ? { ...p, x, y } : p)),
        ])
      ),
    }));
  },

  savePlacementPosition: async (id, x, y) => {
    const db = await getDb();
    await db.execute('UPDATE altar_placements SET x=$1, y=$2 WHERE id=$3', [x, y, id]);
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().updateAltar(activeAltarId, {});
  },

  updatePlacementScale: async (id, scale) => {
    const db = await getDb();
    await db.execute('UPDATE altar_placements SET scale=$1 WHERE id=$2', [scale, id]);
    set((s) => ({
      placements: s.placements.map((p) => (p.id === id ? { ...p, scale } : p)),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [
          altarId,
          placements.map((p) => (p.id === id ? { ...p, scale } : p)),
        ])
      ),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().updateAltar(activeAltarId, {});
  },

  removePlacement: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM altar_placements WHERE id=$1', [id]);
    set((s) => ({
      placements: s.placements.filter((p) => p.id !== id),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [
          altarId,
          placements.filter((p) => p.id !== id),
        ])
      ),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().updateAltar(activeAltarId, {});
  },

  saveIntention: async (text) => {
    const activeAltarId = get().activeAltarId;
    if (!activeAltarId) return;
    await get().updateAltar(activeAltarId, { intention: text });
  },

  setIntentionLocal: (text) => set({ intention: text }),
}));
