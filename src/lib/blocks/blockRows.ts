import { isRecord } from '../helpers';
import { blockSearchText } from './blockTypes';
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
  /** Plain text for the search (`blockSearchText`). */
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
    text: blockSearchText(block),
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
  if (!isRecord(value)) return out;
  for (const [name, v] of Object.entries(value)) {
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
