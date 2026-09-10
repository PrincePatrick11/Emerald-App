import { Fragment, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import Button from './Button';
import CollapseChevron from './CollapseChevron';
import ListToolbar from './ListToolbar';
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
      /** Shown instead of the item list when a group has zero items (default: a muted em-dash). */
      renderEmptyGroup?: (group: DashboardGroup<T>) => ReactNode;
      /** Collapsed groups render only their header — the chevron lives in the
       *  caller's renderGroupHeader (CollapsibleGroupHeader's onToggleCollapse). */
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

export interface DashboardGroupBy {
  value: GroupingMode;
  onChange: (g: GroupingMode) => void;
  /** Wonach gruppiert wird, in den Worten des Moduls — „Mondphase" im
   *  Journal, „Typ" im Papierkorb. Default: „Kategorie". */
  label?: string;
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
  /** Beschrifteter Jade-Knopf, in beiden Kopf-Bäumen gleich. In der
   *  Seitenleiste darf dafür der Titel daneben abschneiden: die Aktion ist
   *  das, wofür man den Kopf aufsucht, der Titel steht auch im Tab. */
  primaryAction?: { label: string; onClick: () => void };
  /** Kompakte Icon-Knöpfe rechts neben der Primäraktion, in derselben Reihe —
   *  in beiden Kopf-Bäumen gleich, ihr Label steht nur im Tooltip. Für
   *  Nebenschauplätze des Moduls (Altar: die Bibliothek unter den Altären). */
  extraActions?: { label: string; icon: ReactNode; onClick: () => void }[];
  /** Fully replaces the action slot — in BOTH header trees: inline the
   *  topbar-right, im Seitenleisten-Modus die Titelzeilen-Buttons (gerendert
   *  in der Scroll-Spalte, wo Platz zum Umbrechen ist). Trash's bulk-select. */
  headerRight?: ReactNode;
  /** Nur Inline-Kopf; die Seitenleisten-Titelzeile hat festes Chrome. */
  headerClassName?: string;

  // ListToolbar passthrough. Ansicht und Sortierung sind optional wie
  // `groupBy`: ohne Handler entfällt die jeweilige Reihe.
  view?: ViewMode;
  sort?: SortMode;
  onView?: (v: ViewMode) => void;
  onSort?: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  /** Die Gruppierungs-Achse der Toolbar — als ein Objekt, damit Wert und
   *  Handler nicht einzeln fehlen können und der Name sich nicht mit
   *  `grouping` unten verwechselt, das die Struktur des Inhalts beschreibt.
   *  Ohne sie zeigt die Toolbar nur Ansicht und Sortierung (Altar: seine
   *  Altäre haben nichts zu gruppieren). */
  groupBy?: DashboardGroupBy;
  search?: string;
  onSearch?: (v: string) => void;

  // FilterPanel (omit entirely for views with no filter concept)
  filters?: DashboardFilters;

  // Content
  items: T[];
  itemKey: (item: T) => string;
  noResultsMessage?: string;
  noResultsClassName?: string;

  /** Über dem Inhalt, auch im Leer- und „Keine Ergebnisse"-Fall — die
   *  Abschnitts-Überschrift des Hauptbereichs (Altar: „Altäre" mit Chevron,
   *  passend zu der der Bibliothek darunter). */
  contentHeader?: ReactNode;
  /** Unter dem Inhalt, auch im Leer- und „Keine Ergebnisse"-Fall — ein
   *  zweiter Bereich desselben Moduls (Altar: die Bibliothek). */
  contentFooter?: ReactNode;

  cardsClassName?: string;
  /** Raster der Ansicht „Karten in voller Breite" — eine Spalte statt drei.
   *  Eigene Prop statt einer Variante von `cardsClassName`, weil Module die
   *  breite Karte anders füllen dürfen (Altar: höhere Vorschau). */
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

const DEFAULT_HEADER_CLASSNAME = 'flex items-center justify-between px-8 h-14 border-b border-stone-700/60';
const DEFAULT_CONTENT_CLASSNAME = 'flex-1 overflow-y-auto px-8 py-6';
const DEFAULT_CARDS_CLASSNAME = 'grid grid-cols-3 gap-3';
const DEFAULT_WIDE_CARDS_CLASSNAME = 'grid grid-cols-1 gap-3';
const DEFAULT_LIST_CLASSNAME = 'space-y-1.5';
const DEFAULT_TITLE_CLASSNAME = 'text-lg font-semibold text-stone-100';
const DEFAULT_EMPTY_WRAPPER_CLASSNAME = 'text-center py-20';
const DEFAULT_EMPTY_MESSAGE_CLASSNAME = 'text-stone-600 text-sm';
const DEFAULT_EMPTY_ACTION_CLASSNAME = 'mt-4 text-xs text-stone-500 hover:text-stone-300 underline transition-colors';
const DEFAULT_NO_RESULTS_CLASSNAME = 'text-center py-20 text-stone-600 text-sm';

/**
 * Die Trennlinien-Ueberschrift der Timeline-Gruppen — Label, danach eine Linie
 * bis zum Rand. Exportiert, weil auch ein ganzer Abschnitt so ueberschrieben
 * wird (die Bibliothek im Altar-Dashboard); dort mit Chevron und Zaehler.
 * Nicht CollapsibleGroupHeader: der hat keine Linie und traegt Kategoriezeilen,
 * nicht Abschnitte.
 */
export function GroupDivider({
  label, count, collapsed, onToggleCollapse,
}: {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const labelClass = 'text-xs font-semibold text-stone-500 uppercase tracking-wider whitespace-nowrap';
  return (
    <div className="flex items-center gap-3 mb-3">
      {onToggleCollapse && <CollapseChevron collapsed={!!collapsed} onToggle={onToggleCollapse} />}
      {onToggleCollapse
        ? <button onClick={onToggleCollapse} className={`${labelClass} transition-colors hover:text-stone-300`}>{label}</button>
        : <span className={labelClass}>{label}</span>}
      {count != null && <span className="text-xs text-stone-500">({count})</span>}
      <div className="flex-1 h-px bg-stone-700/50" />
    </div>
  );
}

export default function Dashboard<T>({
  title,
  headerLeft,
  titleClassName = DEFAULT_TITLE_CLASSNAME,
  primaryAction,
  extraActions,
  headerRight,
  headerClassName = DEFAULT_HEADER_CLASSNAME,
  view,
  sort,
  onView,
  onSort,
  viewOptions,
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
  noResultsMessage,
  noResultsClassName = DEFAULT_NO_RESULTS_CLASSNAME,
  grouping,
  contentHeader,
  contentFooter,
  cardsClassName = DEFAULT_CARDS_CLASSNAME,
  wideCardsClassName = DEFAULT_WIDE_CARDS_CLASSNAME,
  listClassName = DEFAULT_LIST_CLASSNAME,
  contentClassName = DEFAULT_CONTENT_CLASSNAME,
  contextMenuSlot,
}: DashboardProps<T>) {
  // Ohne Ansichts-Achse gibt es nur die Liste — Karten sind eine Wahl, die
  // eine solche View nicht anbietet.
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
    // Leere Gruppen fallen hier zentral weg: die Kategorienliste ist global,
    // eine für das Wiki angelegte Kategorie stünde sonst als leerer Kopf auch
    // in den Operationen.
    // Bleibt keine Gruppe übrig, greift der „Keine Ergebnisse"-Hinweis,
    // den sonst hasNoResults liefert.
    // Nicht die einzige Stelle: Tasks rendert im custom-Modus und führt
    // dieselbe Regel selbst (TasksView, `visibleCategories`).
    const groups = grouping.groups.filter((group) => group.items.length > 0);
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
  const toolbarCommon = { view, sort, onView, onSort, viewOptions, groupBy, search, onSearch };

  // Einmal gebaut, in beide Kopf-Bäume gehängt: kompakt sind diese Knöpfe
  // in beiden, ihr Label steht so oder so nur im Tooltip.
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

  const inlineHeader = (
    <>
      <div className={headerClassName}>
        {headerLeft ?? <h1 className={titleClassName}>{title}</h1>}
        {headerRight ?? (
          <div className="flex items-center gap-2">
            {primaryAction && (
              <Button onClick={primaryAction.onClick} variant="primary">
                <Plus size={14} />{primaryAction.label}
              </Button>
            )}
            {extraActionButtons}
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
          Trennlinie mit der Tab-Leiste der Eintragsliste fluchtet. Die Zeile
          gehört allein dem Titel: die Aktionen bekommen darunter eine eigene
          volle Zeile in der Scroll-Spalte — neben dem Titel bliebe von einer
          beschrifteten Primäraktion in dieser schmalen Spalte nichts
          Lesbares übrig. `headerRight` ersetzt sie — derselbe Vertrag wie
          inline —, dort kann eine breite Slot-Zeile (Trash-Bulk-Aktionen)
          umbrechen. */}
      <div className="flex items-center gap-2 px-3 h-14 border-b border-stone-700/60 flex-shrink-0 min-w-0">
        {headerLeft ?? <h1 className={`${titleClassName} truncate`}>{title}</h1>}
      </div>
      {/* Eine Einzugsquelle pro Spalte (design.md): dieselbe p-3-Spalte wie der
          Properties-Container in RightSidebar — Toolbar und FilterPanel bringen
          im vertikalen Modus kein eigenes Streifen-Chrome mit. */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {headerRight && <div className="flex flex-col gap-1.5">{headerRight}</div>}

        {/* Die Primäraktion füllt die Zeile, die Nebenaktionen bleiben daneben
            kompakt — dieselbe Reihenfolge wie inline. */}
        {!headerRight && (primaryAction || !!extraActions?.length) && (
          <div className="flex items-center gap-1.5">
            {primaryAction && (
              <Button variant="primary" onClick={primaryAction.onClick} className="flex-1 min-w-0 justify-center">
                <Plus size={14} className="flex-shrink-0" />
                <span className="truncate">{primaryAction.label}</span>
              </Button>
            )}
            {extraActionButtons}
          </div>
        )}

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

      <div className={contentClassName}>
        {contentHeader}
        {renderContent()}
        {contentFooter}
      </div>

      {contextMenuSlot}
    </div>
  );
}
