import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * Reading and writing a block's data JSON (`data-block-data`) as an object —
 * shared by the sigil, the drawing and the converter of the old sigil
 * blocks. A leaf module: `sigil.ts` imports `paint.ts`, so neither can hold it.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The data JSON of a block. Unreadable input sets `broken` — such a block is never overwritten. */
export function readBlockData(block: BlockInstance): { broken: boolean; data: Record<string, unknown> } {
  const raw = block.attrs[BLOCK_ATTR.data];
  if (raw === undefined) return { broken: false, data: {} };
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? { broken: false, data: value } : { broken: true, data: {} };
  } catch {
    return { broken: true, data: {} };
  }
}

/** The block with this data JSON and inner HTML. */
export function withBlockData(block: BlockInstance, data: Record<string, unknown>, html: string): BlockInstance {
  return { ...block, html, attrs: { ...block.attrs, [BLOCK_ATTR.data]: JSON.stringify(data) } };
}
