import type { ComponentType } from 'react';
import { TEXT_BLOCK_TYPE, type BlockInstance } from '../../lib/blocks/types';
import { FIELDS_BLOCK_TYPE, type ElementDef } from '../../lib/blocks/fields';
import { SIGIL_CALC_TYPE, SIGIL_CANVAS_TYPE, SIGIL_CHARGE_TYPE, type SigilState } from '../../lib/blocks/sigil';
import TextBlock from './TextBlock';
import FieldsBlock from './FieldsBlock';
import SigilCalcBlock from './SigilCalcBlock';
import SigilCanvasBlock from './SigilCanvasBlock';
import SigilChargeBlock from './SigilChargeBlock';

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
   * Der Block. Beim Textblock ist `block.html` ein INITIALWERT: nach dem ersten
   * Tastendruck steht der lebende Stand nur noch im Ref des Stapels — der
   * Editor liest ihn einmal und verwaltet ihn danach selbst. Andere Typen sind
   * kontrolliert und lesen den Block bei jedem Render.
   */
  block: BlockInstance;
  /**
   * Alle Blöcke des Eintrags, Stand des letzten Strukturwechsels — für Typen,
   * die auf andere Blöcke zeigen (die Ladung wählt ihre Rechner und
   * Zeichnungen). Das HTML von Textblöcken darin kann veraltet sein.
   */
  blocks: readonly BlockInstance[];
  isEditing: boolean;
  /** Textblock: neues inneres HTML — nur in den Ref, kein Neu-Rendern pro Tastendruck. */
  onHtmlChange: (html: string) => void;
  /** Bearbeitungsmodus: den ganzen Block ersetzen (Strukturänderung, rendert neu). */
  onBlockChange: (next: BlockInstance) => void;
  /**
   * Lesemodus: eine erlaubte Änderung (Checkliste abhaken, Ja/Nein, Sigille
   * laden) sofort in den Eintrag schreiben. Fehlt, wenn der Eintrag das nicht erlaubt.
   */
  onPersist?: (next: BlockInstance) => void;
  /** Was der Ladung-Block dem Eintrag gibt: gesperrt, verborgen (siehe `sigilState`). */
  sigil: SigilState;
  /**
   * Nur für einen Sigillen-Teil eines eigenen Blocks (`SigilPart`): sein
   * Element — mit den Einstellungen aus dem Baukasten (Rechner-Modus, Pinsel).
   */
  part?: ElementDef;
}

export const BLOCK_VIEWS: ReadonlyMap<string, ComponentType<BlockViewProps>> = new Map<string, ComponentType<BlockViewProps>>([
  [TEXT_BLOCK_TYPE, TextBlock],
  [FIELDS_BLOCK_TYPE, FieldsBlock],
  [SIGIL_CALC_TYPE, SigilCalcBlock],
  [SIGIL_CANVAS_TYPE, SigilCanvasBlock],
  [SIGIL_CHARGE_TYPE, SigilChargeBlock],
]);
