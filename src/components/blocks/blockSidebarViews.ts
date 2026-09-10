import type { ComponentType } from 'react';
import type { BlockAttrName, BlockInstance } from '../../lib/blocks/types';
import { FIELDS_BLOCK_TYPE } from '../../lib/blocks/fields';
import FieldsSidebarEdit from './FieldsSidebarEdit';

/**
 * Abschnitte, die ein Blocktyp in die rechte Seitenleiste mitbringt — je eine
 * Lese- und eine Bearbeitungsvariante, wie die Eigenschaften-Panels. Die
 * Block-Verwaltung rendert für jeden Block, dessen Typ hier steht, einen
 * einklappbaren Abschnitt unter der Blockliste. Nachgeschlagen wird über den
 * aufgelösten Typ (`resolveBlockType`): ein Block mit zu neuem Datenformat
 * bekommt hier so wenig eine Bearbeitungsansicht wie im Stapel.
 *
 * Der Textblock trägt nichts ein — Titel und Sichtbarkeit gelten für jeden
 * Block und stehen in der Verwaltungsliste. Der Feldblock bringt seine
 * Einstellungen mit (Beschriftungen, Optionen, Anzeigeregeln).
 *
 * Importregel: nur `BlockSidebarArea` importiert diese Datei, und sie darf
 * nichts ziehen, was TipTap lädt — die Seitenleiste wird eager geladen.
 */
export interface BlockSidebarReadProps {
  block: BlockInstance;
}

export interface BlockSidebarEditProps extends BlockSidebarReadProps {
  /**
   * Ein Instanz-Attribut setzen; läuft durch den Stapel, Cancel dreht es
   * zurück. Nur die Bearbeitungsvariante bekommt Schreibzugriff: eine Änderung
   * im Lesemodus landete in keinem Autosave und würde von der nächsten
   * Cancel-Baseline geschluckt.
   */
  setAttr: (name: BlockAttrName, value: string | null) => void;
  /** Den ganzen Block ersetzen (Attribute und inneres HTML) — für Typen, deren Fallback mitwandert. */
  update: (next: BlockInstance) => void;
}

export interface BlockSidebarViews {
  Read?: ComponentType<BlockSidebarReadProps>;
  Edit?: ComponentType<BlockSidebarEditProps>;
}

export const BLOCK_SIDEBAR_VIEWS: ReadonlyMap<string, BlockSidebarViews> = new Map<string, BlockSidebarViews>([
  [FIELDS_BLOCK_TYPE, { Edit: FieldsSidebarEdit }],
]);
