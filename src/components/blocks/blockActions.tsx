import type { TFunction } from 'i18next';
import { Copy, Trash2 } from 'lucide-react';
import type { ContextMenuAction } from '../ui/ContextMenu';
import { BLOCK_TYPE_LIST, type BlockTypeMeta } from '../../lib/blocks/blockTypes';

/**
 * Menüeinträge, die Stapel (Rahmen-Menü, Einfügelinie) und Block-Verwaltung
 * der Seitenleiste teilen. Jedes Menü ergänzt seine eigenen Einträge davor.
 */

/** „Block hinzufügen": ein Eintrag pro Blocktyp. */
export function addBlockActions(t: TFunction, onPick: (type: string) => void): ContextMenuAction[] {
  return BLOCK_TYPE_LIST.map((meta) => {
    const Icon = meta.icon;
    return { label: t(meta.labelKey), icon: <Icon size={12} />, onClick: () => onPick(meta.id) };
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
