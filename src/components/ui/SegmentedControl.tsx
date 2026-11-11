import type { ReactNode } from 'react';

export interface SegmentOption<T extends string | number> {
  value: T;
  /** The segment's text, or with an `icon` its tooltip and accessible name. */
  label: string;
  icon?: ReactNode;
}

/**
 * A choice of a few options as segments on an inset track, the active one in
 * jade (`.prop-segments`): the entry type, the canvas editor's export dialog
 * and background panel. An option with an icon shows only the icon; one
 * without shows its label and takes the width it needs (`--label`).
 */
export default function SegmentedControl<T extends string | number>({ options, value, onChange, ariaLabel, disabled = false, className }: {
  options: readonly SegmentOption<T>[];
  /** `null` when none of the options holds (a value typed in elsewhere). */
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
  /** Appended to the track: its place in the caller's layout. */
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={`prop-segments${className ? ` ${className}` : ''}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            aria-label={o.icon ? o.label : undefined}
            title={o.icon ? o.label : undefined}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`prop-segment${o.icon ? '' : ' prop-segment--label'}${active ? ' prop-segment--active' : ''}`}
          >
            {o.icon ?? o.label}
          </button>
        );
      })}
    </div>
  );
}
