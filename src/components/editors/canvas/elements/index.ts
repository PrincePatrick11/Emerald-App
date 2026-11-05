import type { CanvasTypes } from '../types';
import { imageType } from './image';
import { shapeType } from './shape';
import { textType } from './text';

/** The element types every canvas editor knows; a place spreads its own over them. */
export const BUILTIN_CANVAS_TYPES: CanvasTypes = {
  image: imageType,
  shape: shapeType,
  text: textType,
};

export { imageType, type ImageElement, type ImageProps } from './image';
export { shapeType, CANVAS_SHAPES, DEFAULT_FILL, type CanvasShape, type ShapeElement, type ShapeProps } from './shape';
export {
  textType, textHeight, CANVAS_FONTS, DEFAULT_TEXT_COLOR, FONT_FAMILIES,
  type CanvasFont, type CanvasTextAlign, type TextElement, type TextProps,
} from './text';
export { ColorPanel, NumberField, CANVAS_SWATCHES, common } from './controlParts';
