interface PropertySummaryRowProps {
  label: string;
  value: React.ReactNode;
  badge?: { label: string; tone: 'jade' | 'muted' };
}

export function PropertySummaryRow({ label, value, badge }: PropertySummaryRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-stone-900/45 border border-stone-700/60">
      <span className="text-[11px] uppercase tracking-wider text-stone-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {badge && (
          <span
            className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${
              badge.tone === 'jade'
                ? 'border-jade-600/50 bg-jade-900/40 text-jade-300'
                : 'border-stone-700/60 bg-stone-800/60 text-stone-400'
            }`}
          >
            {badge.label}
          </span>
        )}
        <span className="text-[11px] font-medium text-stone-300 text-right tabular-nums">{value}</span>
      </div>
    </div>
  );
}

export function PropertySummarySectionTitle({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1 pt-3 pb-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{label}</span>
    </div>
  );
}
