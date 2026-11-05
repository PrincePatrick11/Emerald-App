/**
 * The paint editor, for embedding anywhere: a toolbar over a canvas, drawing
 * vector strokes in layers (`lib/paint/document.ts`). See
 * Documentation/architecture/editors.md.
 */
export { default as PaintEditor } from './PaintEditor';
export { FULL_PAINT_FEATURES, type PaintFeatures } from './features';
export { drawPaintDoc, layerImageRefs, loadLayerImages, renderPaintPng, type ImageLoader, type LayerImages } from './render';
export * from '../../../lib/paint/document';
