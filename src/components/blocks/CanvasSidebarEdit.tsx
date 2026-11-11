import { useTranslation } from 'react-i18next';
import { CANVAS_PART_KEYS, parseCanvasBlock, withCanvasParts } from '../../lib/blocks/canvas';
import { SwitchRow } from '../ui/Switch';
import type { BlockSidebarEditProps } from './blockSidebarViews';

/**
 * The settings of a canvas block, below its row in edit mode: which parts it
 * offers (the "Images" strip, shapes, text, symbols, drawing). Switched off,
 * a part adds nothing new; what is on the canvas stays. In a template they
 * travel with the block.
 */
export default function CanvasSidebarEdit({ block, update }: BlockSidebarEditProps) {
  const { t } = useTranslation();
  const { broken, parts } = parseCanvasBlock(block);
  if (broken) return null;
  return (
    <div className="min-w-0 space-y-2">
      <p className="panel-subheading">{t('blocks.canvas.parts')}</p>
      {CANVAS_PART_KEYS.map((key) => (
        <SwitchRow
          key={key}
          variant="panel"
          checked={parts[key]}
          label={t(`blocks.canvas.part.${key}`)}
          onChange={(checked) => update(withCanvasParts(block, { ...parts, [key]: checked }))}
        />
      ))}
    </div>
  );
}
