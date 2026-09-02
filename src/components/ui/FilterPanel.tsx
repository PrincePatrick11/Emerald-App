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
  /** Rendert hinter den Kategorie-Chips einen „Nur mit Einträgen"-Chip.
   *  Die Auswertung (leere Gruppen weglassen) übernimmt Dashboard im
   *  Kategorie-Modus zentral; der Aufrufer führt nur Zustand,
   *  activeFilterCount und onClearAll. */
  nonEmptyOnly?: boolean;
  onNonEmptyToggle?: () => void;
  /** Chips für eine eigene „Anzeige"-Gruppe vor den Kategorie-Chips
   *  (Tasks: „Erledigte anzeigen"). */
  displayExtras?: ReactNode;

  statusChips?: FilterChip[];
  selectedStatus?: string[];
  onStatusToggle?: (value: string) => void;
  /** Überschrift der statusChips-Gruppe; Default t('filters.status').
   *  Tasks nutzt die Gruppe für Prioritäten. */
  statusLabel?: string;

  activeFilterCount: number;
  onClearAll: () => void;
  /** Schmale Spalten-Variante für die rechte Seitenleiste (Dashboard-Portal):
   *  Gruppen untereinander statt nebeneinander, enger Einzug. */
  vertical?: boolean;
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
  nonEmptyOnly,
  onNonEmptyToggle,
  displayExtras,
  statusChips,
  selectedStatus = [],
  onStatusToggle,
  statusLabel,
  activeFilterCount,
  onClearAll,
  vertical,
}: FilterPanelProps) {
  const { t } = useTranslation();

  // Vertikal: Gruppenlabels in der Seitenleisten-Sprache (label-xs wie die
  // Properties-Panels) statt der Streifen-Optik des Hauptbereichs.
  const labelClass = vertical ? 'label-xs' : 'text-xs font-semibold text-stone-600 uppercase tracking-wider';

  return (
    // Vertikal ohne `.filter-panel` und ohne eigenes px/bg: die Spalte der
    // Seitenleiste liefert den Einzug, und die Theme-Overrides der Klasse
    // würden den Streifen-Hintergrund sonst wieder anmalen.
    <div className={vertical
      ? 'flex flex-col gap-4'
      : 'filter-panel px-8 py-3 border-b border-stone-700/40 bg-stone-900/50 flex flex-wrap gap-x-6 gap-y-3 items-start'
    }>
      {/* Anzeige-Schalter — eigene Gruppe vor den Auswahl-Chips. */}
      {displayExtras && (
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>{t('filters.display')}</span>
          <div className="flex flex-wrap gap-1.5">{displayExtras}</div>
        </div>
      )}

      {/* Primary chips (category / moon phase) */}
      {chips && chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {chipLabel && <span className={labelClass}>{chipLabel}</span>}
          <div className="flex flex-wrap gap-1.5">
            {onNonEmptyToggle && (
              <>
                {/* Vor den Kategorien, mit Trennstrich dahinter: der Schalter
                    ist eine Option, keine Kategorie. */}
                <FilterChipButton active={!!nonEmptyOnly} onClick={onNonEmptyToggle}>
                  {t('filters.nonEmptyOnly')}
                </FilterChipButton>
                <span className="w-px self-stretch bg-stone-700/60 mx-1" aria-hidden="true" />
              </>
            )}
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
          <span className={labelClass}>{statusLabel ?? t('filters.status')}</span>
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
