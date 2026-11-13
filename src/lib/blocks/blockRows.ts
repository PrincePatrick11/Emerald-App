import { htmlTags } from '../htmlTags';
import { decodeHtmlAttr } from './blockHtml';
import { isCanvasBlockType } from './canvas';
import { isDrawingBlockType } from './paint';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * A block as a row of `blocks` and back — without the owner and the position,
 * which the caller knows (`blockStore.ts`).
 *
 * The row is lossless: whatever `BlockInstance.attrs` holds comes back. The
 * instance attributes have columns of their own, but only in the form the app
 * writes them (`data-block-hidden="1"`, a whole number as version, `"1"`/`"0"`
 * for showing the title); any other value of theirs, and every attribute the
 * app does not know (`data-block-origin` of older copies, a block type from a
 * newer version), stays in `attrs`, in its order. `serializeBlocks` writes the
 * instance attributes in a fixed order (`orderedBlockAttrs`), so a block
 * written from its row is the same string as the block it was made from.
 *
 * Pure, like everything under `lib/blocks/`: the migration and
 * `scripts/check-blocks.mjs` run it under Node.
 */

export interface BlockRowValues {
  id: string;
  type: string;
  version: number | null;
  hidden: 0 | 1;
  title: string | null;
  show_title: 0 | 1 | null;
  config: string | null;
  data: string | null;
  /** JSON object of the remaining `data-*` attributes, in their order. */
  attrs: string;
  html: string;
  /** Plain text for the search (`blockPlainText`). */
  text: string;
}

const VERSION_RE = /^[1-9][0-9]{0,8}$/;
const KEPT_ATTR_RE = /^data-[a-z0-9-]+$/;

export function toBlockRow(block: BlockInstance): BlockRowValues {
  const rest: Record<string, string> = {};
  const row: BlockRowValues = {
    id: block.id,
    type: block.type,
    version: null,
    hidden: 0,
    title: null,
    show_title: null,
    config: null,
    data: null,
    attrs: '{}',
    html: block.html,
    text: blockPlainText(block),
  };
  for (const [name, value] of Object.entries(block.attrs)) {
    if (name === BLOCK_ATTR.version && VERSION_RE.test(value)) row.version = Number(value);
    else if (name === BLOCK_ATTR.hidden && value === '1') row.hidden = 1;
    else if (name === BLOCK_ATTR.title) row.title = value;
    else if (name === BLOCK_ATTR.showTitle && (value === '1' || value === '0')) row.show_title = value === '1' ? 1 : 0;
    else if (name === BLOCK_ATTR.config) row.config = value;
    else if (name === BLOCK_ATTR.data) row.data = value;
    else rest[name] = value;
  }
  row.attrs = JSON.stringify(rest);
  return row;
}

/** The remaining attributes of a row; what is no `data-*` name with a string value is dropped, as `parseBlocks` would. */
function restAttrs(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw === '{}') return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
  for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
    if (KEPT_ATTR_RE.test(name) && typeof v === 'string' && name !== 'data-block' && name !== 'data-block-id') out[name] = v;
  }
  return out;
}

/** A row as read from the database — the columns `toBlockRow` writes, loosely typed. */
export interface StoredBlockRow {
  id: string;
  type: string;
  version?: number | null;
  hidden?: number | null;
  title?: string | null;
  show_title?: number | null;
  config?: string | null;
  data?: string | null;
  attrs?: string | null;
  html?: string | null;
}

export function fromBlockRow(row: StoredBlockRow): BlockInstance {
  const attrs: Record<string, string> = {};
  if (row.version != null) attrs[BLOCK_ATTR.version] = String(row.version);
  if (row.hidden === 1) attrs[BLOCK_ATTR.hidden] = '1';
  if (row.title != null) attrs[BLOCK_ATTR.title] = row.title;
  if (row.show_title === 0 || row.show_title === 1) attrs[BLOCK_ATTR.showTitle] = String(row.show_title);
  if (row.config != null) attrs[BLOCK_ATTR.config] = row.config;
  if (row.data != null) attrs[BLOCK_ATTR.data] = row.data;
  return { id: row.id, type: row.type, html: row.html ?? '', attrs: { ...attrs, ...restAttrs(row.attrs) } };
}

/* ---------------- Plain text ---------------- */

/** Elements whose edges are word boundaries — the same list as `searchText.ts`, plus the fields block's `<dl>`. */
const SEPARATED_TAG_RE = /^(address|blockquote|br|div|dd|dl|dt|h[1-6]|hr|li|ol|p|pre|section|table|td|th|tr|ul|img)$/i;
/** Elements whose content is no text: their source would read as if it were the entry's prose. */
const DROPPED_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'noscript']);
const CHIP_ATTR_RE = /\bdata-type=["']internalLink["']/i;

/**
 * The plain text of a block's markup, without a DOM: tags gone, block
 * elements and link chips as word boundaries, entities decoded. A canvas and a
 * drawing have no text (their markup only lists pictures).
 */
export function blockPlainText(block: BlockInstance): string {
  if (isCanvasBlockType(block.type) || isDrawingBlockType(block.type)) return '';
  return htmlPlainText(block.html);
}

export function htmlPlainText(html: string): string {
  if (!html) return '';
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let textFrom = 0;
  /** Up to where the content of a dropped element runs. */
  let skipTo = 0;
  /** Per open `<span>`: is it a link chip? A chip is one word of its own, like in `searchText.ts`. */
  const spans: boolean[] = [];
  const unclosedDropped = new Set<string>();
  for (const tag of htmlTags(html)) {
    if (tag.index < skipTo) continue;
    parts.push(html.slice(textFrom, tag.index));
    textFrom = tag.index + tag.length;
    const name = tag.name.toLowerCase();
    if (!tag.close && DROPPED_TAGS.has(name) && !unclosedDropped.has(name)) {
      const end = lower.indexOf(`</${name}`, textFrom);
      const gt = end === -1 ? -1 : html.indexOf('>', end);
      if (gt !== -1) {
        parts.push(' ');
        skipTo = gt + 1;
        textFrom = skipTo;
        continue;
      }
      unclosedDropped.add(name);
    }
    if (name === 'span') {
      const chip = tag.close ? spans.pop() ?? false : CHIP_ATTR_RE.test(tag.attrs);
      if (!tag.close) spans.push(chip);
      parts.push(chip ? ' ' : '');
      continue;
    }
    parts.push(!name || SEPARATED_TAG_RE.test(name) ? ' ' : '');
  }
  parts.push(html.slice(textFrom));
  return decodeHtmlAttr(parts.join('')).replace(/\s+/g, ' ').trim();
}
