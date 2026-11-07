import { create } from 'zustand';
import { saveImage } from '../lib/images';
import { getDb } from '../lib/db';
import { ALTAR_RATIOS, isRatioFormat, parseResolution } from '../lib/altarConstants';
import { altarSettingsJson, parseAltarSettings } from '../lib/altarSettings';
import { generateId, isValidHexColor, nowIso } from '../lib/helpers';
import { needsWrite, stampFor, type WriteOptions } from '../lib/stamp';
import { serialKey, serialized } from '../lib/serialize';
import { bool, fromRow, toInt, type DbRow } from '../lib/row';
import type { AltarItem, AltarPlacement, AltarRecord } from '../types';
import i18n from '../i18n';
import { displayTitle } from '../lib/entryTitle';
import { altarElementsJson, isDrawn, parseAltarElements, withNewElementIds } from '../lib/altarElements';

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
    'INSERT INTO altars (id, title, settings, background_image_data, created_at, updated_at, thumbnail_data, icon_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [altar.id, altar.title, altarSettingsJson(altar), altar.background_image_data, altar.created_at, altar.updated_at, altar.thumbnail_data ?? null, altar.icon_data ?? null],
  );
}

// name, emoji, category_id and image_data are not columns of
// altar_placements — they come from the associated altar_items entry.
// The `scale` column, from which earlier versions derived a fallback size,
// was dropped with migration v33: width and height have been
// NOT NULL since then and carry their own default.
function mapPlacementRows(rows: DbRow[], items: AltarItem[]): AltarPlacement[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => {
    const item = itemsById.get(String(r.item_id));
    return {
      id: String(r.id),
      altar_id: String(r.altar_id),
      kind: 'item' as const,
      item_id: String(r.item_id),
      name: item?.name ?? '?',
      emoji: item?.emoji ?? '✨',
      category_id: item?.category_id ?? null,
      x: Number(r.x),
      y: Number(r.y),
      z_index: Number(r.z_index),
      width: Number(r.width),
      height: Number(r.height),
      rotation: Number(r.rotation),
      opacity: Number(r.opacity),
      locked: bool(r.locked),
      hidden: bool(r.hidden),
      ...(r.group_id ? { group: String(r.group_id) } : {}),
      image_data: item?.image_data,
    };
  });
}

/**
 * The placements that are visible: without those of items in the trash.
 * They stay in the database and come back with the item.
 */
const LIVE_PLACEMENTS = `SELECT p.* FROM altar_placements p
  JOIN altar_items i ON i.id = p.item_id AND i.deleted_at IS NULL`;

/** Everything on an altar: the placements of library items and the drawn shapes and text. */
async function fetchPlacementsForAltar(altarId: string, items: AltarItem[]): Promise<AltarPlacement[]> {
  const db = await getDb();
  const rows = await db.select<DbRow[]>(`${LIVE_PLACEMENTS} WHERE p.altar_id=$1`, [altarId]);
  const [altar] = await db.select<{ elements: string }[]>('SELECT elements FROM altars WHERE id=$1', [altarId]);
  return [...mapPlacementRows(rows, items), ...parseAltarElements(altar?.elements, altarId)];
}

/** The placements of an altar as the store holds them — the active list for the open altar. */
function placementsOf(s: Pick<AltarState, 'activeAltarId' | 'placements' | 'previewPlacements'>, altarId: string): AltarPlacement[] {
  return s.activeAltarId === altarId ? s.placements : s.previewPlacements[altarId] ?? [];
}

/** Writes the drawn shapes and text of an altar from the store into `altars.elements`. */
async function writeAltarElements(altarId: string, placements: readonly AltarPlacement[]): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE altars SET elements=$1 WHERE id=$2', [altarElementsJson(placements), altarId]);
}

/** A placement's row values, in the column order of the INSERT statements below. */
const placementValues = (p: AltarPlacement, altarId: string) => [
  p.id, altarId, p.item_id, p.x, p.y, p.z_index, p.width, p.height, p.rotation, p.opacity, toInt(p.locked), toInt(p.hidden), p.group ?? null,
];
const INSERT_PLACEMENT = 'INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden, group_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)';
const UPDATE_PLACEMENT = 'UPDATE altar_placements SET x=$1, y=$2, z_index=$3, width=$4, height=$5, rotation=$6, opacity=$7, locked=$8, hidden=$9, group_id=$10 WHERE id=$11';
const placementUpdateValues = (p: AltarPlacement) => [
  p.x, p.y, p.z_index, p.width, p.height, p.rotation, p.opacity, toInt(p.locked), toInt(p.hidden), p.group ?? null, p.id,
];


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
  /** The selected placements of the open altar, in the order they were selected. */
  selectedPlacementIds: string[];
  previewPlacements: Record<string, AltarPlacement[]>;

  fetchAltars: () => Promise<void>;
  setActiveAltar: (id: string) => Promise<void>;
  clearActiveAltar: () => void;
  /** `createdAt` only for the import, which takes the date from the file; otherwise now. */
  createAltar: (opts?: { createdAt?: string }) => Promise<AltarRecord>;
  duplicateAltar: (id: string) => Promise<AltarRecord | null>;
  updateAltar: (id: string, patch: Partial<Pick<AltarRecord, 'title' | 'background_preset' | 'background_image_data' | 'background_overlay' | 'background_overlay_color' | 'thumbnail_data' | 'icon_data'>>, options?: WriteOptions) => Promise<void>;
  updateAltarGrid: (id: string, patch: Partial<Pick<AltarRecord, 'grid_enabled' | 'grid_size' | 'grid_opacity' | 'grid_color' | 'snap_to_grid' | 'rotation_snap_enabled' | 'rotation_snap_angle' | 'snap_scale_to_grid'>>) => Promise<void>;
  updateAltarResolution: (id: string, resolution: string) => Promise<void>;
  /** The canvas editor's guides of an altar, and whether they are locked. */
  updateAltarGuides: (id: string, patch: Partial<Pick<AltarRecord, 'guides' | 'guides_locked'>>) => Promise<void>;
  bumpAltarUpdatedAt: (id: string) => Promise<void>;
  /** Soft delete: into the trash. Placements and links to the altar stay, for the way back. */
  deleteAltar: (id: string) => Promise<void>;
  restoreAltar: (id: string) => Promise<void>;
  /**
   * Cancel in the altar (`altarEdit.ts`): writes the altar and its
   * placements back as they were on entering edit mode — including
   * timestamp and thumbnail, so it sits in the lists where it was.
   * Throws if the write fails; a second call finishes the job.
   */
  /** `untouchedItemIds`: items whose placements are not part of the snapshot and stay. */
  restoreAltarSnapshot: (altar: AltarRecord, placements: readonly AltarPlacement[], untouchedItemIds?: readonly string[]) => Promise<void>;
  permanentlyDeleteAltar: (id: string) => Promise<void>;

  /** `createdAt` only for the import, which takes the date from the file;
   *  otherwise now. */
  addItem: (name: string, emoji: string, categoryId: string | null, note?: string, imageData?: string, createdAt?: string) => Promise<AltarItem>;
  updateItem: (id: string, patch: Partial<Pick<AltarItem, 'name' | 'emoji' | 'category_id' | 'note' | 'image_data'>>) => Promise<void>;
  /** Into the trash — placements go out of sight too, but not out of the database. */
  deleteItem: (id: string) => Promise<void>;
  restoreItem: (id: string) => Promise<void>;
  permanentlyDeleteItem: (id: string) => Promise<void>;
  placeItem: (item: AltarItem, x: number, y: number) => Promise<void>;
  selectPlacement: (id: string | null) => void;
  selectPlacements: (ids: string[]) => void;
  /**
   * The open altar's placements as the canvas editor hands them back: all at once,
   * in the store right away, then written — rows for items, `altars.elements`
   * for shapes and text. New item placements need their `item_id`.
   */
  applyPlacements: (next: AltarPlacement[]) => Promise<void>;
  movePlacement: (id: string, x: number, y: number) => void;
  savePlacementPosition: (id: string, x: number, y: number) => Promise<void>;
  updatePlacement: (id: string, patch: Partial<Pick<AltarPlacement, 'x' | 'y' | 'z_index' | 'width' | 'height' | 'rotation' | 'opacity' | 'locked' | 'hidden'>>) => Promise<void>;
  duplicatePlacement: (id: string) => Promise<void>;
  /** Takes a placement off the altar and returns it — for undo (`restorePlacement`). */
  removePlacement: (id: string) => Promise<AltarPlacement | undefined>;
  /** Puts a removed placement back as it was — provided the altar and item still exist. */
  restorePlacement: (placement: AltarPlacement) => Promise<void>;
}

/**
 * Discards the thumbnails of the altars on which item `itemId` sits —
 * they still showed it as it was. Until the next recomputation the card falls
 * back to the live preview. A consequence, not a change to the altar: "Last
 * modified" stays.
 */
async function dropThumbnailsShowing(db: Awaited<ReturnType<typeof getDb>>, itemId: string): Promise<Set<string>> {
  const rows = await db.select<{ altar_id: string }[]>(
    'SELECT DISTINCT altar_id FROM altar_placements WHERE item_id=$1', [itemId]
  );
  const ids = new Set(rows.map((r) => r.altar_id));
  await db.batch([...ids].map((id) => ['UPDATE altars SET thumbnail_data=NULL WHERE id=$1', [id]] as const));
  return ids;
}

/** The altars whose thumbnail `stale` has discarded (`dropThumbnailsShowing`). */
function withoutThumbnails(altars: AltarRecord[], stale: Set<string>): AltarRecord[] {
  return stale.size ? altars.map((a) => (stale.has(a.id) ? { ...a, thumbnail_data: null } : a)) : altars;
}

/** The store without item `id` and its placements; `stale` = altars without a valid thumbnail. */
function withoutItem(s: AltarState, id: string, stale: Set<string>): Partial<AltarState> {
  return {
    altars: withoutThumbnails(s.altars, stale),
    items: s.items.filter((i) => i.id !== id),
    placements: s.placements.filter((p) => p.item_id !== id),
    previewPlacements: filterEachPreview(s.previewPlacements, (p) => p.item_id !== id),
    selectedPlacementIds: s.selectedPlacementIds.filter((sel) => !s.placements.some((p) => p.id === sel && p.item_id === id)),
  };
}

/** The store without altar `id` — moved to the trash or permanently deleted. */
function withoutAltar(s: AltarState, id: string): Partial<AltarState> {
  const { [id]: _removed, ...previewPlacements } = s.previewPlacements;
  return {
    altars: s.altars.filter((altar) => altar.id !== id),
    previewPlacements,
    ...(s.activeAltarId === id ? { activeAltarId: null, placements: [], selectedPlacementIds: [] } : {}),
  };
}

export const useAltarStore = create<AltarState>((set, get) => ({
  altars: [],
  activeAltarId: null,
  items: [],
  placements: [],
  selectedPlacementIds: [],
  previewPlacements: {},

  fetchAltars: async () => {
    const db = await getDb();
    const itemRows = await db.select<DbRow[]>('SELECT * FROM altar_items WHERE deleted_at IS NULL ORDER BY name ASC');
    const items = itemRows.map(fromRow.altarItem);
    const altarRows = await db.select<DbRow[]>('SELECT * FROM altars WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC');
    const altars = altarRows.map(fromRow.altar);
    for (const altar of altars) {
      if (!altar.background_image_data?.startsWith('data:')) continue;
      try {
        const filename = await saveImage(altar.background_image_data);
        altar.background_image_data = filename;
        await db.execute('UPDATE altars SET background_image_data=$1, updated_at=$2 WHERE id=$3', [filename, altar.updated_at, altar.id]);
      } catch (error) {
        console.error('Failed to migrate altar background image:', altar.id, error);
      }
    }
    const activeAltarId = get().activeAltarId ?? null;
    const activeAltar = altars.find((altar) => altar.id === activeAltarId) ?? null;
    // One query for all altars instead of one per altar — this used to run as
    // N+1 on every app start and every mount of the AltarView.
    const placementRows = await db.select<DbRow[]>(LIVE_PLACEMENTS);
    const allPlacements = mapPlacementRows(placementRows, items);
    const previewPlacements: Record<string, AltarPlacement[]> = Object.fromEntries(
      altars.map((altar) => [altar.id, [] as AltarPlacement[]])
    );
    for (const placement of allPlacements) {
      if (placement.altar_id) previewPlacements[placement.altar_id]?.push(placement);
    }
    for (const row of altarRows) {
      previewPlacements[String(row.id)]?.push(...parseAltarElements(row.elements, String(row.id)));
    }
    const placements = activeAltar ? previewPlacements[activeAltar.id] ?? [] : [];
    set({
      items,
      altars,
      activeAltarId: activeAltar?.id ?? null,
      placements,
      selectedPlacementIds: [],
      previewPlacements,
    });
  },

  setActiveAltar: async (id) => {
    const { items, altars } = get();
    const active = altars.find((altar) => altar.id === id);
    if (!active) return;
    const placements = await fetchPlacementsForAltar(id, items);
    set({ activeAltarId: id, placements, selectedPlacementIds: [] });
  },

  clearActiveAltar: () => {
    set({ activeAltarId: null, placements: [], selectedPlacementIds: [] });
  },

  createAltar: async ({ createdAt } = {}) => {
    const now = nowIso();
    const altar: AltarRecord = {
      id: generateId(),
      // Empty — "Unnamed altar" is shown (`displayTitle`).
      title: '',
      // Without a preset: all defaults.
      ...parseAltarSettings({}),
      background_image_data: null,
      created_at: createdAt ?? now,
      updated_at: now,
    };
    await insertAltarRow(altar);
    set((s) => ({
      altars: [altar, ...s.altars],
      activeAltarId: altar.id,
      placements: [],
      selectedPlacementIds: [],
      // An entry even when empty: anyone looking up an altar's placements there should find it.
      previewPlacements: { ...s.previewPlacements, [altar.id]: [] },
    }));
    return altar;
  },

  duplicateAltar: async (id) => {
    const source = get().altars.find((altar) => altar.id === id);
    if (!source) return null;

    const newId = generateId();
    const now = nowIso();
    const copy: AltarRecord = {
      id: newId,
      title: displayTitle(i18n.t, 'altar', source.title) + i18n.t('common.copySuffix'),
      ...parseAltarSettings(source),
      background_image_data: source.background_image_data ?? null,
      created_at: now,
      updated_at: now,
      thumbnail_data: source.thumbnail_data ?? null,
      icon_data: source.icon_data ?? null,
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
      group_id: string | null;
    }[]>(
      // All of them, including those of items in the trash: if one comes back,
      // it sits on the copy just as on the original.
      'SELECT item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden, group_id FROM altar_placements WHERE altar_id=$1',
      [id],
    );

    const [sourceRow] = await db.select<{ elements: string }[]>('SELECT elements FROM altars WHERE id=$1', [id]);
    await db.execute('UPDATE altars SET elements=$1 WHERE id=$2', [withNewElementIds(sourceRow?.elements, copy.id), copy.id]);

    await db.batch(sourcePlacements.map((placement) => [
      'INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden, group_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
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
        placement.group_id,
      ],
    ] as const));

    // Along with the placements: without them the card would show the copy empty, and
    // anyone looking it up there (`altarEdit.ts`) would take it for empty.
    const placements = await fetchPlacementsForAltar(copy.id, get().items);
    set((s) => ({
      altars: [copy, ...s.altars],
      previewPlacements: { ...s.previewPlacements, [copy.id]: placements },
    }));
    return copy;
  },

  // serialized (grid/resolution share the key): see lib/serialize.ts. The most
  // realistic collision here is the automatic thumbnail save, which goes
  // through updateAltar and would overlap with a title save.
  updateAltar: (id, patch, { touch } = {}) => serialized(serialKey('altar', id), async () => {
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar || !needsWrite(altar, patch, touch)) return;
    const db = await getDb();
    const updated: AltarRecord = { ...altar, ...patch, updated_at: stampFor(altar.updated_at, touch) };
    await db.execute(
      'UPDATE altars SET title=$1, settings=$2, background_image_data=$3, updated_at=$4, thumbnail_data=$5, icon_data=$6 WHERE id=$7',
      [updated.title, altarSettingsJson(updated), updated.background_image_data ?? null, updated.updated_at, updated.thumbnail_data ?? null, updated.icon_data ?? null, id]
    );
    set((s) => {
      const cur = s.altars.find(e => e.id === id);
      if (!cur) return s;
      const next = { ...cur, ...patch, updated_at: updated.updated_at };
      return {
        altars: s.altars.map(e => e.id === id ? next : e).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      };
    });
  }),

  updateAltarGrid: (id, patch) => serialized(serialKey('altar', id), async () => {
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar) return;
    const grid = {
      grid_enabled: Boolean(patch.grid_enabled ?? altar.grid_enabled),
      grid_size: Math.max(8, Math.min(128, Math.round(patch.grid_size ?? altar.grid_size))),
      grid_opacity: Math.max(0.01, Math.min(0.25, patch.grid_opacity ?? altar.grid_opacity)),
      grid_color: patch.grid_color !== undefined && isValidHexColor(patch.grid_color) ? patch.grid_color : altar.grid_color,
      snap_to_grid: Boolean(patch.snap_to_grid ?? altar.snap_to_grid),
      rotation_snap_enabled: Boolean(patch.rotation_snap_enabled ?? altar.rotation_snap_enabled),
      rotation_snap_angle: Math.max(1, Math.min(180, Math.round(patch.rotation_snap_angle ?? altar.rotation_snap_angle))),
      snap_scale_to_grid: Boolean(patch.snap_scale_to_grid ?? altar.snap_scale_to_grid),
    };
    if (!needsWrite(altar, grid)) return;
    const db = await getDb();
    const next: AltarRecord = { ...altar, ...grid, updated_at: stampFor(altar.updated_at) };
    await db.execute(
      'UPDATE altars SET settings=$1, updated_at=$2 WHERE id=$3',
      [altarSettingsJson(next), next.updated_at, id]
    );
    set((s) => ({
      altars: s.altars.map((entry) => (entry.id === id ? next : entry)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }));
  }),

  updateAltarGuides: (id, patch) => serialized(serialKey('altar', id), async () => {
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar) return;
    const { guides, guides_locked } = parseAltarSettings({ ...altar, ...patch });
    if (!needsWrite(altar, { guides, guides_locked })) return;
    // Not a change of the altar's picture: the date stays.
    const next: AltarRecord = { ...altar, guides, guides_locked };
    const db = await getDb();
    await db.execute('UPDATE altars SET settings=$1 WHERE id=$2', [altarSettingsJson(next), id]);
    set((s) => ({ altars: s.altars.map((entry) => (entry.id === id ? next : entry)) }));
  }),

  updateAltarResolution: (id, resolution) => serialized(serialKey('altar', id), async () => {
    const altar = get().altars.find((entry) => entry.id === id);
    if (!altar) return;
    let safeRes: string;
    if (isRatioFormat(resolution) && (ALTAR_RATIOS as readonly string[]).includes(resolution)) {
      safeRes = resolution;
    } else {
      const { w, h } = parseResolution(resolution);
      safeRes = `${w}x${h}`;
    }
    if (!needsWrite(altar, { resolution: safeRes })) return;
    const db = await getDb();
    const updated_at = stampFor(altar.updated_at);
    // The thumbnail stays: "Done" and leaving recompute it anyway,
    // and an import would otherwise not bring a matching one along.
    await db.execute(
      'UPDATE altars SET settings=$1, updated_at=$2 WHERE id=$3',
      [altarSettingsJson({ ...altar, resolution: safeRes }), updated_at, id],
    );
    set((s) => ({
      altars: s.altars
        .map((entry) => (entry.id === id ? { ...entry, resolution: safeRes, updated_at } : entry))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }));
  }),

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
    await db.execute('UPDATE altars SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    // Placements and the links pointing at the altar stay in place —
    // as with a task: the soft delete is reversible, and
    // `sweepDanglingTaskLinks` counts trash contents as valid.
    set((s) => withoutAltar(s, id));
  },

  restoreAltar: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE altars SET deleted_at=NULL WHERE id=$1', [id]);
    // Reload only this altar, not `fetchAltars`: that would also reset the
    // snapshot of another one that is currently being edited.
    const rows = await db.select<DbRow[]>('SELECT * FROM altars WHERE id=$1', [id]);
    if (!rows.length) return;
    const altar = fromRow.altar(rows[0]);
    const placements = await fetchPlacementsForAltar(id, get().items);
    set((s) => ({
      altars: [altar, ...s.altars.filter((entry) => entry.id !== id)]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      previewPlacements: { ...s.previewPlacements, [id]: placements },
    }));
  },

  restoreAltarSnapshot: (altar, placements, untouchedItemIds = []) => serialized(serialKey('altar', altar.id), async () => {
    const db = await getDb();
    if (!get().altars.some((entry) => entry.id === altar.id)) return;
    await db.execute(
      `UPDATE altars SET
        title=$1, settings=$2, background_image_data=$3, thumbnail_data=$4, icon_data=$5, updated_at=$6
       WHERE id=$7`,
      [
        altar.title, altarSettingsJson(altar), altar.background_image_data ?? null,
        altar.thumbnail_data ?? null, altar.icon_data ?? null, altar.updated_at,
        altar.id,
      ],
    );

    // An item that has since been deleted from the library has no
    // row left for its placement to hang on.
    const items = get().items;
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const drawn = placements.filter(isDrawn);
    await writeAltarElements(altar.id, drawn);
    const restored = placements
      .filter((placement) => !isDrawn(placement) && itemsById.has(placement.item_id))
      // Name, emoji and image in the item's current version.
      .map((placement) => {
        const item = itemsById.get(placement.item_id)!;
        return { ...placement, name: item.name, emoji: item.emoji, category_id: item.category_id, image_data: item.image_data };
      });
    // In one transaction (`batch`): first create each remembered placement
    // or bring it to its snapshot state, then remove whatever does not belong. The
    // order also keeps it repeatable — the altar is never left in between
    // without the placements it had.
    const upserts = restored.map((p) => [
      `INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden, group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(id) DO UPDATE SET
         altar_id=excluded.altar_id, item_id=excluded.item_id, x=excluded.x, y=excluded.y, z_index=excluded.z_index,
         width=excluded.width, height=excluded.height, rotation=excluded.rotation, opacity=excluded.opacity,
         locked=excluded.locked, hidden=excluded.hidden, group_id=excluded.group_id`,
      [p.id, altar.id, p.item_id, p.x, p.y, p.z_index, p.width, p.height, p.rotation, p.opacity, toInt(p.locked), toInt(p.hidden), p.group ?? null],
    ] as const);
    // The placements of items in the trash are not part of the remembered
    // snapshot, yet belong to the altar: they stay — including those of an
    // item that was in the trash on entering and has since come back.
    const keptIds = restored.map((p) => p.id);
    const params = [altar.id, ...keptIds, ...untouchedItemIds];
    const ph = (from: number, n: number) => Array.from({ length: n }, (_, i) => `$${from + i}`).join(', ');
    await db.batch([
      ...upserts,
      [
        `DELETE FROM altar_placements WHERE altar_id=$1
           AND item_id IN (SELECT id FROM altar_items WHERE deleted_at IS NULL)`
          + (keptIds.length ? ` AND id NOT IN (${ph(2, keptIds.length)})` : '')
          + (untouchedItemIds.length ? ` AND item_id NOT IN (${ph(2 + keptIds.length, untouchedItemIds.length)})` : ''),
        params,
      ],
    ]);

    set((s) => ({
      altars: s.altars
        .map((entry) => (entry.id === altar.id ? altar : entry))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      previewPlacements: { ...s.previewPlacements, [altar.id]: [...restored, ...drawn] },
      ...(s.activeAltarId === altar.id
        ? { placements: [...restored, ...drawn], selectedPlacementIds: [] }
        : {}),
    }));
  }),

  permanentlyDeleteAltar: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM altar_placements WHERE altar_id=$1', [id]);
    // Altars are link targets of task_links (polymorphic, no foreign key).
    await db.execute('DELETE FROM task_links WHERE target_id=$1', [id]);
    await db.execute('DELETE FROM altars WHERE id=$1', [id]);
    // Reachable only from the trash or when rolling back an import;
    // if it is still in the store, it goes from there too.
    if (get().altars.some((altar) => altar.id === id)) set((s) => withoutAltar(s, id));
  },

  addItem: async (name, emoji, categoryId, note = '', imageData, createdAt) => {
    const db = await getDb();
    const created = createdAt ?? nowIso();
    const item: AltarItem = { id: generateId(), name, emoji, category_id: categoryId, note, image_data: imageData, created_at: created, updated_at: created };
    await db.execute(
      'INSERT INTO altar_items (id, name, emoji, category_id, note, image_data, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [item.id, item.name, item.emoji, item.category_id, item.note, item.image_data ?? null, item.created_at, item.updated_at]
    );
    set((s) => ({ items: [...s.items, item].sort((a, b) => a.name.localeCompare(b.name)) }));
    return item;
  },

  // serialized: see lib/serialize.ts.
  updateItem: (id, patch) => serialized(serialKey('altarItem', id), async () => {
    const db = await getDb();
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    const updated = { ...item, ...patch, updated_at: nowIso() };
    await db.execute(
      'UPDATE altar_items SET name=$1, emoji=$2, category_id=$3, note=$4, image_data=$5, updated_at=$6 WHERE id=$7',
      [updated.name, updated.emoji, updated.category_id, updated.note, updated.image_data ?? null, updated.updated_at, id]
    );
    const looksDifferent = updated.emoji !== item.emoji || (updated.image_data ?? null) !== (item.image_data ?? null);
    const stale = looksDifferent ? await dropThumbnailsShowing(db, id) : new Set<string>();
    set((s) => ({
      altars: withoutThumbnails(s.altars, stale),
      items: s.items.map((i) => (i.id === id ? updated : i)).sort((a, b) => a.name.localeCompare(b.name)),
      placements: s.placements.map((p) => (p.item_id === id ? { ...p, name: updated.name, emoji: updated.emoji, category_id: updated.category_id, image_data: updated.image_data } : p)),
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.item_id === id ? { ...p, name: updated.name, emoji: updated.emoji, category_id: updated.category_id, image_data: updated.image_data } : p),
    }));
  }),

  deleteItem: async (id) => {
    const db = await getDb();
    const stale = await dropThumbnailsShowing(db, id);
    await db.execute('UPDATE altar_items SET deleted_at=$1 WHERE id=$2', [nowIso(), id]);
    set((s) => withoutItem(s, id, stale));
  },

  restoreItem: async (id) => {
    // Already back (undo and trash one after the other).
    if (get().items.some((i) => i.id === id)) return;
    const db = await getDb();
    await db.execute('UPDATE altar_items SET deleted_at=NULL WHERE id=$1', [id]);
    const rows = await db.select<DbRow[]>('SELECT * FROM altar_items WHERE id=$1', [id]);
    if (!rows.length) return;
    const item = fromRow.altarItem(rows[0]);
    const stale = await dropThumbnailsShowing(db, id);
    // Reload only this item's placements, not `fetchAltars`:
    // that would reset the snapshot of an altar that is currently being edited.
    const back = mapPlacementRows(
      await db.select<DbRow[]>('SELECT * FROM altar_placements WHERE item_id=$1', [id]),
      [item],
    );
    set((s) => {
      const previewPlacements = { ...s.previewPlacements };
      for (const p of back) {
        if (p.altar_id && previewPlacements[p.altar_id]) previewPlacements[p.altar_id] = [...previewPlacements[p.altar_id], p];
      }
      return {
        items: [...s.items.filter((i) => i.id !== id), item].sort((a, b) => a.name.localeCompare(b.name)),
        altars: withoutThumbnails(s.altars, stale),
        previewPlacements,
        placements: [...s.placements, ...back.filter((p) => p.altar_id === s.activeAltarId)],
      };
    });
  },

  permanentlyDeleteItem: async (id) => {
    const db = await getDb();
    const stale = await dropThumbnailsShowing(db, id);
    await db.execute('DELETE FROM altar_placements WHERE item_id=$1', [id]);
    await db.execute('DELETE FROM altar_items WHERE id=$1', [id]);
    // From the trash it is no longer in the store; when rolling back an
    // import it still is.
    set((s) => withoutItem(s, id, stale));
  },

  placeItem: async (item, x, y) => {
    const db = await getDb();
    const altarId = get().activeAltarId;
    if (!altarId) return;
    const id = generateId();
    const maxZ = get().placements.reduce((max, p) => Math.max(max, p.z_index), -1);
    const nextZ = maxZ + 1;
    const placement: AltarPlacement = {
      id,
      altar_id: altarId,
      kind: 'item',
      item_id: item.id,
      name: item.name,
      emoji: item.emoji,
      category_id: item.category_id,
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
    await db.execute(INSERT_PLACEMENT, placementValues(placement, altarId));
    set((s) => ({
      placements: [...s.placements, placement],
      selectedPlacementIds: [id],
      previewPlacements: {
        ...s.previewPlacements,
        [altarId]: [...(s.previewPlacements[altarId] ?? []), placement],
      },
    }));
    await get().bumpAltarUpdatedAt(altarId);
  },

  selectPlacement: (id) => set({ selectedPlacementIds: id ? [id] : [] }),

  selectPlacements: (ids) => set({ selectedPlacementIds: ids }),

  applyPlacements: (next) => {
    const altarId = get().activeAltarId;
    if (!altarId) return Promise.resolve();
    const items = new Map(get().items.map((item) => [item.id, item]));
    const clamped = next
      // An item placement whose item is gone (or that never had one) has no row to stand on.
      .filter((p) => isDrawn(p) || items.has(p.item_id))
      .map((p) => {
        const safe = { ...p, ...clampPlacementPatch(p), altar_id: altarId };
        const item = items.get(p.item_id);
        return item && !isDrawn(p)
          ? { ...safe, name: item.name, emoji: item.emoji, category_id: item.category_id, image_data: item.image_data }
          : safe;
      });
    const before = new Map(get().placements.map((p) => [p.id, p]));
    const after = new Map(clamped.map((p) => [p.id, p]));
    const statements: [string, unknown[]][] = [];
    for (const p of clamped) {
      if (isDrawn(p)) continue;
      const old = before.get(p.id);
      if (!old) statements.push([INSERT_PLACEMENT, placementValues(p, altarId)]);
      else if (placementUpdateValues(old).some((v, i) => v !== placementUpdateValues(p)[i])) {
        statements.push([UPDATE_PLACEMENT, placementUpdateValues(p)]);
      }
    }
    for (const old of before.values()) {
      if (!isDrawn(old) && !after.has(old.id)) statements.push(['DELETE FROM altar_placements WHERE id=$1', [old.id]]);
    }
    const drawnBefore = altarElementsJson([...before.values()]);
    const drawnAfter = altarElementsJson(clamped);
    if (!statements.length && drawnBefore === drawnAfter) return Promise.resolve();
    // In the store at once: the canvas editor shows the new state in the same frame.
    set((s) => ({
      placements: clamped,
      selectedPlacementIds: s.selectedPlacementIds.filter((id) => after.has(id)),
      previewPlacements: { ...s.previewPlacements, [altarId]: clamped },
    }));
    return serialized(serialKey('altar', altarId), async () => {
      const db = await getDb();
      if (drawnBefore !== drawnAfter) statements.push(['UPDATE altars SET elements=$1 WHERE id=$2', [drawnAfter, altarId]]);
      await db.batch(statements);
    }).then(() => get().bumpAltarUpdatedAt(altarId));
  },

  movePlacement: (id, x, y) => {
    const safePatch = clampPlacementPatch({ x, y });
    // Only update the live `placements` slice.
    // `previewPlacements` (used by AltarCard thumbnails) is intentionally NOT
    // updated here because movePlacement may fire at pointer rate, and
    // rebuilding the entire previewPlacements map every frame causes AltarView
    // to re-render at pointer rate. The preview is synced on release via
    // savePlacementPosition, which is sufficient for thumbnail accuracy.
    set((s) => ({
      placements: s.placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p)),
    }));
  },

  savePlacementPosition: async (id, x, y) => {
    const db = await getDb();
    const safe = clampPlacementPatch({ x, y });
    const altarId = get().activeAltarId;
    const current = get().placements.find((p) => p.id === id);
    if (current && isDrawn(current)) {
      if (altarId) await writeAltarElements(altarId, get().placements.map((p) => (p.id === id ? { ...p, ...safe } : p)));
    } else {
      await db.execute('UPDATE altar_placements SET x=$1, y=$2 WHERE id=$3', [safe.x, safe.y, id]);
    }
    // Sync the final drag position into previewPlacements now that the drag is
    // complete. This is the only place we need to pay the per-altar map rebuild
    // cost, and it runs at most once per drag gesture (on release).
    set((s) => ({
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.id === id ? { ...p, ...safe } : p),
    }));
    if (altarId) await get().bumpAltarUpdatedAt(altarId);
  },

  // serialized: see lib/serialize.ts. bumpAltarUpdatedAt at the end stays
  // outside any chain — it only writes updated_at, which cannot collide.
  // Drawn shapes and text share the altar's chain: they are one column of it.
  updatePlacement: (id, patch) => {
    const current = get().placements.find((entry) => entry.id === id);
    const drawn = !!current && isDrawn(current);
    const altarId = current?.altar_id ?? get().activeAltarId;
    return serialized(drawn && altarId ? serialKey('altar', altarId) : serialKey('placement', id), async () => {
      const latest = get().placements.find((entry) => entry.id === id);
      if (!latest) return;
      const safePatch = clampPlacementPatch(patch);
      // Nothing changed (e.g. snapping to the same size): write nothing, stamp nothing.
      if (Object.entries(safePatch).every(([key, value]) => latest[key as keyof AltarPlacement] === value)) return;
      const next = { ...latest, ...safePatch };
      if (drawn && altarId) {
        await writeAltarElements(altarId, get().placements.map((p) => (p.id === id ? next : p)));
      } else {
        const db = await getDb();
        await db.execute(UPDATE_PLACEMENT, placementUpdateValues(next));
      }
      set((s) => ({
        placements: s.placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p)),
        previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.id === id ? { ...p, ...safePatch } : p),
      }));
      const activeAltarId = get().activeAltarId;
      if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
    });
  },

  duplicatePlacement: async (id) => {
    const altarId = get().activeAltarId;
    if (!altarId) return;
    const source = get().placements.find((p) => p.id === id);
    if (!source) return;
    const maxZ = get().placements.reduce((max, p) => Math.max(max, p.z_index), -1);
    const copy: AltarPlacement = {
      ...source,
      id: generateId(),
      altar_id: altarId,
      x: Math.min(100, source.x + 2),
      y: Math.min(100, source.y + 2),
      z_index: maxZ + 1,
      locked: false,
      hidden: false,
      // A copy from the sidebar stands on its own.
      group: undefined,
    };
    if (isDrawn(copy)) {
      await writeAltarElements(altarId, [...get().placements, copy]);
    } else {
      const db = await getDb();
      await db.execute(INSERT_PLACEMENT, placementValues(copy, altarId));
    }
    set((s) => ({
      placements: [...s.placements, copy],
      selectedPlacementIds: [copy.id],
      previewPlacements: {
        ...s.previewPlacements,
        [altarId]: [...(s.previewPlacements[altarId] ?? []), copy],
      },
    }));
    await get().bumpAltarUpdatedAt(altarId);
  },

  removePlacement: async (id) => {
    const removed = get().placements.find((p) => p.id === id);
    if (removed && isDrawn(removed) && removed.altar_id) {
      await writeAltarElements(removed.altar_id, get().placements.filter((p) => p.id !== id));
    } else {
      const db = await getDb();
      await db.execute('DELETE FROM altar_placements WHERE id=$1', [id]);
    }
    set((s) => ({
      placements: s.placements.filter((p) => p.id !== id),
      selectedPlacementIds: s.selectedPlacementIds.filter((sel) => sel !== id),
      previewPlacements: filterEachPreview(s.previewPlacements, (p) => p.id !== id),
    }));
    if (removed?.altar_id) await get().bumpAltarUpdatedAt(removed.altar_id);
    return removed;
  },

  restorePlacement: async (placement) => {
    const { altars, items } = get();
    const altarId = placement.altar_id;
    if (!altarId || !altars.some((altar) => altar.id === altarId)) return;
    let back: AltarPlacement;
    if (isDrawn(placement)) {
      const current = placementsOf(get(), altarId);
      // Cancelling the edit may already have brought it back.
      if (current.some((p) => p.id === placement.id)) return;
      await writeAltarElements(altarId, [...current, placement]);
      back = placement;
    } else {
      const item = items.find((entry) => entry.id === placement.item_id);
      if (!item) return;
      const db = await getDb();
      // OR IGNORE: cancelling the edit may already have brought it back.
      const { rowsAffected } = await db.execute(
        INSERT_PLACEMENT.replace('INSERT INTO', 'INSERT OR IGNORE INTO'),
        placementValues(placement, altarId),
      );
      if (!rowsAffected) return;
      // Name, emoji and image in the item's current version.
      back = { ...placement, name: item.name, emoji: item.emoji, category_id: item.category_id, image_data: item.image_data };
    }
    set((s) => ({
      placements: s.activeAltarId === altarId ? [...s.placements, back] : s.placements,
      previewPlacements: s.previewPlacements[altarId]
        ? { ...s.previewPlacements, [altarId]: [...s.previewPlacements[altarId], back] }
        : s.previewPlacements,
    }));
    await get().bumpAltarUpdatedAt(altarId);
  },
}));
