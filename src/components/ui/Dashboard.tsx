import { Fragment, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus, Plus } from 'lucide-react';
import Button from './Button';
import ListToolbar from './ListToolbar';
import FilterPanel, { type FilterPanelProps } from './FilterPanel';
import { useUIStore, type ViewMode, type SortMode } from '../../store/uiStore';

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
      /** Shown instead of the item list when a group has zero items (default: a muted em-dash). */
      renderEmptyGroup?: (group: DashboardGroup<T>) => ReactNode;
      /** Collapsed groups render only their header — the chevron lives in the
       *  caller's renderGroupHeader (CategoryHeaderRow's onToggleCollapse). */
      isGroupCollapsed?: (group: DashboardGroup<T>) => boolean;
    }
  | { mode: 'custom'; render: () => ReactNode };

export interface DashboardEmptyState {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  messageClassName?: string;
  actionClassName?: string;
}

export interface DashboardFilters {
  /** Nur Inline-Kopf: im Seitenleisten-Modus steht das FilterPanel dauerhaft,
   *  der Auf/Zu-Zustand greift erst wieder, wenn die Leiste zugeklappt ist. */
  showFilters: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  panelProps: Omit<FilterPanelProps, 'activeFilterCount'>;
}

interface DashboardBaseProps<T> {
  // Topbar
  title?: string;
  /** Fully replaces the topbar-left slot (icon + title + badge + selection controls). */
  headerLeft?: ReactNode;
  titleClassName?: string;
  /** Inline als beschrifteter Button, im Seitenleisten-Kopf als kompakter
   *  Jade-Icon-Button (Label wird title/aria-label). */
  primaryAction?: { label: string; onClick: () => void };
  /** Links vom Primär-Knopf, z. B. „Kategorie hinzufügen". */
  secondaryAction?: { label: string; onClick: () => void };
  /** Fully replaces the action slot — in BOTH header trees: inline the
   *  topbar-right, im Seitenleisten-Modus die Titelzeilen-Buttons (gerendert
   *  in der Scroll-Spalte, wo Platz zum Umbrechen ist). Trash's bulk-select. */
  headerRight?: ReactNode;
  /** Nur Inline-Kopf; die Seitenleisten-Titelzeile hat festes Chrome. */
  headerClassName?: string;

  // ListToolbar passthrough
  view: ViewMode;
  sort: SortMode;
  onView: (v: ViewMode) => void;
  onSort: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  search?: string;
  onSearch?: (v: string) => void;

  // FilterPanel (omit entirely for views with no filter concept)
  filters?: DashboardFilters;

  // Content
  items: T[];
  itemKey: (item: T) => string;
  noResultsMessage?: string;
  noResultsClassName?: string;

  cardsClassName?: string;
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

const DEFAULT_HEADER_CLASSNAME = 'flex items-center justify-between px-8 h-14 border-b border-stone-700/60';
const DEFAULT_CONTENT_CLASSNAME = 'flex-1 overflow-y-auto px-8 py-6';
const DEFAULT_CARDS_CLASSNAME = 'grid grid-cols-3 gap-3';
const DEFAULT_LIST_CLASSNAME = 'space-y-1.5';
const DEFAULT_TITLE_CLASSNAME = 'text-lg font-semibold text-stone-100';
const DEFAULT_EMPTY_WRAPPER_CLASSNAME = 'text-center py-20';
const DEFAULT_EMPTY_MESSAGE_CLASSNAME = 'text-stone-600 text-sm';
const DEFAULT_EMPTY_ACTION_CLASSNAME = 'mt-4 text-xs text-stone-500 hover:text-stone-300 underline transition-colors';
const DEFAULT_NO_RESULTS_CLASSNAME = 'text-center py-20 text-stone-600 text-sm';

function GroupDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-stone-700/50" />
    </div>
  );
}

export default function Dashboard<T>({
  title,
  headerLeft,
  titleClassName = DEFAULT_TITLE_CLASSNAME,
  primaryAction,
  secondaryAction,
  headerRight,
  headerClassName = DEFAULT_HEADER_CLASSNAME,
  view,
  sort,
  onView,
  onSort,
  viewOptions,
  search,
  onSearch,
  filters,
  items,
  itemKey,
  renderItem,
  isEmpty,
  emptyState,
  hasNoResults,
  noResultsMessage,
  noResultsClassName = DEFAULT_NO_RESULTS_CLASSNAME,
  grouping,
  cardsClassName = DEFAULT_CARDS_CLASSNAME,
  listClassName = DEFAULT_LIST_CLASSNAME,
  contentClassName = DEFAULT_CONTENT_CLASSNAME,
  contextMenuSlot,
}: DashboardProps<T>) {
  const renderItems = (subset: T[]) =>
    view === 'cards' ? (
      <div className={cardsClassName}>
        {subset.map((item) => <Fragment key={itemKey(item)}>{renderItem!(item)}</Fragment>)}
      </div>
    ) : (
      <div className={listClassName}>
        {subset.map((item) => <Fragment key={itemKey(item)}>{renderItem!(item)}</Fragment>)}
      </div>
    );

  const renderContent = () => {
    // Custom mode owns 100% of its content — checked first so callers don't
    // need to pass meaningless isEmpty/hasNoResults values to opt out.
    if (grouping.mode === 'custom') return grouping.render();

    if (isEmpty) {
      return (
        <div className={emptyState!.className ?? DEFAULT_EMPTY_WRAPPER_CLASSNAME}>
          <p className={emptyState!.messageClassName ?? DEFAULT_EMPTY_MESSAGE_CLASSNAME}>{emptyState!.message}</p>
          {emptyState!.actionLabel && emptyState!.onAction && (
            <button
              onClick={emptyState!.onAction}
              className={emptyState!.actionClassName ?? DEFAULT_EMPTY_ACTION_CLASSNAME}
            >
              {emptyState!.actionLabel}
            </button>
          )}
        </div>
      );
    }

    if (hasNoResults) {
      return <p className={noResultsClassName}>{noResultsMessage}</p>;
    }

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
    // „Nur mit Einträgen" wird hier zentral ausgewertet — die Views reichen den
    // Schalter nur als Chip-Zustand durch. Bleibt danach keine Gruppe übrig,
    // greift der „Keine Ergebnisse"-Hinweis, den sonst hasNoResults liefert.
    const groups = filters?.panelProps.nonEmptyOnly
      ? grouping.groups.filter((group) => group.items.length > 0)
      : grouping.groups;
    return (
      <div className="space-y-6">
        {groups.length === 0 && <p className={noResultsClassName}>{noResultsMessage}</p>}
        {groups.map((group) => (
          <div key={group.key ?? group.label}>
            {grouping.renderGroupHeader?.(group)}
            {grouping.isGroupCollapsed?.(group)
              ? null
              : group.items.length === 0
                ? (grouping.renderEmptyGroup?.(group) ?? <p className="text-xs text-stone-700 px-1 py-1">—</p>)
                : renderItems(group.items)}
          </div>
        ))}
      </div>
    );
  };

  // Experiment „Kopfzeile in der Seitenleiste": Die rechte Seitenleiste stellt
  // in Listenansichten ein Portal-Ziel (RightSidebar → setListHeaderHost).
  // Solange es existiert, wandert der komplette Kopf dorthin; ist die Leiste
  // zu (oder noch nicht gemountet), bleibt er inline — sonst käme man an
  // „Neuer Eintrag", Suche und Filter nicht mehr heran. Der rightSidebarOpen-
  // Zusatz lässt den Kopf sofort beim Zuklappen zurückfallen: AppShell hält
  // die Leiste für die 200ms-Animation noch gemountet (inert), der Host wäre
  // also noch da, aber unbenutzbar.
  const listHeaderHost = useUIStore((s) => (s.rightSidebarOpen ? s.listHeaderHost : null));

  // Beide Kopf-Bäume teilen sich die Toolbar-Props — eine künftige Prop, die
  // nur in einem Zweig nachgezogen wird, ist der naheliegendste Drift.
  const toolbarCommon = { view, sort, onView, onSort, viewOptions, search, onSearch };

  const inlineHeader = (
    <>
      <div className={headerClassName}>
        {headerLeft ?? <h1 className={titleClassName}>{title}</h1>}
        {headerRight ?? (
          <div className="flex items-center gap-2">
            {secondaryAction && (
              <Button onClick={secondaryAction.onClick} variant="secondary">
                <Plus size={14} />{secondaryAction.label}
              </Button>
            )}
            {primaryAction && (
              <Button onClick={primaryAction.onClick} variant="primary">
                <Plus size={14} />{primaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>

      <ListToolbar
        {...toolbarCommon}
        showFilters={filters?.showFilters}
        onToggleFilters={filters?.onToggleFilters}
        activeFilterCount={filters?.activeFilterCount}
      />

      {filters?.showFilters && (
        <FilterPanel {...filters.panelProps} activeFilterCount={filters.activeFilterCount} />
      )}
    </>
  );

  const sidebarHeader = (
    <div className="flex flex-col flex-1 min-h-0">
      {/* h-14 + px-3 wie die Aktionsleiste der Detailansichten, damit die
          Trennlinie mit der Tab-Leiste der Eintragsliste fluchtet. Die
          Aktionen sitzen als kompakte tone-Buttons rechts im Titel, ihr Label
          wandert in title/aria-label. `headerRight` ersetzt sie — derselbe
          Vertrag wie inline —, wohnt aber in der Scroll-Spalte darunter, wo
          eine breite Slot-Zeile (Trash-Bulk-Aktionen) umbrechen kann. */}
      <div className="flex items-center gap-2 px-3 h-14 border-b border-stone-700/60 flex-shrink-0 min-w-0">
        {headerLeft ?? <h1 className={`${titleClassName} truncate`}>{title}</h1>}
        {!headerRight && (primaryAction || secondaryAction) && (
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            {secondaryAction && (
              // FolderPlus statt Plus: neben dem Jade-Plus für den neuen
              // Eintrag wären zwei identische Pluszeichen nicht unterscheidbar.
              <Button
                tone="neutral"
                compact
                onClick={secondaryAction.onClick}
                title={secondaryAction.label}
                aria-label={secondaryAction.label}
              >
                <FolderPlus size={14} />
              </Button>
            )}
            {primaryAction && (
              <Button
                tone="jade"
                compact
                onClick={primaryAction.onClick}
                title={primaryAction.label}
                aria-label={primaryAction.label}
              >
                <Plus size={14} />
              </Button>
            )}
          </div>
        )}
      </div>
      {/* Eine Einzugsquelle pro Spalte (design.md): dieselbe p-3-Spalte wie der
          Properties-Container in RightSidebar — Toolbar und FilterPanel bringen
          im vertikalen Modus kein eigenes Streifen-Chrome mit. */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {headerRight && <div className="flex flex-col gap-1.5">{headerRight}</div>}

        <ListToolbar vertical {...toolbarCommon} />

        {/* In der Seitenleiste ist Platz in der Höhe: das FilterPanel steht
            dauerhaft, der Auf/Zu-Zustand gilt nur für den Inline-Fallback. */}
        {filters && (
          <FilterPanel vertical {...filters.panelProps} activeFilterCount={filters.activeFilterCount} />
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {listHeaderHost ? createPortal(sidebarHeader, listHeaderHost) : inlineHeader}

      <div className={contentClassName}>{renderContent()}</div>

      {contextMenuSlot}
    </div>
  );
}
