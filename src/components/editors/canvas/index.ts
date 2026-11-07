/**
 * The canvas editor: composing elements on an artboard (Konva), and painting
 * inside drawing elements. Neutral: the embedding place owns the scene and
 * maps its stored format onto `CanvasElement`; element types come from a
 * registry, a profile says what a place offers.
 * See Documentation/architecture/editors.md.
 */
export { default as CanvasEditor } from './CanvasEditor';
export type { CanvasEditorHandle, CanvasEditorProps, CanvasPaintOptions } from './CanvasEditor';
export type { CanvasExportFormat, CanvasExportOptions } from './ExportDialog';
export { FULL_CANVAS_FEATURES, type CanvasFeatures } from './features';
export type { RulerGuide } from './Rulers';
export {
  byZ,
  type CanvasAddition, type CanvasDrawEnv, type CanvasElement, type CanvasElementType, type CanvasGrid,
  type CanvasTypeControls, type CanvasTypes,
} from './types';
export * from './elements';
export { renderCanvasImage, renderCanvasSvg, canvasToDataUrl, type RenderOptions } from './exportImage';
export { createDrawingType, type DrawingElement, type DrawingProps, type DrawingTypeOptions } from './paint/drawing';
export { FULL_PAINT_FEATURES, type PaintFeatures } from './paint/features';
export { drawPaintDoc, layerImageRefs, loadLayerImages, polygonPoints, renderPaintPng, type ImageLoader, type LayerImages } from './paint/render';
export { fullProfile, paintOnlyProfile, type CanvasProfile } from './profiles';
export * from '../../../lib/paint/document';
