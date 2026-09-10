import {
  Calendar, ChevronsUpDown, Hash, Image, Link2, ListChecks, Moon, TextCursorInput, ToggleLeft, Type, type LucideIcon,
} from 'lucide-react';
import { createTextBlock } from './blockHtml';
import {
  createFieldsBlock, ELEMENT_KINDS, elementKindLabelKey, FIELDS_BLOCK_TYPE, parseFields, type ElementKind,
} from './fields';
import type { BlockGroup, BlockTypeMeta } from './blockTypes';
import type { BlockInstance } from './types';

/**
 * Was „Block hinzufügen" anbietet. Ein Eintrag ist nicht dasselbe wie ein
 * Blocktyp: jede Feldart ist ein eigener Eintrag, legt aber einen `core.fields`
 * mit einem Element an. Später kommen hier die eigenen Blöcke aus der
 * Blöcke-Ansicht dazu.
 */
export interface BlockPreset {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  group: BlockGroup;
  create: () => BlockInstance;
}

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
];

/** Das Icon eines Blocks: ein Feldblock mit genau einem Element trägt das seiner Art. */
export function blockIcon(block: BlockInstance, meta: BlockTypeMeta | undefined): LucideIcon | undefined {
  if (meta?.id === FIELDS_BLOCK_TYPE) {
    const { elements } = parseFields(block);
    if (elements.length === 1) return ELEMENT_KIND_ICONS[elements[0].kind];
  }
  return meta?.icon;
}
