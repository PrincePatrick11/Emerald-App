import type { TFunction } from 'i18next';
import { Copy, Trash2 } from 'lucide-react';
import type { ContextMenuAction } from '../ui/ContextMenu';
import type { BlockTypeMeta } from '../../lib/blocks/blockTypes';
import type { BlockDefinition } from '../../lib/blocks/definitions';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import { BLOCK_PRESETS, definitionPresetId } from '../../lib/blocks/presets';
import BlockGlyph from './BlockGlyph';

/**
 * Menu entries shared by the stack (frame menu, insertion line) and the sidebar's
 * block management. Each menu adds its own entries before them.
 */

/**
 * "Add block": one entry per preset (text, each field kind),
 * followed by the custom blocks from the blocks view.
 */
export function addBlockActions(
  t: TFunction,
  onPick: (presetId: string) => void,
  definitions: readonly BlockDefinition[] = [],
): ContextMenuAction[] {
  return [
    ...BLOCK_PRESETS.map((preset) => {
      const Icon = preset.icon;
      return { label: t(preset.labelKey), icon: <Icon size={12} />, onClick: () => onPick(preset.id) };
    }),
    ...definitions.map((def) => ({
      label: definitionLabel(t, def),
      icon: <BlockGlyph icon={def.icon} />,
      onClick: () => onPick(definitionPresetId(def.id)),
    })),
  ];
}

/**
 * Duplicate and remove. An unknown block (`meta` is missing: foreign type
 * or too new a data format) can only be removed; a copy of its
 * data would be worthless without the type that understands it.
 */
export function commonBlockActions(
  t: TFunction,
  meta: BlockTypeMeta | undefined,
  { duplicate, remove }: { duplicate: () => void; remove: () => void },
): ContextMenuAction[] {
  return [
    ...(meta ? [{ label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: duplicate }] : []),
    { label: t('blocks.remove'), icon: <Trash2 size={12} />, onClick: remove, danger: true },
  ];
}
