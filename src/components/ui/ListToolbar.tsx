import { useTranslation } from 'react-i18next';
import {
  ArrowDown10, ArrowDownAZ, ArrowDownZA, CalendarArrowDown, CalendarArrowUp, CalendarRange,
  Grid3x3, Layers, LayoutGrid, List, Search, StretchHorizontal, X, type LucideIcon,
} from 'lucide-react';
import type { ViewMode, SortMode, GroupingMode } from '../../store/uiStore';
import type { DashboardGroupBy } from './Dashboard';
import IconToggleGroup from './IconToggleGroup';

/* Icon je Modus: Ansicht, Sortierung und Gruppierung stehen als wählbare
   Icon-Reihen, das Label des jeweiligen Modus wandert in title/aria-label.

   SORT_ICONS ist exportiert: die Altar-Bibliothek stellt im selben Kopf ihre
   eigene, kleinere Sortier-Reihe und soll je Modus dasselbe Glyph zeigen. */
const VIEW_ICONS: Record<ViewMode, LucideIcon> = {
  list: List,
  cards: LayoutGrid,
  cards_wide: StretchHorizontal,
  timeline: CalendarRange,
};
/** Reihenfolge der Sortier-Auswahl, wenn der Aufrufer keine `sortModes`
 *  vorgibt. `count_desc` fehlt bewusst: nur Tags haben etwas zu zählen. */
const DEFAULT_SORT_MODES: readonly SortMode[] = ['date_desc', 'date_asc', 'alpha_asc', 'alpha_desc'];

export const SORT_ICONS: Record<SortMode, LucideIcon> = {
  date_desc: CalendarArrowDown,
  date_asc: CalendarArrowUp,
  alpha_asc: ArrowDownAZ,
  alpha_desc: ArrowDownZA,
  count_desc: ArrowDown10,
};

/** Auch von der Altar-Bibliothek benutzt, die im selben Kopf ihre eigene
 *  Gruppierung stellt. `Grid3x3` statt `LayoutGrid` fürs flache Raster:
 *  LayoutGrid steht in der Reihe darüber schon für die Kartenansicht. */
export const GROUPING_ICONS: Record<GroupingMode, LucideIcon> = {
  grouped: Layers,
  flat: Grid3x3,
};

interface Props {
  /** Ansicht und Sortierung sind Achsen wie `groupBy`: fehlt der Handler,
   *  entfällt die Reihe. Die Kategorien-Ansicht hat weder das eine noch das
   *  andere — ihre Ordnung ist die von Hand gezogene — und bringt nur Suche. */
  view?: ViewMode;
  sort?: SortMode;
  onView?: (v: ViewMode) => void;
  onSort?: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  /** Welche Sortiermodi zur Wahl stehen, in dieser Reihenfolge. */
  sortModes?: readonly SortMode[];
  /** Die Gruppierungs-Achse; fehlt sie, zeigt die Leiste nur Ansicht und
   *  Sortierung. Siehe DashboardGroupBy. */
  groupBy?: DashboardGroupBy;
  search?: string;
  onSearch?: (v: string) => void;
}

/** Der Zeitstrahl gruppiert nach Monat über die *sortierte* Liste:
 *  Neueste/Älteste zuerst drehen ihn um und bleiben wählbar, die Alpha-Modi
 *  würden die Monatsreihenfolge verwürfeln und sind deshalb gesperrt. Die
 *  Gruppierungs-Achse sperrt der Zeitstrahl ganz: dort gruppieren die
 *  Monate. */
const sortBlockedInTimeline = (v: SortMode) => v !== 'date_desc' && v !== 'date_asc';

/**
 * Suche, Ansicht, Sortierung und Gruppierung als Spalte — für den Kopf in der
 * rechten Seitenleiste (Dashboard-Portal): Suche auf eigener voller Zeile,
 * darunter die Icon-Reihen mit Umbruch.
 */
export default function ListToolbar({
  view, sort, onView, onSort, viewOptions: viewOptionsProp, sortModes = DEFAULT_SORT_MODES, groupBy, search, onSearch,
}: Props) {
  const { t } = useTranslation();

  const viewOptions = viewOptionsProp ?? [
    { value: 'list' as const, label: t('listView.list') },
    { value: 'cards' as const, label: t('listView.cards') },
    { value: 'cards_wide' as const, label: t('listView.cardsWide') },
    { value: 'timeline' as const, label: t('listView.timeline') },
  ];

  const sortLabels: Record<SortMode, string> = {
    date_desc: t('listView.dateDesc'),
    date_asc: t('listView.dateAsc'),
    alpha_asc: t('listView.alphaAsc'),
    alpha_desc: t('listView.alphaDesc'),
    count_desc: t('listView.countDesc'),
  };
  const sortOptions = sortModes.map((value) => ({ value, label: sortLabels[value] }));

  const sortDisabled = view === 'timeline' ? sortBlockedInTimeline : undefined;
  const showView = view !== undefined && onView !== undefined && viewOptions.length > 1;
  const showSort = sort !== undefined && onSort !== undefined;

  // Im Zeitstrahl gruppieren die Monate; die Achse hat dort keine Wirkung und
  // wird komplett ausgegraut — dieselbe Behandlung wie die gesperrten
  // Sortiermodi, statt die Reihe verschwinden zu lassen.
  const groupingOptions: { value: GroupingMode; label: string }[] = [
    { value: 'grouped', label: groupBy?.label ?? t('listView.category') },
    { value: 'flat', label: t('listView.ungrouped') },
  ];
  const groupingDisabled = view === 'timeline' ? () => true : undefined;

  return (
    // Ohne eigenes Streifen-Chrome: die p-3-Spalte der Seitenleiste liefert
    // den Einzug (eine Einzugsquelle pro Spalte, design.md).
    <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
      {/* Suche zuerst (basis-full = eigene volle Zeile), auf dem Höhenmaß der
          Eintragslisten-Suche (text-sm + Icon 14 ≈ 34px) — die beiden
          Seitenleisten-Suchen sollen gleich schwer wirken. */}
      {onSearch !== undefined && (
        <div className="list-toolbar-search flex items-center gap-1.5 rounded-md px-2.5 py-1.5 basis-full">
          <Search size={14} className="list-toolbar-chip-label flex-shrink-0" />
          <input
            type="text"
            placeholder={t('search.placeholder')}
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            className="list-toolbar-input bg-transparent outline-none w-full selectable text-sm"
          />
          {search && (
            <button onClick={() => onSearch('')} className="list-toolbar-clear transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {showView && (
        <IconToggleGroup label={t('listView.view')} options={viewOptions} icons={VIEW_ICONS} value={view!} onChange={onView!} />
      )}
      {showSort && (
        <IconToggleGroup
          label={t('listView.sort')}
          options={sortOptions}
          icons={SORT_ICONS}
          value={sort!}
          onChange={onSort!}
          isDisabled={sortDisabled}
          disabledHint={t('listView.notAvailableInTimeline')}
        />
      )}
      {groupBy && (
        <IconToggleGroup
          label={t('listView.grouping')}
          options={groupingOptions}
          icons={GROUPING_ICONS}
          value={groupBy.value}
          onChange={groupBy.onChange}
          isDisabled={groupingDisabled}
          disabledHint={t('listView.notAvailableInTimeline')}
        />
      )}
    </div>
  );
}
