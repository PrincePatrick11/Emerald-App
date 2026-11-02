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

/* Icon per mode: the view appears as an icon bar (label in
   title/aria-label), the sorting as a select with icon and text. */
const VIEW_ICONS: Record<ViewMode, LucideIcon> = {
  list: List,
  cards: LayoutGrid,
  cards_wide: StretchHorizontal,
  timeline: CalendarRange,
};
/** Order of the sort select when the caller specifies no `sortModes`.
 *  `count_desc` is deliberately missing: only tags have anything to count. */
const DEFAULT_SORT_MODES: readonly SortMode[] = ['date_desc', 'date_asc', 'alpha_asc', 'alpha_desc'];

const SORT_ICONS: Record<SortMode, LucideIcon> = {
  date_desc: CalendarArrowDown,
  date_asc: CalendarArrowUp,
  alpha_asc: ArrowDownAZ,
  alpha_desc: ArrowDownZA,
  count_desc: ArrowDown10,
};

/** Which date a list's date sort compares; it comes first
 *  in its label ("Created · newest"). */
export type SortDateField = 'created' | 'updated' | 'deleted';

const SORT_DATE_KEYS: Record<SortDateField, string> = {
  created: 'listView.dateCreated',
  updated: 'listView.dateUpdated',
  deleted: 'listView.dateDeleted',
};

/** A display toggle: a preference of the view, not a filter; it does not count
 *  towards `activeFilterCount` and stays put on reset. */
export interface DisplayToggle {
  label: string;
  icon?: LucideIcon;
  checked: boolean;
  onChange: (next: boolean) => void;
}

interface Props {
  /** View and sorting are axes like `groupBy`: if the handler is missing,
   *  the section is omitted. The categories view has neither the one nor
   *  the other; its order is the hand-dragged one. */
  view?: ViewMode;
  sort?: SortMode;
  onView?: (v: ViewMode) => void;
  onSort?: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  /** Which sort modes are on offer, in this order. */
  sortModes?: readonly SortMode[];
  /** Which date the date sort compares; default `created`. */
  sortDate?: SortDateField;
  /** Heading of the sorting when the bar has more than one
   *  (altar: "Sort · Altars" above "Sort · Library"). */
  sortLabel?: string;
  /** Under the view's layout buttons, in the same section. */
  displayToggles?: DisplayToggle[];
  /** The grouping axis; if it is missing, its section is omitted. See DashboardGroupBy. */
  groupBy?: DashboardGroupBy;
}

/**
 * The search field of a list, in the main area to the right of the title
 * (`Dashboard`); the caller sets the width via `className`.
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

/** The timeline groups by month over the *sorted* list:
 *  Newest/Oldest first reverse it and remain selectable, the alphabetical modes
 *  would scramble the month order and are therefore disabled. The
 *  timeline disables grouping entirely: there the months group. */
const sortBlockedInTimeline = (v: SortMode) => v !== 'date_desc' && v !== 'date_asc';

/**
 * The sort select of the dashboard sidebar: full width, with icon
 * and label of the chosen mode in the trigger ("Created · newest"), a
 * `FieldDropdown` with `variant="sidebar"`. Exported for
 * the altar library, which provides its own sorting in the same header.
 */
export function SortSelect<S extends SortMode>({ label, value, modes, onChange, dateField = 'created', isDisabled, disabledHint }: {
  /** aria-label of the trigger, before the chosen mode. */
  label: string;
  value: S;
  modes: readonly S[];
  onChange: (s: S) => void;
  dateField?: SortDateField;
  isDisabled?: (s: S) => boolean;
  /** Tooltip of disabled modes ("Not available in the timeline"). */
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
 * View, sorting and grouping as labelled sections, always in this order, for
 * the header in the right sidebar (dashboard portal). What a dashboard does not
 * have falls away. The search is in the main area (`ListSearchField`).
 */
export default function ListToolbar({
  view, sort, onView, onSort, viewOptions: viewOptionsProp, sortModes = DEFAULT_SORT_MODES, sortDate, sortLabel, displayToggles = [], groupBy,
}: Props) {
  const { t } = useTranslation();

  const viewOptions = viewOptionsProp ?? [
    { value: 'list' as const, label: t('listView.list') },
    { value: 'cards' as const, label: t('listView.cards') },
    { value: 'cards_wide' as const, label: t('listView.cardsWide') },
    { value: 'timeline' as const, label: t('listView.timeline') },
  ];

  const inTimeline = view === 'timeline';
  const showLayouts = view !== undefined && onView !== undefined && viewOptions.length > 1;
  const showSort = sort !== undefined && onSort !== undefined;
  const timelineHint = t('listView.notAvailableInTimeline');
  const sortHeading = sortLabel ?? t('listView.sort');

  if (!showLayouts && displayToggles.length === 0 && !showSort && !groupBy) return null;

  return (
    // Without strip chrome of its own: the sidebar's p-3 column provides
    // the indentation (one indentation source per column, design.md).
    <div className="flex flex-col gap-4">
      {(showLayouts || displayToggles.length > 0) && (
        <SidebarGroup label={t('listView.view')}>
          {showLayouts && (
            <IconToggleGroup
              fill
              label={t('listView.view')}
              options={viewOptions}
              icons={VIEW_ICONS}
              value={view!}
              onChange={onView!}
            />
          )}
          {displayToggles.map((toggle) => <SwitchRow key={toggle.label} {...toggle} />)}
        </SidebarGroup>
      )}
      {showSort && (
        <SidebarGroup label={sortHeading}>
          <SortSelect
            label={sortHeading}
            // In the timeline a date applies (`groupByMonth`); the saved
            // sorting stays and applies again as soon as it is left.
            value={inTimeline && sortBlockedInTimeline(sort!) ? 'date_desc' : sort!}
            modes={sortModes}
            onChange={onSort!}
            dateField={sortDate}
            isDisabled={inTimeline ? sortBlockedInTimeline : undefined}
            disabledHint={timelineHint}
          />
        </SidebarGroup>
      )}
      {/* In the timeline the months group; the toggle has no effect there
          and stays disabled instead of disappearing. */}
      {groupBy && (
        <SidebarGroup label={t('listView.grouping')}>
          <SwitchRow
            icon={Layers}
            label={t('listView.groupBy', { label: groupBy.label ?? t('listView.category') })}
            checked={groupBy.value === 'grouped'}
            onChange={(on) => groupBy.onChange(on ? 'grouped' : 'flat')}
            disabled={inTimeline}
            title={inTimeline ? timelineHint : undefined}
          />
        </SidebarGroup>
      )}
    </div>
  );
}
