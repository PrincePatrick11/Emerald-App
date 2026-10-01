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

// name, emoji, category_id und image_data sind keine Spalten von
// altar_placements — sie stammen aus dem zugehörigen altar_items-Eintrag.
// Die Spalte `scale`, aus der frühere Versionen eine Ersatzgröße abgeleitet
// haben, ist mit Migration v33 entfallen: width und height sind seitdem
// NOT NULL und tragen ihren eigenen Default.
function mapPlacementRows(rows: DbRow[], items: AltarItem[]): AltarPlacement[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => {
    const item = itemsById.get(String(r.item_id));
    return {
      id: String(r.id),
      altar_id: String(r.altar_id),
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
      image_data: item?.image_data,
    };
  });
}

/**
 * Die Platzierungen, die zu sehen sind: ohne die von Elementen im Papierkorb.
 * Die bleiben in der Datenbank stehen und kommen mit dem Element zurück.
 */
const LIVE_PLACEMENTS = `SELECT p.* FROM altar_placements p
  JOIN altar_items i ON i.id = p.item_id AND i.deleted_at IS NULL`;

async function fetchPlacementsForAltar(altarId: string, items: AltarItem[]): Promise<AltarPlacement[]> {
  const db = await getDb();
  const rows = await db.select<DbRow[]>(`${LIVE_PLACEMENTS} WHERE p.altar_id=$1`, [altarId]);
  return mapPlacementRows(rows, items);
}

function normalizeAltar(altar: AltarRecord): AltarRecord {
  return {
    ...altar,
    ...parseAltarSettings(altar),
    background_image_data: altar.background_image_data ?? null,
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

  fetchAltars: () => Promise<void>;
  setActiveAltar: (id: string) => Promise<void>;
  clearActiveAltar: () => void;
  /** `createdAt` nur für den Import, der das Datum der Datei übernimmt; sonst jetzt. */
  createAltar: (opts?: { createdAt?: string }) => Promise<AltarRecord>;
  duplicateAltar: (id: string) => Promise<AltarRecord | null>;
  updateAltar: (id: string, patch: Partial<Pick<AltarRecord, 'title' | 'background_preset' | 'background_image_data' | 'background_overlay' | 'background_overlay_color' | 'thumbnail_data' | 'icon_data'>>, options?: WriteOptions) => Promise<void>;
  updateAltarGrid: (id: string, patch: Partial<Pick<AltarRecord, 'grid_enabled' | 'grid_size' | 'grid_opacity' | 'grid_color' | 'snap_to_grid' | 'rotation_snap_enabled' | 'rotation_snap_angle' | 'snap_scale_to_grid'>>) => Promise<void>;
  updateAltarResolution: (id: string, resolution: string) => Promise<void>;
  bumpAltarUpdatedAt: (id: string) => Promise<void>;
  /** Soft-Delete: in den Papierkorb. Platzierungen und Verknüpfungen auf den Altar bleiben, für den Rückweg. */
  deleteAltar: (id: string) => Promise<void>;
  restoreAltar: (id: string) => Promise<void>;
  /**
   * Cancel im Altar (`altarEdit.ts`): schreibt den Altar und seine
   * Platzierungen zurück, wie sie beim Betreten des Bearbeitens waren — samt
   * Zeitstempel und Vorschaubild, damit er in den Listen steht, wo er stand.
   * Wirft, wenn das Schreiben scheitert; ein zweiter Aufruf bringt es zu Ende.
   */
  restoreAltarSnapshot: (altar: AltarRecord, placements: readonly AltarPlacement[]) => Promise<void>;
  permanentlyDeleteAltar: (id: string) => Promise<void>;

  /** `createdAt` nur für den Import, der das Datum der Datei übernimmt;
   *  sonst jetzt. */
  addItem: (name: string, emoji: string, categoryId: string | null, note?: string, imageData?: string, createdAt?: string) => Promise<AltarItem>;
  updateItem: (id: string, patch: Partial<Pick<AltarItem, 'name' | 'emoji' | 'category_id' | 'note' | 'image_data'>>) => Promise<void>;
  /** In den Papierkorb — samt Platzierungen aus dem Blick, nicht aus der Datenbank. */
  deleteItem: (id: string) => Promise<void>;
  restoreItem: (id: string) => Promise<void>;
  permanentlyDeleteItem: (id: string) => Promise<void>;
  placeItem: (item: AltarItem, x: number, y: number) => Promise<void>;
  selectPlacement: (id: string | null) => void;
  movePlacement: (id: string, x: number, y: number) => void;
  savePlacementPosition: (id: string, x: number, y: number) => Promise<void>;
  updatePlacement: (id: string, patch: Partial<Pick<AltarPlacement, 'x' | 'y' | 'z_index' | 'width' | 'height' | 'rotation' | 'opacity' | 'locked' | 'hidden'>>) => Promise<void>;
  duplicatePlacement: (id: string) => Promise<void>;
  /** Nimmt eine Platzierung vom Altar und gibt sie zurück — für das Rückgängig (`restorePlacement`). */
  removePlacement: (id: string) => Promise<AltarPlacement | undefined>;
  /** Legt eine entfernte Platzierung wieder hin, wie sie war — sofern Altar und Element noch da sind. */
  restorePlacement: (placement: AltarPlacement) => Promise<void>;
}

/**
 * Verwirft die Vorschaubilder der Altäre, auf denen Element `itemId` liegt —
 * sie zeigten es noch, wie es war. Die Karte fällt bis zum nächsten Rechnen
 * auf die Live-Vorschau zurück. Eine Folge, keine Änderung am Altar: „Zuletzt
 * geändert" bleibt.
 */
async function dropThumbnailsShowing(db: Awaited<ReturnType<typeof getDb>>, itemId: string): Promise<Set<string>> {
  const rows = await db.select<{ altar_id: string }[]>(
    'SELECT DISTINCT altar_id FROM altar_placements WHERE item_id=$1', [itemId]
  );
  const ids = new Set(rows.map((r) => r.altar_id));
  for (const id of ids) await db.execute('UPDATE altars SET thumbnail_data=NULL WHERE id=$1', [id]);
  return ids;
}

/** Der Store ohne das Element `id` und seine Platzierungen; `stale` = Altäre ohne gültiges Vorschaubild. */
function withoutItem(s: AltarState, id: string, stale: Set<string>): Partial<AltarState> {
  return {
    altars: s.altars.map((a) => (stale.has(a.id) ? { ...a, thumbnail_data: null } : a)),
    items: s.items.filter((i) => i.id !== id),
    placements: s.placements.filter((p) => p.item_id !== id),
    previewPlacements: filterEachPreview(s.previewPlacements, (p) => p.item_id !== id),
    ...(s.placements.some((p) => p.id === s.selectedPlacementId && p.item_id === id) ? { selectedPlacementId: null } : {}),
  };
}

/** Der Store ohne den Altar `id` — in den Papierkorb gelegt oder endgültig gelöscht. */
function withoutAltar(s: AltarState, id: string): Partial<AltarState> {
  const { [id]: _removed, ...previewPlacements } = s.previewPlacements;
  return {
    altars: s.altars.filter((altar) => altar.id !== id),
    previewPlacements,
    ...(s.activeAltarId === id ? { activeAltarId: null, placements: [], selectedPlacementId: null } : {}),
  };
}

export const useAltarStore = create<AltarState>((set, get) => ({
  altars: [],
  activeAltarId: null,
  items: [],
  placements: [],
  selectedPlacementId: null,
  previewPlacements: {},

  fetchAltars: async () => {
    const db = await getDb();
    const itemRows = await db.select<DbRow[]>('SELECT * FROM altar_items WHERE deleted_at IS NULL ORDER BY name ASC');
    const items = itemRows.map(fromRow.altarItem);
    const altarRows = await db.select<DbRow[]>('SELECT * FROM altars WHERE deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC');
    const altars = altarRows.map(fromRow.altar).map(normalizeAltar);
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
    // Eine Query fuer alle Altaere statt einer pro Altar — das lief frueher als
    // N+1 bei jedem App-Start und jedem Mount der AltarView.
    const placementRows = await db.select<DbRow[]>(LIVE_PLACEMENTS);
    const allPlacements = mapPlacementRows(placementRows, items);
    const previewPlacements: Record<string, AltarPlacement[]> = Object.fromEntries(
      altars.map((altar) => [altar.id, [] as AltarPlacement[]])
    );
    for (const placement of allPlacements) {
      if (placement.altar_id) previewPlacements[placement.altar_id]?.push(placement);
    }
    const placements = activeAltar ? previewPlacements[activeAltar.id] ?? [] : [];
    set({
      items,
      altars,
      activeAltarId: activeAltar?.id ?? null,
      placements,
      selectedPlacementId: null,
      previewPlacements,
    });
  },

  setActiveAltar: async (id) => {
    const { items, altars } = get();
    const active = altars.find((altar) => altar.id === id);
    if (!active) return;
    const placements = await fetchPlacementsForAltar(id, items);
    set({ activeAltarId: id, placements, selectedPlacementId: null });
  },

  clearActiveAltar: () => {
    set({ activeAltarId: null, placements: [], selectedPlacementId: null });
  },

  createAltar: async ({ createdAt } = {}) => {
    const now = nowIso();
    const altar: AltarRecord = {
      id: generateId(),
      // Leer — angezeigt wird „Unbenannter Altar" (`displayTitle`).
      title: '',
      // Ohne Vorgabe: lauter Standardwerte.
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
      selectedPlacementId: null,
      // Auch leer ein Eintrag: wer die Platzierungen eines Altars dort sucht, soll ihn finden.
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
    }[]>(
      `SELECT p.item_id, p.x, p.y, p.z_index, p.width, p.height, p.rotation, p.opacity, p.locked, p.hidden
         FROM (${LIVE_PLACEMENTS}) p WHERE p.altar_id=$1`,
      [id],
    );

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

    // Samt den Platzierungen: ohne sie zeigte die Karte die Kopie leer, und
    // wer sie dort nachschlägt (`altarEdit.ts`), hielte sie für leer.
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
      [updated.title, altarSettingsJson(parseAltarSettings(updated)), updated.background_image_data ?? null, updated.updated_at, updated.thumbnail_data ?? null, updated.icon_data ?? null, id]
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
    // Das Vorschaubild bleibt: „Fertig" und das Verlassen rechnen es ohnehin
    // neu, und ein Import brächte sonst sein passendes nicht mit.
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
    // Platzierungen und die Verknüpfungen, die auf den Altar zeigen, bleiben
    // stehen — wie bei einer Aufgabe: der Soft-Delete ist umkehrbar, und
    // `sweepDanglingTaskLinks` zählt Papierkorb-Inhalte als gültig.
    set((s) => withoutAltar(s, id));
  },

  restoreAltar: async (id) => {
    const db = await getDb();
    await db.execute('UPDATE altars SET deleted_at=NULL WHERE id=$1', [id]);
    // Nur diesen Altar nachladen, nicht `fetchAltars`: das setzte auch den
    // Stand eines anderen zurück, der gerade bearbeitet wird.
    const rows = await db.select<DbRow[]>('SELECT * FROM altars WHERE id=$1', [id]);
    if (!rows.length) return;
    const altar = normalizeAltar(fromRow.altar(rows[0]));
    const placements = await fetchPlacementsForAltar(id, get().items);
    set((s) => ({
      altars: [altar, ...s.altars.filter((entry) => entry.id !== id)]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      previewPlacements: { ...s.previewPlacements, [id]: placements },
    }));
  },

  restoreAltarSnapshot: (altar, placements) => serialized(serialKey('altar', altar.id), async () => {
    const db = await getDb();
    if (!get().altars.some((entry) => entry.id === altar.id)) return;
    await db.execute(
      `UPDATE altars SET
        title=$1, settings=$2, background_image_data=$3, thumbnail_data=$4, icon_data=$5, updated_at=$6
       WHERE id=$7`,
      [
        altar.title, altarSettingsJson(parseAltarSettings(altar)), altar.background_image_data ?? null,
        altar.thumbnail_data ?? null, altar.icon_data ?? null, altar.updated_at,
        altar.id,
      ],
    );

    // Ein Element, das inzwischen aus der Bibliothek gelöscht wurde, hat
    // keine Zeile mehr, an der seine Platzierung hängen könnte.
    const items = get().items;
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const restored = placements
      .filter((placement) => itemsById.has(placement.item_id))
      // Name, Emoji und Bild in der heutigen Fassung des Elements.
      .map((placement) => {
        const item = itemsById.get(placement.item_id)!;
        return { ...placement, name: item.name, emoji: item.emoji, category_id: item.category_id, image_data: item.image_data };
      });
    // Ohne Transaktion, deshalb so, dass ein abgebrochener Lauf sich
    // wiederholen lässt: erst jede gemerkte Platzierung anlegen oder auf ihren
    // Stand bringen, dann weg, was nicht dazugehört. Nie steht der Altar
    // dazwischen ohne die Platzierungen da, die er hatte.
    for (const p of restored) {
      await db.execute(
        `INSERT INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(id) DO UPDATE SET
           altar_id=excluded.altar_id, item_id=excluded.item_id, x=excluded.x, y=excluded.y, z_index=excluded.z_index,
           width=excluded.width, height=excluded.height, rotation=excluded.rotation, opacity=excluded.opacity,
           locked=excluded.locked, hidden=excluded.hidden`,
        [p.id, altar.id, p.item_id, p.x, p.y, p.z_index, p.width, p.height, p.rotation, p.opacity, toInt(p.locked), toInt(p.hidden)],
      );
    }
    // Die Platzierungen von Elementen im Papierkorb gehören nicht zum
    // gemerkten Stand, und doch zum Altar: sie bleiben.
    const kept = restored.map((_, i) => `$${i + 2}`).join(', ');
    await db.execute(
      `DELETE FROM altar_placements WHERE altar_id=$1
         AND item_id IN (SELECT id FROM altar_items WHERE deleted_at IS NULL)${restored.length ? ` AND id NOT IN (${kept})` : ''}`,
      [altar.id, ...restored.map((p) => p.id)],
    );

    set((s) => ({
      altars: s.altars
        .map((entry) => (entry.id === altar.id ? altar : entry))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      previewPlacements: { ...s.previewPlacements, [altar.id]: restored },
      ...(s.activeAltarId === altar.id
        ? { placements: restored, selectedPlacementId: null }
        : {}),
    }));
  }),

  permanentlyDeleteAltar: async (id) => {
    const db = await getDb();
    await db.execute('DELETE FROM altar_placements WHERE altar_id=$1', [id]);
    // Altäre sind Link-Ziele von task_links (polymorph, ohne Foreign Key).
    await db.execute('DELETE FROM task_links WHERE target_id=$1', [id]);
    await db.execute('DELETE FROM altars WHERE id=$1', [id]);
    // Nur aus dem Papierkorb oder beim Zurückrollen eines Imports erreichbar;
    // steht er doch noch im Store, geht er dort mit.
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
      altars: stale.size ? s.altars.map((a) => (stale.has(a.id) ? { ...a, thumbnail_data: null } : a)) : s.altars,
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
    const db = await getDb();
    await db.execute('UPDATE altar_items SET deleted_at=NULL WHERE id=$1', [id]);
    const rows = await db.select<DbRow[]>('SELECT * FROM altar_items WHERE id=$1', [id]);
    if (!rows.length) return;
    const item = fromRow.altarItem(rows[0]);
    const stale = await dropThumbnailsShowing(db, id);
    // Nur die Platzierungen dieses Elements nachladen, nicht `fetchAltars`:
    // das setzte den Stand eines Altars zurück, der gerade bearbeitet wird.
    const back = mapPlacementRows(
      await db.select<DbRow[]>('SELECT * FROM altar_placements WHERE item_id=$1', [id]),
      [item],
    );
    set((s) => {
      const previewPlacements = { ...s.previewPlacements };
      for (const p of back) {
        const list = p.altar_id ? previewPlacements[p.altar_id] : undefined;
        if (list && p.altar_id) previewPlacements[p.altar_id] = [...list, p];
      }
      return {
        items: [...s.items.filter((i) => i.id !== id), item].sort((a, b) => a.name.localeCompare(b.name)),
        altars: s.altars.map((a) => (stale.has(a.id) ? { ...a, thumbnail_data: null } : a)),
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
    // Aus dem Papierkorb steht es nicht mehr im Store; beim Zurückrollen eines
    // Imports schon.
    set((s) => withoutItem(s, id, stale));
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

  // serialized: see lib/serialize.ts. bumpAltarUpdatedAt at the end stays
  // outside any chain — it only writes updated_at, which cannot collide.
  updatePlacement: (id, patch) => serialized(serialKey('placement', id), async () => {
    const db = await getDb();
    const current = get().placements.find((entry) => entry.id === id);
    if (!current) return;
    const safePatch = clampPlacementPatch(patch);
    // Nichts geändert (etwa ein Einrasten auf dieselbe Größe): nichts schreiben, nichts stempeln.
    if (Object.entries(safePatch).every(([key, value]) => current[key as keyof AltarPlacement] === value)) return;
    const next = { ...current, ...safePatch };
    await db.execute(
      'UPDATE altar_placements SET x=$1, y=$2, z_index=$3, width=$4, height=$5, rotation=$6, opacity=$7, locked=$8, hidden=$9 WHERE id=$10',
      [next.x, next.y, next.z_index, next.width, next.height, next.rotation, next.opacity, toInt(next.locked), toInt(next.hidden), id]
    );
    set((s) => ({
      placements: s.placements.map((p) => (p.id === id ? { ...p, ...safePatch } : p)),
      previewPlacements: mapEachPreview(s.previewPlacements, (p) => p.id === id ? { ...p, ...safePatch } : p),
    }));
    const activeAltarId = get().activeAltarId;
    if (activeAltarId) await get().bumpAltarUpdatedAt(activeAltarId);
  }),

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
      category_id: source.category_id,
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
    const removed = get().placements.find((p) => p.id === id);
    const db = await getDb();
    await db.execute('DELETE FROM altar_placements WHERE id=$1', [id]);
    set((s) => ({
      placements: s.placements.filter((p) => p.id !== id),
      selectedPlacementId: s.selectedPlacementId === id ? null : s.selectedPlacementId,
      previewPlacements: filterEachPreview(s.previewPlacements, (p) => p.id !== id),
    }));
    if (removed?.altar_id) await get().bumpAltarUpdatedAt(removed.altar_id);
    return removed;
  },

  restorePlacement: async (placement) => {
    const { altars, items } = get();
    const altarId = placement.altar_id;
    const item = items.find((entry) => entry.id === placement.item_id);
    if (!altarId || !item || !altars.some((altar) => altar.id === altarId)) return;
    const db = await getDb();
    // OR IGNORE: ein Abbrechen der Bearbeitung kann sie schon zurückgebracht haben.
    const { rowsAffected } = await db.execute(
      'INSERT OR IGNORE INTO altar_placements (id, altar_id, item_id, x, y, z_index, width, height, rotation, opacity, locked, hidden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [placement.id, altarId, placement.item_id, placement.x, placement.y, placement.z_index, placement.width,
        placement.height, placement.rotation, placement.opacity, toInt(placement.locked), toInt(placement.hidden)]
    );
    if (!rowsAffected) return;
    // Name, Emoji und Bild in der heutigen Fassung des Elements.
    const back = { ...placement, name: item.name, emoji: item.emoji, category_id: item.category_id, image_data: item.image_data };
    set((s) => ({
      placements: s.activeAltarId === altarId ? [...s.placements, back] : s.placements,
      previewPlacements: s.previewPlacements[altarId]
        ? { ...s.previewPlacements, [altarId]: [...s.previewPlacements[altarId], back] }
        : s.previewPlacements,
    }));
    await get().bumpAltarUpdatedAt(altarId);
  },
}));
