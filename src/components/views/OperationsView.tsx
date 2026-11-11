import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Pencil, Copy } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import { useOpenInNewTabAction } from '../../hooks/useOpenInNewTabAction';
import { useSaveAsTemplateAction } from '../../hooks/useSaveAsTemplateAction';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import DashboardItem, { CardContent, ItemGlyph, RENAME_INPUT_CLASS, RowContent } from '../ui/DashboardItem';
import RenameField from '../ui/RenameField';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { generateId } from '../../lib/helpers';
import { entryIcon, MODULES } from '../../lib/modules';
import { displayTitle } from '../../lib/entryTitle';
import { categoriesUsedBy, categoryLabel, hasUncategorized, lookupCategory } from '../../lib/categories';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY, countByCategory } from '../../lib/groupBy';
import { useUIStore } from '../../store/uiStore';
import { useEntryStore } from '../../store/entryStore';
import { useTagMap, visibleTags } from '../../store/tagStore';
import type { Entry } from '../../types';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import { EDIT_ENDED, useEntryEditor } from '../../hooks/useEntryEditor';
import { useEntryContentReady } from '../../hooks/useEntryContentReady';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';

export default function OperationsView() {
  const { t } = useTranslation();
  const tagMap = useTagMap();
  const { activeView, setActiveView, operationsPrefs, setOperationsPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, operationsPrefs: s.operationsPrefs, setOperationsPrefs: s.setOperationsPrefs }))
  );
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { operations, duplicateEntry, updateEntry, deleteEntry, restoreEntry, getEntry } = useEntryStore(
    useShallow((s) => ({ operations: s.entries.operation, duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry, getEntry: s.getEntry }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const operation = activeView.id ? getEntry(activeView.id, 'operation') : null;
  // Startup loads content after the lists: until it arrives, the frame with
  // the title is shown, and the block stack only mounts with the real content.
  const contentReady = useEntryContentReady(operation?.id);
  // A loaded sigil with the "whole entry" lock never opens in edit
  // mode — no matter where that comes from (sidebar, home, tab).
  const locked = !!operation && !!entryBlockSummary(operation.id, operation.content).sigil?.lockEntry;
  const isEditing = activeView.mode === 'edit' && !locked;

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useSessionState('operations.search', '');
  const [filterCatIds, setFilterCatIds] = useSessionState<string[]>('operations.filter', []);
  const { isCollapsed: isCatCollapsed, toggle: toggleCatCollapse } = useCollapsedSet('operations');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedOperationId, setLoadedOperationId] = useState<string | null>(null);

  const [editorEpoch, setEditorEpoch] = useState(0);

  const fieldsOf = (o: NonNullable<typeof operation>) => ({
    title: o.title, content: o.content, tags: o.tags ?? [],
    category_id: o.category_id ?? null, icon: o.icon, cover_image: o.cover_image,
  });

  const { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange } = useEntryEditor({
    scope: 'operations',
    entityId: operation?.id,
    isEditing,
    ready: !!operation && loadedOperationId === operation.id,
    // The category belongs to the properties panel (saved immediately) and is
    // therefore not in the patch: an autosave right after the change would
    // otherwise write the old state back.
    buildPatch: (content) => ({ title, content, tags }),
    // Cancel restores the operation as it was on entering edit mode —
    // including what the sidebar has saved in the meantime.
    buildRestorePatch: (content) => ({
      title, content, tags,
      category_id: operation?.category_id ?? null, icon: operation?.icon, cover_image: operation?.cover_image,
    }),
    readStored: (id) => {
      const stored = getEntry(id, 'operation');
      return stored ? fieldsOf(stored) : null;
    },
    readStamp: (id) => getEntry(id, 'operation')?.updated_at,
    update: updateEntry,
  });

  useEffect(() => {
    if (operation && contentReady) {
      setTitle(operation.title);
      contentRef.current = operation.content;
      setTags(operation.tags ?? []);
      setLoadedOperationId(operation.id);
    } else {
      setLoadedOperationId(null);
    }
  }, [operation?.id, contentReady]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (operation) {
      setTags(operation.tags ?? []);
    }
  }, [operation?.tags]);

  // The title likewise: a rename from the sidebar while edit mode is open
  // would otherwise be reverted by the next autosave.
  useEffect(() => {
    if (operation) setTitle(operation.title);
  }, [operation?.title]);

  const handleNew = () => createItem('operations');

  // The "+" button on the category header — like handleCreateTask(cat.id) in TasksView.
  const handleNewInCategory = (categoryId: string) => createItem('operations', { categoryId });

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const newOp = await duplicateEntry(id);
    if (newOp) setActiveView({ type: 'operations', id: newOp.id, mode: 'view' });
  };

  const startRename = (id: string) => {
    const src = operations.find((o) => o.id === id);
    if (!src) return;
    setRenameValue(src.title);
    setRenamingId(id);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    if (renameValue.trim()) await updateEntry(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleCtxDelete = async (id: string) => {
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreEntry(id) });
    if (activeView.id === id) setActiveView({ type: 'operations' });
  };

  const handleDone = async () => {
    if (!operation) return;
    cancelAutoSave();
    await updateEntry(operation.id, { title, content: contentRef.current, tags });
    setActiveView({ type: 'operations', id: operation.id, mode: 'view' });
  };

  const handleCancel = async () => {
    // An operation never confirmed with "Done" goes to the trash, like any deleted one.
    if (activeView.isNew && operation) return handleDelete();
    cancelAutoSave();
    if (operation) {
      // Not back to the store state — after the first debounced autosave
      // the store IS the edited state. restoreOnCancel writes back the state
      // of the operation remembered on entering edit mode; the setters
      // here handle the case before the first autosave (store unchanged,
      // sync effects do not run).
      const restored = await restoreOnCancel();
      // The page no longer shows this entry, editing has already ended — nothing left to do.
      if (restored === EDIT_ENDED) return;
      const from = restored ?? fieldsOf(operation);
      setTitle(from.title);
      setTags(from.tags);
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'operations', id: operation!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!operation) return;
    // Write what is still deferred first: the trash holds the latest state.
    await flushAutoSave().catch(console.error);
    const id = operation.id;
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreEntry(id) });
    setActiveView({ type: 'operations' });
  };

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete, flush: flushAutoSave,
    guard: operation ? {
      key: guardKey('operations', operation.id),
      title: () => title.trim() || getEntry(operation.id, 'operation')?.title.trim() || t('operations.untitled'),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  // List view
  if (!operation) {
    const { view, sort, grouping } = operationsPrefs;
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
    // Chips and groups only show what occurs among the operations (plus
    // Other); catById stays the full list so foreign categories resolve.
    const usedCategories = categoriesUsedBy(categories, operations);

    const searchFiltered = search
      ? operations.filter((o) =>
          o.title.toLowerCase().includes(search.toLowerCase()) ||
          visibleTags(o.tags, tagMap).some((tag) => tag.name.toLowerCase().includes(search.toLowerCase()))
        )
      : operations;

    const filtered = filterCatIds.length === 0
      ? searchFiltered
      : searchFiltered.filter((o) =>
          (!!o.category_id && filterCatIds.includes(o.category_id)) ||
          // The "No category" chip selects the orphans — their category_id
          // (deleted category) is never itself in the chip selection.
          (filterCatIds.includes(UNCATEGORIZED_KEY) && !lookupCategory(catById, o.category_id)));

    const catName = (c: typeof categories[0]) => categoryLabel(t, c);

    // Only the categories used here (plus Other and one just
    // created) — the list is global, the other modules should not leave
    // empty chips here.
    // "No category" only if there are orphans — or as long as the chip is
    // still selected: if it vanished under the active selection, a filter
    // would stay active that nothing displays anymore.
    const showUncatChip = hasUncategorized(categories, operations) || filterCatIds.includes(UNCATEGORIZED_KEY);
    // Counted over the search, without the category filter itself: the number
    // stays put while categories are selected and deselected.
    const catCounts = countByCategory(searchFiltered, (id) => !!lookupCategory(catById, id), (o) => o.category_id);
    const catChips = [
      ...usedCategories.map((c) => ({ value: c.id, label: catName(c), emoji: c.emoji, count: catCounts.get(c.id) ?? 0 })),
      ...(showUncatChip ? [{ value: UNCATEGORIZED_KEY, label: t('categories.uncategorized'), emoji: '📄', count: catCounts.get(UNCATEGORIZED_KEY) ?? 0 }] : []),
    ];

    const activeFilterCount = filterCatIds.length > 0 ? 1 : 0;

    const sortedOps = sortItems(filtered, sort, { date: (o) => o.updated_at });

    const timelineGroups = groupByMonth(sortedOps, (o) => o.updated_at);

    const renderOp = (op: typeof operations[0]) => {
      const cat = lookupCategory(catById, op.category_id);
      const iconValue = entryIcon('operation', op, cat);
      const catDisplayName = cat ? catName(cat) : '';
      // A sigil with a target date appends it — row and card alike.
      const revealDate = entryBlockSummary(op.id, op.content).sigil?.revealDate;
      const dateStr = [
        catDisplayName,
        formatEntryDate(op.updated_at),
        revealDate ? `${t('creation.targetDate')}: ${formatEntryDate(revealDate)}` : '',
      ].filter(Boolean).join(' · ');
      const renaming = renamingId === op.id;
      const title = renaming
        ? <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename}
            onCancel={() => setRenamingId(null)} className={RENAME_INPUT_CLASS} />
        : displayTitle(t, 'operation', op.title);
      return (
        <DashboardItem
          view={{ type: 'operations', id: op.id, mode: 'view' }}
          layout={isCardView(view) ? 'card' : 'row'}
          editing={renaming}
          onContextMenu={(e) => openCtxMenu(e, op.id)}
        >
          {isCardView(view)
            ? <CardContent icon={<ItemGlyph icon={iconValue} large />} title={title} meta={dateStr} />
            : <RowContent icon={<ItemGlyph icon={iconValue} />} title={title} meta={dateStr} />}
        </DashboardItem>
      );
    };

    // Hide deselected categories entirely instead of leaving them empty —
    // like visibleCategories in TasksView.
    const visibleCategories = filterCatIds.length > 0
      ? usedCategories.filter((c) => filterCatIds.includes(c.id))
      : usedCategories;
    // The orphan bucket catches operations whose category is in the trash —
    // otherwise they would vanish from the category grouping.
    const catGroups: DashboardGroup<Entry>[] = groupByCategory(
      sortedOps, visibleCategories, (o) => o.category_id,
      catName, t('categories.uncategorized'),
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
          add={{ title: t('operations.new'), onClick: () => handleNewInCategory(cat.id) }}
        />
      );
    };

    return (
      <Dashboard<Entry>
        title={t('nav.operations')}
        primaryAction={{ label: t('operations.new'), onClick: handleNew }}
        view={view}
        sort={sort}
        sortDate="updated"
        onView={(v) => setOperationsPrefs({ view: v })}
        onSort={(s) => setOperationsPrefs({ sort: s })}
        groupBy={{ value: grouping, onChange: (g) => setOperationsPrefs({ grouping: g }) }}
        search={search}
        onSearch={setSearch}
        filters={{
          activeFilterCount,
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
        items={sortedOps}
        itemKey={(o) => o.id}
        renderItem={renderOp}
        isEmpty={operations.length === 0}
        emptyState={{
          icon: MODULES.operations.icon,
          title: t('emptyState.operations.title'),
          description: t('emptyState.operations.description'),
          actionLabel: t('operations.new'),
          onAction: handleNew,
        }}
        // In grouped mode Dashboard decides itself: if no group survives,
        // it shows "No results". This branch must therefore not
        // pre-empt it.
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
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              openInNewTabAction({ type: 'operations', id: ctxMenu.id, mode: 'view' }),
              // Sigil operations used to be excluded here because duplicating
              // lost the drawing. Since sigils are blocks in the content,
              // duplicateEntry copies them along — the exception is gone.
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              saveAsTemplateAction('operation', ctxMenu.id),
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      />
    );
  }

  return (
    <EntryDetailFrame
      module="operations"
      isEditing={isEditing}
      meta={formatEntryDate(operation.updated_at)}
      title={isEditing ? title : operation.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      // Cover image — read mode hero (deliberately after the title, unlike in the wiki)
      belowTitle={!isEditing && operation.cover_image && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img src={operation.cover_image} alt="" className="w-full max-h-48 object-cover rounded-lg border border-edge" />
        </div>
      )}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedOperationId === operation.id && (
        <BlockStack
          key={`${operation.id}:${editorEpoch}`}
          entryId={operation.id}
          initialContent={operation.content}
          placeholder={t('operations.placeholder')}
          onChange={handleContentChange}
          onReadModeChange={(content) => updateEntry(operation.id, { content })}
          isEditing={isEditing}
          templateTarget={{ entryType: 'operation', flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
