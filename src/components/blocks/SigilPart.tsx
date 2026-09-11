import type { ComponentType } from 'react';
import type { ElementDef, FieldsModel, SigilElementKind } from '../../lib/blocks/fields';
import { sigilPartBlock, withSigilPart } from '../../lib/blocks/sigil';
import type { BlockInstance } from '../../lib/blocks/types';
import SigilCalcBlock from './SigilCalcBlock';
import SigilCanvasBlock from './SigilCanvasBlock';
import SigilChargeBlock from './SigilChargeBlock';
import type { BlockViewProps } from './blockViews';

const PART_VIEWS: Record<SigilElementKind, ComponentType<BlockViewProps>> = {
  sigilCalc: SigilCalcBlock,
  sigilCanvas: SigilCanvasBlock,
  sigilCharge: SigilChargeBlock,
};

const noHtml = () => {};

/**
 * Ein Sigillen-Teil eines eigenen Blocks: dieselbe Komponente wie der Block
 * gleicher Art, nur auf dem virtuellen Block (`sigilPartBlock`). Was sie
 * schreibt, geht zurück ins Modell des Feldblocks und von dort als ganzer
 * Block in den Eintrag — beim Bearbeiten über `onBlockChange`, im Lesemodus
 * (Laden, Entladen, eine spät gespeicherte Zeichnung) über `onPersist`.
 */
export default function SigilPart({ element, block, model, write, persist, ...rest }: {
  element: ElementDef & { kind: SigilElementKind };
  block: BlockInstance;
  model: FieldsModel;
  /** Das geänderte Modell beim Bearbeiten übernehmen. */
  write: (next: FieldsModel) => void;
  /** Das geänderte Modell sofort speichern — fehlt, wenn der Lesemodus hier nichts darf. */
  persist?: (next: FieldsModel) => void;
} & Pick<BlockViewProps, 'blocks' | 'isEditing' | 'sigil'>) {
  const View = PART_VIEWS[element.kind];
  return (
    <View
      {...rest}
      block={sigilPartBlock(block, element, model)}
      part={element}
      onHtmlChange={noHtml}
      onBlockChange={(part) => write(withSigilPart(model, element, part))}
      onPersist={persist ? (part) => persist(withSigilPart(model, element, part)) : undefined}
    />
  );
}
