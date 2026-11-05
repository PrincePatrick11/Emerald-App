import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { TFunction } from 'i18next';

/**
 * What a builder edits: a scene of elements on an artboard, in artboard pixels.
 *
 * Every element has the same frame — `x`/`y` its centre, `width`/`height` its
 * box before rotation, `rotation` in degrees around the centre, `z` the
 * stacking (higher on top; ties keep the order of the list) — and a `type`
 * that says what it is and how it draws, with that type's own `props`. The
 * types come from a registry (`BuilderElementType`), so a place can add its
 * own beside the built-in image, shape and text.
 *
 * The embedding place maps its stored format onto this and back.
 */
export interface BuilderElement<P = unknown> {
  id: string;
  type: string;
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
   * look at (where it came from, say). Copies keep it.
   */
  ref?: string;
  props: P;
}

/** The grid of the artboard: drawn, snapped to, or both. */
export interface BuilderGrid {
  /** Columns and rows across the artboard. */
  columns: number;
  rows: number;
  visible: boolean;
  color: string;
  /** 0–1. */
  opacity: number;
  /** Element centres snap to the grid crossings. */
  snapPosition: boolean;
  /** Sizes snap to whole cells. */
  snapSize: boolean;
}

/** What a type gets for drawing, besides the context and the element. */
export interface BuilderDrawEnv {
  /** A loaded picture for one of the sources the type named (`sources`), or `null` while it loads. */
  image: (src: string) => CanvasImageSource | null;
  /** The moment to draw, for types that move (`animated`), or `null` for a still picture. */
  time: number | null;
}

/** An entry of the toolbar's "add" group: what a type can put on the artboard. */
export interface BuilderAddition<P = unknown> {
  key: string;
  icon: ReactNode;
  label: (t: TFunction) => string;
  /** A new element's frame and props around `centre`, on an artboard of the given size. */
  create: (centre: { x: number; y: number }, artboard: { width: number; height: number }, t: TFunction) =>
    Pick<BuilderElement<P>, 'width' | 'height' | 'props'>;
}

/** Controls a type puts in the toolbar for the selected elements of its type. */
export type BuilderTypeControls<P = unknown> = ComponentType<{
  elements: BuilderElement<P>[];
  /** Changes the selected, unlocked elements of this type; `null` leaves one alone. */
  update: (patch: (el: BuilderElement<P>) => Partial<BuilderElement<P>> | null) => void;
}>;

/**
 * One kind of element: how it draws, how its handles behave, what the toolbar
 * offers for it. Registering one is all it takes for a place to add its own
 * kind (a drawing, say, whose renderer lives in another module).
 */
export interface BuilderElementType<P = unknown> {
  type: string;
  /** Draws `el` with its box's top-left corner at the origin; frame, rotation and opacity are the builder's. */
  draw: (ctx: CanvasRenderingContext2D, el: BuilderElement<P>, env: BuilderDrawEnv) => void;
  /** The picture sources it draws from; the builder loads them and redraws when they arrive. */
  sources?: (el: BuilderElement<P>) => (string | null)[];
  /** Fonts it draws with (CSS `font` strings); the builder loads them before drawing. */
  fonts?: (el: BuilderElement<P>) => string[];
  /** Redrawn every frame while on the stage (a flame). */
  animated?: (el: BuilderElement<P>) => boolean;
  /** Corner handles keep the proportions (Shift frees them); otherwise Shift keeps them. */
  keepRatio?: boolean;
  /** Which handles: all eight, the corners, or the corners and the two sides (for text that wraps). */
  handles?: 'all' | 'corners' | 'corners-and-sides';
  /**
   * After a scale by (`sx`, `sy`) has been baked into the box, what else
   * changes (a font size). `width`/`height` in the result override the box.
   */
  scaled?: (el: BuilderElement<P>, sx: number, sy: number) => Partial<BuilderElement<P>>;
  /** The height the element needs for its props and width (text); without it the height is free. */
  fitHeight?: (el: BuilderElement<P>) => number;
  /** Typing in place, on double-click or Enter. */
  textEdit?: {
    get: (el: BuilderElement<P>) => string;
    set: (el: BuilderElement<P>, text: string) => P;
    /** The field's look at zoom 1: font, size, colour, alignment, line height. */
    style: (el: BuilderElement<P>) => CSSProperties;
  };
  /** Entries for the toolbar's "add" group. */
  additions?: BuilderAddition<P>[];
  /** Icon and label of the add group's panel when there is more than one addition. */
  additionsGroup?: { icon: ReactNode; label: (t: TFunction) => string };
  /** Toolbar controls while elements of this type are selected. */
  controls?: BuilderTypeControls<P>;
}

/** The registry a builder works with, by type name. */
export type BuilderTypes = Record<string, BuilderElementType<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The elements in drawing order, bottom first. */
export function byZ<E extends Pick<BuilderElement, 'z'>>(elements: readonly E[]): E[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
    .map(({ element }) => element);
}
