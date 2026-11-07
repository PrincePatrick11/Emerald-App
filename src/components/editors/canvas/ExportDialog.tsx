import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../ui/Modal';
import Button from '../../ui/Button';
import { SwitchRow } from '../../ui/Switch';
import type { Box } from './geometry';

export type CanvasExportFormat = 'png' | 'jpeg' | 'svg';

/** What the export dialog asks the place to save. */
export interface CanvasExportOptions {
  format: CanvasExportFormat;
  /** The picture's width in pixels; the height follows the area. */
  width: number;
  /** The part of the artboard, in artboard pixels: the selection's box, or `null` for all of it. */
  region: Box | null;
  /** The place's background behind the elements; without it PNG and SVG are transparent, JPEG white. */
  background: boolean;
}

/** The last choices, for the next export while the window is open. */
let remembered: { format: CanvasExportFormat; scale: number; background: boolean } = { format: 'png', scale: 1, background: true };

const SCALES = [0.5, 1, 2, 4];
const MAX_SIDE = 16384;

/**
 * Saving the artboard as a picture: PNG, JPEG or SVG (vectors where the
 * types can write themselves), all of it or only the selection, at a width
 * picked by a factor or typed in, with the background or without. The place
 * does the saving (`onExport`).
 */
export default function ExportDialog({ artboard, selection, hasBackground, onExport, onClose }: {
  artboard: { width: number; height: number };
  /** The box around the selection, or `null` with nothing selected. */
  selection: Box | null;
  /** The place draws a background behind the elements, which can be left out. */
  hasBackground: boolean;
  onExport: (options: CanvasExportOptions) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = useState(remembered.format);
  const [onlySelection, setOnlySelection] = useState(false);
  const [background, setBackground] = useState(remembered.background);
  const area = onlySelection && selection ? selection : { x: 0, y: 0, width: artboard.width, height: artboard.height };
  const [scale, setScale] = useState(remembered.scale);
  const maxScale = MAX_SIDE / Math.max(area.width, area.height, 1);
  const effective = Math.min(scale, maxScale);
  const width = Math.max(1, Math.round(area.width * effective));
  const height = Math.max(1, Math.round(area.height * effective));
  const jpeg = format === 'jpeg';

  const setWidth = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setScale(value / area.width);
  };
  const setHeight = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setScale(value / area.height);
  };

  const save = () => {
    remembered = { format, scale, background };
    onExport({ format, width, region: onlySelection && selection ? selection : null, background: hasBackground && (jpeg || background) });
    onClose();
  };

  const segments = <T extends string | number>(label: string, options: { value: T; label: string }[], value: T | null, onChange: (v: T) => void) => (
    <div className="canvas-export-row">
      <span className="canvas-export-label">{label}</span>
      <div role="group" aria-label={label} className="prop-segments">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            className={`prop-segment canvas-export-segment${value === o.value ? ' prop-segment--active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Modal
      title={t('canvas.exportDialog.title')}
      onClose={onClose}
      widthClassName="w-[420px] max-w-full"
      bodyClassName="modal-body space-y-3"
      footer={(<>
        <Button tone="neutral" onClick={onClose}>{t('common.cancel')}</Button>
        <Button tone="jade" onClick={save}>{t('canvas.exportDialog.save')}</Button>
      </>)}
    >
      {segments(t('canvas.exportDialog.format'), [
        { value: 'png', label: 'PNG' },
        { value: 'jpeg', label: 'JPEG' },
        { value: 'svg', label: 'SVG' },
      ], format, setFormat)}
      {format === 'svg' && <p className="canvas-export-hint">{t('canvas.exportDialog.svgHint')}</p>}
      {selection && segments(t('canvas.exportDialog.area'), [
        { value: 'all', label: t('canvas.exportDialog.all') },
        { value: 'selection', label: t('canvas.exportDialog.selection') },
      ], onlySelection ? 'selection' : 'all', (v) => setOnlySelection(v === 'selection'))}
      {segments(t('canvas.exportDialog.size'), SCALES.map((s) => ({ value: s, label: `${s}×` })), SCALES.includes(scale) ? scale : null, setScale)}
      <div className="canvas-export-row">
        <span className="canvas-export-label">{t(format === 'svg' ? 'canvas.exportDialog.displaySize' : 'canvas.exportDialog.pixels')}</span>
        <div className="canvas-export-size">
          <input type="number" min={1} max={MAX_SIDE} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label={t('canvas.exportDialog.width')} />
          <span>×</span>
          <input type="number" min={1} max={MAX_SIDE} value={height} onChange={(e) => setHeight(Number(e.target.value))} aria-label={t('canvas.exportDialog.height')} />
          <span>px</span>
        </div>
      </div>
      {hasBackground && <SwitchRow
        variant="panel"
        label={t('canvas.exportDialog.background')}
        hint={jpeg ? t('canvas.exportDialog.jpegBackground') : undefined}
        checked={jpeg || background}
        disabled={jpeg}
        onChange={setBackground}
      />}
    </Modal>
  );
}
