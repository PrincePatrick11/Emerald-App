import type { ComponentType } from 'react';
import { TEXT_BLOCK_TYPE, type BlockInstance } from '../../lib/blocks/types';
import TextBlock from './TextBlock';

/**
 * Welche Komponente einen Blocktyp darstellt — der Komponenten-Teil der
 * Registry (die Metadaten stehen in `lib/blocks/blockTypes.ts`).
 *
 * Importregel: nur `BlockStack` (und später die Blöcke-Ansicht) importieren
 * diese Datei. Der Textblock zieht TipTap, und das darf nicht über die eager
 * geladene Seitenleiste mitkommen.
 */
export interface BlockViewProps {
  /**
   * Der Block beim Mount. `block.html` ist ein INITIALWERT: nach dem ersten
   * Tastendruck steht der lebende Stand nur noch im Ref des Stapels — eine
   * Block-Komponente liest ihn einmal und verwaltet ihn danach selbst.
   */
  block: BlockInstance;
  isEditing: boolean;
  /** Neues inneres HTML des Blocks — der Stapel serialisiert und speichert. */
  onHtmlChange: (html: string) => void;
}

export const BLOCK_VIEWS: ReadonlyMap<string, ComponentType<BlockViewProps>> = new Map([
  [TEXT_BLOCK_TYPE, TextBlock],
]);
