import type Database from './sqlite';
import type { EntryType } from '../types';
import { parseBlocks, serializeBlocks } from './blocks/blockHtml';
import { BLOCK_ATTR, type BlockInstance } from './blocks/types';
import { FIELDS_BLOCK_TYPE, withoutElementContent } from './blocks/fields';
import { SIGIL_CANVAS_TYPE } from './blocks/sigil';
import { isCanvasBlockType, canvasBackgroundFile, canvasElementFile, parseCanvasBlock, withoutCanvasFile } from './blocks/canvas';
import { storedImageName } from './schema';

/**
 * Where the vault's pictures are used — for "Images": which entries show a
 * picture, and which pictures are not pictures of their own but the thing
 * itself (a sigil drawing, a canvas background), kept out of the grid.
 */

/**
 * How a place uses a picture:
 * - `content`: shown in a text or an image field — it can be taken out there;
 * - `default`: the image default of a custom block — changed in the block;
 * - `drawing`: a sigil drawing, the drawing itself;
 * - `background`: a canvas's background.
 */
export type ImageUseRole = 'content' | 'default' | 'drawing' | 'background';

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

/** The pictures of a block stack, each with how the block uses it. */
function usesInContent(content: string): Map<string, ImageUseRole> {
  const roles = new Map<string, ImageUseRole>();
  const note = (file: string, role: ImageUseRole) => {
    // `content` wins: a picture shown anywhere is a picture of its own.
    if (roles.get(file) !== 'content') roles.set(file, role);
  };
  for (const block of parseBlocks(content)) {
    if (block.type === SIGIL_CANVAS_TYPE) {
      for (const file of namesIn(block.html)) note(file, 'drawing');
      continue;
    }
    // A canvas: its pictures are shown, its rendered picture is the canvas itself.
    if (isCanvasBlockType(block.type)) {
      const { scene, render } = parseCanvasBlock(block);
      for (const el of scene.elements) { const file = canvasElementFile(el); if (file) note(file, 'content'); }
      const background = canvasBackgroundFile(scene.background);
      if (background) note(background, 'background');
      if (render) note(render, 'drawing');
      continue;
    }
    for (const file of namesIn(block.html)) note(file, 'content');
    // A field block keeps its sigil drawings in the data JSON; any other
    // attribute naming a picture (an element's default) is the block's own.
    for (const [name, value] of Object.entries(block.attrs)) {
      for (const file of namesIn(value)) note(file, name === BLOCK_ATTR.data ? 'drawing' : 'default');
    }
  }
  return roles;
}

/** Every picture in use, with every place that uses it. Scans whole tables, like the image cleanup. */
export async function collectImageUses(db: Database): Promise<Map<string, ImageUse[]>> {
  const uses = new Map<string, ImageUse[]>();
  const add = (file: string, use: ImageUse) => {
    if (!storedImageName(file)) return;
    uses.set(file, [...(uses.get(file) ?? []), use]);
  };

  const entries = await db.select<{ id: string; type: EntryType; title: string; content: string | null }[]>(
    'SELECT id, type, title, content FROM entries WHERE deleted_at IS NULL'
  );
  for (const entry of entries) {
    for (const [file, role] of usesInContent(entry.content ?? '')) {
      add(file, { kind: 'entry', id: entry.id, title: entry.title, entryType: entry.type, role });
    }
  }

  const templates = await db.select<{ id: string; name: string; content: string | null }[]>(
    'SELECT id, name, content FROM templates WHERE deleted_at IS NULL'
  );
  for (const template of templates) {
    for (const [file, role] of usesInContent(template.content ?? '')) {
      add(file, { kind: 'template', id: template.id, title: template.name, role });
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
  return uses;
}

/** Whether a place can take the picture out itself: shown in a text or an image field of an entry or a template. */
export function isRemovableUse(use: ImageUse): boolean {
  return use.role === 'content' && (use.kind === 'entry' || use.kind === 'template');
}

/** A picture used only as the thing itself (a drawing, a background) — not one for "Images". */
export function isOnlyDrawingOrBackground(uses: readonly ImageUse[] | undefined): boolean {
  return !!uses?.length && uses.every((use) => use.role === 'drawing' || use.role === 'background');
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
  if (block.type === SIGIL_CANVAS_TYPE || !block.html.includes(file)) return block;
  if (isCanvasBlockType(block.type)) return withoutCanvasFile(block, file);
  if (block.type === FIELDS_BLOCK_TYPE) {
    const slots = new Set<string>();
    const slotRe = /\bdata-block-slot="el:([^"]{1,200})"[^<>]*>([\s\S]*?)<\/dd>/gi;
    for (const [, id, inner] of block.html.matchAll(slotRe)) if (inner.includes(file)) slots.add(id);
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
