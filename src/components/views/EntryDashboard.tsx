import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, SlidersHorizontal, Trash2, type LucideIcon } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem, { CardContent, ItemGlyph, RENAME_INPUT_CLASS, RowContent } from '../ui/DashboardItem';
import RenameField from '../ui/RenameField';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { useDashboardEntries } from '../../hooks/useDashboardEntries';
import { useDashboardPrefs } from '../../hooks/useDashboardPrefs';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { generateId } from '../../lib/helpers';
import { entryIcon } from '../../lib/entryIcon';
import { dashboardDateField, entryDateOf } from '../../lib/dashboards';
import { displayTitle } from '../../lib/entryTitle';
import { categoriesUsedBy, categoryLabel, hasUncategorized, lookupCategory } from '../../lib/categories';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { countByCategory, groupByCategory, groupByMonth, UNCATEGORIZED_KEY } from '../../lib/groupBy';
import { useUIStore } from '../../store/uiStore';
import { useEntryStore } from '../../store/entryStore';
import { useTagMap, visibleTags } from '../../store/tagStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUndoStore } from '../../store/undoStore';
import { useSessionState } from '../../store/sessionStore';
import { entryView } from '../../store/entryViews';
import { openDashboardSettings } from '../../store/dashboardSettingsStore';
import type { Dashboard as DashboardRow, Entry } from '../../types';

/** The compact button beside "New …" that opens the dashboard's settings — name, icon, filter. */
export function dashboardSettingsAction(t: (key: string) => string, id: string) {
  return { label: t('dashboards.settings'), icon: <SlidersHorizontal size={14} />, onClick: () => openDashboardSettings(id) };
}

export interface EntryDashboardProps {
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
  const setActiveView = useUIStore((s) => s.setActiveView);
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const entries = useDashboardEntries(dashboard?.id);
  const { duplicateEntry, updateEntry, deleteEntry, restoreEntry } = useEntryStore(
    useShallow((s) => ({ duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);
  const pushUndo = useUndoStore((s) => s.push);

  // Keys the session's search and category selection and the collapsed groups.
  const scope = `dashboard:${dashboard?.id ?? 'all'}` as const;
  const dateField = dashboardDateField(dashboard);
  const [{ view, sort, grouping }, setPrefs] = useDashboardPrefs(dashboard, dateField);
  const dateOf = (e: Entry) => entryDateOf(e, dateField);

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useSessionState(`${scope}.search`, '');
  const [filterCatIds, setFilterCatIds] = useSessionState<string[]>(`${scope}.filter`, []);
  const { isCollapsed: isCatCollapsed, toggle: toggleCatCollapse } = useCollapsedSet(scope);

  const openView = (e: Entry) => entryView(e.id, dashboard?.id);

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (entry: Entry) => {
    const copy = await duplicateEntry(entry.id);
    if (copy) setActiveView(openView(copy));
  };

  const startRename = (entry: Entry) => {
    setRenameValue(entry.title);
    setRenamingId(entry.id);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    if (renameValue.trim()) await updateEntry(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleDelete = async (entry: Entry) => {
    const id = entry.id;
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.entryDeleted'), undo: () => restoreEntry(id) });
  };

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  // Chips and groups only show what occurs here (plus Other); catById stays
  // the full list so foreign categories resolve.
  const usedCategories = categoriesUsedBy(categories, entries);

  const query = search.toLowerCase();
  const searchFiltered = search
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

  const renderEntry = (e: Entry) => {
    const cat = lookupCategory(catById, e.category_id);
    const icon = entryIcon(e, cat, showMoonPhase);
    // No fallback to the raw category_id: for a deleted category the label is omitted.
    const catLabel = categoryLabel(t, cat);
    // A sigil with a target date appends it — row and card alike.
    const revealDate = entryBlockSummary(e.id, e.content).sigil?.revealDate;
    const meta = [
      catLabel,
      formatEntryDate(dateOf(e)),
      revealDate ? `${t('creation.targetDate')}: ${formatEntryDate(revealDate)}` : '',
    ].filter(Boolean).join(' · ');
    const renaming = renamingId === e.id;
    const itemTitle = renaming
      ? <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename}
          onCancel={() => setRenamingId(null)} className={RENAME_INPUT_CLASS} />
      : displayTitle(t, 'entry', e.title);
    return (
      <DashboardItem
        view={openView(e)}
        layout={isCardView(view) ? 'card' : 'row'}
        editing={renaming}
        onContextMenu={(ev) => openCtxMenu(ev, e.id)}
      >
        {isCardView(view)
          ? <CardContent icon={<ItemGlyph icon={icon} large />} title={itemTitle} meta={meta} />
          : <RowContent icon={<ItemGlyph icon={icon} />} title={itemTitle} meta={meta} />}
      </DashboardItem>
    );
  };

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

  const ctxEntry = ctxMenu ? entries.find((e) => e.id === ctxMenu.id) : undefined;

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
      contextMenuSlot={ctxMenu && ctxEntry && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            openInNewTabAction(openView(ctxEntry)),
            { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxEntry) },
            saveAsTemplateAction(ctxEntry.id),
            { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: () => startRename(ctxEntry) },
            { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(ctxEntry), danger: true },
          ]}
        />
      )}
    />
  );
}
