import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isSigilBroken, shownSigilParts, sigilPartBlock, sigilPartId, withSigilPart, SIGIL_PARTS, type SigilPartName,
} from '../../lib/blocks/sigil';
import type { BlockInstance } from '../../lib/blocks/types';
import DrawingBlock from './DrawingBlock';
import SigilCalc from './SigilCalc';
import SigilCharge from './SigilCharge';
import SigilConcealed from './SigilConcealed';
import UnknownBlock from './UnknownBlock';
import type { BlockViewProps } from './blockViews';

/** The palette of the sigil drawing. */
const SIGIL_COLORS = ['#f8fafc', '#00e699', '#f59e0b', '#ef4444', '#60a5fa', '#a78bfa', '#111827'];
const START_SIZE = 8;

/**
 * The sigil block: calculator, drawing and charge, each under its own
 * heading, as the block's settings switch them on (`shownSigilParts`). Each
 * part reads and writes its own block-shaped value; what it writes goes
 * back into the block (`withSigilPart`) — while editing through
 * `onBlockChange`, in read mode (charging, a drawing saved late) through
 * `onPersist`.
 *
 * What the charge does — lock and conceal calculator and drawing — the view
 * reads from the entry's effects like every other view, by the part's ID.
 */
export default function SigilBlock({ block, isEditing, onBlockChange, onPersist, effects }: BlockViewProps) {
  const { t } = useTranslation();
  // Three parts write into one block: two writes before the next render (a
  // drawing saved while typing in the calculator) must build on each other,
  // not both on the block of the last render.
  const latest = useRef(block);
  latest.current = block;
  if (isSigilBroken(block)) return <UnknownBlock block={block} />;
  const shown = shownSigilParts(block);
  const parts = SIGIL_PARTS.filter((part) => shown[part]);
  if (parts.length === 0) {
    return isEditing ? <p className="block-field-hint">{t('blocks.types.sigil.noParts')}</p> : null;
  }

  const merged = (part: SigilPartName, next: BlockInstance) => {
    latest.current = withSigilPart(latest.current, part, next);
    return latest.current;
  };
  const write = (part: SigilPartName) => (next: BlockInstance) => onBlockChange(merged(part, next));
  const persist = (part: SigilPartName) => (onPersist ? (next: BlockInstance) => onPersist(merged(part, next)) : undefined);

  const body = (part: SigilPartName) => {
    const id = sigilPartId(block.id, part);
    // Concealed in both modes: otherwise "Edit" (lock "only the sigil") would show it early.
    if (effects.concealed.has(id)) return <SigilConcealed revealDate={effects.concealed.get(id) ?? null} />;
    const value = sigilPartBlock(block, part);
    const locked = effects.locked.has(id);
    switch (part) {
      case 'calc':
        return <SigilCalc value={value} isEditing={isEditing} locked={locked} onChange={write(part)} />;
      case 'drawing':
        return (
          <DrawingBlock
            block={value}
            isEditing={isEditing}
            onBlockChange={write(part)}
            onPersist={persist(part)}
            locked={locked}
            palette={SIGIL_COLORS}
            startColor={SIGIL_COLORS[0]}
            startSize={START_SIZE}
            texts={{
              empty: t('blocks.sigil.emptyDrawing'),
              locked: t('blocks.sigil.locked'),
              saveFailed: t('blocks.sigil.saveFailed'),
              loadFailed: t('blocks.sigil.loadFailed'),
            }}
          />
        );
      case 'charge':
        return <SigilCharge value={value} isEditing={isEditing} onChange={write(part)} onPersist={persist(part)} />;
    }
  };

  return (
    <div className="block-sigil">
      {parts.map((part) => (
        <div key={part} className="block-sigil-part">
          <div className="label-xs">{t(`blocks.types.sigil.parts.${part}`)}</div>
          {body(part)}
        </div>
      ))}
    </div>
  );
}
