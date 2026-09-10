import type { TFunction } from 'i18next';
import { Copy, Trash2 } from 'lucide-react';
import type { ContextMenuAction } from '../ui/ContextMenu';
import type { BlockTypeMeta } from '../../lib/blocks/blockTypes';
import { BLOCK_PRESETS } from '../../lib/blocks/presets';

/**
 * Menüeinträge, die Stapel (Rahmen-Menü, Einfügelinie) und Block-Verwaltung
 * der Seitenleiste teilen. Jedes Menü ergänzt seine eigenen Einträge davor.
 */

/** „Block hinzufügen": ein Eintrag pro Voreinstellung (Text, jede Feldart). */
export function addBlockActions(t: TFunction, onPick: (presetId: string) => void): ContextMenuAction[] {
  return BLOCK_PRESETS.map((preset) => {
    const Icon = preset.icon;
    return { label: t(preset.labelKey), icon: <Icon size={12} />, onClick: () => onPick(preset.id) };
  });
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
