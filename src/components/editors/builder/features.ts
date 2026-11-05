/**
 * What a builder offers. Each place that embeds it picks its set; the toolbar
 * and the keys show only what is switched on. Elements of a kind that is
 * switched off are still drawn and can still be moved, they just cannot be
 * added.
 */
export interface BuilderFeatures {
  /** Rectangles, ellipses, triangles, stars and hexagons. */
  shapes: boolean;
  /** Text boxes, edited in place. */
  text: boolean;
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
  /** Saving the artboard as a PNG file. */
  export: boolean;
}

export const FULL_BUILDER_FEATURES: BuilderFeatures = {
  shapes: true,
  text: true,
  arrange: true,
  align: true,
  guides: true,
  zoom: true,
  history: true,
  export: true,
};
