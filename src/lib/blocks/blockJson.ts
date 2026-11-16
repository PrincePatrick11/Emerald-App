import { BLOCK_ATTR, type BlockInstance } from './types';
import { isRecord } from '../helpers';

/**
 * Reading a block's JSON attributes (`data-block-data`, `data-block-config`)
 * as objects and writing its data JSON — shared by the sigil, the drawing,
 * the canvas and the converter of the old sigil blocks. A leaf module: `sigil.ts` imports `paint.ts`, so neither can hold it.
 */

/** A JSON attribute of a block as an object. Unreadable input sets `broken` — such a block is never overwritten. */
export function readBlockJson(raw: string | undefined): { broken: boolean; value: Record<string, unknown> } {
  if (raw === undefined) return { broken: false, value: {} };
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? { broken: false, value } : { broken: true, value: {} };
  } catch {
    return { broken: true, value: {} };
  }
}

/** The data JSON of a block (`readBlockJson`). */
export function readBlockData(block: BlockInstance): { broken: boolean; data: Record<string, unknown> } {
  const { broken, value } = readBlockJson(block.attrs[BLOCK_ATTR.data]);
  return { broken, data: value };
}

/** The block with this data JSON and inner HTML. */
export function withBlockData(block: BlockInstance, data: Record<string, unknown>, html: string): BlockInstance {
  return { ...block, html, attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify(data) } };
}
