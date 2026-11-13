import { extractInternalLinks } from '../internalLinkHtml';
import { storedImageName, storedImageNamesIn } from '../schema';
import { canvasBackgroundFile, canvasElementFile, isCanvasBlockType, parseCanvasBlock } from './canvas';
import { FIELDS_BLOCK_TYPE, isSigilElement, parseFields } from './fields';
import { isDrawingBlockType, parseDrawing } from './paint';
import { sigilPartBlock } from './sigil';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * What a block points at — the rows of `block_refs`, rewritten whenever the
 * block is saved (`blockStore.ts`). Pure: the migration runs it under Node.
 *
 * Roles:
 * - `content`: shown in the block — a link chip, a picture in a text or an
 *   image field, a picture on a canvas;
 * - `render`: the rendered picture of a canvas or a drawing;
 * - `layer`: the picture of a drawing's layer;
 * - `background`: a canvas's background picture;
 * - `default`: what a custom block's copy brings as a prefill.
 */
export type BlockRefKind = 'entry' | 'image';
export type BlockRefRole = 'content' | 'render' | 'layer' | 'background' | 'default';

export interface BlockRef {
  kind: BlockRefKind;
  /** The entry's ID, or the stored file name of the picture. */
  target: string;
  role: BlockRefRole;
}

function imagesIn(text: string | null | undefined): string[] {
  return storedImageNamesIn(text ?? '');
}

class RefSet {
  private readonly seen = new Set<string>();
  readonly refs: BlockRef[] = [];

  add(kind: BlockRefKind, target: string | null | undefined, role: BlockRefRole): void {
    if (!target) return;
    if (kind === 'image' && !storedImageName(target)) return;
    const key = `${kind}\u0000${target}\u0000${role}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.refs.push({ kind, target, role });
  }

  /** Link chips and pictures in markup, as `role`. */
  markup(html: string, role: BlockRefRole): void {
    for (const link of extractInternalLinks(html)) this.add('entry', link.id, role);
    for (const file of imagesIn(html)) this.add('image', file, role);
  }

  drawing(block: BlockInstance): void {
    const { render, doc } = parseDrawing(block);
    this.add('image', render, 'render');
    for (const layer of doc?.layers ?? []) this.add('image', layer.image, 'layer');
  }
}

export function blockRefs(block: BlockInstance): BlockRef[] {
  const set = new RefSet();

  if (isDrawingBlockType(block.type)) {
    set.drawing(block);
    return set.refs;
  }

  if (isCanvasBlockType(block.type)) {
    const { scene, render } = parseCanvasBlock(block);
    for (const el of scene.elements) set.add('image', canvasElementFile(el), 'content');
    set.add('image', canvasBackgroundFile(scene.background), 'background');
    set.add('image', render, 'render');
    return set.refs;
  }

  if (block.type === FIELDS_BLOCK_TYPE) {
    const model = parseFields(block);
    const byId = new Map(model.elements.map((el) => [el.id, el]));
    for (const [id, html] of Object.entries(model.slots)) {
      const element = byId.get(id);
      // A custom block's drawing part is a drawing of its own.
      if (element?.kind === 'sigilCanvas' && isSigilElement(element)) set.drawing(sigilPartBlock(block, element, model));
      else set.markup(html, 'content');
    }
    for (const element of model.elements) {
      const value = element.defaultValue;
      if (element.kind === 'image' && typeof value === 'string') set.add('image', value, 'default');
      if (element.kind === 'link' && value && typeof value === 'object' && 'id' in value) set.add('entry', String(value.id), 'default');
    }
    // A broken block keeps what its markup and JSON name, so nothing it holds goes unseen.
    if (model.broken) {
      set.markup(block.html, 'content');
      for (const file of imagesIn(block.attrs[BLOCK_ATTR.config])) set.add('image', file, 'default');
    }
    return set.refs;
  }

  // Text, and any type this version does not know: its markup is what it shows,
  // a picture named in an attribute is the block's own.
  set.markup(block.html, 'content');
  for (const [name, value] of Object.entries(block.attrs)) {
    for (const file of imagesIn(value)) set.add('image', file, name === BLOCK_ATTR.data ? 'content' : 'default');
  }
  return set.refs;
}
