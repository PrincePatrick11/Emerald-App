import type { TFunction } from 'i18next';
import { Copy, Trash2 } from 'lucide-react';
import type { ContextMenuAction } from '../ui/ContextMenu';
import type { BlockTypeMeta } from '../../lib/blocks/blockTypes';
import type { BlockDefinition } from '../../lib/blocks/definitions';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import { BLOCK_PRESETS, definitionPresetId } from '../../lib/blocks/presets';
import BlockGlyph from './BlockGlyph';

/**
 * Menüeinträge, die Stapel (Rahmen-Menü, Einfügelinie) und Block-Verwaltung
 * der Seitenleiste teilen. Jedes Menü ergänzt seine eigenen Einträge davor.
 */

/**
 * „Block hinzufügen": ein Eintrag pro Voreinstellung (Text, jede Feldart),
 * dahinter die eigenen Blöcke aus der Blöcke-Ansicht.
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
 * Duplizieren und Entfernen. Ein unbekannter Block (`meta` fehlt: fremder Typ
 * oder zu neues Datenformat) lässt sich nur entfernen — eine Kopie seiner
 * Daten wäre ohne den Typ, der sie versteht, nichts wert.
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
