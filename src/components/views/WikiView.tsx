import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Pencil, Copy, PanelTopOpen } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import CategoryHeaderRow from '../ui/CategoryHeaderRow';
import CategoryAddRow from '../ui/CategoryAddRow';
import CollapsibleGroupHeader from '../ui/CollapsibleGroupHeader';
import { generateId, isImageIcon } from '../../lib/helpers';
import { categoryLabel } from '../../lib/categories';
import { formatEntryDate } from '../../lib/formatDate';
import { sortItems } from '../../lib/sortItems';
import { groupByCategory, groupByMonth, UNCATEGORIZED_KEY } from '../../lib/groupBy';

import { useUIStore } from '../../store/uiStore';
import { useEntryEditor } from '../../hooks/useEntryEditor';
import { useEditActions } from '../../hooks/useEditActions';
import { useWikiStore } from '../../store/wikiStore';
import { useUndoStore } from '../../store/undoStore';
import { useCategoryEditor } from '../../hooks/useCategoryEditor';
import { useCollapsedSet } from '../../hooks/useCollapsedSet';
import RichEditor from '../editor/RichEditor';
import EntryDetailFrame from '../ui/EntryDetailFrame';
import { getCategoryEmoji } from '../wiki/WikiList';
import type { WikiCategory } from '../../types';


export default function WikiView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab, wikiPrefs, setWikiPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, openViewInNewTab: s.openViewInNewTab, wikiPrefs: s.wikiPrefs, setWikiPrefs: s.setWikiPrefs }))
  );
  const { articles, wikiCategories, createArticle, duplicateArticle, updateArticle, deleteArticle, restoreArticle, getArticle, addWikiCategory, updateWikiCategory, deleteWikiCategory, restoreWikiCategory, } = useWikiStore(
    useShallow((s) => ({ articles: s.articles, wikiCategories: s.wikiCategories, createArticle: s.createArticle, duplicateArticle: s.duplicateArticle, updateArticle: s.updateArticle, deleteArticle: s.deleteArticle, restoreArticle: s.restoreArticle, getArticle: s.getArticle, addWikiCategory: s.addWikiCategory, updateWikiCategory: s.updateWikiCategory, deleteWikiCategory: s.deleteWikiCategory, restoreWikiCategory: s.restoreWikiCategory }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const article = activeView.id ? getArticle(activeView.id) : null;
  const isEditing = activeView.mode === 'edit';

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCatIds, setFilterCatIds] = useState<string[]>([]);
  const { collapsed: collapsedCats, toggle: toggleCatCollapse } = useCollapsedSet('wiki');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<WikiCategory>('other');
  const [tags, setTags] = useState<string[]>([]);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [loadedArticleId, setLoadedArticleId] = useState<string | null>(null);

  const [editorEpoch, setEditorEpoch] = useState(0);

  const { triggerAutoSave, cancelAutoSave, contentRef, handleContentChange } = useEntryEditor({
    entityId: article?.id,
    isEditing,
    ready: !!article && loadedArticleId === article.id,
    buildPatch: (content) => ({ title, content, category_id: category, tags, cover_image: coverImage ?? undefined, icon: icon ?? undefined }),
    update: updateArticle,
  });

  const catEditor = useCategoryEditor(
    { addCategory: addWikiCategory, updateCategory: updateWikiCategory, deleteCategory: deleteWikiCategory, restoreCategory: restoreWikiCategory },
    {
      defaultEmoji: '📄',
      onAdded: (cat) => { setCategory(cat.id); triggerAutoSave(); },
    },
  );

  useEffect(() => {
    if (article) {
      setTitle(article.title);
      contentRef.current = article.content;
      setCategory(article.category_id);
      setTags(article.tags ?? []);
      setCoverImage(article.cover_image ?? null);
      setIcon(article.icon ?? null);
      setLoadedArticleId(article.id);
    } else {
      setLoadedArticleId(null);
    }
  }, [article?.id]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (article) {
      setTags(article.tags ?? []);
      setCategory(article.category_id);
      setCoverImage(article.cover_image ?? null);
      setIcon(article.icon ?? null);
    }
  }, [article?.tags, article?.category_id, article?.cover_image, article?.icon]);

  // Titel ebenso: ein Rename aus der Sidebar bei offenem Edit-Modus wuerde
  // sonst vom naechsten Autosave zurueckgedreht.
  useEffect(() => {
    if (article) setTitle(article.title);
  }, [article?.title]);

  // Apply tags from a dropped routine
  useEffect(() => {
    if (!isEditing || !article) return;
    const handler = (e: Event) => {
      const { tags: routineTags } = (e as CustomEvent<{ tags: string[] }>).detail;
      setTags((prev) => {
        const nextTags = [...new Set([...prev, ...routineTags])];
        triggerAutoSave();
        return nextTags;
      });
    };
    document.addEventListener('routine-drop', handler);
    return () => document.removeEventListener('routine-drop', handler);
  }, [isEditing, article?.id, triggerAutoSave]);

  const handleDone = async () => {
    if (!article) return;
    cancelAutoSave();
    await updateArticle(article.id, { title, content: contentRef.current, category_id: category, tags, cover_image: coverImage ?? undefined, icon: icon ?? undefined });
    setActiveView({ type: 'wiki', id: article.id, mode: 'view' });
  };

  const handleCancel = () => {
    cancelAutoSave();
    if (article) {
      setTitle(article.title);
      setCategory(article.category_id);
      setTags(article.tags ?? []);
      setCoverImage(article.cover_image ?? null);
      setIcon(article.icon ?? null);
      contentRef.current = article.content;
      setEditorEpoch((e) => e + 1);
    }
    setActiveView({ type: 'wiki', id: article!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!article) return;
    cancelAutoSave();
    const id = article.id;
    await deleteArticle(id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreArticle(id) });
    setActiveView({ type: 'wiki' });
  };

  useEditActions(isEditing, { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });

  const handleNew = async () => {
    const a = await createArticle();
    setActiveView({ type: 'wiki', id: a.id, mode: 'edit' });
  };

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const newArt = await duplicateArticle(id);
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
    if (renameValue.trim()) await updateArticle(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleCtxDelete = async (id: string) => {
    await deleteArticle(id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreArticle(id) });
    if (activeView.id === id) setActiveView({ type: 'wiki' });
  };

  const enterEditMode = () => {
    if (!isEditing && article) setActiveView({ type: 'wiki', id: article.id, mode: 'edit' });
  };

  if (!article) {
    const { view, sort } = wikiPrefs;
    const catById = Object.fromEntries(wikiCategories.map((c) => [c.id, c]));

    const searchFiltered = search
      ? articles.filter((a) =>
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          a.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
        )
      : articles;

    const catFiltered = filterCatIds.length === 0
      ? searchFiltered
      : searchFiltered.filter((a) =>
          filterCatIds.includes(a.category_id) ||
          // Der „Ohne Kategorie"-Chip wählt die Waisen aus — deren category_id
          // (gelöschte Kategorie) steht nie selbst in der Chip-Auswahl.
          (filterCatIds.includes(UNCATEGORIZED_KEY) && !catById[a.category_id]));

    const filtered = catFiltered;

    // Alle Kategorien anbieten, auch leere — die Leiste ist auch der Weg, sich
    // gezielt EINE Kategorie anzeigen zu lassen, nicht nur ein Ausschlussfilter.
    // „Ohne Kategorie" nur, wenn es tatsächlich Waisen gibt.
    const catChips = [
      ...wikiCategories.map((c) => ({ value: c.id, label: categoryLabel(t, 'wiki', c), emoji: c.emoji })),
      ...(articles.some((a) => !catById[a.category_id])
        ? [{ value: UNCATEGORIZED_KEY, label: t('wiki.uncategorized'), emoji: '📄' }]
        : []),
    ];

    const activeFilterCount = filterCatIds.length > 0 ? 1 : 0;

    const sortedArticles = sortItems(filtered, sort, {
      date: (a) => a.created_at,
      // Bewusste Korrektur: vorher wurde die rohe category_id verglichen,
      // sortiert wird jetzt nach dem angezeigten Kategorienamen.
      category: (a) => catById[a.category_id]?.name ?? '',
    });


    // For timeline (by month)
    const timelineGroups = groupByMonth(sortedArticles, (a) => a.created_at);

    const renderArticle = (a: typeof articles[0]) => {
      const cat = catById[a.category_id];
      const iconEl = isImageIcon(a.icon) ? <img src={a.icon!} alt="" className="w-5 h-5 object-cover rounded inline" /> : (cat?.emoji ?? '📄');
      // Ohne Fallback auf die rohe category_id: bei gelöschter Kategorie stünde
      // hier sonst deren id als Label (wie in OperationsView entfällt es dann).
      const catLabel = categoryLabel(t, 'wiki', cat);
      const dateStr = `${catLabel}${catLabel ? ' · ' : ''}${formatEntryDate(a.updated_at)}`;
      if (renamingId === a.id) return (
        <div key={a.id} className={view === 'cards' ? 'panel-interactive px-4 py-4 text-left' : 'panel-interactive w-full flex items-center gap-3 px-4 py-3'}>
          {view === 'cards' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                {isImageIcon(a.icon) ? <img src={a.icon!} alt="" className="w-6 h-6 object-cover rounded" /> : <span className="text-xl">{cat?.emoji ?? '📄'}</span>}
              </div>
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1" />
              <div className="text-xs text-parchment-500/70">{dateStr}</div>
            </>
          ) : (
            <>
              <span className="text-base flex-shrink-0">{iconEl}</span>
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable" />
              <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
            </>
          )}
        </div>
      );
      return (
        <button
          key={a.id}
          onClick={() => setActiveView({ type: 'wiki', id: a.id, mode: 'view' })}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              openViewInNewTab({ type: 'wiki', id: a.id, mode: 'view' });
            }
          }}
          onContextMenu={(e) => openCtxMenu(e, a.id)}
          className={view === 'cards'
            ? 'panel-interactive px-4 py-4 text-left'
            : 'panel-interactive w-full text-left flex items-center gap-3 px-4 py-3 group'
          }
        >
          {view === 'cards' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                {isImageIcon(a.icon) ? <img src={a.icon!} alt="" className="w-6 h-6 object-cover rounded" /> : <span className="text-xl">{cat?.emoji ?? '📄'}</span>}
              </div>
              <div className="text-sm font-medium text-stone-200 truncate mb-1">{a.title}</div>
              <div className="text-xs text-parchment-500/70">{dateStr}</div>
            </>
          ) : (
            <>
              <span className="text-base flex-shrink-0">{iconEl}</span>
              <span className="flex-1 text-sm text-stone-300 truncate">{a.title}</span>
              <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
            </>
          )}
        </button>
      );
    };

    type Article = typeof articles[number];

    // Abgewählte Kategorien ganz ausblenden statt sie leer stehen zu lassen —
    // wie visibleCategories in TasksView.
    const visibleCategories = filterCatIds.length > 0
      ? wikiCategories.filter((c) => filterCatIds.includes(c.id))
      : wikiCategories;
    // Der Waisen-Bucket fängt Artikel auf, deren Kategorie im Papierkorb liegt —
    // sonst verschwänden sie aus der Kategorien-Gruppierung.
    const catGroups: DashboardGroup<Article>[] = groupByCategory(
      sortedArticles, visibleCategories, (a) => a.category_id,
      (c) => categoryLabel(t, 'wiki', c), t('wiki.uncategorized'),
    );

    const renderCategoryHeader = (group: DashboardGroup<Article>) => {
      if (group.key === UNCATEGORIZED_KEY) {
        return (
          <CollapsibleGroupHeader
            collapsed={collapsedCats.has(UNCATEGORIZED_KEY)}
            onToggleCollapse={() => toggleCatCollapse(UNCATEGORIZED_KEY)}
            emoji="📄"
            label={group.label}
            meta={<span className="text-xs text-stone-500">({group.items.length})</span>}
          />
        );
      }
      const cat = catById[group.key!];
      if (!cat) return null;
      return (
        <CategoryHeaderRow
          category={cat}
          label={categoryLabel(t, 'wiki', cat)}
          editor={catEditor}
          canDelete={!cat.is_builtin}
          collapsed={collapsedCats.has(cat.id)}
          onToggleCollapse={() => toggleCatCollapse(cat.id)}
          meta={<span className="text-xs text-stone-500">({group.items.length})</span>}
        />
      );
    };

    const renderAddCategory = () => (
      <CategoryAddRow
        editor={catEditor}
        buttonLabel={t('wiki.addCategory')}
        placeholder={t('wiki.categoryName')}
      />
    );

    return (
      <Dashboard<Article>
        title={t('wiki.title')}
        primaryAction={{ label: t('wiki.newArticle'), onClick: handleNew }}
        view={view}
        sort={sort}
        onView={(v) => setWikiPrefs({ view: v })}
        onSort={(s) => setWikiPrefs({ sort: s })}
        search={search}
        onSearch={setSearch}
        filters={{
          showFilters,
          onToggleFilters: () => setShowFilters((v) => !v),
          activeFilterCount,
          panelProps: {
            chipLabel: t('filters.category'),
            chips: catChips,
            selectedChips: filterCatIds,
            onChipToggle: (v) => setFilterCatIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onAllChips: () => setFilterCatIds([]),
            onClearAll: () => setFilterCatIds([]),
          },
        }}
        items={sortedArticles}
        itemKey={(a) => a.id}
        renderItem={renderArticle}
        isEmpty={articles.length === 0 && wikiCategories.length === 0}
        emptyState={{ message: t('wiki.noArticles'), actionLabel: t('wiki.startDocumenting'), onAction: handleNew }}
        // Bei aktivem Kategorie-Filter ohne Suchtext trotzdem die Gruppierung
        // rendern: eine ausgewählte leere Kategorie soll ihren Kopf samt
        // Leer-Hinweis zeigen, nicht „Keine Ergebnisse".
        hasNoResults={filtered.length === 0 && !(sort === 'category' && view !== 'timeline' && filterCatIds.length > 0 && !search)}
        noResultsMessage={t('search.noResults')}
        grouping={
          view === 'timeline'
            ? { mode: 'timeline', groups: timelineGroups }
            : sort === 'category'
              ? {
                  mode: 'category',
                  groups: catGroups,
                  renderGroupHeader: renderCategoryHeader,
                  renderAddCategory,
                  renderEmptyGroup: () => <p className="text-xs text-stone-700 px-1 py-1">{t('wiki.noArticles')}</p>,
                  isGroupCollapsed: (g) => collapsedCats.has(g.key!),
                }
              : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'wiki', id: ctxMenu.id, mode: 'view' }) },
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      />
    );
  }

  const currentCat = wikiCategories.find((c) => c.id === (isEditing ? category : article.category_id));

  return (
    <EntryDetailFrame
      module="wiki"
      isEditing={isEditing}
      onEnterEditMode={enterEditMode}
      breadcrumbMeta={
        <>
          {isImageIcon(article.icon)
            ? <img src={article.icon!} alt="" className="w-5 h-5 object-cover rounded" />
            : <span>{currentCat?.emoji ?? getCategoryEmoji(article.category_id)}</span>
          }
          <span className="capitalize">{categoryLabel(t, 'wiki', currentCat, '—')}</span>
          <span>·</span>
          <span>{formatEntryDate(article.updated_at)}</span>
        </>
      }
      aboveTitle={!isEditing && coverImage && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img
            src={coverImage}
            alt=""
            className="w-full max-h-48 object-cover rounded-lg border border-stone-700/40"
          />
        </div>
      )}
      title={isEditing ? title : article.title}
      onTitleChange={(nextTitle) => { setTitle(nextTitle); triggerAutoSave(); }}
      tags={{ value: tags, onChange: (newTags) => { setTags(newTags); triggerAutoSave(); } }}
    >
      {loadedArticleId === article.id && (
        <RichEditor
          key={`${article.id}:${editorEpoch}`}
          initialContent={article.content}
          placeholder={t('wiki.placeholder')}
          onChange={handleContentChange}
          editable={isEditing}
        />
      )}
    </EntryDetailFrame>
  );
}
