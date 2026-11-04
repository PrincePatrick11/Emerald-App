import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'primaryDanger' | 'secondary' | 'ghost' | 'danger';
export type ButtonTone = 'jade' | 'amber' | 'danger' | 'neutral';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  primaryDanger: 'btn-primary-danger',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

/* Soft tinted fill, matching border, brighter on hover. Colours are the
   `--tone-*` tokens of the theme files. */
const TONE_CLASSES: Record<ButtonTone, string> = {
  jade: 'btn-tone-jade',
  amber: 'btn-tone-amber',
  danger: 'btn-tone-danger',
  neutral: 'btn-tone-neutral',
};

const ACTIVE_TONE_CLASSES: Partial<Record<ButtonTone, string>> = {
  jade: 'btn-tone-active',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * Tinted-border look for tone-coded row actions (edit/save/delete/cancel) —
   * takes over from `variant` when set. 30px tall to match TabIconButton, so
   * these sit on the same baseline wherever they show up alongside it.
   */
  tone?: ButtonTone;
  /** Icon-only square — for secondary actions sharing the row with a primary one. */
  compact?: boolean;
  /** Tone mode only: 24px instead of 30px tall, for dense rows such as the
   *  category headers, whose text line a 30px button would bloat.
   *  Icons in it belong on the 12px size. */
  small?: boolean;
  /** Stretches to fill the row instead of sizing to its content — the primary
   *  action in a dedicated action bar (e.g. RightSidebar's Edit/Done). */
  fill?: boolean;
  active?: boolean;
}

export default function Button({
  variant = 'secondary',
  tone,
  compact,
  small,
  fill,
  active,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const toneClass = tone && ((active && ACTIVE_TONE_CLASSES[tone]) || TONE_CLASSES[tone]);
  const baseClass = toneClass
    ? `sidebar-action-btn flex ${small ? 'h-6' : 'h-[30px]'} items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ${
        compact ? `${small ? 'w-6' : 'w-[30px]'} flex-shrink-0` : `min-w-0 px-2 ${fill ? 'flex-1' : ''}`
      } ${toneClass}`
    : VARIANT_CLASS[variant];

  return (
    <button
      type={type}
      className={`${baseClass}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}
