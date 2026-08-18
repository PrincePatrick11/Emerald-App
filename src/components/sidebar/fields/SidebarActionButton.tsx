export type SidebarActionTone = 'jade' | 'amber' | 'danger' | 'neutral';

/* Tone classes follow the Altar fullscreen-button look: soft tinted fill, matching
   border, brighter on hover. Parchment overrides for these utilities live in index.css. */
const TONE_CLASSES: Record<SidebarActionTone, string> = {
  jade: 'border-jade-700/60 bg-jade-900/30 text-jade-300 hover:bg-jade-900/50 hover:border-jade-500/70',
  amber: 'border-amber-700/60 bg-amber-900/30 text-amber-300 hover:bg-amber-900/50 hover:border-amber-500/70',
  danger: 'border-red-700/60 bg-red-950/30 text-red-200 hover:bg-red-950/50 hover:border-red-500',
  neutral: 'border-stone-700/60 bg-stone-900/45 text-stone-400 hover:bg-stone-800/60 hover:text-stone-200',
};

const ACTIVE_TONE_CLASSES: Partial<Record<SidebarActionTone, string>> = {
  jade: 'border-jade-600/60 bg-jade-900/40 text-jade-200 hover:bg-jade-900/60',
};

interface SidebarActionButtonProps {
  icon: React.ReactNode;
  /** Always the tooltip and accessible name; only rendered as text when not `compact`. */
  label: string;
  tone?: SidebarActionTone;
  /** Icon-only square — for secondary actions sharing the row with a primary one. */
  compact?: boolean;
  active?: boolean;
  onClick: () => void;
}

/* 30px tall to match TabIconButton (the entry-list tabs on the left), so both sidebars
   sit on the same baseline. The primary action stretches across the remaining width. */
export default function SidebarActionButton({
  icon,
  label,
  tone = 'neutral',
  compact,
  active,
  onClick,
}: SidebarActionButtonProps) {
  const toneClass = (active && ACTIVE_TONE_CLASSES[tone]) || TONE_CLASSES[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`sidebar-action-btn flex h-[30px] items-center justify-center gap-1.5 rounded-md border text-[11px] font-semibold transition-colors duration-150 ${
        compact ? 'w-[30px] flex-shrink-0' : 'min-w-0 flex-1 px-2'
      } ${toneClass}`}
    >
      {icon}
      {!compact && <span className="truncate">{label}</span>}
    </button>
  );
}
