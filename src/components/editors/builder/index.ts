/**
 * The builder: composing elements on an artboard (Konva). The embedding place
 * owns the elements and maps its stored format onto `BuilderElement`.
 * See Documentation/architecture/editors.md.
 */
export { default as BuilderEditor, DEFAULT_FILL, DEFAULT_TEXT_COLOR } from './BuilderEditor';
export type { BuilderEditorHandle, BuilderEditorProps } from './BuilderEditor';
export { FULL_BUILDER_FEATURES, type BuilderFeatures } from './features';
export {
  BUILDER_FONTS, BUILDER_SHAPES, byZ,
  type BuilderElement, type BuilderFont, type BuilderGrid, type BuilderImageElement, type BuilderShapeElement,
  type BuilderShapeType, type BuilderTextAlign, type BuilderTextElement,
} from './types';
export { renderBuilderImage, canvasToDataUrl } from './exportImage';
export { textHeight } from './draw';
