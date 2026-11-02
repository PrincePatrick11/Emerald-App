import { useState, useEffect } from 'react';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
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
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { isCardView } from '../../lib/viewMode';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY, countByCategory } from '../../lib/groupBy';

import { useUIStore } from '../../store/uiStore';
import { EDIT_ENDED, useEntryEditor } from '../../hooks/useEntryEditor';
import { useEntryContentReady } from '../../hooks/useEntryContentReady';
import { useEditActions } from '../../hooks/useEditActions';
import { guardKey } from '../../store/leaveGuardStore';
import { useEntryStore } from '../../store/entryStore';
import { useTagMap, visibleTags } from '../../store/tagStore';
import { useCategoryStore } from '../../store/categoryStore';
import { useUndoStore } from '../../store/undoStore';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import BlockStack from '../blocks/BlockStack';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import { useSessionState } from '../../store/sessionStore';
import { createItem } from '../../lib/createItem';

export default function WikiView() {
  const { t } = useTranslation();
  const tagMap = useTagMap();
  const { activeView, setActiveView, wikiPrefs, setWikiPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, wikiPrefs: s.wikiPrefs, setWikiPrefs: s.setWikiPrefs }))
  );
  const openInNewTabAction = useOpenInNewTabAction();
  const saveAsTemplateAction = useSaveAsTemplateAction();
  const { articles, duplicateEntry, updateEntry, deleteEntry, restoreEntry, getEntry } = useEntryStore(
    useShallow((s) => ({ articles: s.entries.wiki, duplicateEntry: s.duplicateEntry, updateEntry: s.updateEntry, deleteEntry: s.deleteEntry, restoreEntry: s.restoreEntry, getEntry: s.getEntry }))
  );
  const categories = useCategoryStore((s) => s.categories);
  const pushUndo = useUndoStore((s) => s.push);

  const article = activeView.id ? getEntry(activeView.id, 'wiki') : null;
  // Startup loads content after the lists: until it arrives, the frame with
  // the title is shown, and the block stack only mounts with the real content.
  const contentReady = useEntryContentReady(article?.id);
  // A loaded sigil with the "whole entry" lock never opens in edit mode.
  const locked = !!article && !!entryBlockSummary(article.id, article.content).sigil?.lockEntry;
  const isEditing = activeView.mode === 'edit' && !locked;

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useSessionState('wiki.search', '');
  const [filterCatIds, setFilterCatIds] = useSessionState<string[]>('wiki.filter', []);
  const { isCollapsed: isCatCollapsed, toggle: toggleCatCollapse } = useCollapsedSet('wiki');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [loadedArticleId, setLoadedArticleId] = useState<string | null>(null);

  const [editorEpoch, setEditorEpoch] = useState(0);

  const fieldsOf = (a: NonNullable<typeof article>) => ({
    title: a.title, content: a.content, tags: a.tags ?? [],
    category_id: a.category_id ?? null, icon: a.icon, cover_image: a.cover_image,
  });

  const { triggerAutoSave, cancelAutoSave, flushAutoSave, restoreOnCancel, isDirty, contentRef, handleContentChange } = useEntryEditor({
    scope: 'wiki',
    entityId: article?.id,
    isEditing,
    ready: !!article && loadedArticleId === article.id,
    // Category, cover and icon belong to the properties panel (saved
    // immediately) and are therefore not in the patch: an autosave right after
    // a panel change would otherwise write the local state back before the
    // sync effect ran.
    buildPatch: (content) => ({ title, content, tags }),
    // Cancel restores the article as it was on entering edit mode —
    // including what the sidebar has saved in the meantime.
    buildRestorePatch: (content) => ({
      title, content, tags,
      category_id: article?.category_id ?? null, icon: article?.icon, cover_image: article?.cover_image,
    }),
    readStored: (id) => {
      const stored = getEntry(id, 'wiki');
      return stored ? fieldsOf(stored) : null;
    },
    readStamp: (id) => getEntry(id, 'wiki')?.updated_at,
    update: updateEntry,
  });

  useEffect(() => {
    if (article && contentReady) {
      setTitle(article.title);
      contentRef.current = article.content;
      setTags(article.tags ?? []);
      setCoverImage(article.cover_image ?? null);
      setLoadedArticleId(article.id);
    } else {
      setLoadedArticleId(null);
    }
  }, [article?.id, contentReady]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (article) {
      setTags(article.tags ?? []);
      setCoverImage(article.cover_image ?? null);
    }
  }, [article?.tags, article?.cover_image]);

  // The title likewise: a rename from the sidebar while edit mode is open
  // would otherwise be reverted by the next autosave.
  useEffect(() => {
    if (article) setTitle(article.title);
  }, [article?.title]);

  const handleDone = async () => {
    if (!article) return;
    cancelAutoSave();
    await updateEntry(article.id, { title, content: contentRef.current, tags });
    setActiveView({ type: 'wiki', id: article.id, mode: 'view' });
  };

  const handleCancel = async () => {
    // An article never confirmed with "Done" goes to the trash, like any deleted one.
    if (activeView.isNew && article) return handleDelete();
    cancelAutoSave();
    if (article) {
      // Not back to the store state — after the first debounced autosave
      // the store IS the edited state. restoreOnCancel writes back the state
      // of the article remembered on entering edit mode; the setters
      // here handle the case before the first autosave (store unchanged,
      // sync effects do not run).
      const restored = await restoreOnCancel();
      // The page no longer shows this entry, editing has already ended — nothing left to do.
      if (restored === EDIT_ENDED) return;
      const from = restored ?? fieldsOf(article);
      setTitle(from.title);
      setTags(from.tags);
      setCoverImage(from.cover_image ?? null);
      contentRef.current = from.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'wiki', id: article!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!article) return;
    // Write what is still deferred first: the trash holds the latest state.
    await flushAutoSave().catch(console.error);
    const id = article.id;
    await deleteEntry(id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreEntry(id) });
    setActiveView({ type: 'wiki' });
  };

  useEditActions(isEditing, {
    onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete, flush: flushAutoSave,
    guard: article ? {
      key: guardKey('wiki', article.id),
      title: () => title.trim() || getEntry(article.id, 'wiki')?.title.trim() || t('wiki.untitled'),
      isDirty: () => isDirty(!!activeView.isNew),
    } : undefined,
  });

  // Without an argument the article is created without a category; the "+"
  // button on the category header passes its category — like handleCreateTask(cat.id).
  const handleNew = (categoryId?: string) => createItem('wiki', { categoryId });

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const newArt = await duplicateEntry(id);
    if (newArt) setActiveView({ type: 'wiki', id: newArt.id, mode: 'view' });
  };

  const startRename = (id: string) => {
    const src = articles.find((a) => a.id === id);
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
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreEntry(id) });
    if (activeView.id === id) setActiveView({ type: 'wiki' });
  };

  if (!article) {
    const { view, sort, grouping } = wikiPrefs;
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
    // Chips and groups only show what occurs in the wiki (plus Other);
    // catById stays the full list so foreign categories resolve.
    const usedCategories = categoriesUsedBy(categories, articles);

    const searchFiltered = search
      ? articles.filter((a) =>
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          visibleTags(a.tags, tagMap).some((tag) => tag.name.toLowerCase().includes(search.toLowerCase()))
        )
      : articles;

    const catFiltered = filterCatIds.length === 0
      ? searchFiltered
      : searchFiltered.filter((a) =>
          (!!a.category_id && filterCatIds.includes(a.category_id)) ||
          // The "No category" chip selects the orphans — their category_id
          // (deleted category) is never itself in the chip selection.
          (filterCatIds.includes(UNCATEGORIZED_KEY) && !lookupCategory(catById, a.category_id)));

    const filtered = catFiltered;

    // Only the categories used here — the list is global, the other
    // modules should not leave empty chips here.
    // "No category" only if there are orphans — or as long as the chip is
    // still selected: if it vanished under the active selection, a filter
    // would stay active that nothing displays anymore.
    const showUncatChip = hasUncategorized(categories, articles) || filterCatIds.includes(UNCATEGORIZED_KEY);
    // Counted over the search, without the category filter itself: the number
    // stays put while categories are selected and deselected.
    const catCounts = countByCategory(searchFiltered, (id) => !!lookupCategory(catById, id), (a) => a.category_id);
    const catChips = [
      ...usedCategories.map((c) => ({ value: c.id, label: categoryLabel(t, c), emoji: c.emoji, count: catCounts.get(c.id) ?? 0 })),
      ...(showUncatChip ? [{ value: UNCATEGORIZED_KEY, label: t('categories.uncategorized'), emoji: '📄', count: catCounts.get(UNCATEGORIZED_KEY) ?? 0 }] : []),
    ];

    const activeFilterCount = filterCatIds.length > 0 ? 1 : 0;

    // By the date the row shows — "last modified", as on Home and in the left list.
    const sortedArticles = sortItems(filtered, sort, { date: (a) => a.updated_at });
    const timelineGroups = groupByMonth(sortedArticles, (a) => a.updated_at);

    const renderArticle = (a: typeof articles[0]) => {
      const cat = lookupCategory(catById, a.category_id);
      const icon = entryIcon('wiki', a, cat);
      // No fallback to the raw category_id: for a deleted category its id
      // would otherwise appear here as the label (as in OperationsView it is then omitted).
      const catLabel = categoryLabel(t, cat);
      const dateStr = `${catLabel}${catLabel ? ' · ' : ''}${formatEntryDate(a.updated_at)}`;
      const renaming = renamingId === a.id;
      const title = renaming
        ? <RenameField value={renameValue} onChange={setRenameValue} onCommit={commitRename}
            onCancel={() => setRenamingId(null)} className={RENAME_INPUT_CLASS} />
        : displayTitle(t, 'wiki', a.title);
      return (
        <DashboardItem
          view={{ type: 'wiki', id: a.id, mode: 'view' }}
          layout={isCardView(view) ? 'card' : 'row'}
          editing={renaming}
          onContextMenu={(e) => openCtxMenu(e, a.id)}
        >
          {isCardView(view)
            ? <CardContent icon={<ItemGlyph icon={icon} large />} title={title} meta={dateStr} />
            : <RowContent icon={<ItemGlyph icon={icon} />} title={title} meta={dateStr} />}
        </DashboardItem>
      );
    };

    type Article = typeof articles[number];

    // Hide deselected categories entirely instead of leaving them empty —
    // like visibleCategories in TasksView.
    const visibleCategories = filterCatIds.length > 0
      ? usedCategories.filter((c) => filterCatIds.includes(c.id))
      : usedCategories;
    // The orphan bucket catches articles whose category is in the trash —
    // otherwise they would vanish from the category grouping.
    const catGroups: DashboardGroup<Article>[] = groupByCategory(
      sortedArticles, visibleCategories, (a) => a.category_id,
      (c) => categoryLabel(t, c), t('categories.uncategorized'),
    );

    const renderCategoryHeader = (group: DashboardGroup<Article>) => {
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
          add={{ title: t('wiki.newArticle'), onClick: () => handleNew(cat.id) }}
        />
      );
    };

    return (
      <Dashboard<Article>
        title={t('wiki.title')}
        // Wrapped, not passed through: onClick supplies a MouseEvent that
        // would otherwise end up as categoryId in handleNew.
        primaryAction={{ label: t('wiki.newArticle'), onClick: () => handleNew() }}
        view={view}
        sort={sort}
        sortDate="updated"
        onView={(v) => setWikiPrefs({ view: v })}
        onSort={(s) => setWikiPrefs({ sort: s })}
        groupBy={{ value: grouping, onChange: (g) => setWikiPrefs({ grouping: g }) }}
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
        items={sortedArticles}
        itemKey={(a) => a.id}
        renderItem={renderArticle}
        isEmpty={articles.length === 0}
        emptyState={{
          icon: MODULES.wiki.icon,
          title: t('emptyState.wiki.title'),
          description: t('emptyState.wiki.description'),
          actionLabel: t('wiki.newArticle'),
          onAction: () => handleNew(),
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
              openInNewTabAction({ type: 'wiki', id: ctxMenu.id, mode: 'view' }),
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              saveAsTemplateAction('wiki', ctxMenu.id),
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
      module="wiki"
      isEditing={isEditing}
      meta={formatEntryDate(article.updated_at)}
      aboveTitle={!isEditing && coverImage && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img
            src={coverImage}
            alt=""
            className="w-full max-h-48 object-cover rounded-lg border border-edge"
          />
        </div>
      )}
      title={isEditing ? title : article.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedArticleId === article.id && (
        <BlockStack
          key={`${article.id}:${editorEpoch}`}
          entryId={article.id}
          initialContent={article.content}
          placeholder={t('wiki.placeholder')}
          onChange={handleContentChange}
          onReadModeChange={(content) => updateEntry(article.id, { content })}
          isEditing={isEditing}
          templateTarget={{ entryType: 'wiki', flush: flushAutoSave }}
        />
      )}
    </EntryDetailFrame>
  );
}
