/**
 * What a paint editor offers. Each place that embeds the editor picks its set;
 * the toolbar shows only what is switched on. Unlike the text editor's
 * features these only hide tools: a document drawn with a tool that is
 * switched off keeps its strokes and draws them.
 */
export interface PaintFeatures {
  /** Line, ellipse, rectangle, polygon and star, outlined or filled. */
  shapes: boolean;
  /** The paint bucket, filling an area as a vector. */
  fill: boolean;
  /** Drawing in mirror or radial symmetry. */
  symmetry: boolean;
  eraser: boolean;
  /** Several layers: adding, hiding, reordering, renaming, removing. */
  layers: boolean;
  /** Any colour from the system's picker besides the place's palette. */
  customColor: boolean;
  /** Emptying the whole drawing in one step. */
  clear: boolean;
  /** Selecting strokes (rectangle, lasso) to move, scale, turn, copy or remove them, and moving a whole layer. */
  select: boolean;
  /** Taking a colour from the drawing. */
  picker: boolean;
}

/** Everything. */
export const FULL_PAINT_FEATURES: PaintFeatures = {
  shapes: true,
  fill: true,
  symmetry: true,
  eraser: true,
  layers: true,
  customColor: true,
  clear: true,
  select: true,
  picker: true,
};
