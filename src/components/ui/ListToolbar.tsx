import { useTranslation } from 'react-i18next';
import {
  ArrowDown10, ArrowDownAZ, ArrowDownZA, CalendarArrowDown, CalendarArrowUp, CalendarRange,
  Layers, LayoutGrid, List, Search, StretchHorizontal, X, type LucideIcon,
} from 'lucide-react';
import type { ViewMode, SortMode } from '../../store/uiStore';
import type { DashboardGroupBy } from './Dashboard';
import IconToggleGroup from './IconToggleGroup';
import FieldDropdown from './FieldDropdown';
import { SwitchRow } from './Switch';
import { SidebarGroup } from './SidebarColumn';

/* Icon je Modus: die Ansicht steht als Icon-Leiste (Label in
   title/aria-label), die Sortierung als Auswahl mit Icon und Text. */
const VIEW_ICONS: Record<ViewMode, LucideIcon> = {
  list: List,
  cards: LayoutGrid,
  cards_wide: StretchHorizontal,
  timeline: CalendarRange,
};
/** Reihenfolge der Sortier-Auswahl, wenn der Aufrufer keine `sortModes`
 *  vorgibt. `count_desc` fehlt bewusst: nur Tags haben etwas zu zählen. */
const DEFAULT_SORT_MODES: readonly SortMode[] = ['date_desc', 'date_asc', 'alpha_asc', 'alpha_desc'];

const SORT_ICONS: Record<SortMode, LucideIcon> = {
  date_desc: CalendarArrowDown,
  date_asc: CalendarArrowUp,
  alpha_asc: ArrowDownAZ,
  alpha_desc: ArrowDownZA,
  count_desc: ArrowDown10,
};

/** Welches Datum die Datums-Sortierung einer Liste vergleicht — steht vorn
 *  in ihrem Label („Erstellt · neueste"). */
export type SortDateField = 'created' | 'updated' | 'deleted';

const SORT_DATE_KEYS: Record<SortDateField, string> = {
  created: 'listView.dateCreated',
  updated: 'listView.dateUpdated',
  deleted: 'listView.dateDeleted',
};

interface Props {
  /** Ansicht und Sortierung sind Achsen wie `groupBy`: fehlt der Handler,
   *  entfällt der Abschnitt. Die Kategorien-Ansicht hat weder das eine noch
   *  das andere — ihre Ordnung ist die von Hand gezogene. */
  view?: ViewMode;
  sort?: SortMode;
  onView?: (v: ViewMode) => void;
  onSort?: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  /** Welche Sortiermodi zur Wahl stehen, in dieser Reihenfolge. */
  sortModes?: readonly SortMode[];
  /** Welches Datum die Datums-Sortierung vergleicht; Default `created`. */
  sortDate?: SortDateField;
  /** Überschrift der Sortierung, wenn die Leiste mehr als eine hat
   *  (Altar: „Sortierung · Altäre" über „Sortierung · Bibliothek"). */
  sortLabel?: string;
  /** Die Gruppierungs-Achse; fehlt sie, entfällt der Schalter unter der
   *  Sortierung. Siehe DashboardGroupBy. */
  groupBy?: DashboardGroupBy;
}

/**
 * Das Suchfeld einer Liste, im Hauptbereich rechts neben dem Titel
 * (`Dashboard`); die Breite gibt der Aufrufer über `className`.
 */
export function ListSearchField({ value, onChange, placeholder, className = '' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`list-search-field flex items-center gap-2.5 rounded-md px-2.5 h-8 ${className}`}>
      <Search size={16} className="list-toolbar-chip-label flex-shrink-0" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="list-toolbar-input bg-transparent outline-none w-full min-w-0 selectable text-sm"
      />
      {value && (
        <button onClick={() => onChange('')} className="list-toolbar-clear rounded-sm transition-colors flex-shrink-0">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Der Zeitstrahl gruppiert nach Monat über die *sortierte* Liste:
 *  Neueste/Älteste zuerst drehen ihn um und bleiben wählbar, die Alpha-Modi
 *  würden die Monatsreihenfolge verwürfeln und sind deshalb gesperrt. Die
 *  Gruppierung sperrt der Zeitstrahl ganz: dort gruppieren die Monate. */
const sortBlockedInTimeline = (v: SortMode) => v !== 'date_desc' && v !== 'date_asc';

/**
 * Die Sortier-Auswahl der Dashboard-Seitenleiste: volle Breite, im Auslöser
 * Icon und Label des gewählten Modus („Erstellt · neueste") — ein
 * `FieldDropdown` mit `variant="sidebar"`. Exportiert für
 * die Altar-Bibliothek, die im selben Kopf ihre eigene Sortierung stellt.
 */
export function SortSelect<S extends SortMode>({ label, value, modes, onChange, dateField = 'created', isDisabled, disabledHint }: {
  /** aria-label des Auslösers, vor dem gewählten Modus. */
  label: string;
  value: S;
  modes: readonly S[];
  onChange: (s: S) => void;
  dateField?: SortDateField;
  isDisabled?: (s: S) => boolean;
  /** Tooltip gesperrter Modi („Im Zeitstrahl nicht verfügbar"). */
  disabledHint?: string;
}) {
  const { t } = useTranslation();
  const field = t(SORT_DATE_KEYS[dateField]);
  const labels: Record<SortMode, string> = {
    date_desc: t('listView.sortNewest', { field }),
    date_asc: t('listView.sortOldest', { field }),
    alpha_asc: t('listView.sortAlphaAsc'),
    alpha_desc: t('listView.sortAlphaDesc'),
    count_desc: t('listView.sortCountDesc'),
  };
  const options = modes.map((mode) => {
    const Icon: LucideIcon = SORT_ICONS[mode];
    const disabled = isDisabled?.(mode) ?? false;
    return {
      value: mode,
      label: labels[mode],
      icon: <Icon size={14} className="flex-shrink-0" />,
      disabled,
      title: disabled ? disabledHint : undefined,
    };
  });
  return (
    <FieldDropdown
      value={value}
      options={options}
      onChange={onChange}
      variant="sidebar"
      ariaLabel={`${label}: ${labels[value]}`}
    />
  );
}

/**
 * Ansicht, Sortierung und Gruppierung als beschriftete Abschnitte — für den
 * Kopf in der rechten Seitenleiste (Dashboard-Portal). Die Suche steht im
 * Hauptbereich (`ListSearchField`).
 */
export default function ListToolbar({
  view, sort, onView, onSort, viewOptions: viewOptionsProp, sortModes = DEFAULT_SORT_MODES, sortDate, sortLabel, groupBy,
}: Props) {
  const { t } = useTranslation();

  const viewOptions = viewOptionsProp ?? [
    { value: 'list' as const, label: t('listView.list') },
    { value: 'cards' as const, label: t('listView.cards') },
    { value: 'cards_wide' as const, label: t('listView.cardsWide') },
    { value: 'timeline' as const, label: t('listView.timeline') },
  ];

  const inTimeline = view === 'timeline';
  const showView = view !== undefined && onView !== undefined && viewOptions.length > 1;
  const showSort = sort !== undefined && onSort !== undefined;
  const timelineHint = t('listView.notAvailableInTimeline');
  // Ohne Sortierung stünde der Gruppierungs-Schalter allein unter „Sortierung".
  const sortHeading = showSort ? (sortLabel ?? t('listView.sort')) : undefined;

  if (!showView && !showSort && !groupBy) return null;

  return (
    // Ohne eigenes Streifen-Chrome: die p-3-Spalte der Seitenleiste liefert
    // den Einzug (eine Einzugsquelle pro Spalte, design.md).
    <div className="flex flex-col gap-4">
      {showView && (
        <SidebarGroup label={t('listView.view')}>
          <IconToggleGroup
            fill
            label={t('listView.view')}
            options={viewOptions}
            icons={VIEW_ICONS}
            value={view!}
            onChange={onView!}
          />
        </SidebarGroup>
      )}
      {(showSort || groupBy) && (
        <SidebarGroup label={sortHeading}>
          {showSort && (
            <SortSelect
              label={sortHeading!}
              // Im Zeitstrahl gilt ein Datum (`groupByMonth`); die gespeicherte
              // Sortierung bleibt und gilt wieder, sobald er verlassen wird.
              value={inTimeline && sortBlockedInTimeline(sort!) ? 'date_desc' : sort!}
              modes={sortModes}
              onChange={onSort!}
              dateField={sortDate}
              isDisabled={inTimeline ? sortBlockedInTimeline : undefined}
              disabledHint={timelineHint}
            />
          )}
          {/* Im Zeitstrahl gruppieren die Monate; der Schalter hat dort keine
              Wirkung und bleibt gesperrt stehen, statt zu verschwinden. */}
          {groupBy && (
            <SwitchRow
              icon={Layers}
              label={t('listView.groupBy', { label: groupBy.label ?? t('listView.category') })}
              checked={groupBy.value === 'grouped'}
              onChange={(on) => groupBy.onChange(on ? 'grouped' : 'flat')}
              disabled={inTimeline}
              title={inTimeline ? timelineHint : undefined}
            />
          )}
        </SidebarGroup>
      )}
    </div>
  );
}
