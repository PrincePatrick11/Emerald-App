/**
 * What a canvas editor offers besides its element types (which come from the
 * registry, `CanvasElementType`). Each place picks its set; the toolbar and
 * the keys show only what is switched on.
 */
export interface CanvasFeatures {
  /** Bring forward, send backward, to front, to back. */
  arrange: boolean;
  /** Aligning and distributing several elements. */
  align: boolean;
  /** Guides to the artboard and the other elements while moving. */
  guides: boolean;
  /** Zooming and panning the view. */
  zoom: boolean;
  /** Undo and redo inside the canvas editor. */
  history: boolean;
  /** The list of the elements beside the stage: picking, stacking, hiding, locking. */
  layers: boolean;
  /** Grouping elements (the place has to store `CanvasElement.group`). */
  group: boolean;
}

export const FULL_CANVAS_FEATURES: CanvasFeatures = {
  arrange: true,
  align: true,
  guides: true,
  zoom: true,
  history: true,
  layers: true,
  group: true,
};
