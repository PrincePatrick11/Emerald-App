import type { TFunction } from 'i18next';
import { Copy, Trash2 } from 'lucide-react';
import type { ContextMenuAction } from '../ui/ContextMenu';
import { blockActionsOf, blockSettingsOf, type BlockTypeDef } from '../../lib/blocks/blockTypes';
import { readBlockSettings, withBlockSetting } from '../../lib/blocks/toolkit';
import type { BlockInstance } from '../../lib/blocks/types';
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
 * What the block's type brings to its menu while editing: its actions
 * (`BlockTypeDef.actions`, carried out by the mounted view through `run`),
 * then its settings (`BlockTypeDef.settings`) — a switch as one ticked
 * entry, a choice as one entry per option. Every type's settings look alike
 * here; a change goes through `update`, so Cancel rolls it back.
 */
export function typeBlockActions(
  t: TFunction,
  block: BlockInstance,
  { run, update }: { run: (actionId: string) => void; update: (next: BlockInstance) => void },
): ContextMenuAction[] {
  const actions: ContextMenuAction[] = blockActionsOf(block, { reading: false }).map((action) => {
    const Icon = action.icon;
    return { label: t(action.labelKey), icon: <Icon size={12} />, onClick: () => run(action.id) };
  });
  const defs = blockSettingsOf(block);
  const values = readBlockSettings(block, defs);
  const settings = defs.flatMap((def): ContextMenuAction[] => {
    if (def.kind === 'toggle') {
      const on = values[def.key] === true;
      return [{ label: t(def.labelKey), checked: on, onClick: () => update(withBlockSetting(block, def, !on)) }];
    }
    return def.options.map((option) => ({
      label: t('common.labelValue', { label: t(def.labelKey), value: t(option.labelKey) }),
      checked: values[def.key] === option.value,
      onClick: () => update(withBlockSetting(block, def, option.value)),
    }));
  });
  if (settings.length) settings[0] = { ...settings[0], separator: actions.length > 0 };
  return [...actions, ...settings];
}

/**
 * Duplicate and remove. An unknown block (`meta` is missing: foreign type
 * or too new a data format) can only be removed; a copy of its
 * data would be worthless without the type that understands it.
 */
export function commonBlockActions(
  t: TFunction,
  meta: BlockTypeDef | undefined,
  { duplicate, remove }: { duplicate: () => void; remove: () => void },
): ContextMenuAction[] {
  return [
    ...(meta ? [{ label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: duplicate }] : []),
    { label: t('blocks.remove'), icon: <Trash2 size={12} />, onClick: remove, danger: true },
  ];
}
