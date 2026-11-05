/**
 * What a builder offers besides its element types (which come from the
 * registry, `BuilderElementType`). Each place picks its set; the toolbar and
 * the keys show only what is switched on.
 */
export interface BuilderFeatures {
  /** Bring forward, send backward, to front, to back. */
  arrange: boolean;
  /** Aligning and distributing several elements. */
  align: boolean;
  /** Guides to the artboard and the other elements while moving. */
  guides: boolean;
  /** Zooming and panning the view. */
  zoom: boolean;
  /** Undo and redo inside the builder. */
  history: boolean;
  /** Saving the artboard as an image (needs the place's `onExport`). */
  export: boolean;
}

export const FULL_BUILDER_FEATURES: BuilderFeatures = {
  arrange: true,
  align: true,
  guides: true,
  zoom: true,
  history: true,
  export: true,
};
