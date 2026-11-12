import type { ComponentType } from 'react';
import type { FieldsModel, SigilElement, SigilElementKind } from '../../lib/blocks/fields';
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
 * A sigil part of a fields block — one of a custom block's, or a calculator
 * or charge on its own: its component on the virtual block (`sigilPartBlock`). What it
 * writes goes back into the field block's model and from there as a whole
 * block into the entry: when editing via `onBlockChange`, in read mode
 * (charging, discharging, a drawing saved late) via `onPersist`.
 */
export default function SigilPart({ element, block, model, write, persist, ...rest }: {
  element: SigilElement;
  block: BlockInstance;
  model: FieldsModel;
  /** Adopt the changed model when editing. */
  write: (next: FieldsModel) => void;
  /** Save the changed model immediately; absent if read mode is not allowed to do anything here. */
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
