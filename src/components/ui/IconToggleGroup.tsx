import type { LucideIcon } from 'lucide-react';
import TabIconButton from './TabIconButton';

/**
 * A row of icon buttons as a segmented choice: a shared frame, the
 * active option fills its segment. No visible heading; the icons
 * explain themselves via their tooltips, and the label remains the group's aria-label.
 * Shared by the ListToolbar (view, full width with `fill`) and small
 * choices where a menu would be too much.
 */
export default function IconToggleGroup<T extends string>({ label, options, icons, value, onChange, isDisabled, disabledHint, fill }: {
  label: string;
  options: { value: T; label: string }[];
  icons: Record<T, LucideIcon>;
  /** `null`: no option active — a mixed state. */
  value: T | null;
  onChange: (v: T) => void;
  /** Options that have no effect in the current combination (the
   *  timeline tolerates no alphabetical sorting and groups itself),
   *  greyed out instead of hidden so the row does not jump. */
  isDisabled?: (v: T) => boolean;
  /** Tooltip addition for disabled options ("No effect in the timeline"). */
  disabledHint?: string;
  /** Full width, segments equally wide: the view bar of the
   *  dashboard sidebar. */
  fill?: boolean;
}) {
  return (
    // gap-px keeps the row as narrow as possible without `fill`.
    <div role="group" aria-label={label} className={`${fill ? 'flex w-full' : 'inline-flex'} gap-px p-0.5 rounded-md border border-edge bg-well-strong`}>
      {options.map((option) => {
        const Icon: LucideIcon = icons[option.value];
        const disabled = isDisabled?.(option.value) ?? false;
        const title = disabled && disabledHint ? `${option.label} — ${disabledHint}` : option.label;
        return (
          <TabIconButton
            key={option.value}
            compact
            active={value === option.value}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            title={title}
            aria-label={title}
            // With `fill`, py-1 instead of p-1.5: the bar becomes 30px tall like the
            // primary button and the select below it.
            className={fill ? 'flex-1 flex justify-center py-1' : undefined}
          >
            <Icon size={14} />
          </TabIconButton>
        );
      })}
    </div>
  );
}
