/**
 * The canvas editor: composing elements on an artboard (Konva). Neutral: the
 * embedding place owns the scene and maps its stored format onto
 * `CanvasElement`; element types come from a registry the place can extend.
 * See Documentation/architecture/editors.md.
 */
export { default as CanvasEditor } from './CanvasEditor';
export type { CanvasEditorHandle, CanvasEditorProps } from './CanvasEditor';
export { FULL_CANVAS_FEATURES, type CanvasFeatures } from './features';
export {
  byZ,
  type CanvasAddition, type CanvasDrawEnv, type CanvasElement, type CanvasElementType, type CanvasGrid,
  type CanvasTypeControls, type CanvasTypes,
} from './types';
export * from './elements';
export { renderCanvasImage, canvasToDataUrl, type RenderOptions } from './exportImage';
