import { isImageIcon, isTagId, localIsoDay } from '../helpers';
import { decodeHtmlAttr, extractInternalLinks } from '../internalLinkHtml';
import { storedImageName, storedImageNamesIn } from '../schema';
import { readBlockJson } from './blockJson';
import type { BlockContext, BlockSettingDef, BlockSettingValue } from './blockType';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * The toolkit: building blocks every block type uses instead of making its
 * own — reporting what it points at, reading the entry's date, its settings,
 * its texts, raising its data version. The parts that need React or stores
 * (storing a picture safely in the vault, binding it to the type's tag) are
 * the component half, `components/blocks/toolkit.ts`.
 *
 * Pure, like all of `lib/blocks`.
 */

/* ---------------- References (11) ---------------- */

/**
 * What a reference points at: an entry or task, a stored picture, an icon
 * file of the vault's `icons/`, or a tag the block gives its entry.
 */
export type BlockRefKind = 'entry' | 'image' | 'icon' | 'tag';

/**
 * The role a reference plays in its block:
 * - `content`: shown in the block — a link chip, a picture in a text or an
 *   image field, a picture on a canvas;
 * - `render`: the rendered picture of a canvas or a drawing;
 * - `layer`: the picture of a drawing's layer;
 * - `background`: a canvas's background picture;
 * - `default`: what a custom block's copy brings as a prefill;
 * - `icon`: a custom block's copy's icon — every copy names the same file;
 * - `tag`: a tag the block gives its entry while it is there (`BlockProperties.tags`).
 */
export type BlockRefRole = 'content' | 'render' | 'layer' | 'background' | 'default' | 'icon' | 'tag';

export interface BlockRef {
  kind: BlockRefKind;
  /** The entry's or tag's ID, or the stored file name of the picture or the icon. */
  target: string;
  role: BlockRefRole;
}

/**
 * Collects a block's references — what a type's `refs` reports into. Checks
 * every target and drops duplicates, so a type reports what it holds and
 * nothing else.
 */
export class RefReporter {
  private readonly seen = new Set<string>();
  readonly refs: BlockRef[] = [];

  private add(kind: BlockRefKind, target: string | null | undefined, role: BlockRefRole): void {
    if (!target) return;
    const key = `${kind}\u0000${target}\u0000${role}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.refs.push({ kind, target, role });
  }

  /** An entry or task the block links to. */
  entry(id: string | null | undefined, role: BlockRefRole = 'content'): void {
    this.add('entry', id, role);
  }

  /** A stored picture; anything that is no stored name is left out. */
  image(file: string | null | undefined, role: BlockRefRole = 'content'): void {
    if (file && storedImageName(file)) this.add('image', file, role);
  }

  /** An icon file of the vault (an emoji is none). */
  icon(file: string | null | undefined): void {
    if (file && isImageIcon(file)) this.add('icon', file, 'icon');
  }

  /** A tag the block gives its entry. */
  tag(id: string | null | undefined): void {
    if (isTagId(id)) this.add('tag', id, 'tag');
  }

  /** Link chips and pictures in markup. */
  markup(html: string, role: BlockRefRole = 'content'): void {
    this.links(html, role);
    for (const file of storedImageNamesIn(html)) this.image(file, role);
  }

  /** The link chips in markup. */
  links(html: string, role: BlockRefRole = 'content'): void {
    for (const link of extractInternalLinks(html)) this.entry(link.id, role);
  }

  /** Every stored picture named anywhere in a text (markup, JSON). */
  imagesIn(text: string | null | undefined, role: BlockRefRole): void {
    for (const file of storedImageNamesIn(text ?? '')) this.image(file, role);
  }
}

/* ---------------- Slots: one value as markup ---------------- */

/**
 * Target of the link chip in a slot (the markup a block keeps a link in), with
 * the label stored in it — or `null`. Every type that holds a link as a chip
 * reads it so.
 */
export function linkFromSlot(html: string | undefined): { id: string; targetKind: string; label: string } | null {
  if (typeof html !== 'string' || !html) return null;
  return extractInternalLinks(html)[0] ?? null;
}

/** The stored picture in a slot (`<img src>`) — or `null`. */
export function imageFromSlot(html: string | undefined): string | null {
  const src = typeof html === 'string' ? /\bsrc="([^"]*)"/i.exec(html)?.[1] : undefined;
  return src ? decodeHtmlAttr(src) : null;
}

/* ---------------- Text editors (15) ---------------- */

/** The key under which the stack hosts a text editor of a block (`textEditors`): the block's ID for `''`, else `<block ID>:<key>`. */
export function textEditorKey(blockId: string, key: string): string {
  return key ? `${blockId}:${key}` : blockId;
}

/* ---------------- Pictures in markup ---------------- */

// Bounded: it runs over foreign markup.
const IMG_RE = /<img\b[^<>]{0,2048}>/gi;

/**
 * The block without the `<img>` tags of its markup that show `file` — the
 * same block if there were none. DOM-free, so it runs under Node too.
 */
export function withoutImageInMarkup(block: BlockInstance, file: string): BlockInstance {
  const html = block.html.replace(IMG_RE, (tag) => {
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1];
    return src && storedImageName(decodeHtmlAttr(src)) === file ? '' : tag;
  });
  return html === block.html ? block : { ...block, html };
}

/* ---------------- The entry's date ---------------- */

/** The entry's day (local), from when it was made. */
export function entryDate(entry: { created_at: string } | null | undefined): string | null {
  if (!entry) return null;
  const date = new Date(entry.created_at);
  return Number.isNaN(date.getTime()) ? null : localIsoDay(date);
}

/** Where a block is: the entry (or none — a template, a block definition) and today. */
export function blockContext(entry: { id: string; created_at: string } | null | undefined, today = localIsoDay()): BlockContext {
  return { entryId: entry?.id ?? null, entryDate: entryDate(entry), today };
}

/* ---------------- Copies (12) ---------------- */

/**
 * A reference to a block or a part of one (`<block ID>` or `<block ID>:<part>`)
 * pointed at the copy, if its block was copied in the same go.
 */
export function copiedBlockRef(target: string, ids: ReadonlyMap<string, string>): string {
  const colon = target.indexOf(':');
  const next = ids.get(colon < 0 ? target : target.slice(0, colon));
  return next === undefined ? target : next + (colon < 0 ? '' : target.slice(colon));
}

/* ---------------- Settings (14) ---------------- */

/** The block's settings, each as stored if it fits its description, else its start value. */
export function readBlockSettings(block: BlockInstance, defs: readonly BlockSettingDef[] = []): Record<string, BlockSettingValue> {
  const stored = readBlockJson(block.attrs[BLOCK_ATTR.settings]).value;
  const out: Record<string, BlockSettingValue> = Object.create(null) as Record<string, BlockSettingValue>;
  for (const def of defs) {
    const value = Object.prototype.hasOwnProperty.call(stored, def.key) ? stored[def.key] : undefined;
    if (def.kind === 'toggle') out[def.key] = typeof value === 'boolean' ? value : def.initial;
    else out[def.key] = typeof value === 'string' && def.options.some((o) => o.value === value) ? value : def.initial;
  }
  return out;
}

/** The block with one setting changed; a value equal to its start value is not stored. */
export function withBlockSetting(block: BlockInstance, def: BlockSettingDef, value: BlockSettingValue): BlockInstance {
  const { broken, value: stored } = readBlockJson(block.attrs[BLOCK_ATTR.settings]);
  const next: Record<string, unknown> = broken ? {} : { ...stored };
  if (value === def.initial) delete next[def.key];
  else next[def.key] = value;
  const attrs = { ...block.attrs };
  if (Object.keys(next).length) attrs[BLOCK_ATTR.settings] = JSON.stringify(next);
  else delete attrs[BLOCK_ATTR.settings];
  return { ...block, attrs };
}

/* ---------------- Texts ---------------- */

/**
 * The i18n key of a built-in type's text: `blocks.types.<name>.<key>`, the
 * name being the type ID after `core.`. All four locale files carry it
 * (`npm run check:i18n`).
 */
export function blockTypeTextKey(typeId: string, key: string): string {
  return `blocks.types.${typeId.replace(/^core\./, '')}.${key}`;
}

/**
 * `t(key)` — unless i18n is not ready yet and returns the key itself;
 * then `fallback`. For texts that end up permanently in content or a
 * definition: otherwise "blocks.fields.no" would stay there forever.
 */
export function translatedOr(t: (key: string) => string, key: string, fallback: string): string {
  const value = t(key);
  return typeof value === 'string' && value && value !== key ? value : fallback;
}

/* ---------------- Data version (13) ---------------- */

/** The stored data version of a block (missing = 1; unreadable counts as too new). */
export function blockDataVersion(block: BlockInstance): number {
  const version = Number(block.attrs[BLOCK_ATTR.version] ?? 1);
  return Number.isFinite(version) && version >= 1 ? version : Number.POSITIVE_INFINITY;
}

/** The block marked as being at `version` (1 is not written). */
export function withDataVersion(block: BlockInstance, version: number): BlockInstance {
  const attrs = { ...block.attrs };
  if (version > 1) attrs[BLOCK_ATTR.version] = String(version);
  else delete attrs[BLOCK_ATTR.version];
  return { ...block, attrs };
}
