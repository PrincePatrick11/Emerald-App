import { Fragment, useLayoutEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import Button from './Button';
import SidebarPortal from './SidebarPortal';
import SidebarColumn, { SidebarActionBar } from './SidebarColumn';
import CollapseChevron from './CollapseChevron';
import EmptyState, { NoResults, type EmptyStateProps } from './EmptyState';
import ListToolbar, { ListSearchField, type SortDateField } from './ListToolbar';
import { ENTRY_TITLE_HEADING_CLASSES } from './EntryDetailFrame';
import FilterPanel, { type FilterPanelProps } from './FilterPanel';
import { useUIStore, type ViewMode, type SortMode, type GroupingMode } from '../../store/uiStore';
import { isCardView, isWideCardView } from '../../lib/viewMode';

export interface DashboardGroup<T> {
  /** Stable key for React lists; defaults to `label` when omitted. */
  key?: string;
  /** Empty string renders no header/divider (e.g. a flat, ungrouped bucket). */
  label: string;
  items: T[];
}

type DashboardGrouping<T> =
  | { mode: 'flat' }
  | { mode: 'timeline'; groups: DashboardGroup<T>[] }
  | {
      mode: 'category';
      groups: DashboardGroup<T>[];
      renderGroupHeader?: (group: DashboardGroup<T>) => ReactNode;
      /** Shown instead of the item list when a group has zero items (default: a muted em-dash).
       *  Only reachable with `keepEmptyGroups` — otherwise empty groups are dropped first. */
      renderEmptyGroup?: (group: DashboardGroup<T>) => ReactNode;
      /** Collapsed groups render only their header — the chevron lives in the
       *  caller's renderGroupHeader (CollapsibleGroupHeader's onToggleCollapse). */
      isGroupCollapsed?: (group: DashboardGroup<T>) => boolean;
      /** Keep empty groups instead of filtering them out centrally, for
       *  groups that are something in themselves (tags: an unused tag stays
       *  visible and manageable). */
      keepEmptyGroups?: boolean;
    }
  | { mode: 'custom'; render: () => ReactNode };

/** Rendered as `EmptyState`; the `icon` is usually the view's rail icon. */
export type DashboardEmptyState = EmptyStateProps;

export interface DashboardGroupBy {
  value: GroupingMode;
  onChange: (g: GroupingMode) => void;
  /** What is grouped by, in the module's own words: "Moon phase" in the
   *  journal, "Type" in the trash. Default: "Category". */
  label?: string;
}

/** The sidebar's main action: jade with "+", or red (`danger`) with
 *  its own icon when the page's main action destroys (emptying the trash). */
export interface DashboardPrimaryAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Replaces the "+". */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface DashboardFilters {
  /** Counts for the reset button of the "No results" notice. */
  activeFilterCount: number;
  /** Clears the filters, the same button; in the sidebar itself the
   *  "All" row of each list does that. */
  onClearAll?: () => void;
  panelProps: FilterPanelProps;
}

interface DashboardBaseProps<T> {
  // Header: title and search in the main area; actions, toolbar and filter in
  // the right sidebar
  /** Only the title: no icon, no number. The icon is already in the rail,
   *  and counting is not done in the sections below (equally plain everywhere). */
  title?: string;
  /** Replaces the whole title line, for headers with more than the title
   *  (Home: two lines; trash: `DashboardTitle` plus "Select all"). */
  headerLeft?: ReactNode;
  /** Labelled button that fills the bar at the top of the sidebar. */
  primaryAction?: DashboardPrimaryAction;
  /** Compact icon buttons to the right of the primary action, in the same row;
   *  their label is only in the tooltip. For side areas of the module (altar:
   *  the library below the altars) and for cancelling a confirmation
   *  that the primary action raises (trash). */
  extraActions?: { label: string; icon: ReactNode; onClick: () => void }[];

  // ListToolbar passthrough. View and sorting are optional like
  // `groupBy`: without a handler the respective row is omitted.
  view?: ViewMode;
  sort?: SortMode;
  onView?: (v: ViewMode) => void;
  onSort?: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  /** Which sort modes are on offer; default: the four date/alphabetical modes. */
  sortModes?: readonly SortMode[];
  /** Which date the date sort compares (label "Created · newest"). */
  sortDate?: SortDateField;
  /** Heading of the sort section instead of "Sort" (altar: "Sort · Altars"). */
  sortLabel?: string;
  /** The toolbar's grouping axis, as one object so that value and
   *  handler cannot go missing individually and the name is not confused with
   *  `grouping` below, which describes the structure of the content.
   *  Without it the toolbar shows only view and sorting (altar: its
   *  altars have nothing to group). */
  groupBy?: DashboardGroupBy;
  search?: string;
  onSearch?: (v: string) => void;

  // FilterPanel (omit entirely for views with no filter concept)
  filters?: DashboardFilters;

  // Content
  items: T[];
  itemKey: (item: T) => string;

  /** Above the content, also in the empty and "No results" case: the
   *  section heading of the main area (altar: "Altars" with a chevron,
   *  matching that of the library below). */
  contentHeader?: ReactNode;
  /** Below the content, also in the empty and "No results" case: a
   *  second area of the same module (altar: the library). */
  contentFooter?: ReactNode;

  cardsClassName?: string;
  /** Grid of the "Full-width cards" view: one column instead of three.
   *  A separate prop instead of a variant of `cardsClassName`, because modules may
   *  fill the wide card differently (altar: taller preview). */
  wideCardsClassName?: string;
  listClassName?: string;
  contentClassName?: string;
  /** <ContextMenu> stays caller-owned since its trigger is wired inside renderItem. */
  contextMenuSlot?: ReactNode;
}

/**
 * `grouping: { mode: 'custom' }` hands 100% of content rendering to the
 * caller (used by views whose grouping doesn't fit `category`/`timeline`,
 * e.g. Tasks/Trash) — so it's the only mode where renderItem/isEmpty/
 * emptyState/hasNoResults don't apply. Every other mode requires them.
 */
type DashboardContentProps<T> =
  | {
      grouping: Exclude<DashboardGrouping<T>, { mode: 'custom' }>;
      renderItem: (item: T) => ReactNode;
      /** True empty state: no items exist at all (independent of search/filters). */
      isEmpty: boolean;
      emptyState: DashboardEmptyState;
      /** Search/filter produced zero results (only checked when `isEmpty` is false). */
      hasNoResults: boolean;
    }
  | {
      grouping: Extract<DashboardGrouping<T>, { mode: 'custom' }>;
      renderItem?: undefined;
      isEmpty?: undefined;
      emptyState?: undefined;
      hasNoResults?: undefined;
    };

export type DashboardProps<T> = DashboardBaseProps<T> & DashboardContentProps<T>;

const DEFAULT_CONTENT_CLASSNAME = 'flex-1 overflow-y-auto px-8 py-6';
const DEFAULT_CARDS_CLASSNAME = 'grid grid-cols-3 gap-3';
const DEFAULT_WIDE_CARDS_CLASSNAME = 'grid grid-cols-1 gap-3';
const DEFAULT_LIST_CLASSNAME = 'space-y-1.5';

/**
 * The title of a dashboard in the main area: just the title. Dashboard renders
 * it itself from `title`; exported for headers that need something after it
 * (`children`, the trash its "Select all") and therefore build it as
 * `headerLeft`.
 */
export function DashboardTitle({ title, children }: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <h1 className={`${ENTRY_TITLE_HEADING_CLASSES} truncate`}>{title}</h1>
      {children}
    </div>
  );
}

/**
 * The divider heading of the timeline groups: a label, then a line
 * to the edge. Exported because a whole section is also headed this way
 * (the library in the altar dashboard); there with a chevron. Deliberately without
 * a counter: a section is only named, nothing is counted in the header.
 * Not CollapsibleGroupHeader: that one has no line and carries category rows,
 * not sections.
 */
export function GroupDivider({
  label, collapsed, onToggleCollapse,
}: {
  label: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const labelClass = 'text-xs font-semibold text-subtle uppercase tracking-wider whitespace-nowrap';
  return (
    <div className="flex items-center gap-3 mb-3">
      {onToggleCollapse && <CollapseChevron collapsed={!!collapsed} onToggle={onToggleCollapse} />}
      {onToggleCollapse
        ? <button onClick={onToggleCollapse} className={`${labelClass} transition-colors hover:text-raise`}>{label}</button>
        : <span className={labelClass}>{label}</span>}
      <div className="flex-1 h-px bg-well-raise" />
    </div>
  );
}

export default function Dashboard<T>({
  title,
  headerLeft,
  primaryAction,
  extraActions,
  view,
  sort,
  onView,
  onSort,
  viewOptions,
  sortModes,
  sortDate,
  sortLabel,
  groupBy,
  search,
  onSearch,
  filters,
  items,
  itemKey,
  renderItem,
  isEmpty,
  emptyState,
  hasNoResults,
  grouping,
  contentHeader,
  contentFooter,
  cardsClassName = DEFAULT_CARDS_CLASSNAME,
  wideCardsClassName = DEFAULT_WIDE_CARDS_CLASSNAME,
  listClassName = DEFAULT_LIST_CLASSNAME,
  contentClassName = DEFAULT_CONTENT_CLASSNAME,
  contextMenuSlot,
}: DashboardProps<T>) {
  const { t } = useTranslation();
  // Without a view axis there is only the list; cards are a choice that
  // such a view does not offer.
  const renderItems = (subset: T[]) =>
    view !== undefined && isCardView(view) ? (
      <div className={isWideCardView(view) ? wideCardsClassName : cardsClassName}>
        {subset.map((item) => <Fragment key={itemKey(item)}>{renderItem!(item)}</Fragment>)}
      </div>
    ) : (
      <div className={listClassName}>
        {subset.map((item) => <Fragment key={itemKey(item)}>{renderItem!(item)}</Fragment>)}
      </div>
    );

  // One button clears search and filters together; which of them was active does not matter.
  const activeFilterCount = filters?.activeFilterCount ?? 0;
  const canReset = !!search?.trim() || activeFilterCount > 0;
  const noResults = (
    <NoResults
      query={search}
      filtered={activeFilterCount > 0}
      onReset={canReset ? () => {
        onSearch?.('');
        filters?.onClearAll?.();
      } : undefined}
    />
  );

  const renderContent = () => {
    // Custom mode owns 100% of its content — checked first so callers don't
    // need to pass meaningless isEmpty/hasNoResults values to opt out.
    if (grouping.mode === 'custom') return grouping.render();

    if (isEmpty) return <EmptyState {...emptyState!} />;

    if (hasNoResults) return noResults;

    if (grouping.mode === 'flat') return renderItems(items);

    if (grouping.mode === 'timeline') {
      return (
        <div className="space-y-6">
          {grouping.groups.map((group) => (
            <div key={group.key ?? group.label}>
              {group.label && <GroupDivider label={group.label} />}
              {renderItems(group.items)}
            </div>
          ))}
        </div>
      );
    }

    // mode === 'category'
    // Empty groups are dropped centrally here (except with `keepEmptyGroups`): the category list is global,
    // so a category created for the wiki would otherwise also show up as an empty header
    // in operations.
    // If no group remains, the "No results" notice kicks in,
    // which hasNoResults would otherwise supply.
    // Not the only place: Tasks renders in custom mode and applies
    // the same rule itself (TasksView, `visibleCategories`).
    const groups = grouping.keepEmptyGroups
      ? grouping.groups
      : grouping.groups.filter((group) => group.items.length > 0);
    if (groups.length === 0) return noResults;
    return (
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.key ?? group.label}>
            {grouping.renderGroupHeader?.(group)}
            {grouping.isGroupCollapsed?.(group)
              ? null
              : group.items.length === 0
                ? (grouping.renderEmptyGroup?.(group) ?? <p className="text-xs text-faint px-1 py-1">—</p>)
                : renderItems(group.items)}
          </div>
        ))}
      </div>
    );
  };

  // Register so that RightSidebar provides the portal target (see
  // `uiStore.dashboardMounted`). Layout effect instead of passive effect: if a
  // click opens an entry, the sidebar must switch to the action bar
  // before painting, otherwise an empty host would stand there for one frame.
  const setDashboardMounted = useUIStore((s) => s.setDashboardMounted);
  useLayoutEffect(() => {
    setDashboardMounted(true);
    return () => setDashboardMounted(false);
  }, [setDashboardMounted]);

  const extraActionButtons = extraActions?.map((action) => (
    <Button
      key={action.label}
      tone="neutral"
      compact
      onClick={action.onClick}
      title={action.label}
      aria-label={action.label}
    >
      {action.icon}
    </Button>
  ));

  // At the very top of the sidebar are the actions (`actionBar`). Toolbar and
  // FilterPanel bring no strip chrome of their own; the indentation is provided by
  // `SidebarColumn`.
  // The actions sit like an entry's "Edit" in the 56px bar
  // with the divider below it: the primary action fills the row, the
  // secondary actions stay compact beside it.
  const actionBar = primaryAction || extraActions?.length ? (
    <SidebarActionBar>
      {primaryAction && (
        <Button
          variant={primaryAction.danger ? 'primaryDanger' : 'primary'}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          className="flex-1 min-w-0 justify-center"
        >
          {primaryAction.icon ?? <Plus size={14} className="flex-shrink-0" />}
          <span className="truncate">{primaryAction.label}</span>
        </Button>
      )}
      {extraActionButtons}
    </SidebarActionBar>
  ) : undefined;

  const header = (
    <SidebarColumn bar={actionBar} bodyClassName="space-y-4">
      <ListToolbar
        view={view}
        sort={sort}
        onView={onView}
        onSort={onSort}
        viewOptions={viewOptions}
        sortModes={sortModes}
        sortDate={sortDate}
        sortLabel={sortLabel}
        groupBy={groupBy}
      />

      {/* The sidebar has room in height: the FilterPanel stays
          permanently open instead of behind an open/close button. */}
      {filters && (
        <FilterPanel {...filters.panelProps} />
      )}
    </SidebarColumn>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Actions, toolbar and filter live in the right sidebar: it
          provides a portal target in list views (RightSidebar →
          setListHeaderHost). When it is closed they are absent, deliberately; the list
          then gets the full width. On collapse, AppShell keeps the sidebar mounted
          (inert) for the 200ms animation; the header slides out with it
          and disappears when the host is unregistered. */}
      <SidebarPortal>{header}</SidebarPortal>

      {/* Title and search in the main area, on one line: the title on the left, the
          search 260px wide, right-aligned. Above the scroll area, so that they stand
          independently of the indentation a view sets for its content. */}
      <div className="px-8 pt-6 flex items-center gap-4 flex-shrink-0">
        <div className="flex-1 min-w-0">
          {headerLeft ?? (title && <DashboardTitle title={title} />)}
        </div>
        {onSearch && (
          <ListSearchField
            value={search ?? ''}
            onChange={onSearch}
            placeholder={title ? t('search.placeholderIn', { name: title }) : t('search.placeholder')}
            className="w-[260px] flex-shrink-0"
          />
        )}
      </div>

      <div className={contentClassName}>
        {contentHeader}
        {renderContent()}
        {contentFooter}
      </div>

      {contextMenuSlot}
    </div>
  );
}
