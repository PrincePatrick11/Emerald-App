import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonTone = 'jade' | 'amber' | 'danger' | 'neutral';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

/* Tone classes follow the Altar fullscreen-button look: soft tinted fill, matching
   border, brighter on hover. Parchment overrides for these utilities live in index.css. */
const TONE_CLASSES: Record<ButtonTone, string> = {
  jade: 'border-jade-700/60 bg-jade-900/30 text-jade-300 hover:bg-jade-900/50 hover:border-jade-500/70',
  amber: 'border-amber-700/60 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 hover:border-amber-500/70',
  danger: 'border-red-700/60 bg-red-950/30 text-red-200 hover:bg-red-950/50 hover:border-red-500',
  // border-stone-600/70 statt -700/60: neben einem Jade-Button wirkte der
  // neutrale Rahmen sonst fast unsichtbar (beide Themes haben Brücken dafür).
  neutral: 'border-stone-600/70 bg-stone-900/45 text-stone-400 hover:bg-stone-800/60 hover:text-stone-200',
};

const ACTIVE_TONE_CLASSES: Partial<Record<ButtonTone, string>> = {
  jade: 'border-jade-600/60 bg-jade-900/40 text-jade-200 hover:bg-jade-900/60',
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
  /** Nur im tone-Modus: 24px statt 30px hoch — für dichte Zeilen wie die
   *  Kategorien-Köpfe, deren Textzeile ein 30px-Button aufblähen würde.
   *  Icons darin gehören auf die 12px-Stufe. */
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
    ? `sidebar-action-btn flex ${small ? 'h-6' : 'h-[30px]'} items-center justify-center gap-1.5 rounded-md border text-[11px] font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ${
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
