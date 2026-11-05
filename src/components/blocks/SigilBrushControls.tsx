import { useTranslation } from 'react-i18next';
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../lib/blocks/fields';

/** The palette of the sigil drawing; a custom block's drawing may start with one of them. */
export const SIGIL_COLORS = ['#f8fafc', '#00e699', '#f59e0b', '#ef4444', '#60a5fa', '#a78bfa', '#111827'];

/** What drawing starts with when a custom block specifies nothing. */
export const DEFAULT_BRUSH_SIZE = 8;

/**
 * Colour and brush size at the start of a drawing part, set in the builder;
 * the drawing itself picks them in the paint bar of the canvas editor.
 */

export function SigilColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SIGIL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 transition-transform ${value === c ? 'scale-105 border-contrast' : 'border-edge-default hover:border-edge-raise'}`}
          style={{ backgroundColor: c }}
          aria-label={c}
          aria-pressed={value === c}
        />
      ))}
    </div>
  );
}

export function SigilBrushSize({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const { t } = useTranslation();
  return (
    <label className="sigil-brush-controls flex items-center gap-2 text-xs text-muted">
      <span>{t('creation.brushSize')}</span>
      <input
        type="range"
        min={BRUSH_SIZE_MIN}
        max={BRUSH_SIZE_MAX}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sigil-brush-slider accent-accent"
      />
      <span className="w-7 text-right text-subtle">{value}</span>
    </label>
  );
}
