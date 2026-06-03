import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getDb } from '../lib/db';
import { DEFAULT_ALTAR_BACKGROUND } from '../lib/altarConstants';
import { generateId, nowIso } from '../lib/helpers';
import type { AltarItem, AltarItemCategory, AltarPlacement, AltarRecord } from '../types';

const DEFAULT_PLACEMENT_SIZE = 40;

async function fetchPlacementsForAltar(altarId: string, items: AltarItem[]): Promise<AltarPlacement[]> {
  const db = await getDb();
  const rows = await db.select<{
    id: string;
    altar_id: string;
    item_id: string;
    x: number;
    y: number;
    scale: number | null;
    z_index: number | null;
    width: number | null;
    height: number | null;
    rotation: number | null;
    opacity: number | null;
    locked: number | null;
    hidden: number | null;
  }[]>('SELECT * FROM altar_placements WHERE altar_id=$1', [altarId]);

  return rows.map((r) => {
    const item = items.find((i) => i.id === r.item_id);
    const legacySize = Math.max(4, Math.min(24, (r.scale ?? 1) * 8));
    return {
      id: r.id,
      altar_id: r.altar_id,
      item_id: r.item_id,
      name: item?.name ?? '?',
      emoji: item?.emoji ?? '✨',
      category: item?.category ?? 'other',
      x: r.x,
      y: r.y,
      z_index: r.z_index ?? 0,
      width: r.width ?? legacySize,
      height: r.height ?? legacySize,
      rotation: r.rotation ?? 0,
      opacity: r.opacity ?? 1,
      locked: Boolean(r.locked ?? 0),
      hidden: Boolean(r.hidden ?? 0),
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

function clampPlacementPatch(patch: Partial<Pick<AltarPlacement, 'x' | 'y' | 'z_index' | 'width' | 'height' | 'rotation' | 'opacity' | 'locked' | 'hidden'>>): Partial<AltarPlacement> {
  const next: Partial<AltarPlacement> = { ...patch };
  if (typeof next.x === 'number') next.x = Math.max(0, Math.min(100, next.x));
  if (typeof next.y === 'number') next.y = Math.max(0, Math.min(100, next.y));
  if (typeof next.z_index === 'number') next.z_index = Math.max(0, Math.round(next.z_index));
  if (typeof next.width === 'number') next.width = Math.max(2, Math.min(500, next.width));
  if (typeof next.height === 'number') next.height = Math.max(2, Math.min(500, next.height));
  if (typeof next.rotation === 'number') next.rotation = Math.max(-360, Math.min(360, next.rotation));
  if (typeof next.opacity === 'number') next.opacity = Math.max(0.05, Math.min(1, next.opacity));
  return next;
}

interface AltarState {
  altars: AltarRecord[];
  activeAltarId: string | null;
  items: AltarItem[];
  placements: AltarPlacement[];
  selectedPlacementId: string | null;
  previewPlacements: Record<string, AltarPlacement[]>;
  intention: string;

  fetchAltars: () => Promise<void>;
  setActiveAltar: (id: string) => Promise<void>;
  clearActiveAltar: () => void;
  createAltar: () => Promise<AltarRecord>;
  duplicateAltar: (id: string) => Promise<AltarRecord | null>;
  updateAltar: (id: string, patch: Partial<Pick<AltarRecord, 'title' | 'intention' | 'background_preset' | 'background_image_data'>>) => Promise<void>;
  bumpAltarUpdatedAt: (id: string) => Promise<void>;
  deleteAltar: (id: string) => Promise<void>;

  addItem: (name: string, emoji: string, category: AltarItemCategory, note?: string, imageData?: string) => Promise<AltarItem>;
  updateItem: (id: string, patch: Partial<Omit<AltarItem, 'id'>>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  placeItem: (item: AltarItem, x: number, y: number) => Promise<void>;
  selectPlacement: (id: string | null) => void;
  movePlacement: (id: string, x: number, y: number) => void;
  savePlacementPosition: (id: string, x: number, y: number) => Promise<void>;
  updatePlacement: (id: string, patch: Partial<Pick<AltarPlacement, 'x' | 'y' | 'z_index' | 'width' | 'height' | 'rotation' | 'opacity' | 'locked' | 'hidden'>>) => Promise<void>;
  bringPlacementForward: (id: string) => Promise<void>;
  sendPlacementBackward: (id: string) => Promise<void>;
  bringPlacementToFront: (id: string) => Promise<void>;
  sendPlacementToBack: (id: string) => Promise<void>;
  _swapPlacementZIndex: (idA: string, idB: string) => Promise<void>;
  removePlacement: (id: string) => Promise<void>;
  saveIntention: (text: string) => Promise<void>;
  setIntentionLocal: (text: string) => void;
}

export const useAltarStore = create<AltarState>((set, get) => ({
  altars: [],
  activeAltarId: null,
  items: [],
  placements: [],
  selectedPlacementId: null,
  previewPlacements: {},
  intention: '',

  fetchAltars: async () => {
    const db = await getDb();
    const items = await db.select<AltarItem[]>('SELECT * FROM altar_items ORDER BY name ASC');
    const altars = (await db.select<AltarRecord[]>('SELECT * FROM altars ORDER BY updated_at DESC, created_at DESC')).map(normalizeAltar);
    for (const altar of altars) {
      if (!altar.background_image_data?.startsWith('data:')) continue;
      try {
        const savedPath = await invoke<string>('save_image', { dataUrl: altar.background_image_data });
        altar.background_image_data = savedPath;
        await db.execute('UPDATE altars SET background_image_data=$1, updated_at=$2 WHERE id=$3', [savedPath, altar.updated_at, altar.id]);
      } catch (error) {
        console.error('Failed to migrate altar background image:', altar.id, error);
      }
    }
    const activeAltarId = get().activeAltarId ?? null;
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
      selectedPlacementId: null,
      previewPlacements,
      intention: activeAltar?.intention ?? '',
    });
  },

  setActiveAltar: async (id) => {
    const { items, altars } = get();
    const active = altars.find((altar) => altar.id === id);
    if (!active) return;
    const placements = await fetchPlacementsForAltar(id, items);
    set({ activeAltarId: id, placements, selectedPlacementId: null, intention: active.intention });
  },

  clearActiveAltar: () => {
    set({ activeAltarId: null, placements: [], selectedPlacementId: null, intention: '' });
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
    set((s) => ({ altars: [altar, ...s.altars], activeAltarId: altar.id, placements: [], selectedPlacementId: null, intention: '' }));
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
      z_index: number | null;
      width: number | null;
      height: number | null;
      rotation: number | null;
      opacity: number | null;
      locked: number | null;
      hidden: number | null;
    }[]>('SELECT item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden FROM altar_placements WHERE altar_id=$1', [id]);

    for (const placement of sourcePlacements) {
      await db.execute(
        'INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          generateId(),
          copy.id,
          placement.item_id,
          placement.x,
          placement.y,
          placement.z_index ?? 0,
          placement.width ?? DEFAULT_PLACEMENT_SIZE,
          placement.height ?? DEFAULT_PLACEMENT_SIZE,
          placement.rotation ?? 0,
          placement.opacity ?? 1,
          placement.locked ?? 0,
          placement.hidden ?? 0,
        ]
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
      altars: s.altars.map((entry) => (entry.id === id ? updated : entry)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      intention: s.activeAltarId === id ? updated.intention : s.intention,
    }));
  },

  bumpAltarUpdatedAt: async (id) => {
    const db = await getDb();
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar) return;
    const updated_at = nowIso();
    await db.execute('UPDATE altars SET updated_at=$1 WHERE id=$2', [updated_at, id]);
    set((s) => ({
      altars: s.altars
        .map((entry) => (entry.id === id ? { ...entry, updated_at } : entry))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
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
      selectedPlacementId: null,
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
      placements: s.placements.map((p) => (p.item_id === id ? { ...p, name: updated.name, emoji: updated.emoji, category: updated.category, image_data: updated.image_data } : p)),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [
          altarId,
          placements.map((p) => (p.item_id === id ? { ...p, name: updated.name, emoji: updated.emoji, category: updated.category, image_data: updated.image_data } : p)),
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
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [altarId, placements.filter((p) => p.item_id !== id)])
      ),
    }));
  },

  placeItem: async (item, x, y) => {
    const db = await getDb();
    const altarId = get().activeAltarId;
    if (!altarId) return;
    const id = generateId();
    const maxZ = get().placements.reduce((max, p) => Math.max(max, p.z_index), -1);
    const nextZ = maxZ + 1;
    await db.execute(
      'INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id, altarId, item.id, x, y, nextZ, DEFAULT_PLACEMENT_SIZE, DEFAULT_PLACEMENT_SIZE, 0, 1, 0, 0]
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
      z_index: nextZ,
      width: DEFAULT_PLACEMENT_SIZE,
      height: DEFAULT_PLACEMENT_SIZE,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      image_data: item.image_data,
    };
    set((s) => ({
      placements: [...s.placements, placement],
      selectedPlacementId: id,
      previewPlacements: {
        ...s.previewPlacements,
        [altarId]: [...(s.previewPlacements[altarId] ?? []), placement],
      },
    }));
    await get().bumpAltarUpdatedAt(altarId);
  },

  selectPlacement: (id) => set({ selectedPlacementId: id }),

  movePlacement: (id, x, y) => {
    const safePatch = clampPlacementPatch({ x, y });
    set((s) => ({
      placements: s.placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p)),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [altarId, placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p))])
      ),
    }));
  },

  savePlacementPosition: async (id, x, y) => {
    const db = await getDb();
    await db.execute('UPDATE altar_placements SET x=$1, y=$2 WHERE id=$3', [x, y, id]);
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  },

  updatePlacement: async (id, patch) => {
    const db = await getDb();
    const current = get().placements.find((entry) => entry.id === id);
    if (!current) return;
    const safePatch = clampPlacementPatch(patch);
    const next = { ...current, ...safePatch };
    await db.execute(
      'UPDATE altar_placements SET x=$1, y=$2, z_index=$3, width=$4, height=$5, rotation=$6, opacity=$7, locked=$8, hidden=$9 WHERE id=$10',
      [next.x, next.y, next.z_index, next.width, next.height, next.rotation, next.opacity, next.locked ? 1 : 0, next.hidden ? 1 : 0, id]
    );
    set((s) => ({
      placements: s.placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p)),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [altarId, placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p))])
      ),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  },

  bringPlacementForward: async (id) => {
    const sorted = [...get().placements].sort((a, b) => a.z_index - b.z_index);
    const index = sorted.findIndex((p) => p.id === id);
    if (index < 0 || index === sorted.length - 1) return;
    await get()._swapPlacementZIndex(sorted[index].id, sorted[index + 1].id);
  },

  sendPlacementBackward: async (id) => {
    const sorted = [...get().placements].sort((a, b) => a.z_index - b.z_index);
    const index = sorted.findIndex((p) => p.id === id);
    if (index <= 0) return;
    await get()._swapPlacementZIndex(sorted[index - 1].id, sorted[index].id);
  },

  _swapPlacementZIndex: async (idA, idB) => {
    const a = get().placements.find((p) => p.id === idA);
    const b = get().placements.find((p) => p.id === idB);
    if (!a || !b || a.z_index === b.z_index) return;
    const db = await getDb();
    await db.execute(
      'UPDATE altar_placements SET z_index = CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END WHERE id IN ($1, $3)',
      [idA, b.z_index, idB, a.z_index]
    );
    set((s) => ({
      placements: s.placements.map((p) => {
        if (p.id === idA) return { ...p, z_index: b.z_index };
        if (p.id === idB) return { ...p, z_index: a.z_index };
        return p;
      }),
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, list]) => [
          altarId,
          list.map((p) => {
            if (p.id === idA) return { ...p, z_index: b.z_index };
            if (p.id === idB) return { ...p, z_index: a.z_index };
            return p;
          }),
        ])
      ),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  },

  bringPlacementToFront: async (id) => {
    const maxZ = get().placements.reduce((max, p) => Math.max(max, p.z_index), 0);
    await get().updatePlacement(id, { z_index: maxZ + 1 });
  },

  sendPlacementToBack: async (id) => {
    const minZ = get().placements.reduce((min, p) => Math.min(min, p.z_index), 0);
    const shift = minZ <= 0 ? 1 - minZ : 0;
    if (shift !== 0) {
      const updateJobs = get().placements.map((p) => get().updatePlacement(p.id, { z_index: p.z_index + shift }));
      await Promise.all(updateJobs);
    }
    const refreshedMin = get().placements.reduce((min, p) => Math.min(min, p.z_index), 0);
    await get().updatePlacement(id, { z_index: Math.max(0, refreshedMin - 1) });
  },

  removePlacement: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM altar_placements WHERE id=$1', [id]);
    set((s) => ({
      placements: s.placements.filter((p) => p.id !== id),
      selectedPlacementId: s.selectedPlacementId === id ? null : s.selectedPlacementId,
      previewPlacements: Object.fromEntries(
        Object.entries(s.previewPlacements).map(([altarId, placements]) => [altarId, placements.filter((p) => p.id !== id)])
      ),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  },

  saveIntention: async (text) => {
    const activeAltarId = get().activeAltarId;
    if (!activeAltarId) return;
    await get().updateAltar(activeAltarId, { intention: text });
  },

  setIntentionLocal: (text) => set({ intention: text }),
}));
