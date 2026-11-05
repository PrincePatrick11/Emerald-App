/**
 * What a builder edits: elements on an artboard, in artboard pixels.
 *
 * `x`/`y` is an element's centre, `width`/`height` its box before rotation,
 * `rotation` in degrees around the centre. `z` orders the elements, higher on
 * top; ties keep the order of the list. The embedding place maps its stored
 * format onto this and back (the altar: `components/altar/altarBuilder.ts`).
 */
export interface BuilderElementBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** 0–1. */
  opacity: number;
  /** Not selectable or movable on the stage. */
  locked: boolean;
  /** Not drawn and not selectable. */
  hidden: boolean;
  z: number;
  /**
   * What the place needs to know about the element and the builder does not
   * look at (the altar: the library item an image comes from). Copies keep it.
   */
  ref?: string;
}

/** A picture, contained in its box; without a loaded source, the emoji. */
export interface BuilderImageElement extends BuilderElementBase {
  kind: 'image';
  src: string | null;
  emoji: string;
  /** A warm glow that flickers, for candles. */
  flame?: boolean;
}

export const BUILDER_SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'hexagon'] as const;
export type BuilderShapeType = (typeof BUILDER_SHAPES)[number];

export interface BuilderShapeElement extends BuilderElementBase {
  kind: 'shape';
  shape: BuilderShapeType;
  /** `#rrggbb`, or `null` for no fill. */
  fill: string | null;
  /** `#rrggbb`, or `null` for no outline. */
  stroke: string | null;
  strokeWidth: number;
  /** Rounded corners of a rectangle. */
  cornerRadius: number;
}

export const BUILDER_FONTS = ['serif', 'book', 'sans'] as const;
export type BuilderFont = (typeof BUILDER_FONTS)[number];
export type BuilderTextAlign = 'left' | 'center' | 'right';

/**
 * Text that wraps at the box's width. Its height follows the text
 * (`layoutText`); the builder keeps it current.
 */
export interface BuilderTextElement extends BuilderElementBase {
  kind: 'text';
  text: string;
  font: BuilderFont;
  fontSize: number;
  color: string;
  align: BuilderTextAlign;
  bold: boolean;
  italic: boolean;
}

export type BuilderElement = BuilderImageElement | BuilderShapeElement | BuilderTextElement;
export type BuilderElementKind = BuilderElement['kind'];

/** The grid of the artboard: drawn, snapped to, or both. */
export interface BuilderGrid {
  /** Columns and rows across the artboard. */
  columns: number;
  rows: number;
  visible: boolean;
  color: string;
  /** 0–1. */
  opacity: number;
  /** Element centres snap to the grid lines. */
  snapPosition: boolean;
  /** Sizes snap to whole cells. */
  snapSize: boolean;
}

/** The elements in drawing order, bottom first. */
export function byZ(elements: readonly BuilderElement[]): BuilderElement[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
    .map(({ element }) => element);
}
