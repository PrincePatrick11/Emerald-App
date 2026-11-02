import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import FilterList, { type FilterChip } from './FilterList';
import { SidebarGroup } from './SidebarColumn';

export interface FilterPanelProps {
  chipLabel?: string;
  chips?: FilterChip[];
  selectedChips?: string[];
  onChipToggle?: (value: string) => void;
  /** Renders an "All" row before the values: active when the selection is empty,
   *  a click clears it (= show everything). */
  onAllChips?: () => void;
  /** Count next to "All": the list after the search, without this filter. */
  allChipsCount?: number;

  /** Second filter group with its own heading; tasks: priorities. */
  statusChips?: FilterChip[];
  selectedStatus?: string[];
  onStatusToggle?: (value: string) => void;
  onAllStatus?: () => void;
  allStatusCount?: number;
  /** Heading of the statusChips group; default t('filters.status'). */
  statusLabel?: string;

  /** Further groups with their own heading, for controls that are not filters:
   *  the altar hangs the sorting of its
   *  library here so that it sits with the rest of the dashboard header instead of
   *  in the content. They come first, directly below the sorting. */
  extraGroups?: { label: string; content: ReactNode }[];
}

export default function FilterPanel({
  chipLabel,
  chips,
  selectedChips = [],
  onChipToggle,
  onAllChips,
  allChipsCount,
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
    // Groups stacked, without their own px/bg: the right sidebar's
    // column (dashboard portal) provides the indentation.
    <div className="flex flex-col gap-4">
      {extraGroups?.map((group) => (
        <SidebarGroup key={group.label} label={group.label}>
          {group.content}
        </SidebarGroup>
      ))}

      {/* Primary filters (category / moon phase / module) */}
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
