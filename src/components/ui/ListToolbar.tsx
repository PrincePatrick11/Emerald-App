import { useTranslation } from 'react-i18next';
import {
  ArrowDownAZ, ArrowDownZA, CalendarArrowDown, CalendarArrowUp, CalendarRange,
  Grid3x3, Layers, LayoutGrid, List, Search, SlidersHorizontal, StretchHorizontal, X, type LucideIcon,
} from 'lucide-react';
import type { ViewMode, SortMode, GroupingMode } from '../../store/uiStore';
import type { DashboardGroupBy } from './Dashboard';
import Dropdown from './Dropdown';
import IconToggleGroup from './IconToggleGroup';

/* Icon je Modus für die vertikale (Seitenleisten-)Variante, in der die drei
   Dropdowns (Ansicht, Sortierung, Gruppierung) als wählbare Icon-Reihen
   stehen. Das Label des jeweiligen Dropdown-Eintrags wandert in
   title/aria-label.

   SORT_ICONS ist exportiert: die Altar-Bibliothek stellt im selben Kopf ihre
   eigene, kleinere Sortier-Reihe und soll je Modus dasselbe Glyph zeigen. */
const VIEW_ICONS: Record<ViewMode, LucideIcon> = {
  list: List,
  cards: LayoutGrid,
  cards_wide: StretchHorizontal,
  timeline: CalendarRange,
};
/** Reihenfolge der Sortier-Auswahl. */
const ALL_SORT_MODES: SortMode[] = ['date_desc', 'date_asc', 'alpha_asc', 'alpha_desc'];

export const SORT_ICONS: Record<SortMode, LucideIcon> = {
  date_desc: CalendarArrowDown,
  date_asc: CalendarArrowUp,
  alpha_asc: ArrowDownAZ,
  alpha_desc: ArrowDownZA,
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
  /** Die Gruppierungs-Achse; fehlt sie, zeigt die Leiste nur Ansicht und
   *  Sortierung. Siehe DashboardGroupBy. */
  groupBy?: DashboardGroupBy;
  search?: string;
  onSearch?: (v: string) => void;
  showFilters?: boolean;
  onToggleFilters?: () => void;
  activeFilterCount?: number;
  /** Schmale Spalten-Variante für die rechte Seitenleiste (Dashboard-Portal):
   *  enger Einzug, Umbruch erlaubt, Suche auf eigener voller Zeile. */
  vertical?: boolean;
}

/** Der Zeitstrahl gruppiert nach Monat über die *sortierte* Liste:
 *  Neueste/Älteste zuerst drehen ihn um und bleiben wählbar, die Alpha-Modi
 *  würden die Monatsreihenfolge verwürfeln — beide Darreichungsformen
 *  (Segmente und Dropdown) sperren deshalb dieselben Optionen. Die
 *  Gruppierungs-Achse sperrt der Zeitstrahl ganz: dort gruppieren die
 *  Monate. */
const sortBlockedInTimeline = (v: SortMode) => v !== 'date_desc' && v !== 'date_asc';

export default function ListToolbar({ view, sort, onView, onSort, viewOptions: viewOptionsProp, groupBy, search, onSearch, showFilters, onToggleFilters, activeFilterCount = 0, vertical }: Props) {
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
  };
  const sortOptions = ALL_SORT_MODES.map((value) => ({ value, label: sortLabels[value] }));

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

  const onSearchFn = onSearch;
  // Vertikal auf dem Höhenmaß der Eintragslisten-Suche (text-sm + Icon 14
  // ≈ 34px) — die beiden Seitenleisten-Suchen sollen gleich schwer wirken.
  // Horizontal bleibt die flache text-xs-Variante des Toolbar-Streifens.
  const searchField = onSearchFn !== undefined && (
    <div className={`list-toolbar-search flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ${
      vertical ? 'basis-full' : 'ml-2 flex-1'
    }`}>
      <Search size={vertical ? 14 : 12} className="list-toolbar-chip-label flex-shrink-0" />
      <input
        type="text"
        placeholder={t('search.placeholder')}
        value={search ?? ''}
        onChange={(e) => onSearchFn(e.target.value)}
        className={`list-toolbar-input bg-transparent outline-none w-full selectable ${vertical ? 'text-sm' : 'text-xs'}`}
      />
      {search && (
        <button onClick={() => onSearchFn('')} className="list-toolbar-clear transition-colors flex-shrink-0">
          <X size={vertical ? 14 : 12} />
        </button>
      )}
    </div>
  );

  return (
    // Vertikal sitzt die Toolbar in der p-3-Spalte der rechten Seitenleiste —
    // ohne eigenes Streifen-Chrome (eine Einzugsquelle pro Spalte, design.md)
    // und bewusst ohne `.list-toolbar`: deren Theme-Overrides würden den
    // Streifen-Hintergrund sonst wieder anmalen.
    <div className={vertical
      ? 'flex flex-wrap items-start gap-x-3 gap-y-3'
      : 'list-toolbar flex items-center gap-2 px-8 py-2 border-b border-stone-700/40 bg-stone-900/40'
    }>
      {vertical ? (
        <>
          {/* Suche zuerst (basis-full = eigene volle Zeile), die beiden
              Segment-Gruppen teilen sich die Zeile darunter. */}
          {searchField}
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
        </>
      ) : (
        <>
          {showView && (
            <Dropdown label={t('listView.view') + ': '} value={view!} options={viewOptions} onChange={onView!} />
          )}
          {showSort && (
            <Dropdown
              label={t('listView.sort') + ': '}
              value={sort!}
              options={sortOptions.map((o) => sortDisabled?.(o.value)
                ? { ...o, disabled: true, title: t('listView.notAvailableInTimeline') }
                : o)}
              onChange={onSort!}
            />
          )}
          {groupBy && (
            <Dropdown
              label={t('listView.grouping') + ': '}
              value={groupBy.value}
              options={groupingOptions.map((o) => groupingDisabled?.()
                ? { ...o, disabled: true, title: t('listView.notAvailableInTimeline') }
                : o)}
              onChange={groupBy.onChange}
            />
          )}
        </>
      )}
      {/* Vertikal (Seitenleiste) gibt es keinen Filter-Knopf — das FilterPanel
          steht dort dauerhaft unter der Toolbar. */}
      {!vertical && onToggleFilters !== undefined && (
        <button
          onClick={onToggleFilters}
          className={`list-toolbar-filter relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
            showFilters || activeFilterCount > 0
              ? 'list-toolbar-filter-active'
              : 'list-toolbar-filter-idle'
          }`}
          title={t('filters.toggle')}
        >
          <SlidersHorizontal size={12} />
          {t('filters.toggle')}
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-jade-500 text-stone-900 text-[9px] font-bold flex items-center justify-center leading-none">
              {activeFilterCount}
            </span>
          )}
        </button>
      )}
      {!vertical && searchField}
    </div>
  );
}
