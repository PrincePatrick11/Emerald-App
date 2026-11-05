import type { BuilderTypes } from '../types';
import { imageType } from './image';
import { shapeType } from './shape';
import { textType } from './text';

/** The element types every builder knows; a place spreads its own over them. */
export const BUILTIN_BUILDER_TYPES: BuilderTypes = {
  image: imageType,
  shape: shapeType,
  text: textType,
};

export { imageType, type ImageElement, type ImageProps } from './image';
export { shapeType, BUILDER_SHAPES, DEFAULT_FILL, type BuilderShape, type ShapeElement, type ShapeProps } from './shape';
export {
  textType, textHeight, BUILDER_FONTS, DEFAULT_TEXT_COLOR, FONT_FAMILIES,
  type BuilderFont, type BuilderTextAlign, type TextElement, type TextProps,
} from './text';
export { ColorPanel, NumberField, BUILDER_SWATCHES, common } from './controlParts';
