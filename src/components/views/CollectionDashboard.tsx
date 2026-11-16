import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Dashboard, { type DashboardEmptyState, type DashboardPrimaryAction } from '../ui/Dashboard';
import DashboardItem, { CardContent, RowContent } from '../ui/DashboardItem';
import ContextMenu, { type ContextMenuAction } from '../ui/ContextMenu';
import EmptyState, { NoResults } from '../ui/EmptyState';
import type { SortDateField } from '../ui/ListToolbar';
import { sortItems } from '../../lib/sortItems';
import { groupByMonth } from '../../lib/groupBy';
import { isCardView } from '../../lib/viewMode';
import { useSessionState } from '../../store/sessionStore';
import { useUIStore, type ListPrefs, type SortMode, type ViewMode } from '../../store/uiStore';
import type { CollectionId } from '../../lib/modules';
import type { ActiveView } from '../../types';

/**
 * One collection's working state: view and sorting (per vault, through
 * `collectionPrefs`, so they survive a restart), search and filter (for the
 * session, like a dashboard's). A hook of its own so that a view can clear
 * search and filter itself (`reset`) — a deep link, a newly created item they
 * would hide.
 */
export function useCollectionState(id: CollectionId) {
  const prefs = useUIStore((s) => s.collectionPrefs[id]);
  const setCollectionPrefs = useUIStore((s) => s.setCollectionPrefs);
  const [search, setSearch] = useSessionState(`collection:${id}.search`, '');
  const [filter, setFilter] = useSessionState<string[]>(`collection:${id}.filter`, []);
  return {
    id,
    prefs,
    setPrefs: (patch: Partial<ListPrefs>) => setCollectionPrefs(id, patch),
    search,
    setSearch,
    /** The search as it is compared: trimmed, lower case. */
    query: search.trim().toLowerCase(),
    filter,
    setFilter,
    reset: () => { setSearch(''); setFilter([]); },
  };
}

export type CollectionState = ReturnType<typeof useCollectionState>;

/** A filter value of a collection: a chip in the sidebar and the test behind it. */
export interface CollectionChip<T> {
  value: string;
  label: string;
  emoji?: string;
  test: (item: T) => boolean;
}

/** How an item looks in a row and on a card, and what a click on it does:
 *  a page of its own (`view`) or a dialog (`onOpen`). */
export type CollectionItemLook = {
  icon?: ReactNode;
  /** The card's larger icon; default `icon`. */
  cardIcon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** At the end of a row, below the meta on a card ("unsaved", a count). */
  trailing?: ReactNode;
} & ({ view: ActiveView; onOpen?: undefined } | { view?: undefined; onOpen: () => void });

export interface CollectionDashboardProps<T extends object> {
  state: CollectionState;
  title: string;
  items: readonly T[];
  itemKey: (item: T) => string;
  /** The name: what the name sorts compare and the search looks at. */
  itemTitle: (item: T) => string;
  /** With a date the date sorts are on offer, and the timeline unless `noTimeline`. */
  itemDate?: (item: T) => string;
  dateField?: SortDateField;
  noTimeline?: boolean;
  /** With a count "Most used" is on offer. */
  itemCount?: (item: T) => number;
  /** The items' own order is a sort of its own (`manual`, categories). */
  manualOrder?: boolean;
  /** What the search looks at besides the name. */
  matchesSearch?: (item: T, query: string) => boolean;
  /** Chips in the sidebar; an item passes if it matches any of the selected
   *  ones — or, with `match: 'all'`, every one (pictures with all the chosen tags). */
  filter?: { label: string; chips: CollectionChip<T>[]; match?: 'any' | 'all' };
  describe: (item: T) => CollectionItemLook;
  /** The item as a whole, for collections whose item is not a plain row or card
   *  (images, a tag being renamed); `undefined` falls back to `describe`. */
  renderItem?: (item: T, layout: 'row' | 'card', openMenu: (item: T, event: React.MouseEvent) => void) => ReactNode | undefined;
  /** The list view drawn by the collection itself (tags: rows that expand; categories: drag handles).
   *  Gets the searched, filtered and sorted items; empty and "No results" are handled here. */
  renderList?: (items: T[], openMenu: (item: T, event: React.MouseEvent) => void, sort: SortMode) => ReactNode;
  /** A data attribute every item carries with its key, for the deep link that
   *  scrolls to it (`data-tag-id`) — in every view, cards included. */
  itemAttribute?: string;
  /** Items to mark as the target (a deep link's) with `row-target`. */
  highlighted?: (item: T) => boolean;
  contextActions?: (item: T) => ContextMenuAction[];
  primaryAction?: DashboardPrimaryAction;
  emptyState: DashboardEmptyState;
  /** A collapsible heading above the list: collapsed shows nothing below it. */
  collapsed?: boolean;
  /** Still loading: neither the empty state nor "No results" yet. */
  loading?: boolean;
  contentHeader?: ReactNode;
  contentFooter?: ReactNode;
  cardsClassName?: string;
}

/**
 * The one display of every collection — tags, categories, images, templates,
 * blocks, lexicon, symbols — on the same `Dashboard` as the entries: search,
 * filter chips, sorting and view (list, cards, timeline where there is a date)
 * in the right sidebar. An item opens its editor — a page or a dialog — as
 * `describe` says.
 */
export default function CollectionDashboard<T extends object>({
  state, title, items, itemKey, itemTitle, itemDate, dateField = 'updated', noTimeline, itemCount, manualOrder,
  matchesSearch, filter, describe, renderItem, renderList, itemAttribute, highlighted, contextActions, primaryAction, emptyState,
  collapsed = false, loading = false, contentHeader, contentFooter, cardsClassName,
}: CollectionDashboardProps<T>) {
  const { t } = useTranslation();
  const [ctxMenu, setCtxMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const { prefs, setPrefs, search, setSearch, query, filter: selected, setFilter, reset } = state;

  const sortModes: SortMode[] = [
    ...(manualOrder ? ['manual' as const] : []),
    ...(itemDate ? ['date_desc' as const, 'date_asc' as const] : []),
    'alpha_asc', 'alpha_desc',
    ...(itemCount ? ['count_desc' as const] : []),
  ];
  const viewOptions: { value: ViewMode; label: string }[] = [
    { value: 'list', label: t('listView.list') },
    { value: 'cards', label: t('listView.cards') },
    ...(itemDate && !noTimeline ? [{ value: 'timeline' as const, label: t('listView.timeline') }] : []),
  ];
  // A saved value this collection does not offer (another version, another
  // collection's habit) falls back to the first one on offer.
  const view = viewOptions.some((o) => o.value === prefs.view) ? prefs.view : viewOptions[0].value;
  const sort = sortModes.includes(prefs.sort) ? prefs.sort : sortModes[0];
  const timeline = view === 'timeline' && !!itemDate;

  const searched = query
    ? items.filter((item) => itemTitle(item).toLowerCase().includes(query) || !!matchesSearch?.(item, query))
    : items;
  const chips = filter?.chips ?? [];
  // A selected chip that no longer exists filters nothing.
  const activeChips = chips.filter((chip) => selected.includes(chip.value));
  const filtered = activeChips.length
    ? searched.filter((item) => (filter?.match === 'all'
      ? activeChips.every((chip) => chip.test(item))
      : activeChips.some((chip) => chip.test(item))))
    : searched;
  const sorted = sortItems(filtered, timeline ? 'date_desc' : sort, {
    date: itemDate ?? (() => ''),
    title: itemTitle,
    count: itemCount,
    tiebreak: (a, b) => itemTitle(a).localeCompare(itemTitle(b)),
  });
  // Collapsed and loading look the same: nothing below the heading.
  const hidden = collapsed || loading;
  const shown = hidden ? [] : sorted;
  const cards = isCardView(view);

  const openMenu = (item: T, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ key: itemKey(item), x: e.clientX, y: e.clientY });
  };

  const renderOne = (item: T) => {
    const own = renderLook(item);
    if (!itemAttribute && !highlighted) return own;
    // A flex wrapper, so that a card still fills its grid cell.
    return (
      <div {...(itemAttribute ? { [itemAttribute]: itemKey(item) } : {})}
        className={`flex rounded-xl ${highlighted?.(item) ? 'row-target' : ''}`}>
        {own}
      </div>
    );
  };

  const renderLook = (item: T) => {
    const layout = cards ? 'card' : 'row';
    const own = renderItem?.(item, layout, openMenu);
    if (own !== undefined) return own;
    const { view: page, onOpen, icon, cardIcon, title: itemName, meta, trailing } = describe(item);
    const target = page ? { view: page } : { onOpen: onOpen! };
    const onContextMenu = contextActions ? (e: React.MouseEvent) => openMenu(item, e) : undefined;
    const look = { icon, cardIcon, title: itemName, meta, trailing };
    return (
      <DashboardItem {...target} layout={layout} onContextMenu={onContextMenu}>
        {cards ? (
          <CardContent icon={look.cardIcon ?? look.icon} title={look.title} meta={look.meta}>
            {!!look.trailing && <div className="mt-1">{look.trailing}</div>}
          </CardContent>
        ) : (
          <>
            <RowContent icon={look.icon} title={look.title} meta={look.meta} />
            {look.trailing}
          </>
        )}
      </DashboardItem>
    );
  };

  const ctxItem = ctxMenu ? items.find((item) => itemKey(item) === ctxMenu.key) : undefined;
  const custom = !cards && !timeline && renderList;

  const common = {
    title,
    primaryAction,
    view,
    sort,
    sortModes,
    sortDate: dateField,
    viewOptions,
    onView: (v: ViewMode) => setPrefs({ view: v }),
    onSort: (s: SortMode) => setPrefs({ sort: s }),
    search,
    onSearch: setSearch,
    filters: chips.length ? {
      activeFilterCount: activeChips.length,
      onClearAll: () => setFilter([]),
      panelProps: {
        chipLabel: filter!.label,
        chips: chips.map((chip) => ({
          value: chip.value, label: chip.label, emoji: chip.emoji, count: searched.filter(chip.test).length,
        })),
        selectedChips: selected,
        onChipToggle: (v: string) => setFilter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
        onAllChips: () => setFilter([]),
        allChipsCount: searched.length,
      },
    } : undefined,
    items: shown,
    itemKey,
    contentHeader,
    contentFooter,
    cardsClassName,
    contextMenuSlot: ctxMenu && ctxItem && contextActions && (
      <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} actions={contextActions(ctxItem)} />
    ),
  };

  if (custom) {
    return (
      <Dashboard<T>
        {...common}
        grouping={{
          mode: 'custom',
          render: () => {
            if (hidden) return null;
            if (items.length === 0) return <EmptyState {...emptyState} />;
            if (filtered.length === 0) {
              return (
                <NoResults
                  query={search}
                  filtered={activeChips.length > 0}
                  onReset={reset}
                />
              );
            }
            return renderList(shown, openMenu, sort);
          },
        }}
      />
    );
  }

  return (
    <Dashboard<T>
      {...common}
      renderItem={renderOne}
      isEmpty={!hidden && items.length === 0}
      emptyState={emptyState}
      hasNoResults={!hidden && filtered.length === 0}
      grouping={timeline && !hidden
        ? { mode: 'timeline', groups: groupByMonth(shown, itemDate!) }
        : { mode: 'flat' }}
    />
  );
}
