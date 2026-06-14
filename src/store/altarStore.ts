import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getDb } from '../lib/db';
import { ALTAR_RATIOS, DEFAULT_ALTAR_BACKGROUND, DEFAULT_ALTAR_RESOLUTION, DEFAULT_BACKGROUND_OVERLAY, DEFAULT_OVERLAY_COLOR, DEFAULT_GRID_COLOR, DEFAULT_GRID_OPACITY, DEFAULT_GRID_SIZE, isRatioFormat, parseResolution } from '../lib/altarConstants';
import { boolToInt, generateId, isValidHexColor, nowIso } from '../lib/helpers';
import type { AltarCategory, AltarItem, AltarItemCategory, AltarPlacement, AltarRecord } from '../types';

const DEFAULT_PLACEMENT_SIZE = 40;

function mapEachPreview(
  prev: Record<string, AltarPlacement[]>,
  fn: (p: AltarPlacement) => AltarPlacement,
): Record<string, AltarPlacement[]> {
  return Object.fromEntries(
    Object.entries(prev).map(([id, list]) => [id, list.map(fn)]),
  );
}

function filterEachPreview(
  prev: Record<string, AltarPlacement[]>,
  fn: (p: AltarPlacement) => boolean,
): Record<string, AltarPlacement[]> {
  return Object.fromEntries(
    Object.entries(prev).map(([id, list]) => [id, list.filter(fn)]),
  );
}

async function insertAltarRow(altar: AltarRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT INTO altars (id, title, intention, background_preset, background_image_data, background_overlay, created_at, updated_at, grid_enabled, grid_size, grid_opacity, grid_color, snap_to_grid, rotation_snap_enabled, rotation_snap_angle, snap_scale_to_grid, resolution) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
    [altar.id, altar.title, altar.intention, altar.background_preset, altar.background_image_data, altar.background_overlay, altar.created_at, altar.updated_at, boolToInt(altar.grid_enabled), altar.grid_size, altar.grid_opacity, altar.grid_color, boolToInt(altar.snap_to_grid), boolToInt(altar.rotation_snap_enabled), altar.rotation_snap_angle, boolToInt(altar.snap_scale_to_grid), altar.resolution],
  );
}

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
    background_overlay: altar.background_overlay ?? DEFAULT_BACKGROUND_OVERLAY,
    background_overlay_color: altar.background_overlay_color ?? DEFAULT_OVERLAY_COLOR,
    grid_enabled: Boolean(altar.grid_enabled),
    grid_size: altar.grid_size ?? DEFAULT_GRID_SIZE,
    grid_opacity: altar.grid_opacity ?? DEFAULT_GRID_OPACITY,
    grid_color: isValidHexColor(altar.grid_color) ? altar.grid_color : DEFAULT_GRID_COLOR,
    snap_to_grid: Boolean(altar.snap_to_grid),
    rotation_snap_enabled: Boolean(altar.rotation_snap_enabled),
    rotation_snap_angle: altar.rotation_snap_angle ?? 15,
    snap_scale_to_grid: Boolean(altar.snap_scale_to_grid),
    resolution: (/^\d+x\d+$/.test(altar.resolution ?? '') || isRatioFormat(altar.resolution ?? '')) ? altar.resolution : DEFAULT_ALTAR_RESOLUTION,
    thumbnail_data: altar.thumbnail_data ?? null,
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
  categories: AltarCategory[];

  fetchAltars: () => Promise<void>;
  fetchCategories: () => Promise<void>;
  addCategory: (name: string, emoji: string) => Promise<AltarCategory>;
  updateCategory: (id: string, name: string, emoji: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (ids: string[]) => Promise<void>;
  setActiveAltar: (id: string) => Promise<void>;
  clearActiveAltar: () => void;
  createAltar: () => Promise<AltarRecord>;
  duplicateAltar: (id: string) => Promise<AltarRecord | null>;
  updateAltar: (id: string, patch: Partial<Pick<AltarRecord, 'title' | 'intention' | 'background_preset' | 'background_image_data' | 'background_overlay' | 'background_overlay_color' | 'thumbnail_data' | 'icon_data'>>) => Promise<void>;
  updateAltarGrid: (id: string, patch: Partial<Pick<AltarRecord, 'grid_enabled' | 'grid_size' | 'grid_opacity' | 'grid_color' | 'snap_to_grid' | 'rotation_snap_enabled' | 'rotation_snap_angle' | 'snap_scale_to_grid'>>) => Promise<void>;
  updateAltarResolution: (id: string, resolution: string) => Promise<void>;
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
  swapPlacementZIndex: (idA: string, idB: string) => Promise<void>;
  duplicatePlacement: (id: string) => Promise<void>;
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
  categories: [],

  fetchCategories: async () => {
    const db = await getDb();
    const rows = await db.select<AltarCategory[]>('SELECT id, name, emoji FROM altar_categories ORDER BY sort_order ASC, created_at ASC, name ASC');
    set({ categories: rows });
  },

  addCategory: async (name, emoji) => {
    const db = await getDb();
    const cat: AltarCategory = { id: generateId(), name, emoji };
    const maxRow = await db.select<{ m: number }[]>('SELECT COALESCE(MAX(sort_order), -1) as m FROM altar_categories');
    const sortOrder = (maxRow[0]?.m ?? -1) + 1;
    await db.execute(
      'INSERT INTO altar_categories (id, name, emoji, created_at, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [cat.id, cat.name, cat.emoji, nowIso(), sortOrder]
    );
    set((s) => ({ categories: [...s.categories, cat] }));
    return cat;
  },

  reorderCategories: async (ids) => {
    const db = await getDb();
    for (let i = 0; i < ids.length; i++) {
      await db.execute('UPDATE altar_categories SET sort_order=$1 WHERE id=$2', [i, ids[i]]);
    }
    const current = get().categories;
    const sorted = ids.map((id) => current.find((c) => c.id === id)!).filter(Boolean);
    set({ categories: sorted });
  },

  updateCategory: async (id, name, emoji) => {
    const db = await getDb();
    const old = get().categories.find((c) => c.id === id);
    await db.execute('UPDATE altar_categories SET name=$1, emoji=$2 WHERE id=$3', [name, emoji, id]);
    if (old && old.name !== name) {
      // Update all items that referenced the old category name
      await db.execute('UPDATE altar_items SET category=$1 WHERE category=$2', [name, old.name]);
      set((s) => ({
        items: s.items.map((i) => i.category === old.name ? { ...i, category: name } : i),
        placements: s.placements.map((p) => p.category === old.name ? { ...p, category: name } : p),
        previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.category === old.name ? { ...p, category: name } : p),
      }));
    }
    set((s) => ({ categories: s.categories.map((c) => c.id === id ? { ...c, name, emoji } : c) }));
  },

  deleteCategory: async (id) => {
    const db = await getDb();
    const cat = get().categories.find((c) => c.id === id);
    if (!cat) return;
    await db.execute('DELETE FROM altar_categories WHERE id=$1', [id]);
    set((s) => ({ categories: s.categories.filter((c) => c.id !== id) }));
  },

  fetchAltars: async () => {
    await get().fetchCategories();
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
    const now = nowIso();
    const altar: AltarRecord = {
      id: generateId(),
      title: 'Untitled Altar',
      intention: '',
      background_preset: DEFAULT_ALTAR_BACKGROUND,
      background_image_data: null,
      background_overlay: DEFAULT_BACKGROUND_OVERLAY,
      background_overlay_color: DEFAULT_OVERLAY_COLOR,
      created_at: now,
      updated_at: now,
      grid_enabled: false,
      grid_size: DEFAULT_GRID_SIZE,
      grid_opacity: DEFAULT_GRID_OPACITY,
      grid_color: DEFAULT_GRID_COLOR,
      snap_to_grid: false,
      rotation_snap_enabled: false,
      rotation_snap_angle: 15,
      snap_scale_to_grid: false,
      resolution: DEFAULT_ALTAR_RESOLUTION,
    };
    await insertAltarRow(altar);
    set((s) => ({ altars: [altar, ...s.altars], activeAltarId: altar.id, placements: [], selectedPlacementId: null, intention: '' }));
    return altar;
  },

  duplicateAltar: async (id) => {
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
      background_overlay: source.background_overlay ?? DEFAULT_BACKGROUND_OVERLAY,
      background_overlay_color: source.background_overlay_color ?? DEFAULT_OVERLAY_COLOR,
      created_at: now,
      updated_at: now,
      grid_enabled: source.grid_enabled,
      grid_size: source.grid_size,
      grid_opacity: source.grid_opacity,
      grid_color: source.grid_color,
      snap_to_grid: source.snap_to_grid,
      rotation_snap_enabled: source.rotation_snap_enabled,
      rotation_snap_angle: source.rotation_snap_angle,
      snap_scale_to_grid: source.snap_scale_to_grid,
      resolution: source.resolution ?? DEFAULT_ALTAR_RESOLUTION,
    };

    await insertAltarRow(copy);

    const db = await getDb();
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
      'UPDATE altars SET title=$1, intention=$2, background_preset=$3, background_image_data=$4, background_overlay=$5, background_overlay_color=$6, updated_at=$7, thumbnail_data=$8, icon_data=$9 WHERE id=$10',
      [updated.title, updated.intention, updated.background_preset || DEFAULT_ALTAR_BACKGROUND, updated.background_image_data ?? null, updated.background_overlay ?? DEFAULT_BACKGROUND_OVERLAY, updated.background_overlay_color ?? DEFAULT_OVERLAY_COLOR, updated.updated_at, updated.thumbnail_data ?? null, updated.icon_data ?? null, id]
    );
    set((s) => {
      const cur = s.altars.find(e => e.id === id);
      if (!cur) return s;
      const next = { ...cur, ...patch, updated_at: updated.updated_at };
      return {
        altars: s.altars.map(e => e.id === id ? next : e).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        intention: s.activeAltarId === id ? next.intention : s.intention,
      };
    });
  },

  updateAltarGrid: async (id, patch) => {
    const db = await getDb();
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar) return;
    const next: AltarRecord = {
      ...altar,
      grid_enabled: Boolean(patch.grid_enabled ?? altar.grid_enabled),
      grid_size: Math.max(8, Math.min(128, Math.round(patch.grid_size ?? altar.grid_size))),
      grid_opacity: Math.max(0.01, Math.min(0.25, patch.grid_opacity ?? altar.grid_opacity)),
      grid_color: patch.grid_color !== undefined && isValidHexColor(patch.grid_color) ? patch.grid_color : altar.grid_color,
      snap_to_grid: Boolean(patch.snap_to_grid ?? altar.snap_to_grid),
      rotation_snap_enabled: Boolean(patch.rotation_snap_enabled ?? altar.rotation_snap_enabled),
      rotation_snap_angle: Math.max(1, Math.min(180, Math.round(patch.rotation_snap_angle ?? altar.rotation_snap_angle))),
      snap_scale_to_grid: Boolean(patch.snap_scale_to_grid ?? altar.snap_scale_to_grid),
      updated_at: nowIso(),
    };
    await db.execute(
      'UPDATE altars SET grid_enabled=$1, grid_size=$2, grid_opacity=$3, grid_color=$4, snap_to_grid=$5, rotation_snap_enabled=$6, rotation_snap_angle=$7, snap_scale_to_grid=$8, updated_at=$9 WHERE id=$10',
      [boolToInt(next.grid_enabled), next.grid_size, next.grid_opacity, next.grid_color, boolToInt(next.snap_to_grid), boolToInt(next.rotation_snap_enabled), next.rotation_snap_angle, boolToInt(next.snap_scale_to_grid), next.updated_at, id]
    );
    set((s) => ({
      altars: s.altars.map((entry) => (entry.id === id ? next : entry)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }));
  },

  updateAltarResolution: async (id, resolution) => {
    const db = await getDb();
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar) return;
    let safeRes: string;
    if (isRatioFormat(resolution) && (ALTAR_RATIOS as readonly string[]).includes(resolution)) {
      safeRes = resolution;
    } else {
      const { w, h } = parseResolution(resolution);
      safeRes = `${w}x${h}`;
    }
    const updated_at = nowIso();
    await db.execute('UPDATE altars SET resolution=$1, updated_at=$2, thumbnail_data=NULL WHERE id=$3', [safeRes, updated_at, id]);
    set((s) => ({
      altars: s.altars
        .map((entry) => (entry.id === id ? { ...entry, resolution: safeRes, updated_at, thumbnail_data: null } : entry))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
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
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.item_id === id ? { ...p, name: updated.name, emoji: updated.emoji, category: updated.category, image_data: updated.image_data } : p),
    }));
  },

  deleteItem: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM altar_items WHERE id=$1', [id]);
    await db.execute('DELETE FROM altar_placements WHERE item_id=$1', [id]);
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      placements: s.placements.filter((p) => p.item_id !== id),
      previewPlacements: filterEachPreview(s.previewPlacements, (p) => p.item_id !== id),
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
    // Only update the live `placements` slice used by AltarCanvas.
    // `previewPlacements` (used by AltarCard thumbnails) is intentionally NOT
    // updated here because movePlacement fires at 60-120 Hz during drag and
    // rebuilding the entire previewPlacements map every frame causes AltarView
    // to re-render at pointer rate. The preview is synced on mouse-up via
    // savePlacementPosition, which is sufficient for thumbnail accuracy.
    set((s) => ({
      placements: s.placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p)),
    }));
  },

  savePlacementPosition: async (id, x, y) => {
    const db = await getDb();
    const safe = clampPlacementPatch({ x, y });
    await db.execute('UPDATE altar_placements SET x=$1, y=$2 WHERE id=$3', [safe.x, safe.y, id]);
    // Sync the final drag position into previewPlacements now that the drag is
    // complete. This is the only place we need to pay the per-altar map rebuild
    // cost, and it runs at most once per drag gesture (on mouse-up).
    set((s) => ({
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.id === id ? { ...p, ...safe } : p),
    }));
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
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.id === id ? { ...p, ...safePatch } : p),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  },

  bringPlacementForward: async (id) => {
    const sorted = [...get().placements].sort((a, b) => a.z_index - b.z_index);
    const index = sorted.findIndex((p) => p.id === id);
    if (index < 0 || index === sorted.length - 1) return;
    await get().swapPlacementZIndex(sorted[index].id, sorted[index + 1].id);
  },

  sendPlacementBackward: async (id) => {
    const sorted = [...get().placements].sort((a, b) => a.z_index - b.z_index);
    const index = sorted.findIndex((p) => p.id === id);
    if (index <= 0) return;
    await get().swapPlacementZIndex(sorted[index - 1].id, sorted[index].id);
  },

  swapPlacementZIndex: async (idA, idB) => {
    const a = get().placements.find((p) => p.id === idA);
    const b = get().placements.find((p) => p.id === idB);
    if (!a || !b || a.z_index === b.z_index) return;
    const db = await getDb();
    await db.execute(
      'UPDATE altar_placements SET z_index = CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END WHERE id IN ($1, $3)',
      [idA, b.z_index, idB, a.z_index],
    );
    set((s) => ({
      placements: s.placements.map((p) => {
        if (p.id === idA) return { ...p, z_index: b.z_index };
        if (p.id === idB) return { ...p, z_index: a.z_index };
        return p;
      }),
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => {
        if (p.id === idA) return { ...p, z_index: b.z_index };
        if (p.id === idB) return { ...p, z_index: a.z_index };
        return p;
      }),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  },

  bringPlacementToFront: async (id) => {
    const maxZ = get().placements.reduce((max, p) => Math.max(max, p.z_index), 0);
    await get().updatePlacement(id, { z_index: maxZ + 1 });
  },

  sendPlacementToBack: async (id) => {
    const placements = get().placements;
    if (placements.length === 0) return;

    const minZ = placements.reduce((min, p) => Math.min(min, p.z_index), Infinity);
    const shift = minZ <= 0 ? 1 - minZ : 0;
    // Target goes just below the minimum of all other placements.
    const targetZ = Math.max(0, minZ + shift - 1);

    const newZMap = new Map<string, number>(
      placements.map((p) => [p.id, p.id === id ? targetZ : p.z_index + shift]),
    );

    // Single bulk UPDATE — one CASE branch per placement, one timestamp bump.
    const db = await getDb();
    const params: (string | number)[] = [];
    let caseExpr = '';
    const inParams: string[] = [];
    for (const [pid, z] of newZMap) {
      const idIdx = params.length + 1;
      params.push(pid, z);
      caseExpr += ` WHEN $${idIdx} THEN $${idIdx + 1}`;
      inParams.push(`$${idIdx}`);
    }
    await db.execute(
      `UPDATE altar_placements SET z_index = CASE id${caseExpr} END WHERE id IN (${inParams.join(',')})`,
      params,
    );

    set((s) => ({
      placements: s.placements.map((p) => ({ ...p, z_index: newZMap.get(p.id) ?? p.z_index })),
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => ({ ...p, z_index: newZMap.get(p.id) ?? p.z_index })),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  },

  duplicatePlacement: async (id) => {
    const db = await getDb();
    const altarId = get().activeAltarId;
    if (!altarId) return;
    const source = get().placements.find((p) => p.id === id);
    if (!source) return;
    const newId = generateId();
    const maxZ = get().placements.reduce((max, p) => Math.max(max, p.z_index), -1);
    const nextZ = maxZ + 1;
    const newX = Math.min(100, source.x + 2);
    const newY = Math.min(100, source.y + 2);
    await db.execute(
      'INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [newId, altarId, source.item_id, newX, newY, nextZ, source.width, source.height, source.rotation, source.opacity, 0, 0]
    );
    const copy: AltarPlacement = {
      id: newId,
      altar_id: altarId,
      item_id: source.item_id,
      name: source.name,
      emoji: source.emoji,
      category: source.category,
      x: newX,
      y: newY,
      z_index: nextZ,
      width: source.width,
      height: source.height,
      rotation: source.rotation,
      opacity: source.opacity,
      locked: false,
      hidden: false,
      image_data: source.image_data,
    };
    set((s) => ({
      placements: [...s.placements, copy],
      selectedPlacementId: newId,
      previewPlacements: {
        ...s.previewPlacements,
        [altarId]: [...(s.previewPlacements[altarId] ?? []), copy],
      },
    }));
    await get().bumpAltarUpdatedAt(altarId);
  },

  removePlacement: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM altar_placements WHERE id=$1', [id]);
    set((s) => ({
      placements: s.placements.filter((p) => p.id !== id),
      selectedPlacementId: s.selectedPlacementId === id ? null : s.selectedPlacementId,
      previewPlacements: filterEachPreview(s.previewPlacements, (p) => p.id !== id),
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
