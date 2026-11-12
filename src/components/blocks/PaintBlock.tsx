import { useTranslation } from 'react-i18next';
import { CANVAS_SWATCHES } from '../editors/canvas';
import { isSigilDrawing } from '../../lib/blocks/paint';
import DrawingBlock from './DrawingBlock';
import SigilCanvasBlock from './SigilCanvasBlock';
import type { BlockViewProps } from './blockViews';

/** Where the brush starts: a middle size of the paint mode's range. */
const START_SIZE = 8;

/**
 * The paint block (`core.paint`): a drawing of its own, in the canvas swatches.
 * Marked as a sigil drawing, it is the sigil's drawing (`SigilCanvasBlock`).
 */
export default function PaintBlock(props: BlockViewProps) {
  return isSigilDrawing(props.block) ? <SigilCanvasBlock {...props} /> : <Painting {...props} />;
}

function Painting({ block, isEditing, onBlockChange, onPersist }: BlockViewProps) {
  const { t } = useTranslation();
  return (
    <DrawingBlock
      block={block}
      isEditing={isEditing}
      onBlockChange={onBlockChange}
      onPersist={onPersist}
      palette={CANVAS_SWATCHES}
      startColor={CANVAS_SWATCHES[0]}
      startSize={START_SIZE}
      texts={{
        empty: t('blocks.paint.empty'),
        locked: '',
        saveFailed: t('blocks.paint.saveFailed'),
        loadFailed: t('blocks.paint.loadFailed'),
      }}
    />
  );
}
