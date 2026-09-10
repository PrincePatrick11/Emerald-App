import {
  Calendar, ChevronsUpDown, Hash, Image, Link2, ListChecks, Moon, PenTool, Sparkles, TextCursorInput, ToggleLeft, Type, Zap,
  type LucideIcon,
} from 'lucide-react';
import { createSigilCalcBlock, createSigilCanvasBlock, createSigilChargeBlock } from './sigil';
import { createTextBlock } from './blockHtml';
import {
  activeElements, createFieldsBlock, ELEMENT_KINDS, elementKindLabelKey, FIELDS_BLOCK_TYPE, parseFields, type ElementKind,
} from './fields';
import { instantiateDefinition, type BlockDefinition } from './definitions';
import type { BlockGroup, BlockTypeMeta } from './blockTypes';
import type { BlockInstance } from './types';

/**
 * Was „Block hinzufügen" anbietet. Ein Eintrag ist nicht dasselbe wie ein
 * Blocktyp: jede Feldart ist ein eigener Eintrag, legt aber einen `core.fields`
 * mit einem Element an. Dahinter stehen die eigenen Blöcke aus der
 * Blöcke-Ansicht (`def:<id>`) — die liest der Aufrufer aus dem Store und
 * reicht sie herein, weil `lib/blocks` keine Stores kennt.
 */
export interface BlockPreset {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  group: BlockGroup;
  create: () => BlockInstance;
}

/** Das Zeichen eines Blocks: ein lucide-Icon, oder das Emoji eines eigenen Blocks. */
export type GlyphSource = LucideIcon | string;

export const ELEMENT_KIND_ICONS: Record<ElementKind, LucideIcon> = {
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

export const BLOCK_PRESETS: readonly BlockPreset[] = [
  { id: 'text', labelKey: 'blocks.types.text.label', icon: Type, group: 'text', create: () => createTextBlock() },
  ...ELEMENT_KINDS.map((kind): BlockPreset => ({
    id: `field.${kind}`,
    labelKey: elementKindLabelKey(kind),
    icon: ELEMENT_KIND_ICONS[kind],
    group: KIND_GROUPS[kind] ?? 'fields',
    create: () => createFieldsBlock(kind),
  })),
  { id: 'sigil.calc', labelKey: 'blocks.types.sigilCalc.label', icon: Sparkles, group: 'sigil', create: createSigilCalcBlock },
  { id: 'sigil.canvas', labelKey: 'blocks.types.sigilCanvas.label', icon: PenTool, group: 'sigil', create: createSigilCanvasBlock },
  { id: 'sigil.charge', labelKey: 'blocks.types.sigilCharge.label', icon: Zap, group: 'sigil', create: createSigilChargeBlock },
];

const DEFINITION_PRESET_PREFIX = 'def:';

/** Die Voreinstellungs-ID eines eigenen Blocks. */
export function definitionPresetId(defId: string): string {
  return `${DEFINITION_PRESET_PREFIX}${defId}`;
}

/** Ein neuer Block aus einer Voreinstellung — `null`, wenn es sie (nicht mehr) gibt. */
export function createFromPreset(presetId: string, definitions: readonly BlockDefinition[]): BlockInstance | null {
  if (presetId.startsWith(DEFINITION_PRESET_PREFIX)) {
    const def = definitions.find((d) => d.id === presetId.slice(DEFINITION_PRESET_PREFIX.length));
    return def ? instantiateDefinition(def) : null;
  }
  return BLOCK_PRESETS.find((p) => p.id === presetId)?.create() ?? null;
}

/**
 * Das Zeichen eines Blocks: eine Kopie eines eigenen Blocks trägt dessen
 * Emoji, ein Feldblock mit genau einem Element das Icon seiner Art.
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
