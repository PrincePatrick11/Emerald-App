import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Asterisk } from 'lucide-react';
import { SidebarGroup } from './SidebarColumn';

export interface FilterChip {
  value: string;
  label: string;
  emoji?: string;
  /** Lucide icon before the label (14px size), e.g. flag for task priorities. */
  icon?: ReactNode;
  /** Hits of this value in the list after the search, without its own
   *  filter, so the number stays put while you toggle it on and off. */
  count?: number;
}

function FilterRow({ active, onClick, lead, label, count }: {
  active: boolean;
  onClick: () => void;
  lead: ReactNode;
  label: string;
  count?: number;
}) {
  return (
    // 30px tall (leading-5 + 2×5px) like the primary button at the top of the sidebar
    // and the sort select: all controls in the sidebar equally tall.
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`filter-row flex items-center gap-2.5 w-full px-3 py-[5px] rounded-md text-[13px] leading-5 text-left${active ? ' filter-row--active' : ''}`}
    >
      <span className="w-4 flex-shrink-0 flex items-center justify-center leading-none">{lead}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {count !== undefined && (
        <span className={`filter-row-count text-[11px] tabular-nums${count === 0 ? ' filter-row-count--zero' : ''}`}>{count}</span>
      )}
    </button>
  );
}

/**
 * Filter values as a vertical list (icon, name, count) with "All" on top.
 * Multi-select: a click toggles a value on or off, "All" is
 * active as long as nothing is selected, and clears the selection.
 */
export default function FilterList({ label, chips, selected, onToggle, onAll, allCount }: {
  label?: string;
  chips: FilterChip[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Shows the "All" row. */
  onAll?: () => void;
  allCount?: number;
}) {
  const { t } = useTranslation();
  return (
    <SidebarGroup label={label}>
      <div className="flex flex-col gap-px">
        {onAll && (
          <FilterRow
            active={selected.length === 0}
            onClick={onAll}
            lead={<Asterisk size={14} />}
            label={t('filters.all')}
            count={allCount}
          />
        )}
        {chips.map((chip) => (
          <FilterRow
            key={chip.value}
            active={selected.includes(chip.value)}
            onClick={() => onToggle(chip.value)}
            lead={chip.icon ?? (chip.emoji && <span className="text-sm">{chip.emoji}</span>)}
            label={chip.label}
            count={chip.count}
          />
        ))}
      </div>
    </SidebarGroup>
  );
}
