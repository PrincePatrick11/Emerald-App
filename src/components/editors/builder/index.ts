/**
 * The builder: composing elements on an artboard (Konva). Neutral: the
 * embedding place owns the scene and maps its stored format onto
 * `BuilderElement`; element types come from a registry the place can extend.
 * See Documentation/architecture/editors.md.
 */
export { default as BuilderEditor } from './BuilderEditor';
export type { BuilderEditorHandle, BuilderEditorProps } from './BuilderEditor';
export { FULL_BUILDER_FEATURES, type BuilderFeatures } from './features';
export {
  byZ,
  type BuilderAddition, type BuilderDrawEnv, type BuilderElement, type BuilderElementType, type BuilderGrid,
  type BuilderTypeControls, type BuilderTypes,
} from './types';
export * from './elements';
export { renderBuilderImage, canvasToDataUrl, type RenderOptions } from './exportImage';
