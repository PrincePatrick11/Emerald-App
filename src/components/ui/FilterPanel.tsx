import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Button from './Button';

export interface FilterChip {
  value: string;
  label: string;
  emoji?: string;
  /** Lucide-Icon vor dem Label (12px-Stufe), z. B. Flag bei Tasks-Prioritäten. */
  icon?: ReactNode;
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
  /** Chips für eine eigene „Anzeige"-Gruppe vor den Kategorie-Chips
   *  (Tasks: „Erledigte anzeigen"). */
  displayExtras?: ReactNode;

  statusChips?: FilterChip[];
  selectedStatus?: string[];
  onStatusToggle?: (value: string) => void;
  /** Überschrift der statusChips-Gruppe; Default t('filters.status').
   *  Tasks nutzt die Gruppe für Prioritäten. */
  statusLabel?: string;

  /** Weitere Gruppen mit eigener Überschrift, für Regler, die weder Filter
   *  noch Chips sind — der Altar hängt die Sortierung seiner Bibliothek hier
   *  ein, damit sie beim übrigen Dashboard-Kopf steht statt im Inhalt. */
  extraGroups?: { label: string; content: ReactNode }[];

  activeFilterCount: number;
  /** Entfällt für Panels ohne echten Filter (Altar: nur ein Anzeige-Schalter),
   *  deren activeFilterCount nie über null geht — dann wird der Knopf, der
   *  ihn allein aufruft, ohnehin nicht gerendert. */
  onClearAll?: () => void;
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
      {chip.icon}
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
  displayExtras,
  statusChips,
  selectedStatus = [],
  onStatusToggle,
  statusLabel,
  extraGroups,
  activeFilterCount,
  onClearAll,
}: FilterPanelProps) {
  const { t } = useTranslation();

  return (
    // Gruppen untereinander, ohne eigenes px/bg: die Spalte der rechten
    // Seitenleiste (Dashboard-Portal) liefert den Einzug.
    <div className="flex flex-col gap-4">
      {/* Anzeige-Schalter — eigene Gruppe vor den Auswahl-Chips. */}
      {displayExtras && (
        <div className="flex flex-col gap-1.5">
          <span className="label-xs">{t('filters.display')}</span>
          <div className="flex flex-wrap gap-1.5">{displayExtras}</div>
        </div>
      )}

      {/* Primary chips (category / moon phase) */}
      {chips && chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {chipLabel && <span className="label-xs">{chipLabel}</span>}
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

      {/* Zweite Chip-Gruppe mit eigenem Label — Operations: Status,
          Tasks: Prioritäten (statusLabel). */}
      {statusChips && statusChips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="label-xs">{statusLabel ?? t('filters.status')}</span>
          <div className="flex flex-wrap gap-1.5">
            {statusChips.map((chip) => (
              <Chip key={chip.value} chip={chip} active={selectedStatus.includes(chip.value)} onToggle={onStatusToggle!} />
            ))}
          </div>
        </div>
      )}

      {extraGroups?.map((group) => (
        <div key={group.label} className="flex flex-col gap-1.5">
          <span className="label-xs">{group.label}</span>
          <div className="flex flex-wrap gap-1.5">{group.content}</div>
        </div>
      ))}

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
