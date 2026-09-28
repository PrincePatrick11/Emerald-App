import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Asterisk } from 'lucide-react';
import { SidebarGroup } from './SidebarColumn';

export interface FilterChip {
  value: string;
  label: string;
  emoji?: string;
  /** Lucide-Icon vor dem Label (14px-Stufe), z. B. Flag bei Tasks-Prioritäten. */
  icon?: ReactNode;
  /** Treffer dieses Werts in der Liste nach der Suche, ohne den eigenen
   *  Filter — so bleibt die Zahl stehen, während man an- und abwählt. */
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
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`filter-row flex items-center gap-2.5 w-full px-3 py-1.5 rounded-md text-sm text-left${active ? ' filter-row--active' : ''}`}
    >
      <span className="w-4 flex-shrink-0 flex items-center justify-center leading-none">{lead}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {count !== undefined && (
        <span className={`filter-row-count text-xs tabular-nums${count === 0 ? ' filter-row-count--zero' : ''}`}>{count}</span>
      )}
    </button>
  );
}

/**
 * Filterwerte als senkrechte Liste — Icon, Name, Anzahl — mit „Alle" oben.
 * Mehrfachauswahl: ein Klick schaltet einen Wert zu oder ab, „Alle" ist
 * aktiv, solange nichts gewählt ist, und leert die Auswahl.
 */
export default function FilterList({ label, chips, selected, onToggle, onAll, allCount }: {
  label?: string;
  chips: FilterChip[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Blendet die „Alle"-Zeile ein. */
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
