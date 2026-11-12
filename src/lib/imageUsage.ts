import type Database from './sqlite';
import type { EntryType } from '../types';
import { decodeHtmlAttr, parseBlocks, serializeBlocks } from './blocks/blockHtml';
import type { BlockRefRole } from './blocks/blockRefs';
import type { BlockInstance } from './blocks/types';
import { FIELDS_BLOCK_TYPE, isSigilElement, parseFields, withoutElementContent } from './blocks/fields';
import { isDrawingBlockType } from './blocks/paint';
import { isCanvasBlockType, withoutCanvasFile } from './blocks/canvas';
import { storedImageName } from './schema';

/**
 * Where the vault's pictures are used — for "Images": which entries show a
 * picture, and which pictures are not pictures of their own but the thing
 * itself (a drawing's render or layer, a canvas background), kept out of the
 * grid. Read from `block_refs`, which every save of a block rewrites
 * (`lib/blocks/blockRefs.ts`), so the roles are the ones it gives.
 */

/** How a place uses a picture — the roles of `block_refs` (`BlockRefRole`). */
export type ImageUseRole = BlockRefRole;

export interface ImageUse {
  kind: 'entry' | 'template' | 'blockDefinition';
  id: string;
  title: string;
  /** For an entry: its type, to open it. */
  entryType?: EntryType;
  role: ImageUseRole;
}

const IMAGE_NAME_RE = /[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg)/g;

function namesIn(text: string | null | undefined): string[] {
  return [...new Set((text ?? '').match(IMAGE_NAME_RE) ?? [])];
}

/** Which role a place is listed under when it uses a picture in several ways: the one most like a picture of its own. */
const ROLE_RANK: Record<ImageUseRole, number> = { content: 0, default: 1, background: 2, render: 3, layer: 4 };

interface RefRow {
  file: string;
  role: ImageUseRole;
  entry_id: string | null;
  entry_type: EntryType | null;
  entry_title: string | null;
  template_id: string | null;
  template_name: string | null;
}

/** Every picture in use by a live entry, template or custom block, with every place that uses it. */
export async function collectImageUses(db: Database): Promise<Map<string, ImageUse[]>> {
  const byPlace = new Map<string, Map<string, ImageUse>>();
  const add = (file: string, use: ImageUse) => {
    if (!storedImageName(file)) return;
    const places = byPlace.get(file) ?? new Map<string, ImageUse>();
    byPlace.set(file, places);
    const key = `${use.kind}:${use.id}`;
    const seen = places.get(key);
    if (!seen || ROLE_RANK[use.role] < ROLE_RANK[seen.role]) places.set(key, use);
  };

  const refs = await db.select<RefRow[]>(
    `SELECT r.target AS file, r.role,
            e.id AS entry_id, e.type AS entry_type, e.title AS entry_title,
            t.id AS template_id, t.name AS template_name
       FROM block_refs r
       JOIN blocks b ON b.row_id = r.block_row
       LEFT JOIN entries e ON e.id = b.entry_id AND e.deleted_at IS NULL
       LEFT JOIN templates t ON t.id = b.template_id AND t.deleted_at IS NULL
      WHERE r.target_kind = 'image' AND (e.id IS NOT NULL OR t.id IS NOT NULL)`
  );
  for (const ref of refs) {
    if (ref.entry_id) {
      add(ref.file, { kind: 'entry', id: ref.entry_id, title: ref.entry_title ?? '', entryType: ref.entry_type ?? undefined, role: ref.role });
    } else if (ref.template_id) {
      add(ref.file, { kind: 'template', id: ref.template_id, title: ref.template_name ?? '', role: ref.role });
    }
  }

  const definitions = await db.select<{ id: string; name: string; elements: string | null }[]>(
    'SELECT id, name, elements FROM block_definitions WHERE deleted_at IS NULL'
  );
  for (const definition of definitions) {
    for (const file of namesIn(definition.elements)) {
      add(file, { kind: 'blockDefinition', id: definition.id, title: definition.name, role: 'default' });
    }
  }
  return new Map([...byPlace].map(([file, places]) => [file, [...places.values()]]));
}

/** The label key of a role that is not `content`: a drawing's render and layers are both "the drawing". */
export function imageRoleLabelKey(role: ImageUseRole): string {
  return `images.roles.${role === 'render' || role === 'layer' ? 'drawing' : role}`;
}

/** Whether a place can take the picture out itself: shown in a text or an image field of an entry or a template. */
export function isRemovableUse(use: ImageUse): boolean {
  return use.role === 'content' && (use.kind === 'entry' || use.kind === 'template');
}

/** A place that shows the picture as a picture of its own (a text, a field, a canvas, a block default) — not as a drawing's render or layer, nor as a background. */
export function isShownUse(use: ImageUse): boolean {
  return use.role === 'content' || use.role === 'default';
}

function withoutImageInHtml(html: string, file: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  let changed = false;
  for (const img of [...doc.body.querySelectorAll('img')]) {
    if (storedImageName(img.getAttribute('src')) !== file) continue;
    img.remove();
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

/** The block without the picture where it is shown: an image field emptied, an image in a text gone. */
function withoutImageInBlock(block: BlockInstance, file: string): BlockInstance {
  if (isDrawingBlockType(block.type) || !block.html.includes(file)) return block;
  if (isCanvasBlockType(block.type)) return withoutCanvasFile(block, file);
  if (block.type === FIELDS_BLOCK_TYPE) {
    // A drawing part keeps its pictures: they are the drawing, not a picture shown in it.
    const drawings = new Set(parseFields(block).elements.filter(isSigilElement).map((el) => el.id));
    const slots = new Set<string>();
    const slotRe = /\bdata-block-slot="el:([^"]{1,200})"[^<>]*>([\s\S]*?)<\/dd>/gi;
    for (const [, id, inner] of block.html.matchAll(slotRe)) {
      if (inner.includes(file) && !drawings.has(decodeHtmlAttr(id))) slots.add(id);
    }
    return withoutElementContent(block, slots);
  }
  return { ...block, html: withoutImageInHtml(block.html, file) };
}

/** A block stack without the picture in its texts and image fields; drawings and defaults stay. */
export function withoutImage(content: string, file: string): string {
  const blocks = parseBlocks(content);
  const next = blocks.map((block) => withoutImageInBlock(block, file));
  return next.every((block, i) => block === blocks[i]) ? content : serializeBlocks(next);
}
