import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface FilterChip {
  value: string;
  label: string;
  emoji?: string;
}

interface FilterPanelProps {
  chipLabel?: string;
  chips?: FilterChip[];
  selectedChips?: string[];
  onChipToggle?: (value: string) => void;

  statusChips?: FilterChip[];
  selectedStatus?: string[];
  onStatusToggle?: (value: string) => void;

  propNames: string[];
  propFilters: { name: string; value: string }[];
  onAddPropFilter: () => void;
  onUpdatePropFilter: (i: number, pf: { name: string; value: string }) => void;
  onRemovePropFilter: (i: number) => void;

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
    <button
      onClick={() => onToggle(chip.value)}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
        active
          ? 'bg-jade-900/50 border-jade-800/40 text-jade-400'
          : 'bg-stone-800/60 border-stone-700/60 text-stone-500 hover:text-stone-300 hover:border-stone-600'
      }`}
    >
      {chip.emoji && <span className="text-sm leading-none">{chip.emoji}</span>}
      {chip.label}
    </button>
  );
}

export default function FilterPanel({
  chipLabel,
  chips,
  selectedChips = [],
  onChipToggle,
  statusChips,
  selectedStatus = [],
  onStatusToggle,
  propNames,
  propFilters,
  onAddPropFilter,
  onUpdatePropFilter,
  onRemovePropFilter,
  activeFilterCount,
  onClearAll,
}: FilterPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="px-8 py-3 border-b border-stone-700/40 bg-stone-900/50 flex flex-wrap gap-x-6 gap-y-3 items-start">
      {/* Primary chips (category / moon phase) */}
      {chips && chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {chipLabel && (
            <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">{chipLabel}</span>
          )}
          <div className="flex flex-wrap gap-1.5">
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

      {/* Custom property filters */}
      {propNames.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-stone-600 uppercase tracking-wider">{t('filters.properties')}</span>
          <div className="flex flex-col gap-1.5">
            {propFilters.map((pf, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={pf.name}
                  onChange={(e) => onUpdatePropFilter(i, { name: e.target.value, value: '' })}
                  className="bg-stone-800/60 border border-stone-700/60 rounded-md px-2 py-1 text-xs text-stone-300 outline-none appearance-none cursor-pointer"
                >
                  <option value="">{t('filters.selectProperty')}</option>
                  {propNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {pf.name && (
                  <input
                    type="text"
                    value={pf.value}
                    onChange={(e) => onUpdatePropFilter(i, { ...pf, value: e.target.value })}
                    placeholder={t('filters.valuePlaceholder')}
                    className="bg-stone-800/60 border border-stone-700/60 rounded-md px-2 py-1 text-xs text-stone-300 placeholder-stone-600 outline-none selectable w-32"
                  />
                )}
                <button onClick={() => onRemovePropFilter(i)} className="text-stone-600 hover:text-stone-400 transition-colors">
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={onAddPropFilter}
              className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-400 transition-colors w-fit"
            >
              <Plus size={11} />
              {t('filters.addFilter')}
            </button>
          </div>
        </div>
      )}

      {/* Clear all */}
      {activeFilterCount > 0 && (
        <button
          onClick={onClearAll}
          className="text-xs text-stone-600 hover:text-red-400 transition-colors self-end ml-auto"
        >
          {t('filters.clearAll')}
        </button>
      )}
    </div>
  );
}
