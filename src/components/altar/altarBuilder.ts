import type { BuilderElement } from '../editors/builder';
import { BASE_RESOLUTION_WIDTH, isCandleEmoji } from '../../lib/altarConstants';
import type { AltarPlacement } from '../../types';

/**
 * The altar in the builder's terms and back. The builder works in pixels of
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
): BuilderElement {
  const unit = unitPx(refW);
  const k = pxScale(refW);
  const base = {
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
    return {
      ...base, kind: 'shape', shape: p.shape.type, fill: p.shape.fill, stroke: p.shape.stroke,
      strokeWidth: p.shape.stroke_width * k, cornerRadius: p.shape.corner_radius * k,
    };
  }
  if (p.kind === 'text' && p.text) {
    return {
      ...base, kind: 'text', text: p.text.content, font: p.text.font, fontSize: p.text.size * k,
      color: p.text.color, align: p.text.align, bold: p.text.bold, italic: p.text.italic,
    };
  }
  const src = imageSrcFor(p.image_data);
  return { ...base, kind: 'image', src, emoji: p.emoji, flame: !src && isCandleEmoji(p.emoji), ref: p.item_id };
}

const round = (n: number, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * A builder element as a placement. `previous` is the placement it was, for
 * what the builder does not carry (name, emoji, image of the item).
 */
export function elementToPlacement(
  el: BuilderElement,
  refW: number,
  refH: number,
  previous: AltarPlacement | undefined,
): AltarPlacement {
  const unit = unitPx(refW);
  const k = pxScale(refW);
  const base: AltarPlacement = {
    id: el.id,
    altar_id: previous?.altar_id,
    kind: el.kind === 'image' ? 'item' : el.kind,
    item_id: el.kind === 'image' ? el.ref ?? previous?.item_id ?? '' : '',
    name: previous?.name ?? '',
    emoji: previous?.emoji ?? (el.kind === 'image' ? el.emoji : ''),
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
  if (el.kind === 'shape') {
    base.shape = {
      type: el.shape, fill: el.fill, stroke: el.stroke,
      stroke_width: round(el.strokeWidth / k, 2), corner_radius: round(el.cornerRadius / k, 2),
    };
  }
  if (el.kind === 'text') {
    base.text = {
      content: el.text, font: el.font, size: round(el.fontSize / k, 2), color: el.color,
      align: el.align, bold: el.bold, italic: el.italic,
    };
  }
  return base;
}
