import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, type LucideIcon } from 'lucide-react';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import CardTags from '../ui/CardTags';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useDashboardEntries } from '../../hooks/useDashboardEntries';
import { useDashboardPrefs } from '../../hooks/useDashboardPrefs';
import { useEntryItems, useEntryRows } from '../../hooks/useEntryRows';
import { DEFAULT_DISPLAY, dashboardDateField } from '../../lib/dashboards';
import { categoriesUsedBy, categoryLabel, hasUncategorized, lookupCategory } from '../../lib/categories';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { countByCategory, groupByCategory, groupByMonth, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import { useTagMap, visibleTags } from '../../store/tagStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useSessionState } from '../../store/sessionStore';
import { openDashboardSettings } from '../../store/dashboardSettingsStore';
import type { Dashboard as DashboardRow, Entry } from '../../types';

/** The compact button beside "New …" that opens the dashboard's settings — name, icon, filter. */
function dashboardSettingsAction(t: (key: string) => string, id: string) {
  return { label: t('dashboards.settings'), icon: <SlidersHorizontal size={14} />, onClick: () => openDashboardSettings(id) };
}

interface EntryDashboardProps {
  /** The dashboard whose entries, filter rules, sorting and layout this is. */
  dashboard: DashboardRow | undefined;
  title: string;
  newLabel: string;
  /** "New …" — with the category of the group header's "+". */
  onNew: (categoryId?: string) => void;
  emptyState: { icon: LucideIcon; title: string; description: string };
}

/**
 * The list of a dashboard over entries: search, a category filter in the
 * sidebar, grouping by category, list, cards and timeline — the one list of
 * every dashboard. Every entry is drawn by the same rule (`entryIcon`) and
 * opens on the entry page inside this dashboard. View, sorting and grouping
 * are the dashboard's (`useDashboardPrefs`).
 */
export default function EntryDashboard({ dashboard, title, newLabel, onNew, emptyState }: EntryDashboardProps) {
  const { t } = useTranslation();
  const tagMap = useTagMap();
  const entries = useDashboardEntries(dashboard?.id);
  const categories = useCategoryStore((s) => s.categories);

  // Keys the session's search and category selection and the collapsed groups.
  const scope = `dashboard:${dashboard?.id ?? 'all'}` as const;
  const dateField = dashboardDateField(dashboard);
  const [{ view, sort, grouping }, setPrefs] = useDashboardPrefs(dashboard, dateField);
  const rows = useEntryRows({ dashboardId: dashboard?.id, dateField });
  const dateOf = rows.date;
  // Short or long info line: the dashboard's setting.
  const { render, menu } = useEntryItems(rows, entries, (dashboard?.display ?? DEFAULT_DISPLAY).info);
  const [search, setSearch] = useSessionState(`${scope}.search`, '');
  const [filterCatIds, setFilterCatIds] = useSessionState<string[]>(`${scope}.filter`, []);
  const { isCollapsed: isCatCollapsed, toggle: toggleCatCollapse } = useCollapsedSet(scope);

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  // Chips and groups only show what occurs here (plus Other); catById stays
  // the full list so foreign categories resolve.
  const usedCategories = categoriesUsedBy(categories, entries);

  // Trimmed like the collections' search: a space at the edge finds the same.
  const query = search.trim().toLowerCase();
  const searchFiltered = query
    ? entries.filter((e) =>
        e.title.toLowerCase().includes(query) ||
        visibleTags(e.tags, tagMap).some((tag) => tag.name.toLowerCase().includes(query)))
    : entries;

  const filtered = filterCatIds.length === 0
    ? searchFiltered
    : searchFiltered.filter((e) =>
        (!!e.category_id && filterCatIds.includes(e.category_id)) ||
        // The "No category" chip selects the orphans — their category_id
        // (deleted category) is never itself in the chip selection.
        (filterCatIds.includes(UNCATEGORIZED_KEY) && !lookupCategory(catById, e.category_id)));

  // "No category" only if there are orphans — or as long as the chip is still
  // selected: if it vanished under the active selection, a filter would stay
  // active that nothing displays anymore.
  const showUncatChip = hasUncategorized(categories, entries) || filterCatIds.includes(UNCATEGORIZED_KEY);
  // Counted over the search, without the category filter itself: the number
  // stays put while categories are selected and deselected.
  const catCounts = countByCategory(searchFiltered, (id) => !!lookupCategory(catById, id), (e) => e.category_id);
  const catChips = [
    ...usedCategories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji, count: catCounts.get(c.id) ?? 0 })),
    ...(showUncatChip ? [{ value: UNCATEGORIZED_KEY, label: t('categories.uncategorized'), emoji: '📄', count: catCounts.get(UNCATEGORIZED_KEY) ?? 0 }] : []),
  ];

  const sorted = sortItems(filtered, sort, { date: dateOf });
  const timelineGroups = groupByMonth(sorted, dateOf);

  const renderEntry = (e: Entry) => (isCardView(view)
    ? render(e, 'card', <CardTags tags={visibleTags(e.tags, tagMap)} />)
    : render(e, 'row'));

  // Hide deselected categories entirely instead of leaving them empty.
  const visibleCategories = filterCatIds.length > 0
    ? usedCategories.filter((c) => filterCatIds.includes(c.id))
    : usedCategories;
  // The orphan bucket catches entries whose category is in the trash —
  // otherwise they would vanish from the category grouping.
  const catGroups: DashboardGroup<Entry>[] = groupByCategory(
    sorted, visibleCategories, (e) => e.category_id,
    (c) => categoryLabel(t, c), t('categories.uncategorized'),
  );

  const renderCategoryHeader = (group: DashboardGroup<Entry>) => {
    if (group.key === UNCATEGORIZED_KEY) {
      return (
        <CollapsibleGroupHeader
          collapsed={isCatCollapsed(UNCATEGORIZED_KEY)}
          onToggleCollapse={() => toggleCatCollapse(UNCATEGORIZED_KEY)}
          emoji="📄"
          label={group.label}
          count={group.items.length}
        />
      );
    }
    const cat = catById[group.key!];
    if (!cat) return null;
    return (
      <CollapsibleGroupHeader
        emoji={cat.emoji}
        label={categoryLabel(t, cat)}
        collapsed={isCatCollapsed(cat.id)}
        onToggleCollapse={() => toggleCatCollapse(cat.id)}
        count={group.items.length}
        add={{ title: newLabel, onClick: () => onNew(cat.id) }}
      />
    );
  };

  return (
    <Dashboard<Entry>
      title={title}
      // Wrapped, not passed through: onClick supplies a MouseEvent that
      // would otherwise end up as the category.
      primaryAction={{ label: newLabel, onClick: () => onNew() }}
      extraActions={dashboard && [dashboardSettingsAction(t, dashboard.id)]}
      view={view}
      sort={sort}
      sortDate={dateField}
      onView={(v) => setPrefs({ view: v })}
      onSort={(s) => setPrefs({ sort: s })}
      groupBy={{ value: grouping, onChange: (g) => setPrefs({ grouping: g }) }}
      search={search}
      onSearch={setSearch}
      filters={{
        activeFilterCount: filterCatIds.length > 0 ? 1 : 0,
        onClearAll: () => setFilterCatIds([]),
        panelProps: {
          chipLabel: t('filters.category'),
          chips: catChips,
          selectedChips: filterCatIds,
          onChipToggle: (v) => setFilterCatIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
          onAllChips: () => setFilterCatIds([]),
          allChipsCount: searchFiltered.length,
        },
      }}
      items={sorted}
      itemKey={(e) => e.id}
      renderItem={renderEntry}
      isEmpty={entries.length === 0}
      emptyState={{ ...emptyState, actionLabel: newLabel, onAction: () => onNew() }}
      // In grouped mode Dashboard decides itself: if no group survives, it
      // shows "No results". This branch must therefore not pre-empt it.
      hasNoResults={filtered.length === 0 && !(grouping === 'grouped' && view !== 'timeline')}
      grouping={
        view === 'timeline'
          ? { mode: 'timeline', groups: timelineGroups }
          : grouping === 'grouped'
            ? {
                mode: 'category',
                groups: catGroups,
                renderGroupHeader: renderCategoryHeader,
                isGroupCollapsed: (g) => isCatCollapsed(g.key!),
              }
            : { mode: 'flat' }
      }
      contextMenuSlot={menu}
    />
  );
}
