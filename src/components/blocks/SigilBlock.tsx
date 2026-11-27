import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BackgroundFields, EMPTY_BACKGROUND, hasBackground, parseCanvasBackground, sigilDrawingProfile,
  type CanvasBackground,
} from '../editors/canvas';
import {
  shownSigilParts, sigilBackground, sigilPartBlock, sigilPartId, withSigilBackground, withSigilPart,
  SIGIL_BACKGROUND_ACTION, SIGIL_PARTS, type SigilPartName,
} from '../../lib/blocks/sigil';
import type { BlockInstance } from '../../lib/blocks/types';
import { luminance } from '../../themes/customTheme';
import Modal from '../ui/Modal';
import DrawingBlock from './DrawingBlock';
import SigilCalc from './SigilCalc';
import SigilCharge from './SigilCharge';
import SigilConcealed from './SigilConcealed';
import { BLOCK_BACKGROUND_IMAGES, useBlockAction } from './toolkit';
import type { BlockViewProps } from './blockViews';

/** The two inks the brush starts with: the one that stands out on the background. */
const LIGHT_INK = '#f8fafc';
const DARK_INK = '#111827';
/** The palette of the sigil drawing. */
const SIGIL_COLORS = [LIGHT_INK, '#00e699', '#f59e0b', '#ef4444', '#60a5fa', '#a78bfa', DARK_INK];
const START_SIZE = 8;
/** Above this luminance the light ink would vanish on the background. */
const LIGHT_LUMINANCE = 0.4;

/**
 * Is the background light, so that the light ink would vanish on it? Judged
 * by its fill (a gradient by its colours' mean) with the tint laid over it
 * at its strength; a picture alone says nothing, the light ink stays.
 */
function isLight(background: CanvasBackground | null): boolean {
  if (!background) return false;
  const { fill, tint } = background;
  const colors = fill.kind === 'color' ? [fill.color] : fill.kind === 'none' ? [] : fill.colors;
  // Without a fill the tint lies on the picture or the page: only a strong one counts.
  if (!colors.length) return !!tint && tint.opacity >= 0.5 && luminance(tint.color) > LIGHT_LUMINANCE;
  const fillLight = colors.reduce((sum, c) => sum + luminance(c), 0) / colors.length;
  const shown = tint ? fillLight * (1 - tint.opacity) + luminance(tint.color) * tint.opacity : fillLight;
  return shown > LIGHT_LUMINANCE;
}

/**
 * The sigil block: calculator, drawing and charge, each under its own
 * heading, as the block's settings switch them on (`shownSigilParts`). Each
 * part reads and writes its own block-shaped value; what it writes goes
 * back into the block (`withSigilPart`) — while editing through
 * `onBlockChange`, in read mode (charging, a drawing saved late) through
 * `onPersist`.
 *
 * The drawing lies on the block's background (`sigilBackground`), chosen
 * with "Background …" from the block's menu while editing, in the canvas
 * editor's background fields; its stored picture carries it.
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
  const [choosingBackground, setChoosingBackground] = useState(false);
  useBlockAction(block.id, SIGIL_BACKGROUND_ACTION, () => setChoosingBackground(true));
  // Editing ended (Done, Cancel) with the dialog open: it does not come back with the next edit.
  useEffect(() => { if (!isEditing) setChoosingBackground(false); }, [isEditing]);
  const rawBackground = sigilBackground(block);
  const backgroundKey = JSON.stringify(rawBackground);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the stored value
  const background = useMemo(() => parseCanvasBackground(rawBackground), [backgroundKey]);
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
  const setBackground = (next: CanvasBackground) => {
    latest.current = withSigilBackground(latest.current, hasBackground(next) ? next : null);
    onBlockChange(latest.current);
  };

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
            profile={sigilDrawingProfile}
            background={background}
            palette={SIGIL_COLORS}
            startColor={isLight(background) ? DARK_INK : LIGHT_INK}
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
      {choosingBackground && isEditing && (
        <Modal title={t('blocks.sigil.backgroundTitle')} onClose={() => setChoosingBackground(false)} widthClassName="w-auto max-w-full">
          <BackgroundFields value={background ?? EMPTY_BACKGROUND} onChange={setBackground} images={BLOCK_BACKGROUND_IMAGES} />
        </Modal>
      )}
    </div>
  );
}
