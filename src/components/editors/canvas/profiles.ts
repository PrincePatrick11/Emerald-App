import { FULL_CANVAS_FEATURES, type CanvasFeatures } from './features';
import { BUILTIN_CANVAS_TYPES } from './elements';
import { createDrawingType, type DrawingTypeOptions } from './paint/drawing';
import { FULL_PAINT_FEATURES, type PaintFeatures } from './paint/features';
import type { CanvasTypes } from './types';

/**
 * What one place offers in the canvas editor: which element types exist
 * (and so what can be added), which of the editor's own tools, and which
 * paint tools. A place picks or builds one and spreads it over the editor's
 * props. The shapes places start from and the named ones a decision fixed
 * (the sigil's drawing) live here; what a place only adjusts stays with it.
 */
export interface CanvasProfile {
  types: CanvasTypes;
  features: CanvasFeatures;
  paint: { features: PaintFeatures };
}

const NOTHING: CanvasFeatures = {
  arrange: false, align: false, guides: false, zoom: false, history: true, layers: false, group: false,
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

/**
 * The sigil's drawing, kept spare: the pen, the line, the eraser, selecting,
 * symmetry, the palette with the free colour, and clearing. No shapes,
 * layers, bucket or picker — a sigil is a figure of lines.
 */
export function sigilDrawingProfile(drawing: DrawingTypeOptions = {}): CanvasProfile {
  return paintOnlyProfile(drawing, { shapes: false, layers: false, fill: false, picker: false });
}

/**
 * Everything: images, shapes, text and drawings, and all tools. The canvas
 * block and the altar both take it; the altar differs only in its parts
 * (`CanvasParts`), not in its tools.
 */
export function fullProfile(drawing: DrawingTypeOptions = {}): CanvasProfile {
  return {
    types: { ...BUILTIN_CANVAS_TYPES, drawing: createDrawingType(drawing) },
    features: FULL_CANVAS_FEATURES,
    paint: { features: FULL_PAINT_FEATURES },
  };
}
