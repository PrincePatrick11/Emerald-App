/**
 * A narrow progress bar with a label to its right.
 *
 * `percent` `null`: unknown; the bar stays empty instead of lying, and the
 * label shows that it is running.
 */
export default function ProgressBar({ percent, label, ariaLabel }: {
  percent: number | null;
  label?: React.ReactNode;
  /** Name of the bar for screen readers; the visible label is often next to it. */
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 h-1 rounded-full overflow-hidden"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' }}
      >
        <div
          className="h-full transition-[width] duration-200"
          style={{ width: `${percent ?? 0}%`, backgroundColor: 'var(--accent)' }}
        />
      </div>
      {label != null && <span className="text-xs text-muted tabular-nums shrink-0">{label}</span>}
    </div>
  );
}
