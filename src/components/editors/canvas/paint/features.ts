/**
 * What a paint editor offers. Each place that embeds the editor picks its set;
 * the toolbar shows only what is switched on. Unlike the text editor's
 * features these only hide tools: a document drawn with a tool that is
 * switched off keeps its strokes and draws them.
 */
export interface PaintFeatures {
  /** Line, ellipse and rectangle. */
  shapes: boolean;
  eraser: boolean;
  /** Several layers: adding, hiding, reordering, renaming, removing. */
  layers: boolean;
  /** Any colour from the system's picker besides the place's palette. */
  customColor: boolean;
  /** Emptying the whole drawing in one step. */
  clear: boolean;
}

/** Everything. */
export const FULL_PAINT_FEATURES: PaintFeatures = {
  shapes: true,
  eraser: true,
  layers: true,
  customColor: true,
  clear: true,
};
