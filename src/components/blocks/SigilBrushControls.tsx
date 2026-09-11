import { useTranslation } from 'react-i18next';
import { BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../lib/blocks/fields';
import { SIGIL_COLORS } from './SigilDrawingCanvas';

/** Womit das Zeichnen beginnt, wenn ein eigener Block nichts festlegt. */
export const DEFAULT_BRUSH_SIZE = 8;

/**
 * Farbe und Pinselgröße der Sigillen-Zeichnung — geteilt von der Zeichenfläche
 * und von den Vorgaben eines Zeichnung-Teils im Baukasten.
 */

export function SigilColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SIGIL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 transition-transform ${value === c ? 'scale-105 border-stone-200' : 'border-stone-700 hover:border-stone-500'}`}
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
    <label className="sigil-brush-controls flex items-center gap-2 text-xs text-stone-400">
      <span>{t('creation.brushSize')}</span>
      <input
        type="range"
        min={BRUSH_SIZE_MIN}
        max={BRUSH_SIZE_MAX}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sigil-brush-slider accent-jade-400"
      />
      <span className="w-7 text-right text-stone-500">{value}</span>
    </label>
  );
}
