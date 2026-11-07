import type { CanvasElement, DrawingProps, ImageProps, ShapeProps, TextProps } from '../editors/canvas';
import { emptyPaintDoc } from '../../lib/paint/document';
import { BASE_RESOLUTION_WIDTH, isCandleEmoji } from '../../lib/altarConstants';
import type { AltarPlacement } from '../../types';

/**
 * The altar in the canvas editor's terms and back. The canvas editor works in pixels of
 * the altar's reference resolution (`resolveResolutionPixels`); a placement
 * stores its centre in percent of the altar and its size in units, where a
 * unit is 5 px at the reference width of 1920 (40 units, an item's default,
 * are 200 px there). Font size, outline width and corner radius of drawn
 * elements are pixels at that width. So everything scales with the
 * resolution, as it always has.
 */

/** Pixels per size unit at the reference width `refW`. */
export function unitPx(refW: number): number {
  return (5 * refW) / BASE_RESOLUTION_WIDTH;
}

/** Pixels at `refW` per pixel at the reference width of 1920. */
const pxScale = (refW: number) => refW / BASE_RESOLUTION_WIDTH;

export function placementToElement(
  p: AltarPlacement,
  refW: number,
  refH: number,
  imageSrcFor: (imageData: string | undefined) => string | null,
): CanvasElement {
  const unit = unitPx(refW);
  const k = pxScale(refW);
  const frame = {
    id: p.id,
    x: (p.x / 100) * refW,
    y: (p.y / 100) * refH,
    width: p.width * unit,
    height: p.height * unit,
    rotation: p.rotation,
    opacity: p.opacity,
    locked: p.locked,
    hidden: p.hidden,
    z: p.z_index,
  };
  if (p.kind === 'shape' && p.shape) {
    const props: ShapeProps = {
      shape: p.shape.type, fill: p.shape.fill, stroke: p.shape.stroke,
      strokeWidth: p.shape.stroke_width * k, cornerRadius: p.shape.corner_radius * k,
      ...(p.shape.sides !== undefined ? { sides: p.shape.sides } : {}),
    };
    return { ...frame, type: 'shape', props };
  }
  if (p.kind === 'text' && p.text) {
    const props: TextProps = {
      text: p.text.content, font: p.text.font, fontSize: p.text.size * k,
      color: p.text.color, align: p.text.align, bold: p.text.bold, italic: p.text.italic,
    };
    return { ...frame, type: 'text', props };
  }
  if (p.kind === 'drawing') {
    const props: DrawingProps = { doc: p.drawing ?? emptyPaintDoc() };
    return { ...frame, type: 'drawing', props };
  }
  const src = imageSrcFor(p.image_data);
  // A candle without a picture flickers, as it always did.
  const props: ImageProps = { src, emoji: p.emoji, glow: !src && isCandleEmoji(p.emoji) };
  return { ...frame, type: 'image', ref: p.item_id, props };
}

const round = (n: number, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * A canvas element as a placement. `previous` is the placement it was, for
 * what the canvas editor does not carry (name, emoji, image of the item).
 */
export function elementToPlacement(
  el: CanvasElement,
  refW: number,
  refH: number,
  previous: AltarPlacement | undefined,
): AltarPlacement {
  const unit = unitPx(refW);
  const k = pxScale(refW);
  const base: AltarPlacement = {
    id: el.id,
    altar_id: previous?.altar_id,
    kind: el.type === 'shape' || el.type === 'text' || el.type === 'drawing' ? el.type : 'item',
    item_id: el.type === 'image' ? el.ref ?? previous?.item_id ?? '' : '',
    name: previous?.name ?? '',
    emoji: previous?.emoji ?? (el.type === 'image' ? (el.props as ImageProps).emoji : ''),
    category_id: previous?.category_id ?? null,
    image_data: previous?.image_data,
    x: round((el.x / refW) * 100),
    y: round((el.y / refH) * 100),
    z_index: el.z,
    width: round(el.width / unit),
    height: round(el.height / unit),
    rotation: round(el.rotation, 1),
    opacity: el.opacity,
    locked: el.locked,
    hidden: el.hidden,
  };
  if (el.type === 'shape') {
    const p = el.props as ShapeProps;
    base.shape = {
      type: p.shape, fill: p.fill, stroke: p.stroke,
      stroke_width: round(p.strokeWidth / k, 2), corner_radius: round(p.cornerRadius / k, 2),
      ...(p.sides !== undefined ? { sides: p.sides } : {}),
    };
  }
  if (el.type === 'drawing') base.drawing = (el.props as DrawingProps).doc;
  if (el.type === 'text') {
    const p = el.props as TextProps;
    base.text = {
      content: p.text, font: p.font, size: round(p.fontSize / k, 2), color: p.color,
      align: p.align, bold: p.bold, italic: p.italic,
    };
  }
  return base;
}
