import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { PaintDoc } from '../../../lib/paint/document';

/**
 * What a canvas editor edits: a scene of elements on an artboard, in artboard pixels.
 *
 * Every element has the same frame — `x`/`y` its centre, `width`/`height` its
 * box before rotation, `rotation` in degrees around the centre, `z` the
 * stacking (higher on top; ties keep the order of the list) — and a `type`
 * that says what it is and how it draws, with that type's own `props`. The
 * types come from a registry (`CanvasElementType`), so a place can add its
 * own beside the built-in image, shape and text.
 *
 * The embedding place maps its stored format onto this and back.
 */
export interface CanvasElement<P = unknown> {
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
   * What the place needs to know about the element and the canvas editor does not
   * look at (where it came from, say). Copies keep it.
   */
  ref?: string;
  /**
   * The group it belongs to: elements with the same group are selected,
   * moved and stacked together. A place that does not store it has no groups.
   */
  group?: string;
  props: P;
}

/** The grid of the artboard: drawn, snapped to, or both. */
export interface CanvasGrid {
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
export interface CanvasDrawEnv {
  /** A loaded picture for one of the sources the type named (`sources`), or `null` while it loads. */
  image: (src: string) => CanvasImageSource | null;
  /** The moment to draw, for types that move (`animated`), or `null` for a still picture. */
  time: number | null;
}

/** What a type gets for writing itself as SVG, besides the element. */
export interface CanvasSvgEnv {
  /** One of the sources the type named (`sources`) as a reference to embed, a data URL; `null` if it did not load. */
  href: (src: string) => string | null;
  /** A fresh id, unique in the file, for a mask, filter or gradient. */
  id: () => string;
  /** Where masks, filters and gradients go. */
  defs: string[];
}

/** A tool of the tool column: what a type can put on the artboard. */
export interface CanvasAddition<P = unknown> {
  key: string;
  icon: ReactNode;
  /** The letter that picks it in the tool column (the paint mode's letter for the same shape). */
  shortcut?: string;
  label: (t: TFunction) => string;
  /**
   * A choice to make before drawing (a symbol from the library), shown beside
   * the tool column when its button is pressed; `onPicked` then picks the tool.
   */
  picker?: ComponentType<{ onPicked: () => void }>;
  /** A new element's frame and props around `centre`, on an artboard of the given size. */
  create: (centre: { x: number; y: number }, artboard: { width: number; height: number }, t: TFunction) =>
    Pick<CanvasElement<P>, 'width' | 'height' | 'props'>;
}

/** Controls a type puts in the toolbar for the selected elements of its type. */
export type CanvasTypeControls<P = unknown> = ComponentType<{
  elements: CanvasElement<P>[];
  /** Changes the selected, unlocked elements of this type; `null` leaves one alone. */
  update: (patch: (el: CanvasElement<P>) => Partial<CanvasElement<P>> | null) => void;
}>;

/**
 * One kind of element: how it draws, how its handles behave, what the toolbar
 * offers for it. Registering one is all it takes for a place to add its own
 * kind (a drawing, say, whose renderer lives in another module).
 */
export interface CanvasElementType<P = unknown> {
  type: string;
  /** What the element is called in the element list (its text, its shape). */
  label?: (el: CanvasElement<P>, t: TFunction) => string;
  /** Draws `el` with its box's top-left corner at the origin; frame, rotation and opacity are the canvas editor's. */
  draw: (ctx: CanvasRenderingContext2D, el: CanvasElement<P>, env: CanvasDrawEnv) => void;
  /**
   * The element as SVG content in its box (top-left corner at the origin;
   * frame, rotation and opacity are the export's), for saving as SVG with
   * vectors. Without it, or with `null`, the export embeds the drawn picture.
   */
  svg?: (el: CanvasElement<P>, env: CanvasSvgEnv) => string | null;
  /** The picture sources it draws from; the canvas editor loads them and redraws when they arrive. */
  sources?: (el: CanvasElement<P>) => (string | null)[];
  /** Fonts it draws with (CSS `font` strings); the canvas editor loads them before drawing. */
  fonts?: (el: CanvasElement<P>) => string[];
  /** Redrawn every frame while on the stage (a flame). */
  animated?: (el: CanvasElement<P>) => boolean;
  /** Corner handles keep the proportions (Shift frees them); otherwise Shift keeps them. */
  keepRatio?: boolean;
  /** Which handles: all eight, the corners, or the corners and the two sides (for text that wraps). */
  handles?: 'all' | 'corners' | 'corners-and-sides';
  /**
   * After a scale by (`sx`, `sy`) has been baked into the box, what else
   * changes (a font size). `width`/`height` in the result override the box.
   */
  scaled?: (el: CanvasElement<P>, sx: number, sy: number) => Partial<CanvasElement<P>>;
  /** The height the element needs for its props and width (text); without it the height is free. */
  fitHeight?: (el: CanvasElement<P>) => number;
  /** Typing in place, on double-click or Enter. */
  textEdit?: {
    get: (el: CanvasElement<P>) => string;
    set: (el: CanvasElement<P>, text: string) => P;
    /** The field's look at zoom 1: font, size, colour, alignment, line height. */
    style: (el: CanvasElement<P>) => CSSProperties;
  };
  /**
   * Painting in place, on double-click or Enter: the paint mode, with the
   * paint tools in the toolbar and a drawing surface over the element.
   */
  paint?: {
    get: (el: CanvasElement<P>) => PaintDoc;
    set: (el: CanvasElement<P>, doc: PaintDoc) => P;
    /** A layer image's reference as a source the canvas can load. */
    resolveImage: (ref: string) => string;
  };
  /** Tools of the tool column: what the type can put on the artboard. */
  additions?: CanvasAddition<P>[];
  /** Toolbar controls while elements of this type are selected. */
  controls?: CanvasTypeControls<P>;
}

/** The registry a canvas editor works with, by type name. */
export type CanvasTypes = Record<string, CanvasElementType<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The elements in drawing order, bottom first. */
export function byZ<E extends Pick<CanvasElement, 'z'>>(elements: readonly E[]): E[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
    .map(({ element }) => element);
}
