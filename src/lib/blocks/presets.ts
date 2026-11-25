import {
  Brush, Calendar, ChevronsUpDown, Frame, Hash, Image, Link2, ListChecks, Moon, Sparkles, TextCursorInput, ToggleLeft, Type,
  type LucideIcon,
} from 'lucide-react';
import { AltarIcon } from '../altarIcon';
import { createSigilBlock } from './sigil';
import { createTextBlock } from './blockHtml';
import { ALTAR_BLOCK_TYPE, createCanvasBlock } from './canvas';
import { createPaintBlock } from './paint';
import {
  activeElements, createFieldsBlock, ELEMENT_KINDS, elementKindLabelKey, FIELDS_BLOCK_TYPE, parseFields,
  type ElementKind, type FallbackText,
} from './fields';
import { instantiateDefinition, type BlockDefinition } from './definitions';
import type { BlockGroup, BlockTypeDef } from './blockTypes';
import type { BlockInstance } from './types';

/**
 * What "Add block" offers. An entry is not the same as a block type: each
 * field kind is its own entry but creates a `core.fields` with one element.
 * Behind them come the custom blocks from the blocks view (`def:<id>`) —
 * the caller reads them from the store and passes them in, because
 * `lib/blocks` knows no stores.
 */
interface BlockPreset {
  id: string;
  labelKey: string;
  /** Explanation as a tooltip in the overview of the blocks view — only where the label is not enough. */
  descriptionKey?: string;
  icon: LucideIcon;
  group: BlockGroup;
  create: () => BlockInstance;
}

/** The glyph of a block: a lucide icon, or the emoji of a custom block. */
export type GlyphSource = LucideIcon | string;

export const ELEMENT_KIND_ICONS: Record<ElementKind, LucideIcon> = {
  text: Type,
  shorttext: TextCursorInput,
  number: Hash,
  date: Calendar,
  select: ChevronsUpDown,
  toggle: ToggleLeft,
  checklist: ListChecks,
  link: Link2,
  image: Image,
  moon: Moon,
};

const KIND_GROUPS: Partial<Record<ElementKind, BlockGroup>> = { link: 'reference', image: 'media', moon: 'moon' };

// Text is not offered as a field of its own: one inserts the text block.
const FIELD_PRESET_KINDS = ELEMENT_KINDS.filter((kind) => kind !== 'text');

export const BLOCK_PRESETS: readonly BlockPreset[] = [
  { id: 'text', labelKey: 'blocks.types.text.label', descriptionKey: 'blocks.types.text.description', icon: Type, group: 'text', create: () => createTextBlock() },
  ...FIELD_PRESET_KINDS.map((kind): BlockPreset => ({
    id: `field.${kind}`,
    labelKey: elementKindLabelKey(kind),
    icon: ELEMENT_KIND_ICONS[kind],
    group: KIND_GROUPS[kind] ?? 'fields',
    create: () => createFieldsBlock(kind),
  })),
  { id: 'canvas', labelKey: 'blocks.types.canvas.label', descriptionKey: 'blocks.types.canvas.description', icon: Frame, group: 'media', create: () => createCanvasBlock() },
  { id: 'paint', labelKey: 'blocks.types.paint.label', descriptionKey: 'blocks.types.paint.description', icon: Brush, group: 'media', create: createPaintBlock },
  { id: 'altar', labelKey: 'blocks.types.altar.label', descriptionKey: 'blocks.types.altar.description', icon: AltarIcon, group: 'media', create: () => createCanvasBlock(ALTAR_BLOCK_TYPE) },
  { id: 'sigil', labelKey: 'blocks.types.sigil.label', descriptionKey: 'blocks.types.sigil.description', icon: Sparkles, group: 'sigil', create: createSigilBlock },
];

const DEFINITION_PRESET_PREFIX = 'def:';

/** The preset ID of a custom block. */
export function definitionPresetId(defId: string): string {
  return `${DEFINITION_PRESET_PREFIX}${defId}`;
}

/**
 * A new block from a preset — `null` if it does not (or no longer) exist.
 * `text` writes the fallback of a custom block's defaults.
 */
export function createFromPreset(
  presetId: string,
  definitions: readonly BlockDefinition[],
  text: FallbackText,
): BlockInstance | null {
  if (presetId.startsWith(DEFINITION_PRESET_PREFIX)) {
    const def = definitions.find((d) => d.id === presetId.slice(DEFINITION_PRESET_PREFIX.length));
    return def ? instantiateDefinition(def, text) : null;
  }
  return BLOCK_PRESETS.find((p) => p.id === presetId)?.create() ?? null;
}

/**
 * The glyph of a block: a copy of a custom block carries its emoji,
 * a fields block with exactly one element the icon of its kind.
 */
export function blockIcon(block: BlockInstance, meta: BlockTypeDef | undefined): GlyphSource | undefined {
  if (meta?.id === FIELDS_BLOCK_TYPE) {
    const model = parseFields(block);
    if (model.icon) return model.icon;
    const elements = activeElements(model);
    if (elements.length === 1) return ELEMENT_KIND_ICONS[elements[0].kind];
  }
  return meta?.icon;
}
