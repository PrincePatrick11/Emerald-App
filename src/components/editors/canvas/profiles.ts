import { FULL_CANVAS_FEATURES, type CanvasFeatures } from './features';
import { BUILTIN_CANVAS_TYPES } from './elements';
import { createDrawingType, type DrawingTypeOptions } from './paint/drawing';
import { FULL_PAINT_FEATURES, type PaintFeatures } from './paint/features';
import type { CanvasTypes } from './types';

/**
 * What one place offers in the canvas editor: which element types exist
 * (and so what can be added), which of the editor's own tools, and which
 * paint tools. A place picks or builds one and spreads it over the editor's
 * props; the concrete profiles live with the places (their adapters).
 */
export interface CanvasProfile {
  types: CanvasTypes;
  features: CanvasFeatures;
  paint: { features: PaintFeatures };
}

const NOTHING: CanvasFeatures = {
  arrange: false, align: false, guides: false, zoom: false, history: true, export: false,
};

/**
 * Only painting: the drawing type alone, none of the editor's tools but undo
 * and zooming into the drawing.
 * With `paintElementId` set to the one drawing, it is a plain paint editor.
 */
export function paintOnlyProfile(drawing: DrawingTypeOptions = {}, paint: Partial<PaintFeatures> = {}): CanvasProfile {
  const type = createDrawingType(drawing);
  // Nothing to add: the place gives the one drawing.
  return {
    types: { drawing: { ...type, additions: undefined } },
    features: { ...NOTHING, zoom: true },
    paint: { features: { ...FULL_PAINT_FEATURES, ...paint } },
  };
}

/** Everything: images, shapes, text and drawings, and all tools. */
export function fullProfile(drawing: DrawingTypeOptions = {}): CanvasProfile {
  return {
    types: { ...BUILTIN_CANVAS_TYPES, drawing: createDrawingType(drawing) },
    features: FULL_CANVAS_FEATURES,
    paint: { features: FULL_PAINT_FEATURES },
  };
}
