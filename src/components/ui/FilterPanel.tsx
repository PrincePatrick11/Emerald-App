import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';

export interface FilterChip {
  value: string;
  label: string;
  emoji?: string;
}

/**
 * The one filter-pill look — exported so the class chain is not copied around.
 * Used by the panel's own chips and by the Settings backup include-lists.
 */
export function FilterChipButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`filter-chip flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
        active
          ? 'filter-chip-active bg-jade-900/50 border-jade-800/40 text-jade-400'
          : 'filter-chip-idle bg-stone-800/60 border-stone-700/60 text-stone-500 hover:text-stone-300 hover:border-stone-600'
      }`}
    >
      {children}
    </button>
  );
}

export interface FilterPanelProps {
  chipLabel?: string;
  chips?: FilterChip[];
  selectedChips?: string[];
  onChipToggle?: (value: string) => void;
  /** Rendert vor den Chips einen „Alle"-Chip: aktiv bei leerer Auswahl,
   *  Klick leert sie (= alles anzeigen). */
  onAllChips?: () => void;

  statusChips?: FilterChip[];
  selectedStatus?: string[];
  onStatusToggle?: (value: string) => void;

  activeFilterCount: number;
  onClearAll: () => void;
}

function Chip({
  chip, active, onToggle,
}: {
  chip: FilterChip;
  active: boolean;
  onToggle: (v: string) => void;
}) {
  return (
    <FilterChipButton active={active} onClick={() => onToggle(chip.value)}>
      {chip.emoji && <span className="text-sm leading-none">{chip.emoji}</span>}
      {chip.label}
    </FilterChipButton>
  );
}

export default function FilterPanel({
  chipLabel,
  chips,
  selectedChips = [],
  onChipToggle,
  onAllChips,
  statusChips,
  selectedStatus = [],
  onStatusToggle,
  activeFilterCount,
  onClearAll,
}: FilterPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="filter-panel px-8 py-3 border-b border-stone-700/40 bg-stone-900/50 flex flex-wrap gap-x-6 gap-y-3 items-start">
      {/* Primary chips (category / moon phase) */}
      {chips && chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {chipLabel && (
            <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">{chipLabel}</span>
          )}
          <div className="flex flex-wrap gap-1.5">
            {onAllChips && (
              <FilterChipButton active={selectedChips.length === 0} onClick={onAllChips}>
                {t('filters.all')}
              </FilterChipButton>
            )}
            {chips.map((chip) => (
              <Chip key={chip.value} chip={chip} active={selectedChips.includes(chip.value)} onToggle={onChipToggle!} />
            ))}
          </div>
        </div>
      )}

      {/* Status chips (Operations) */}
      {statusChips && statusChips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">{t('filters.status')}</span>
          <div className="flex flex-wrap gap-1.5">
            {statusChips.map((chip) => (
              <Chip key={chip.value} chip={chip} active={selectedStatus.includes(chip.value)} onToggle={onStatusToggle!} />
            ))}
          </div>
        </div>
      )}

      {/* Clear all */}
      {activeFilterCount > 0 && (
        <Button
          onClick={onClearAll}
          variant="danger"
          className="text-xs self-end ml-auto"
        >
          {t('filters.clearAll')}
        </Button>
      )}
    </div>
  );
}
