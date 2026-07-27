import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, PanelRightOpen, Check, X, Plus, Pencil, Copy, PanelTopOpen } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import EmojiPicker from '../ui/EmojiPicker';
import Button from '../ui/Button';
import { getDb } from '../../lib/db';
import { generateId, isImageIcon } from '../../lib/helpers';

import { useUIStore } from '../../store/uiStore';
import { useWikiStore } from '../../store/wikiStore';
import { useUndoStore } from '../../store/undoStore';
import RichEditor from '../editor/RichEditor';
import TagInput from '../editor/TagInput';
import EntryCustomProperties from '../editor/EntryCustomProperties';
import { getCategoryEmoji } from '../wiki/WikiList';
import { format } from 'date-fns';
import type { WikiCategory } from '../../types';


export default function WikiView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, openViewInNewTab, toggleRightSidebar, wikiPrefs, setWikiPrefs } = useUIStore();
  const {
    articles, wikiCategories, createArticle, updateArticle, deleteArticle, restoreArticle, getArticle,
    addWikiCategory, updateWikiCategory, deleteWikiCategory, restoreWikiCategory,
  } = useWikiStore();
  const pushUndo = useUndoStore((s) => s.push);

  const article = activeView.id ? getArticle(activeView.id) : null;
  const isEditing = activeView.mode === 'edit';

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCatIds, setFilterCatIds] = useState<string[]>([]);
  const [filterPropSlots, setFilterPropSlots] = useState<{ name: string; value: string }[]>([]);
  const [allPropRows, setAllPropRows] = useState<{ entry_id: string; name: string; value: string | null }[]>([]);
  const [allPropNames, setAllPropNames] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<WikiCategory>('other');
  const [tags, setTags] = useState<string[]>([]);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [loadedArticleId, setLoadedArticleId] = useState<string | null>(null);

  // Category management state
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatEmoji, setEditCatEmoji] = useState('📄');
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);
  const [addingWikiCat, setAddingWikiCat] = useState(false);
  const [newWikiCatName, setNewWikiCatName] = useState('');
  const [newWikiCatEmoji, setNewWikiCatEmoji] = useState('📄');

  // Always-fresh refs
  const pendingRef = useRef({ title, content, category, tags, cover_image: coverImage ?? undefined, icon: icon ?? undefined });
  pendingRef.current = { title, content, category, tags, cover_image: coverImage ?? undefined, icon: icon ?? undefined };
  const isEditingRef = useRef(false);
  isEditingRef.current = isEditing;
  const articleIdRef = useRef<string | undefined>(undefined);
  articleIdRef.current = article?.id;

  // Debounced auto-save
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const id = articleIdRef.current;
    autoSaveTimer.current = setTimeout(() => {
      if (!isEditingRef.current || !id) return;
      updateArticle(id, pendingRef.current);
    }, 1500);
  }, [updateArticle]);

  const prevRef = useRef<{ id: string; isEditing: boolean } | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev?.isEditing && prev.id !== article?.id) {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      updateArticle(prev.id, pendingRef.current);
    }
    prevRef.current = article ? { id: article.id, isEditing } : null;
  }, [article?.id, isEditing]);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      const prev = prevRef.current;
      if (prev?.isEditing) updateArticle(prev.id, pendingRef.current);
    };
  }, []);

  useEffect(() => {
    if (article) {
      setTitle(article.title);
      setContent(article.content);
      setCategory(article.category);
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
      setCategory(article.category);
      setCoverImage(article.cover_image ?? null);
      setIcon(article.icon ?? null);
    }
  }, [article?.tags, article?.category, article?.cover_image, article?.icon]);

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

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [nameRows, valueRows] = await Promise.all([
        db.select<{ name: string }[]>(
          'SELECT DISTINCT name FROM custom_properties WHERE entry_type = $1 ORDER BY name ASC',
          ['wiki']
        ),
        db.select<{ entry_id: string; name: string; value: string | null }[]>(
          'SELECT entry_id, name, value FROM custom_properties WHERE entry_type = $1',
          ['wiki']
        ),
      ]);
      setAllPropNames(nameRows.map((r) => r.name));
      setAllPropRows(valueRows);
    })();
  }, [articles.length]);

  const handleDone = async () => {
    if (!article) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    await updateArticle(article.id, { title, content, category, tags, cover_image: coverImage ?? undefined, icon: icon ?? undefined });
    setActiveView({ type: 'wiki', id: article.id, mode: 'view' });
  };

  const handleCancel = () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (article) {
      setTitle(article.title);
      setContent(article.content);
      setCategory(article.category);
      setTags(article.tags ?? []);
      setCoverImage(article.cover_image ?? null);
      setIcon(article.icon ?? null);
    }
    setActiveView({ type: 'wiki', id: article!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!article) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const id = article.id;
    await deleteArticle(id);
    pushUndo({ id: generateId(), description: t('undo.articleDeleted'), undo: () => restoreArticle(id) });
    setActiveView({ type: 'wiki' });
  };

  const handleContentChange = useCallback((html: string) => {
    setContent(html);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const handleNew = async () => {
    const a = await createArticle();
    setActiveView({ type: 'wiki', id: a.id, mode: 'edit' });
  };

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const src = articles.find((a) => a.id === id);
    if (!src) return;
    const newArt = await createArticle(src.category);
    await updateArticle(newArt.id, {
      title: src.title + ' (Copy)', content: src.content, category: src.category,
      tags: src.tags, icon: src.icon ?? undefined, cover_image: src.cover_image ?? undefined,
    });
    setActiveView({ type: 'wiki', id: newArt.id, mode: 'view' });
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

  const startEditCat = (cat: typeof wikiCategories[0]) => {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatEmoji(cat.emoji);
  };

  const handleSaveEditCat = async () => {
    if (!editingCatId || !editCatName.trim()) return;
    await updateWikiCategory(editingCatId, editCatName.trim(), editCatEmoji);
    setEditingCatId(null);
  };

  const handleDeleteCat = async (id: string) => {
    if (confirmDeleteCatId !== id) { setConfirmDeleteCatId(id); return; }
    setConfirmDeleteCatId(null);
    await deleteWikiCategory(id);
    pushUndo({ id: generateId(), description: t('undo.categoryDeleted'), undo: () => restoreWikiCategory(id) });
  };

  const handleAddWikiCat = async () => {
    if (!newWikiCatName.trim()) return;
    const cat = await addWikiCategory(newWikiCatName.trim(), newWikiCatEmoji);
    setCategory(cat.id);
    setNewWikiCatName(''); setNewWikiCatEmoji('📄'); setAddingWikiCat(false);
    triggerAutoSave();
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
      : searchFiltered.filter((a) => filterCatIds.includes(a.category));

    const filtered = filterPropSlots.some((s) => s.name && s.value)
      ? catFiltered.filter((a) =>
          filterPropSlots.filter((s) => s.name && s.value).every(({ name, value }) =>
            allPropRows.some(
              (r) => r.entry_id === a.id && r.name === name &&
                     (r.value ?? '').toLowerCase().includes(value.toLowerCase())
            )
          )
        )
      : catFiltered;

    const catChips = wikiCategories
      .filter((c) => articles.some((a) => a.category === c.id))
      .map((c) => ({ value: c.id, label: c.is_builtin ? t(`wiki.categories.${c.id}`) : c.name, emoji: c.emoji }));

    const activeFilterCount = (filterCatIds.length > 0 ? 1 : 0) + filterPropSlots.filter((s) => s.name && s.value).length;

    const sortedArticles = [...filtered].sort((a, b) => {
      if (sort === 'alpha_asc') return a.title.localeCompare(b.title);
      if (sort === 'alpha_desc') return b.title.localeCompare(a.title);
      if (sort === 'category') return (a.category ?? '').localeCompare(b.category ?? '');
      if (sort === 'date_asc') return a.created_at.localeCompare(b.created_at);
      return b.created_at.localeCompare(a.created_at); // date_desc
    });

    const groupedByCat = wikiCategories.map((cat) => ({
      cat,
      arts: sortedArticles.filter((a) => a.category === cat.id),
    }));

    // For timeline (by month)
    const timelineGroups: { label: string; items: typeof articles }[] = (() => {
      const map = new Map<string, typeof articles>();
      sortedArticles.forEach((a) => {
        const key = format(new Date(a.created_at), 'MMMM yyyy');
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(a);
      });
      return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
    })();

    const renderArticle = (a: typeof articles[0]) => {
      const cat = catById[a.category];
      const iconEl = isImageIcon(a.icon) ? <img src={a.icon!} alt="" className="w-5 h-5 object-cover rounded inline" /> : (cat?.emoji ?? '📄');
      const catLabel = cat ? (cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name) : a.category;
      const dateStr = `${catLabel} · ${format(new Date(a.updated_at), 'MMM d, yyyy')}`;
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

    const catGroups: DashboardGroup<Article>[] = groupedByCat.map(({ cat, arts }) => ({
      key: cat.id,
      label: cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name,
      items: arts,
    }));

    const timelineDashboardGroups: DashboardGroup<Article>[] = timelineGroups.map(({ label, items }) => ({ label, items }));

    const renderCategoryHeader = (group: DashboardGroup<Article>) => {
      const cat = catById[group.key!];
      if (!cat) return null;
      if (editingCatId === cat.id) {
        return (
          <div className="flex items-center gap-2 mb-2">
            <EmojiPicker
              value={editCatEmoji}
              onChange={setEditCatEmoji}
              trigger={({ toggle }) => (
                <button
                  onClick={toggle}
                  className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
                >
                  {editCatEmoji}
                </button>
              )}
            />
            <input
              autoFocus
              value={editCatName}
              onChange={(e) => setEditCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditCat(); if (e.key === 'Escape') { setEditingCatId(null); } }}
              className="wiki-cat-input flex-1 rounded px-2 py-0.5 text-xs outline-none font-semibold uppercase tracking-wider"
            />
            <button onClick={handleSaveEditCat} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
            <button onClick={() => setEditingCatId(null)} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
            {!cat.is_builtin && (
              confirmDeleteCatId === cat.id ? (
                <>
                  <Button onClick={() => handleDeleteCat(cat.id)} variant="danger" className="text-xs px-1">{t('trash.confirmYes')}</Button>
                  <Button onClick={() => setConfirmDeleteCatId(null)} variant="ghost" className="text-xs">{t('trash.confirmNo')}</Button>
                </>
              ) : (
                <Button onClick={() => handleDeleteCat(cat.id)} variant="danger" className="p-0.5 ml-1">
                  <Trash2 size={12} />
                </Button>
              )
            )}
          </div>
        );
      }
      return (
        <div className="flex items-center gap-2 mb-2">
          <span className="w-5 text-center flex-shrink-0 text-base">{cat.emoji}</span>
          <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider flex-1">
            {cat.is_builtin ? t(`wiki.categories.${cat.id}`) : cat.name}
          </p>
          <button
            onClick={() => startEditCat(cat)}
            className="text-stone-500 hover:text-stone-300 transition-colors p-0.5"
            title={t('editor.edit')}
          >
            <Pencil size={11} />
          </button>
        </div>
      );
    };

    const renderAddCategory = () => (
      addingWikiCat ? (
        <div className="flex items-center gap-2 mb-2">
          <EmojiPicker
            value={newWikiCatEmoji}
            onChange={setNewWikiCatEmoji}
            trigger={({ toggle }) => (
              <button
                onClick={toggle}
                className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
              >
                {newWikiCatEmoji}
              </button>
            )}
          />
          <input
            autoFocus
            value={newWikiCatName}
            onChange={(e) => setNewWikiCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddWikiCat(); if (e.key === 'Escape') { setAddingWikiCat(false); } }}
            placeholder="Name…"
            className="wiki-cat-input flex-1 rounded px-2 py-0.5 text-xs outline-none font-semibold uppercase tracking-wider"
          />
          <button onClick={handleAddWikiCat} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
          <button onClick={() => setAddingWikiCat(false)} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
        </div>
      ) : (
        <button
          onClick={() => setAddingWikiCat(true)}
          className="flex items-center gap-2 mb-2 w-full text-stone-600 hover:text-stone-400 transition-colors"
        >
          <span className="w-5 flex items-center justify-center flex-shrink-0"><Plus size={18} /></span>
          <span className="flex-1 text-left text-xs font-semibold uppercase tracking-wider">{t('wiki.addCategory')}</span>
        </button>
      )
    );

    return (
      <Dashboard<Article>
        title={t('wiki.title')}
        primaryAction={{ label: t('wiki.newArticle'), onClick: handleNew }}
        onToggleRightSidebar={toggleRightSidebar}
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
            propNames: allPropNames,
            propFilters: filterPropSlots,
            onAddPropFilter: () => setFilterPropSlots((prev) => [...prev, { name: '', value: '' }]),
            onUpdatePropFilter: (i, pf) => setFilterPropSlots((prev) => prev.map((s, idx) => idx === i ? pf : s)),
            onRemovePropFilter: (i) => setFilterPropSlots((prev) => prev.filter((_, idx) => idx !== i)),
            onClearAll: () => { setFilterCatIds([]); setFilterPropSlots([]); },
          },
        }}
        items={sortedArticles}
        itemKey={(a) => a.id}
        renderItem={renderArticle}
        isEmpty={articles.length === 0 && wikiCategories.length === 0}
        emptyState={{ message: t('wiki.noArticles'), actionLabel: t('wiki.startDocumenting'), onAction: handleNew }}
        hasNoResults={filtered.length === 0}
        noResultsMessage={t('search.noResults')}
        grouping={
          view === 'timeline'
            ? { mode: 'timeline', groups: timelineDashboardGroups }
            : sort === 'category'
              ? {
                  mode: 'category',
                  groups: catGroups,
                  renderGroupHeader: renderCategoryHeader,
                  renderAddCategory,
                  renderEmptyGroup: () => <p className="text-xs text-stone-700 px-1 py-1">{t('wiki.noArticles')}</p>,
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

  const currentCat = wikiCategories.find((c) => c.id === (isEditing ? category : article.category));

  return (
    <div className="h-full flex flex-col">

      {/* Topbar */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: 'wiki' })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t('nav.wiki')}
          </button>
          {isImageIcon(article.icon)
            ? <img src={article.icon!} alt="" className="w-5 h-5 object-cover rounded" />
            : <span>{currentCat?.emoji ?? getCategoryEmoji(article.category)}</span>
          }
          <span className="capitalize">{currentCat?.name ?? article.category}</span>
          <span>·</span>
          <span>{format(new Date(article.updated_at), 'MMM d, yyyy')}</span>
          {isEditing && <span className="text-stone-700 italic ml-1">{t('editor.editing')}</span>}
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button onClick={handleDone} variant="primary">
                <Check size={13} />
                {t('editor.done')}
              </Button>
              <Button onClick={handleDelete} variant="danger">
                <Trash2 size={15} />
              </Button>
              <Button onClick={handleCancel} variant="ghost">
                <X size={15} />
              </Button>
            </>
          ) : (
            <>
              <Button onClick={enterEditMode} variant="ghost" title={t('editor.edit')}>
                <Pencil size={15} />
              </Button>
              <Button onClick={toggleRightSidebar} variant="ghost">
                <PanelRightOpen size={15} />
              </Button>
            </>
          )}
        </div>
      </div>



      {/* Cover image — view mode hero */}
      {!isEditing && coverImage && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img
            src={coverImage}
            alt=""
            className="w-full max-h-48 object-cover rounded-lg border border-stone-700/40"
          />
        </div>
      )}

      {/* Title — double-click enters edit mode */}
      <div className="px-8 pt-6 pb-4 flex-shrink-0" onDoubleClick={enterEditMode}>
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => { const nextTitle = e.target.value; setTitle(nextTitle); triggerAutoSave(); }}
            placeholder={t('wiki.untitled')}
            className="entry-view-title w-full bg-transparent text-2xl font-semibold text-stone-100
                       placeholder-stone-700 outline-none selectable"
          />
        ) : (
          <h1 className="entry-view-title text-2xl font-semibold text-stone-100 cursor-text"
              title={t('editor.doubleClickEdit')}>
            {article.title || t('wiki.untitled')}
          </h1>
        )}
      </div>


      {/* Custom properties marked "show in entry" */}
      <EntryCustomProperties entryId={article.id} entryType="wiki" isEditing={false} />

      {/* Tags */}
      <div className="px-8 pb-3 flex-shrink-0" onDoubleClick={enterEditMode}>
        <TagInput
          tags={tags}
          onChange={(newTags) => { setTags(newTags); triggerAutoSave(); }}
          readOnly={true}
        />
      </div>

      {/* Editor — double-click enters edit mode */}
      <div className="flex-1 overflow-hidden px-8 pb-8" onDoubleClick={enterEditMode}>
        {loadedArticleId === article.id && (
          <RichEditor
            key={article.id}
            content={content}
            placeholder={t('wiki.placeholder')}
            onChange={handleContentChange}
            editable={isEditing}
          />
        )}
      </div>
    </div>
  );
}
