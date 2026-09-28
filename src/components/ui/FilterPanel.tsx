import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import FilterList, { type FilterChip } from './FilterList';
import { SwitchRow } from './Switch';
import { SidebarGroup } from './SidebarColumn';

/** Ein Anzeige-Schalter: eine Vorliebe der Ansicht, kein Filter — zählt nicht
 *  in `activeFilterCount` und bleibt beim Zurücksetzen stehen. */
export interface DisplayToggle {
  label: string;
  icon?: LucideIcon;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export interface FilterPanelProps {
  chipLabel?: string;
  chips?: FilterChip[];
  selectedChips?: string[];
  onChipToggle?: (value: string) => void;
  /** Rendert vor den Werten eine „Alle"-Zeile: aktiv bei leerer Auswahl,
   *  Klick leert sie (= alles anzeigen). */
  onAllChips?: () => void;
  /** Anzahl neben „Alle" — die Liste nach der Suche, ohne diesen Filter. */
  allChipsCount?: number;
  /** Eigene „Anzeige"-Gruppe vor den Filtern (Tasks: „Erledigte anzeigen",
   *  Altar: „Altar-Vorschau"). */
  displayToggles?: DisplayToggle[];

  /** Zweite Filtergruppe mit eigener Überschrift — Tasks: Prioritäten. */
  statusChips?: FilterChip[];
  selectedStatus?: string[];
  onStatusToggle?: (value: string) => void;
  onAllStatus?: () => void;
  allStatusCount?: number;
  /** Überschrift der statusChips-Gruppe; Default t('filters.status'). */
  statusLabel?: string;

  /** Weitere Gruppen mit eigener Überschrift, für Regler, die weder Filter
   *  noch Anzeige-Schalter sind — der Altar hängt die Sortierung seiner
   *  Bibliothek hier ein, damit sie beim übrigen Dashboard-Kopf steht statt
   *  im Inhalt. Sie stehen zuerst, direkt unter der Sortierung. */
  extraGroups?: { label: string; content: ReactNode }[];
}

export default function FilterPanel({
  chipLabel,
  chips,
  selectedChips = [],
  onChipToggle,
  onAllChips,
  allChipsCount,
  displayToggles,
  statusChips,
  selectedStatus = [],
  onStatusToggle,
  onAllStatus,
  allStatusCount,
  statusLabel,
  extraGroups,
}: FilterPanelProps) {
  const { t } = useTranslation();

  return (
    // Gruppen untereinander, ohne eigenes px/bg: die Spalte der rechten
    // Seitenleiste (Dashboard-Portal) liefert den Einzug.
    <div className="flex flex-col gap-4">
      {extraGroups?.map((group) => (
        <SidebarGroup key={group.label} label={group.label}>
          {group.content}
        </SidebarGroup>
      ))}

      {displayToggles && displayToggles.length > 0 && (
        <SidebarGroup label={t('filters.display')}>
          {displayToggles.map((toggle) => (
            <SwitchRow key={toggle.label} {...toggle} />
          ))}
        </SidebarGroup>
      )}

      {/* Primäre Filter (Kategorie / Mondphase / Modul) */}
      {chips && chips.length > 0 && onChipToggle && (
        <FilterList
          label={chipLabel}
          chips={chips}
          selected={selectedChips}
          onToggle={onChipToggle}
          onAll={onAllChips}
          allCount={allChipsCount}
        />
      )}

      {statusChips && statusChips.length > 0 && onStatusToggle && (
        <FilterList
          label={statusLabel ?? t('filters.status')}
          chips={statusChips}
          selected={selectedStatus}
          onToggle={onStatusToggle}
          onAll={onAllStatus}
          allCount={allStatusCount}
        />
      )}
    </div>
  );
}
