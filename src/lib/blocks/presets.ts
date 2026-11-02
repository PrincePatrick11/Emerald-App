import {
  Calendar, ChevronsUpDown, Hash, Image, Link2, ListChecks, Moon, PenTool, Sparkles, TextCursorInput, ToggleLeft, Type, Zap,
  type LucideIcon,
} from 'lucide-react';
import { AltarIcon } from '../altarIcon';
import { createSigilCalcBlock, createSigilCanvasBlock, createSigilChargeBlock } from './sigil';
import { createTextBlock } from './blockHtml';
import {
  activeElements, createFieldsBlock, ELEMENT_KINDS, elementKindLabelKey, FIELDS_BLOCK_TYPE, isSigilKind, parseFields,
  type ElementKind, type FallbackText,
} from './fields';
import { instantiateDefinition, type BlockDefinition } from './definitions';
import type { BlockGroup, BlockTypeMeta } from './blockTypes';
import type { BlockInstance } from './types';

/**
 * What "Add block" offers. An entry is not the same as a block type: each
 * field kind is its own entry but creates a `core.fields` with one element.
 * Behind them come the custom blocks from the blocks view (`def:<id>`) —
 * the caller reads them from the store and passes them in, because
 * `lib/blocks` knows no stores.
 */
export interface BlockPreset {
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
  altar: AltarIcon,
  sigilCalc: Sparkles,
  sigilCanvas: PenTool,
  sigilCharge: Zap,
};

const KIND_GROUPS: Partial<Record<ElementKind, BlockGroup>> = { link: 'reference', altar: 'reference', image: 'media', moon: 'moon' };

// Text and the sigil parts exist only in custom blocks — on their own one
// inserts the text block and the sigil blocks (above and below).
const FIELD_PRESET_KINDS = ELEMENT_KINDS.filter((kind) => kind !== 'text' && !isSigilKind(kind));

export const BLOCK_PRESETS: readonly BlockPreset[] = [
  { id: 'text', labelKey: 'blocks.types.text.label', descriptionKey: 'blocks.types.text.description', icon: Type, group: 'text', create: () => createTextBlock() },
  ...FIELD_PRESET_KINDS.map((kind): BlockPreset => ({
    id: `field.${kind}`,
    labelKey: elementKindLabelKey(kind),
    icon: ELEMENT_KIND_ICONS[kind],
    group: KIND_GROUPS[kind] ?? 'fields',
    create: () => createFieldsBlock(kind),
  })),
  { id: 'sigil.calc', labelKey: 'blocks.types.sigilCalc.label', descriptionKey: 'blocks.types.sigilCalc.description', icon: Sparkles, group: 'sigil', create: createSigilCalcBlock },
  { id: 'sigil.canvas', labelKey: 'blocks.types.sigilCanvas.label', descriptionKey: 'blocks.types.sigilCanvas.description', icon: PenTool, group: 'sigil', create: createSigilCanvasBlock },
  { id: 'sigil.charge', labelKey: 'blocks.types.sigilCharge.label', descriptionKey: 'blocks.types.sigilCharge.description', icon: Zap, group: 'sigil', create: createSigilChargeBlock },
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
export function blockIcon(block: BlockInstance, meta: BlockTypeMeta | undefined): GlyphSource | undefined {
  if (meta?.id === FIELDS_BLOCK_TYPE) {
    const model = parseFields(block);
    if (model.icon) return model.icon;
    const elements = activeElements(model);
    if (elements.length === 1) return ELEMENT_KIND_ICONS[elements[0].kind];
  }
  return meta?.icon;
}
