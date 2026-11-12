import { Brush, Frame, SlidersHorizontal, Type, type LucideIcon } from 'lucide-react';
import { BLOCK_ATTR, TEXT_BLOCK_TYPE, type BlockInstance, type BlockTypeId } from './types';
import { FIELDS_BLOCK_TYPE } from './fields';
import { ALTAR_BLOCK_TYPE, CANVAS_BLOCK_TYPE } from './canvas';
import { PAINT_BLOCK_TYPE } from './paint';
import { AltarIcon } from '../altarIcon';

/**
 * The registry of block types — the pure part (metadata). Which component
 * renders a type is in `components/blocks/blockViews.ts`; the separation
 * keeps TipTap out of everything that only wants to know WHAT a block is
 * (picker, sidebar, export, migrations).
 *
 * The shape is the seed of the later extension API: a plugin would
 * register exactly such an entry, with `origin: 'plugin'`.
 */

export type BlockGroup = 'text' | 'fields' | 'sigil' | 'media' | 'reference' | 'moon';

export interface BlockTypeMeta {
  id: BlockTypeId;
  origin: 'core' | 'plugin';
  icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
  group: BlockGroup;
  /**
   * Version of the stored data format (`data-block-v`, missing = 1). A
   * block with a higher version comes from a newer app and is treated like an
   * unknown type: shown as a fallback, saved unchanged.
   */
  dataVersion: number;
  /** Show the title in read mode unless the instance says otherwise.
   *  Text flows without a heading, field and tool blocks carry one. */
  defaultShowTitle: boolean;
}

// A Map instead of an object: the type comes from stored content, and
// `BLOCK_TYPES['constructor']` would otherwise find the prototype.
const BLOCK_TYPES = new Map<string, BlockTypeMeta>([
  [TEXT_BLOCK_TYPE, {
    id: TEXT_BLOCK_TYPE,
    origin: 'core',
    icon: Type,
    labelKey: 'blocks.types.text.label',
    descriptionKey: 'blocks.types.text.description',
    group: 'text',
    dataVersion: 1,
    defaultShowTitle: false,
  }],
  [FIELDS_BLOCK_TYPE, {
    id: FIELDS_BLOCK_TYPE,
    origin: 'core',
    icon: SlidersHorizontal,
    labelKey: 'blocks.types.fields.label',
    descriptionKey: 'blocks.types.fields.description',
    group: 'fields',
    dataVersion: 1,
    // A single field carries its label in the row anyway.
    defaultShowTitle: false,
  }],
  [CANVAS_BLOCK_TYPE, {
    id: CANVAS_BLOCK_TYPE,
    origin: 'core',
    icon: Frame,
    labelKey: 'blocks.types.canvas.label',
    descriptionKey: 'blocks.types.canvas.description',
    group: 'media',
    dataVersion: 1,
    defaultShowTitle: false,
  }],
  [PAINT_BLOCK_TYPE, {
    id: PAINT_BLOCK_TYPE,
    origin: 'core',
    icon: Brush,
    labelKey: 'blocks.types.paint.label',
    descriptionKey: 'blocks.types.paint.description',
    group: 'media',
    dataVersion: 1,
    defaultShowTitle: false,
  }],
  [ALTAR_BLOCK_TYPE, {
    id: ALTAR_BLOCK_TYPE,
    origin: 'core',
    icon: AltarIcon,
    labelKey: 'blocks.types.altar.label',
    descriptionKey: 'blocks.types.altar.description',
    group: 'media',
    dataVersion: 1,
    defaultShowTitle: false,
  }],
]);

/**
 * The type with which the app can render this block — or `undefined` for
 * an unknown type or a data format that is too new. Both are shown as a
 * fallback and written back unchanged.
 */
export function resolveBlockType(block: BlockInstance): BlockTypeMeta | undefined {
  const meta = BLOCK_TYPES.get(block.type);
  if (!meta) return undefined;
  const version = Number(block.attrs[BLOCK_ATTR.version] ?? 1);
  return Number.isFinite(version) && version <= meta.dataVersion ? meta : undefined;
}
