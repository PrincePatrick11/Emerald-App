import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaintDoc } from '../../../lib/paint/document';
import PaintCanvas from './PaintCanvas';
import PaintToolbar, { PAINT_TOOL_DEFS, toolEnabled } from './PaintToolbar';
import { FULL_PAINT_FEATURES, type PaintFeatures } from './features';
import { canvasImageSrc } from '../../../lib/images';
import { renderPaintPng, type ImageLoader } from './render';
import { useLayerImages } from './useLayerImages';
import { usePaintEditor } from './usePaintEditor';

/**
 * One paint editor: its toolbar over the drawing surface. `initial` is read
 * once; remount via `key` to load another document. `onChange` hears every
 * change with the new document and a way to render it as a PNG data URL,
 * which only the caller decides to spend time on.
 *
 * Layer images are references the place understands; `loadImage` turns one
 * into a source the canvas can read back, by default a stored image of the
 * vault. If one cannot be loaded the editor shows `loadFailedText` (or a
 * general notice) instead of a drawing it could only save without it.
 *
 * Keys while the drawing has the focus (a stroke gives it): ⌘Z/Ctrl+Z undo,
 * with Shift (or ⌘Y/Ctrl+Y) redo, the tools' letters, `[` and `]` for the size.
 */
export default function PaintEditor({
  initial,
  onChange,
  features = FULL_PAINT_FEATURES,
  palette,
  startColor,
  startSize,
  loadImage = canvasImageSrc,
  loadFailedText,
}: {
  initial: PaintDoc;
  onChange: (doc: PaintDoc, toPng: () => string) => void;
  features?: PaintFeatures;
  palette: readonly string[];
  startColor: string;
  startSize: number;
  loadImage?: ImageLoader;
  loadFailedText?: string;
}) {
  const { t } = useTranslation();
  const imagesRef = useRef<ReturnType<typeof useLayerImages>['images']>(new Map());
  const handleChange = useCallback(
    (doc: PaintDoc) => onChange(doc, () => renderPaintPng(doc, imagesRef.current)),
    [onChange],
  );
  const api = usePaintEditor({ initial, startColor, startSize, onChange: handleChange });
  const { images, pending, failed } = useLayerImages(api.doc, loadImage);
  imagesRef.current = images;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') api[e.shiftKey ? 'redo' : 'undo']();
    else if (mod && key === 'y') api.redo();
    else if (!mod && !e.altKey && key === '[') api.setSize(api.size - (api.size > 10 ? 2 : 1));
    else if (!mod && !e.altKey && key === ']') api.setSize(api.size + (api.size >= 10 ? 2 : 1));
    else {
      const def = !mod && !e.altKey ? PAINT_TOOL_DEFS.find((d) => d.key === key && toolEnabled(d.tool, features)) : undefined;
      if (!def) return;
      api.setTool(def.tool);
    }
    e.preventDefault();
  };

  if (failed) return <p className="paint-error">{loadFailedText ?? t('editor.paint.loadFailed')}</p>;

  return (
    <div className="paint-editor" onKeyDown={onKeyDown}>
      <PaintToolbar api={api} features={features} palette={palette} />
      <PaintCanvas
        doc={api.doc}
        activeLayer={api.activeLayer}
        tool={api.tool}
        color={api.color}
        size={api.size}
        images={images}
        editable={!pending}
        onStroke={api.addStroke}
      />
    </div>
  );
}
