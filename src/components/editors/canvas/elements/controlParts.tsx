import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';

/** Colours for shapes and text: metals, parchment, and a few deep colours. */
export const CANVAS_SWATCHES = [
  '#d4af37', '#c0c0c0', '#b87333', '#f4ecd8', '#ffffff',
  '#8b1e2d', '#c65d1e', '#2e7d5b', '#1e3a6e', '#5b3a7a',
  '#0b0b0f', '#3a3a44',
] as const;

/** The one value all items share, or `undefined` when they differ. */
export function common<T, V>(items: readonly T[], read: (item: T) => V): V | undefined {
  if (!items.length) return undefined;
  const first = read(items[0]);
  return items.every((item) => read(item) === first) ? first : undefined;
}

/** Swatches, "none" where it is allowed, and the system's picker for any other colour. */
export function ColorPanel({ value, allowNone = false, onPick }: {
  value: string | null | undefined;
  allowNone?: boolean;
  onPick: (color: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="canvas-swatches">
      {allowNone && (
        <button type="button" className={`canvas-swatch canvas-swatch-none ${value === null ? 'canvas-swatch-active' : ''}`} title={t('canvas.noColor')} onClick={() => onPick(null)}>
          <Ban size={12} />
        </button>
      )}
      {CANVAS_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          className={`canvas-swatch ${value === color ? 'canvas-swatch-active' : ''}`}
          style={{ background: color }}
          title={color}
          onClick={() => onPick(color)}
        />
      ))}
      <label className="canvas-swatch canvas-swatch-custom" title={t('canvas.customColor')}>
        <input type="color" value={value ?? '#ffffff'} onChange={(e) => onPick(e.target.value)} />
      </label>
    </div>
  );
}

/**
 * A label, a slider and its value in a row, in the canvas editor's panels
 * (an opacity, a gradient's angle). `undefined` shows "–" with the slider at
 * `max`: the picked ones differ.
 */
export function RangeField({ label, value, min, max, onChange, format }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** The value as shown beside the slider; the number itself by default. */
  format?: (value: number) => ReactNode;
}) {
  return (
    <label className="canvas-range-field">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value ?? max} onChange={(e) => onChange(Number(e.target.value))} className="accent-accent" />
      <span className="paint-size-value">{value === undefined ? '–' : format ? format(value) : value}</span>
    </label>
  );
}

/** A number in a small field; nothing is applied while the field is empty. */
export function NumberField({ label, value, min, max, onChange, inline = false }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** In the bar itself, without its label beside it. */
  inline?: boolean;
}) {
  const input = (
    <input
      className="editor-inline-input canvas-size-input"
      type="number"
      min={min}
      max={max}
      value={value !== undefined ? Math.round(value) : ''}
      placeholder="–"
      title={inline ? label : undefined}
      aria-label={label}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(next) && next >= min) onChange(Math.min(max, next));
      }}
    />
  );
  if (inline) return input;
  return (
    <label className="canvas-number-row">
      <span>{label}</span>
      {input}
    </label>
  );
}
