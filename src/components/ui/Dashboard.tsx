import { Fragment, useLayoutEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import Button from './Button';
import SidebarPortal from './SidebarPortal';
import SidebarColumn, { SidebarActionBar } from './SidebarColumn';
import CollapseChevron from './CollapseChevron';
import EmptyState, { NoResults, type EmptyStateProps } from './EmptyState';
import ListToolbar, { ListSearchField } from './ListToolbar';
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
      /** Leere Gruppen stehen lassen statt sie zentral wegzufiltern — für
       *  Gruppen, die für sich etwas sind (Tags: ein unbenutzter Tag bleibt
       *  sichtbar und verwaltbar). */
      keepEmptyGroups?: boolean;
    }
  | { mode: 'custom'; render: () => ReactNode };

/** Gerendert als `EmptyState` — das `icon` ist meist das Rail-Icon der Ansicht. */
export type DashboardEmptyState = EmptyStateProps;

export interface DashboardGroupBy {
  value: GroupingMode;
  onChange: (g: GroupingMode) => void;
  /** Wonach gruppiert wird, in den Worten des Moduls — „Mondphase" im
   *  Journal, „Typ" im Papierkorb. Default: „Kategorie". */
  label?: string;
}

export interface DashboardFilters {
  activeFilterCount: number;
  panelProps: Omit<FilterPanelProps, 'activeFilterCount'>;
}

interface DashboardBaseProps<T> {
  // Kopf — Titel und Suche im Hauptbereich, Aktionen, Toolbar und Filter in
  // der rechten Seitenleiste
  /** Nur der Titel — kein Icon, keine Zahl: das Icon steht schon in der Rail,
   *  gezählt wird in den Abschnitten darunter nicht (überall gleich schlicht). */
  title?: string;
  /** Ersetzt die ganze Titelzeile — für Köpfe mit mehr als dem Titel
   *  (Home: zwei Zeilen; Papierkorb: `DashboardTitle` plus „Alle wählen"). */
  headerLeft?: ReactNode;
  /** Beschrifteter Jade-Knopf, der die Leiste oben in der Seitenleiste füllt. */
  primaryAction?: { label: string; onClick: () => void };
  /** Kompakte Icon-Knöpfe rechts neben der Primäraktion, in derselben Reihe;
   *  ihr Label steht nur im Tooltip. Für Nebenschauplätze des Moduls (Altar:
   *  die Bibliothek unter den Altären). */
  extraActions?: { label: string; icon: ReactNode; onClick: () => void }[];
  /** Ersetzt die Aktionszeile (Primär- und Nebenaktionen) — dort darf eine
   *  breite Slot-Zeile umbrechen. Trash's bulk-select. */
  headerRight?: ReactNode;

  // ListToolbar passthrough. Ansicht und Sortierung sind optional wie
  // `groupBy`: ohne Handler entfällt die jeweilige Reihe.
  view?: ViewMode;
  sort?: SortMode;
  onView?: (v: ViewMode) => void;
  onSort?: (s: SortMode) => void;
  viewOptions?: { value: ViewMode; label: string }[];
  /** Welche Sortiermodi zur Wahl stehen — Default: die vier Datums-/Alpha-Modi. */
  sortModes?: readonly SortMode[];
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

const DEFAULT_CONTENT_CLASSNAME = 'flex-1 overflow-y-auto px-8 py-6';
const DEFAULT_CARDS_CLASSNAME = 'grid grid-cols-3 gap-3';
const DEFAULT_WIDE_CARDS_CLASSNAME = 'grid grid-cols-1 gap-3';
const DEFAULT_LIST_CLASSNAME = 'space-y-1.5';

/**
 * Der Titel eines Dashboards im Hauptbereich — nur der Titel. Dashboard rendert
 * ihn selbst aus `title`; exportiert für Köpfe, die hinter ihm noch etwas
 * brauchen (`children`, der Papierkorb sein „Alle wählen") und ihn deshalb als
 * `headerLeft` bauen.
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
 * Die Trennlinien-Ueberschrift der Timeline-Gruppen — Label, danach eine Linie
 * bis zum Rand. Exportiert, weil auch ein ganzer Abschnitt so ueberschrieben
 * wird (die Bibliothek im Altar-Dashboard); dort mit Chevron. Bewusst ohne
 * Zaehler — ein Abschnitt heisst nur, gezaehlt wird nirgends im Kopf.
 * Nicht CollapsibleGroupHeader: der hat keine Linie und traegt Kategoriezeilen,
 * nicht Abschnitte.
 */
export function GroupDivider({
  label, collapsed, onToggleCollapse,
}: {
  label: string;
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
      <div className="flex-1 h-px bg-stone-700/50" />
    </div>
  );
}

export default function Dashboard<T>({
  title,
  headerLeft,
  primaryAction,
  extraActions,
  headerRight,
  view,
  sort,
  onView,
  onSort,
  viewOptions,
  sortModes,
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

  // Ein Knopf leert Suche und Filter zusammen — was davon aktiv war, ist egal.
  const activeFilterCount = filters?.activeFilterCount ?? 0;
  const canReset = !!search?.trim() || activeFilterCount > 0;
  const noResults = (
    <NoResults
      query={search}
      filtered={activeFilterCount > 0}
      onReset={canReset ? () => {
        onSearch?.('');
        filters?.panelProps.onClearAll?.();
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
    // Leere Gruppen fallen hier zentral weg (außer mit `keepEmptyGroups`): die Kategorienliste ist global,
    // eine für das Wiki angelegte Kategorie stünde sonst als leerer Kopf auch
    // in den Operationen.
    // Bleibt keine Gruppe übrig, greift der „Keine Ergebnisse"-Hinweis,
    // den sonst hasNoResults liefert.
    // Nicht die einzige Stelle: Tasks rendert im custom-Modus und führt
    // dieselbe Regel selbst (TasksView, `visibleCategories`).
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
                ? (grouping.renderEmptyGroup?.(group) ?? <p className="text-xs text-stone-700 px-1 py-1">—</p>)
                : renderItems(group.items)}
          </div>
        ))}
      </div>
    );
  };

  // Anmelden, damit RightSidebar das Portal-Ziel stellt (siehe
  // `uiStore.dashboardMounted`). Layout- statt Passiv-Effekt: Oeffnet ein
  // Klick einen Eintrag, muss die Leiste noch vor dem Zeichnen auf die
  // Aktionsleiste umschalten, sonst stuende einen Frame lang ein leerer Host da.
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

  // In der Seitenleiste ganz oben die Aktionen (`actionBar`) — `headerRight`
  // ersetzt sie im Körper; dort kann eine breite Slot-Zeile
  // (Trash-Bulk-Aktionen) umbrechen. Toolbar und FilterPanel bringen kein
  // eigenes Streifen-Chrome mit — den Einzug stellt `SidebarColumn`.
  // Die Aktionen stehen wie „Bearbeiten" eines Eintrags in der 56px-Leiste
  // mit der Trennlinie darunter: die Primäraktion füllt die Zeile, die
  // Nebenaktionen bleiben daneben kompakt.
  const actionBar = !headerRight && (primaryAction || !!extraActions?.length) ? (
    <SidebarActionBar>
      {primaryAction && (
        <Button variant="primary" onClick={primaryAction.onClick} className="flex-1 min-w-0 justify-center">
          <Plus size={14} className="flex-shrink-0" />
          <span className="truncate">{primaryAction.label}</span>
        </Button>
      )}
      {extraActionButtons}
    </SidebarActionBar>
  ) : undefined;

  const header = (
    <SidebarColumn bar={actionBar} bodyClassName="space-y-4">
      {headerRight && <div className="flex flex-col gap-1.5">{headerRight}</div>}

      <ListToolbar
        view={view}
        sort={sort}
        onView={onView}
        onSort={onSort}
        viewOptions={viewOptions}
        sortModes={sortModes}
        groupBy={groupBy}
      />

      {/* In der Seitenleiste ist Platz in der Höhe: das FilterPanel steht
          dauerhaft, statt hinter einem Auf/Zu-Knopf. */}
      {filters && (
        <FilterPanel {...filters.panelProps} activeFilterCount={filters.activeFilterCount} />
      )}
    </SidebarColumn>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Aktionen, Toolbar und Filter wohnen in der rechten Seitenleiste: Sie
          stellt in Listenansichten ein Portal-Ziel (RightSidebar →
          setListHeaderHost). Ist sie zu, fehlen sie — bewusst, die Liste
          bekommt dann die ganze Breite. Beim Zuklappen hält AppShell die Leiste für die
          200ms-Animation noch gemountet (inert); der Kopf fährt mit ihr hinaus
          und verschwindet, wenn der Host abgemeldet wird. */}
      <SidebarPortal>{header}</SidebarPortal>

      {/* Titel und Suche im Hauptbereich, in einer Zeile: der Titel links, die
          Suche 260px breit rechtsbündig. Über dem Scrollbereich, damit sie
          unabhängig vom Einzug stehen, den eine View für ihren Inhalt setzt. */}
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
