import { createTextBlock, parseBlocks, serializeBlocks } from './blocks/blockHtml';
import { ALTAR_BLOCK_TYPE, CANVAS_BLOCK_HEIGHT, CANVAS_BLOCK_WIDTH, createCanvasBlock, parseCanvasBlock, storedCanvasElement, withCanvasScene, type StoredCanvasElement } from './blocks/canvas';
import { FIELDS_BLOCK_TYPE } from './blocks/fields';
import { BLOCK_ATTR, type BlockInstance } from './blocks/types';
import { placementToElement } from './altarScene';
import { parseAltarElements } from './altarElements';
import { parseAltarSettings } from './altarSettings';
import { altarCanvasBackground } from './altarBackground';
import { DEFAULT_ALTAR_RESOLUTION, resolveResolutionPixels } from './altarConstants';
import { storedImageName } from './schema';
import type { AltarPlacement } from '../types';

/**
 * Altars become operations of the "Altars" category (migration v62 and the
 * import of older backups and `.emerald` files).
 *
 * - Every altar becomes an operation **under its own ID**, so that links,
 *   tasks and the altar fields keep pointing at it, and so that two synced
 *   devices that convert the same altar arrive at the same row. Its content
 *   is what the template "Altar" gives: an altar block — the placements and
 *   the drawn elements as the scene, background and guides from its
 *   settings, at its resolution — and an empty text for notes; the block IDs
 *   follow from the altar's ID as well. The grid has no place in the block and goes.
 * - Every library item with a picture becomes a picture of "Images" under
 *   the item's ID, with its name and note; an item in the trash, a picture
 *   in the trash. A picture still inline (Base64) is stored as a file first
 *   (`storeDataUrl`). An item without a picture (an emoji) stays on the canvas as
 *   its emoji, a candle flickering as before.
 * - A placement of an item in the trash was not shown and is left out.
 *
 * Pure apart from `storeDataUrl`: the migration and the import hand in the
 * rows they read and write what comes back.
 */

export type Row = Record<string, unknown>;

export interface AltarSource {
  altars: Row[];
  items: Row[];
  placements: Row[];
}

export interface ConvertedOperation {
  id: string;
  title: string;
  content: string;
  icon: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ConvertedImage {
  id: string;
  file: string;
  name: string;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ConvertedAltars {
  operations: ConvertedOperation[];
  images: ConvertedImage[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const flag = (v: unknown): boolean => v === true || (v != null && v !== false && Number(v) === 1);

/** An icon an operation can carry: an emoji or an inline picture, as entries keep them. */
function entryIcon(v: unknown): string | null {
  const icon = strOrNull(v);
  if (!icon) return null;
  if (icon.startsWith('data:image/')) return icon;
  return icon.length <= 16 && !icon.includes('/') ? icon : null;
}

/** The IDs the converted content uses: fixed by the altar's, so that every device writes the same. */
export function altarBlockIds(altarId: string): { altar: string; notes: string } {
  return { altar: `altar-${altarId}`.slice(0, 64), notes: `notes-${altarId}`.slice(0, 64) };
}

export async function convertAltars(
  source: AltarSource,
  storeDataUrl: (dataUrl: string) => Promise<string | null>,
): Promise<ConvertedAltars> {
  // The items' pictures as files; an unreadable one becomes no picture.
  const itemFile = new Map<string, string | null>();
  const images: ConvertedImage[] = [];
  const byFile = new Map<string, ConvertedImage>();
  for (const item of source.items) {
    const id = str(item.id);
    if (!id) continue;
    const raw = str(item.image_data);
    let file = storedImageName(raw);
    if (!file && raw.startsWith('data:image/')) file = await storeDataUrl(raw);
    itemFile.set(id, file);
    if (!file) continue;
    const created = str(item.created_at) || new Date().toISOString();
    const image: ConvertedImage = {
      id,
      file,
      name: str(item.name).trim(),
      note: str(item.note),
      created_at: created,
      updated_at: str(item.updated_at) || created,
      deleted_at: strOrNull(item.deleted_at),
    };
    // One picture per file: an active item wins over one in the trash.
    const held = byFile.get(file);
    if (held && (held.deleted_at === null || image.deleted_at !== null)) continue;
    if (held) images.splice(images.indexOf(held), 1);
    byFile.set(file, image);
    images.push(image);
  }
  const itemById = new Map(source.items.map((item) => [str(item.id), item]));

  const operations: ConvertedOperation[] = [];
  for (const altar of source.altars) {
    const id = str(altar.id);
    if (!id) continue;
    const settings = parseAltarSettings(altar.settings ?? altar);
    const { w: width, h: height } = resolveResolutionPixels(settings.resolution ?? DEFAULT_ALTAR_RESOLUTION);

    const placed: AltarPlacement[] = [];
    for (const p of source.placements) {
      if (str(p.altar_id) !== id) continue;
      const item = itemById.get(str(p.item_id));
      if (!item || item.deleted_at) continue;
      placed.push({
        id: str(p.id),
        kind: 'item',
        item_id: str(p.item_id),
        name: str(item.name),
        emoji: str(item.emoji) || '✨',
        category_id: null,
        x: num(p.x, 50),
        y: num(p.y, 50),
        z_index: Math.round(num(p.z_index, 0)),
        width: num(p.width, 8),
        height: num(p.height, 8),
        rotation: num(p.rotation, 0),
        opacity: num(p.opacity, 1),
        locked: flag(p.locked),
        hidden: flag(p.hidden),
        ...(strOrNull(p.group_id) ? { group: str(p.group_id) } : {}),
      });
    }
    placed.push(...parseAltarElements(altar.elements, id));

    const elements: StoredCanvasElement[] = placed.map((p) => {
      const file = p.kind === 'item' ? itemFile.get(p.item_id) ?? null : null;
      const { ref: _ref, ...el } = placementToElement(p, width, height, () => file);
      return storedCanvasElement({ ...el, ...(file ? { ref: file } : {}) });
    });

    const background = altarCanvasBackground({
      ...settings,
      background_image_data: strOrNull(altar.background_image_data),
    });
    const guides = settings.guides.map((g) => ({ ...g, at: (g.at / 100) * (g.orientation === 'vertical' ? width : height) }));

    const ids = altarBlockIds(id);
    const block: BlockInstance = { ...createCanvasBlock(ALTAR_BLOCK_TYPE), id: ids.altar };
    const altarBlock = withCanvasScene(block, {
      ...parseCanvasBlock(block).scene,
      width: width || CANVAS_BLOCK_WIDTH,
      height: height || CANVAS_BLOCK_HEIGHT,
      elements,
      background,
      guides,
      guidesLocked: settings.guides_locked,
    }, null);
    const created = str(altar.created_at) || new Date().toISOString();
    operations.push({
      id,
      title: str(altar.title),
      content: serializeBlocks([altarBlock, { ...createTextBlock(), id: ids.notes }]),
      icon: entryIcon(altar.icon_data),
      created_at: created,
      updated_at: str(altar.updated_at) || created,
      deleted_at: strOrNull(altar.deleted_at),
    });
  }
  return { operations, images };
}

const ALTAR_CHIP_RE = /data-entry-type="altar"/g;

/**
 * A field block's altar elements become link elements: their chip already
 * points at the right ID, since the operation keeps the altar's. A default
 * that named an altar names the operation.
 */
function linkElements(elements: unknown): { changed: boolean; elements: unknown } {
  if (!Array.isArray(elements)) return { changed: false, elements };
  let changed = false;
  const next = elements.map((el) => {
    if (!el || typeof el !== 'object') return el;
    const e = el as Record<string, unknown>;
    const def = e.defaultValue && typeof e.defaultValue === 'object' ? e.defaultValue as Record<string, unknown> : null;
    if (e.kind !== 'altar' && def?.entryType !== 'altar') return el;
    changed = true;
    return {
      ...e,
      ...(e.kind === 'altar' ? { kind: 'link' } : {}),
      ...(def?.entryType === 'altar' ? { defaultValue: { ...def, entryType: 'operation' } } : {}),
    };
  });
  return { changed, elements: next };
}

/**
 * Content with every link to an altar pointing at its operation: the chips
 * change their type (the ID stays), altar fields become link fields.
 * Unchanged content comes back as it was.
 */
export function contentWithAltarsAsOperations(content: string): string {
  if (!content.includes('altar')) return content;
  const blocks = parseBlocks(content);
  let changed = false;
  const next = blocks.map((block) => {
    let html = block.html;
    if (ALTAR_CHIP_RE.test(html)) html = html.replace(ALTAR_CHIP_RE, 'data-entry-type="operation"');
    ALTAR_CHIP_RE.lastIndex = 0;
    let attrs = block.attrs;
    if (block.type === FIELDS_BLOCK_TYPE && attrs[BLOCK_ATTR.config]?.includes('altar')) {
      try {
        const config = JSON.parse(attrs[BLOCK_ATTR.config]) as Record<string, unknown>;
        const linked = linkElements(config.elements);
        if (linked.changed) attrs = { ...attrs, [BLOCK_ATTR.config]: JSON.stringify({ ...config, elements: linked.elements }) };
      } catch {
        // Unreadable: the block stays as it is, like everywhere else.
      }
    }
    if (html === block.html && attrs === block.attrs) return block;
    changed = true;
    return { ...block, html, attrs };
  });
  return changed ? serializeBlocks(next) : content;
}

/**
 * The same for `elements` as an import reads them, a JSON string or already a
 * list: before anything checks them, since an altar element or an altar
 * default is no longer valid there.
 */
export function elementsWithAltarsAsOperations(elements: unknown): unknown {
  if (typeof elements === 'string') return definitionElementsWithAltarsAsOperations(elements);
  return linkElements(elements).elements;
}

/** The `elements` of a block definition with its altar elements as link elements; unchanged as it was. */
export function definitionElementsWithAltarsAsOperations(raw: string): string {
  if (!raw.includes('altar')) return raw;
  try {
    const linked = linkElements(JSON.parse(raw));
    return linked.changed ? JSON.stringify(linked.elements) : raw;
  } catch {
    return raw;
  }
}
