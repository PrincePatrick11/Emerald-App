import { useTranslation } from 'react-i18next';
import SigilConcealed from './SigilConcealed';
import DrawingBlock from './DrawingBlock';
import { DEFAULT_BRUSH_SIZE, SIGIL_COLORS } from './SigilBrushControls';
import type { BlockViewProps } from './blockViews';

/**
 * The sigil drawing — a paint block marked as one, or a custom block's
 * drawing part: a drawing (`DrawingBlock`) in the sigil's colours,
 * hidden while a charge conceals it (when editing too) and shown without
 * its editor while the lock "sigil only" holds it.
 */
export default function SigilCanvasBlock({ block, isEditing, onBlockChange, onPersist, sigil, part }: BlockViewProps) {
  const { t } = useTranslation();
  if (sigil.concealed.has(block.id)) return <SigilConcealed revealDate={sigil.concealed.get(block.id) ?? null} />;
  return (
    <DrawingBlock
      block={block}
      isEditing={isEditing}
      onBlockChange={onBlockChange}
      onPersist={onPersist}
      locked={sigil.locked.has(block.id)}
      palette={SIGIL_COLORS}
      startColor={part?.brushColor ?? SIGIL_COLORS[0]}
      startSize={part?.brushSize ?? DEFAULT_BRUSH_SIZE}
      texts={{
        empty: t('blocks.sigil.emptyDrawing'),
        locked: t('blocks.sigil.locked'),
        saveFailed: t('blocks.sigil.saveFailed'),
        loadFailed: t('blocks.sigil.loadFailed'),
      }}
    />
  );
}
