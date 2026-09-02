import { useTranslation } from 'react-i18next';
import {
  ArrowDownAZ, ArrowDownZA, CalendarArrowDown, CalendarArrowUp, CalendarRange,
  Layers, LayoutGrid, List, Search, SlidersHorizontal, X, type LucideIcon,
} from 'lucide-react';
import type { ViewMode, SortMode } from '../../store/uiStore';
import Dropdown from './Dropdown';
import TabIconButton from './TabIconButton';

/* Icon je Modus für die vertikale (Seitenleisten-)Variante, in der die beiden
   Dropdowns als wählbare Icon-Reihen stehen. Das Label des jeweiligen
   Dropdown-Eintrags wandert in title/aria-label. */
const VIEW_ICONS: Record<ViewMode, LucideIcon> = {
  list: List,
  cards: LayoutGrid,
  timeline: CalendarRange,
};
const SORT_ICONS: Record<SortMode, LucideIcon> = {
  date_desc: CalendarArrowDown,
  date_asc: CalendarArrowUp,
  alpha_asc: ArrowDownAZ,
  alpha_desc: ArrowDownZA,
  category: Layers,
};

function IconToggleGroup<T extends string>({ label, options, icons, value, onChange, isDisabled, disabledHint }: {
  label: string;
  options: { value: T; label: string }[];
  icons: Record<T, LucideIcon>;
  value: T;
  onChange: (v: T) => void;
  /** Optionen, die in der aktuellen Kombination nichts bewirken (Zeitstrahl
   *  ignoriert Alpha-/Kategorie-Sortierung) — ausgegraut statt versteckt,
   *  damit die Reihe nicht springt. */
  isDisabled?: (v: T) => boolean;
  /** Tooltip-Zusatz für deaktivierte Optionen („Im Zeitstrahl ohne Wirkung"). */
  disabledHint?: string;
}) {
  return (
    // Segment-Optik: ein gemeinsamer Rahmen um die Reihe, die aktive Auswahl
    // füllt ihr Segment (TabIconButton). Ohne sichtbare Überschrift — die
    // Icons erklären sich über ihre Tooltips, das Label bleibt als aria-label
    // der Gruppe. gap-px, damit Ansicht (3) + Sortierung (5) bei
    // Standard-Leistenbreite zusammen in eine Zeile passen.
    <div role="group" aria-label={label} className="inline-flex gap-px p-0.5 rounded-md border border-stone-700/60 bg-stone-800/60">
      {options.map((option) => {
        const Icon: LucideIcon = icons[option.value];
        const disabled = isDisabled?.(option.value) ?? false;
        const title = disabled && disabledHint ? `${option.label} — ${disabledHint}` : option.label;
        return (
          <TabIconButton
            key={option.value}
            compact
            active={value === option.value}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            title={title}
            aria-label={title}
          >
            <Icon size={14} />
          </TabIconButton>
        );
      })}
    </div>
  );
}

interface Props {
  view: ViewMode;
  sort: SortMode;
  onView: (v: ViewMode) => void;
  onSort: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
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
 *  Neueste/Älteste zuerst drehen ihn um und bleiben wählbar, Alpha-/Kategorie-
 *  Sortierung würde die Monatsreihenfolge verwürfeln bzw. wird von der
 *  Gruppierung ignoriert — beide Darreichungsformen (Segmente und Dropdown)
 *  sperren deshalb dieselben Optionen. */
const sortBlockedInTimeline = (v: SortMode) => v !== 'date_desc' && v !== 'date_asc';

export default function ListToolbar({ view, sort, onView, onSort, viewOptions: viewOptionsProp, search, onSearch, showFilters, onToggleFilters, activeFilterCount = 0, vertical }: Props) {
  const { t } = useTranslation();

  const viewOptions = viewOptionsProp ?? [
    { value: 'list' as const, label: t('listView.list') },
    { value: 'cards' as const, label: t('listView.cards') },
    { value: 'timeline' as const, label: t('listView.timeline') },
  ];

  const sortOptions: { value: SortMode; label: string }[] = [
    { value: 'date_desc', label: t('listView.dateDesc') },
    { value: 'date_asc',  label: t('listView.dateAsc') },
    { value: 'alpha_asc', label: t('listView.alphaAsc') },
    { value: 'alpha_desc',label: t('listView.alphaDesc') },
    { value: 'category',  label: t('listView.category') },
  ];

  const sortDisabled = view === 'timeline' ? sortBlockedInTimeline : undefined;

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
          {viewOptions.length > 1 && (
            <IconToggleGroup label={t('listView.view')} options={viewOptions} icons={VIEW_ICONS} value={view} onChange={onView} />
          )}
          <IconToggleGroup
            label={t('listView.sort')}
            options={sortOptions}
            icons={SORT_ICONS}
            value={sort}
            onChange={onSort}
            isDisabled={sortDisabled}
            disabledHint={t('listView.notAvailableInTimeline')}
          />
        </>
      ) : (
        <>
          {viewOptions.length > 1 && (
            <Dropdown label={t('listView.view') + ': '} value={view} options={viewOptions} onChange={onView} />
          )}
          <Dropdown
            label={t('listView.sort') + ': '}
            value={sort}
            options={sortOptions.map((o) => sortDisabled?.(o.value)
              ? { ...o, disabled: true, title: t('listView.notAvailableInTimeline') }
              : o)}
            onChange={onSort}
          />
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
