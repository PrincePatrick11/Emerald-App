import { useState, useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useTranslation } from 'react-i18next';
import { Trash2, Check, X, Plus, Pencil, Copy, PanelTopOpen } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import EmojiPicker from '../ui/EmojiPicker';
import Button from '../ui/Button';
import { generateId, isImageIcon } from '../../lib/helpers';
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import { useCategoryEditor } from '../../hooks/useCategoryEditor';
import RichEditor from '../editor/RichEditor';
import TagInput from '../editor/TagInput';
import { format } from 'date-fns';
import OperationSigilView from './OperationSigilView';


export default function OperationsView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, setEditActions, openViewInNewTab, operationsPrefs, setOperationsPrefs } = useUIStore(
    useShallow((s) => ({ activeView: s.activeView, setActiveView: s.setActiveView, setEditActions: s.setEditActions, openViewInNewTab: s.openViewInNewTab, operationsPrefs: s.operationsPrefs, setOperationsPrefs: s.setOperationsPrefs }))
  );
  const { operations, categories, createOperation, updateOperation, deleteOperation, restoreOperation, getOperation, addCategory, updateCategory, deleteCategory, restoreCategory } = useOperationStore(
    useShallow((s) => ({ operations: s.operations, categories: s.categories, createOperation: s.createOperation, updateOperation: s.updateOperation, deleteOperation: s.deleteOperation, restoreOperation: s.restoreOperation, getOperation: s.getOperation, addCategory: s.addCategory, updateCategory: s.updateCategory, deleteCategory: s.deleteCategory, restoreCategory: s.restoreCategory }))
  );
  const pushUndo = useUndoStore((s) => s.push);

  const operation = activeView.id ? getOperation(activeView.id) : null;
  const isEditing = activeView.mode === 'edit';
  const isSigilOperation = operation?.category_id === 'sigils';

  // Die Listen-Query laesst drawing_data weg; der Sigil-Editor braucht es.
  // needsDrawing statt nur der id in den Deps: ein Refetch (Import, Restore)
  // setzt drawing_data auf undefined zurueck, ohne dass die id wechselt —
  // der Effekt muss dann erneut nachladen, sonst bleibt das Gate unten leer.
  const ensureDrawingLoaded = useOperationStore((s) => s.ensureDrawingLoaded);
  const needsDrawing = isSigilOperation && operation?.drawing_data === undefined;
  useEffect(() => {
    if (needsDrawing && operation) void ensureDrawingLoaded(operation.id);
  }, [needsDrawing, operation?.id, ensureDrawingLoaded]);

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCatIds, setFilterCatIds] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadedOperationId, setLoadedOperationId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [endDate, setEndDate] = useState<string>('');
  const [version, setVersion] = useState<string>('');

  const pendingRef = useRef({ title, content, category_id: categoryId, tags, is_active: isActive, end_date: endDate || null, version: version || null });
  pendingRef.current = { title, content, category_id: categoryId, tags, is_active: isActive, end_date: endDate || null, version: version || null };
  const isEditingRef = useRef(false);
  isEditingRef.current = isEditing;
  const opIdRef = useRef<string | undefined>(undefined);
  opIdRef.current = operation?.id;

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const id = opIdRef.current;
    autoSaveTimer.current = setTimeout(() => {
      if (!isEditingRef.current || !id) return;
      // Siehe JournalView: `getDb()` lehnt ab, waehrend ein Vault geloescht wird.
      void updateOperation(id, pendingRef.current).catch(() => {});
    }, 1500);
  }, [updateOperation]);

  const {
    addingCategory, setAddingCategory,
    newCatName, setNewCatName,
    newCatEmoji, setNewCatEmoji,
    editingCatId, setEditingCatId,
    editCatName, setEditCatName,
    editCatEmoji, setEditCatEmoji,
    confirmDeleteCatId, setConfirmDeleteCatId,
    handleAddCategory,
    startEditCat,
    handleSaveEditCat,
    handleDeleteCat,
  } = useCategoryEditor(
    { addCategory, updateCategory, deleteCategory, restoreCategory },
    {
      defaultEmoji: '⚡',
      onAdded: (cat) => { setCategoryId(cat.id); triggerAutoSave(); },
    },
  );

  const prevRef = useRef<{ id: string; isEditing: boolean } | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev?.isEditing && prev.id !== operation?.id) {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      updateOperation(prev.id, pendingRef.current);
    }
    prevRef.current = operation ? { id: operation.id, isEditing } : null;
  }, [operation?.id, isEditing]);

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      const prev = prevRef.current;
      if (prev?.isEditing) updateOperation(prev.id, pendingRef.current);
    };
  }, []);

  useEffect(() => {
    if (operation) {
      setTitle(operation.title);
      setContent(operation.content);
      setCategoryId(operation.category_id);
      setTags(operation.tags ?? []);
      setIsActive(operation.is_active ?? true);
      setEndDate(operation.end_date ?? '');
      setVersion(operation.version ?? '');
      setLoadedOperationId(operation.id);
    } else {
      setLoadedOperationId(null);
    }
  }, [operation?.id]);

  // Sync from store (also during editing — sidebar changes must apply)
  useEffect(() => {
    if (operation) {
      setTags(operation.tags ?? []);
      setCategoryId(operation.category_id);
      setIsActive(!!operation.is_active);
      setEndDate(operation.end_date ?? '');
      setVersion(operation.version ?? '');
    }
  }, [operation?.tags, operation?.category_id, operation?.is_active, operation?.end_date, operation?.version]);

  // Apply tags from a dropped routine
  useEffect(() => {
    if (!isEditing || !operation) return;
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
  }, [isEditing, operation?.id, triggerAutoSave]);

  const handleNew = async () => {
    const defaultCat = categories[0];
    if (!defaultCat) return;
    const op = await createOperation(defaultCat.id);
    setActiveView({ type: 'operations', id: op.id, mode: 'edit' });
  };

  const openCtxMenu = (e: React.MouseEvent, id: string) => { e.preventDefault(); setCtxMenu({ id, x: e.clientX, y: e.clientY }); };

  const handleDuplicate = async (id: string) => {
    const src = operations.find((o) => o.id === id);
    if (!src) return;
    const newOp = await createOperation(src.category_id);
    await updateOperation(newOp.id, {
      title: src.title + ' (Copy)', content: src.content, category_id: src.category_id,
      tags: src.tags, is_active: src.is_active, end_date: src.end_date,
      version: src.version, icon: src.icon ?? undefined, cover_image: src.cover_image ?? undefined,
    });
    setActiveView({ type: 'operations', id: newOp.id, mode: 'view' });
  };

  const startRename = (id: string) => {
    const src = operations.find((o) => o.id === id);
    if (!src) return;
    setRenameValue(src.title);
    setRenamingId(id);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    if (renameValue.trim()) await updateOperation(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleCtxDelete = async (id: string) => {
    await deleteOperation(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
    if (activeView.id === id) setActiveView({ type: 'operations' });
  };

  const handleDone = async () => {
    if (!operation) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    await updateOperation(operation.id, { title, content, category_id: categoryId, tags, is_active: isActive, end_date: endDate || null, version: version || null });
    setActiveView({ type: 'operations', id: operation.id, mode: 'view' });
  };

  const handleCancel = () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (operation) {
      setTitle(operation.title);
      setContent(operation.content);
      setCategoryId(operation.category_id);
      setTags(operation.tags ?? []);
      setIsActive(operation.is_active ?? true);
      setEndDate(operation.end_date ?? '');
      setVersion(operation.version ?? '');
    }
    setActiveView({ type: 'operations', id: operation!.id, mode: 'view' });
  };

  const handleDelete = async () => {
    if (!operation) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const id = operation.id;
    await deleteOperation(id);
    pushUndo({ id: generateId(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
    setActiveView({ type: 'operations' });
  };

  const handleContentChange = useCallback((html: string) => {
    setContent(html);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const editHandlersRef = useRef({ onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete });
  editHandlersRef.current = { onSave: handleDone, onCancel: handleCancel, onDelete: handleDelete };

  // Sigil operations delegate rendering (and editActions registration) to OperationSigilView.
  useEffect(() => {
    if (!isEditing || isSigilOperation) return;
    setEditActions({
      onSave: () => editHandlersRef.current.onSave(),
      onCancel: () => editHandlersRef.current.onCancel(),
      onDelete: () => editHandlersRef.current.onDelete(),
    });
    return () => setEditActions(null);
  }, [isEditing, isSigilOperation]);

  const enterEditMode = () => {
    if (!isEditing && operation) setActiveView({ type: 'operations', id: operation.id, mode: 'edit' });
  };

  const getCatById = (id: string) => categories.find((c) => c.id === id);

  // List view
  if (!operation) {
    const { view, sort } = operationsPrefs;
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

    const searchFiltered = search
      ? operations.filter((o) =>
          o.title.toLowerCase().includes(search.toLowerCase()) ||
          o.tags?.some((tag) => tag.toLowerCase().includes(search.toLowerCase()))
        )
      : operations;

    const catFiltered = filterCatIds.length === 0
      ? searchFiltered
      : searchFiltered.filter((o) => filterCatIds.includes(o.category_id));

    const statusFiltered = filterStatus.length === 0
      ? catFiltered
      : catFiltered.filter((o) => {
          const active = (o.is_active as unknown as number) !== 0;
          return filterStatus.includes(active ? 'active' : 'inactive');
        });

    const filtered = statusFiltered;

    const opCatName = (c: typeof categories[0]) => c.is_builtin ? t(`operations.categories.${c.id}`) : c.name;

    const catChips = categories
      .filter((c) => operations.some((o) => o.category_id === c.id))
      .map((c) => ({ value: c.id, label: opCatName(c), emoji: c.emoji }));

    const statusChips = [
      { value: 'active', label: t('operations.active'), emoji: '●' },
      { value: 'inactive', label: t('operations.inactive'), emoji: '○' },
    ];

    const activeFilterCount =
      (filterCatIds.length > 0 ? 1 : 0) +
      (filterStatus.length > 0 ? 1 : 0);

    const sortedOps = [...filtered].sort((a, b) => {
      if (sort === 'alpha_asc') return a.title.localeCompare(b.title);
      if (sort === 'alpha_desc') return b.title.localeCompare(a.title);
      if (sort === 'category') {
        const ca = catById[a.category_id]?.name ?? '';
        const cb = catById[b.category_id]?.name ?? '';
        return ca.localeCompare(cb);
      }
      if (sort === 'date_asc') return a.updated_at.localeCompare(b.updated_at);
      return b.updated_at.localeCompare(a.updated_at); // date_desc
    });

    const groupedByCat = categories.map((cat) => ({
      cat,
      ops: sortedOps.filter((o) => o.category_id === cat.id),
    }));
    const uncategorized = sortedOps.filter((o) => !categories.find((c) => c.id === o.category_id));

    const timelineGroups: { label: string; items: typeof operations }[] = (() => {
      const map = new Map<string, typeof operations>();
      sortedOps.forEach((o) => {
        const key = format(new Date(o.updated_at), 'MMMM yyyy');
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(o);
      });
      return Array.from(map.entries()).map(([label, items]) => ({ label, items }));
    })();

    const renderOp = (op: typeof operations[0]) => {
      const cat = catById[op.category_id];
      const iconValue = op.icon || cat?.emoji || '⚡';
      const catDisplayName = cat ? opCatName(cat) : '';
      const isSigil = op.category_id === 'sigils';
      const dateStr = `${catDisplayName}${catDisplayName ? ' · ' : ''}${format(new Date(op.updated_at), 'MMM d, yyyy')}`;
      const createdDate = format(new Date(op.created_at), 'MMM d, yyyy');
      const activeDot = <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${op.is_active ? 'bg-jade-400' : 'bg-stone-700'}`} />;
      if (renamingId === op.id) return (
        <div key={op.id} className={view === 'cards' ? 'panel-interactive px-4 py-4 text-left' : 'panel-interactive w-full flex items-center gap-3 px-4 py-3'}>
          {view === 'cards' ? (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-6 h-6 object-cover rounded mb-2" />
                : <div className="text-xl mb-2">{iconValue}</div>
              }
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="text-sm font-medium text-stone-200 w-full bg-transparent outline-none selectable mb-1" />
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-parchment-500/70">{dateStr}</span>
                {activeDot}
              </div>
            </>
          ) : (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
                : <span className="text-base flex-shrink-0">{iconValue}</span>
              }
              <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable" />
              {activeDot}
              <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
            </>
          )}
        </div>
      );
      return (
        <button
          key={op.id}
          onClick={() => setActiveView({ type: 'operations', id: op.id, mode: 'view' })}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              openViewInNewTab({ type: 'operations', id: op.id, mode: 'view' });
            }
          }}
          onContextMenu={(e) => openCtxMenu(e, op.id)}
          className={view === 'cards'
            ? 'panel-interactive px-4 py-4 text-left'
            : 'panel-interactive w-full text-left flex items-center gap-3 px-4 py-3 group'
          }
        >
          {view === 'cards' ? (
            <>
              {isSigil ? (
                <div className="mb-3 overflow-hidden rounded-lg border border-stone-700/40 bg-stone-900/70">
                  <div className="aspect-[4/3] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(0,230,153,0.08),transparent_60%)]">
                    {op.thumbnail_data && op.show_sigil ? (
                      <img src={op.thumbnail_data} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-xl">{iconValue}</span>
                    )}
                  </div>
                </div>
              ) : (
                isImageIcon(iconValue)
                  ? <img src={iconValue} alt="" className="w-6 h-6 object-cover rounded mb-2" />
                  : <div className="text-xl mb-2">{iconValue}</div>
              )}
              <div className="text-sm font-medium text-stone-200 truncate mb-1">{op.title}</div>
              {isSigil ? (
                <>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {op.target_reveal_date && (
                      <span className="text-jade-400/80">{t('creation.targetDate')}: {op.target_reveal_date}</span>
                    )}
                    <span className="text-parchment-500/70">{createdDate}</span>
                  </div>
                  {op.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {op.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-stone-700/60 px-1.5 py-0.5 text-xs text-stone-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-parchment-500/70">{dateStr}</span>
                  {activeDot}
                </div>
              )}
            </>
          ) : (
            <>
              {isImageIcon(iconValue)
                ? <img src={iconValue} alt="" className="w-5 h-5 object-cover rounded flex-shrink-0" />
                : <span className="text-base flex-shrink-0">{iconValue}</span>
              }
              <span className="flex-1 text-sm text-stone-300 truncate">{op.title}</span>
              {isSigil ? (
                <span className="text-xs text-parchment-500/70 flex-shrink-0">
                  {op.target_reveal_date ? `${t('creation.targetDate')}: ${op.target_reveal_date}` : createdDate}
                </span>
              ) : (
                <>
                  {activeDot}
                  <span className="text-xs text-parchment-500/70 flex-shrink-0">{dateStr}</span>
                </>
              )}
            </>
          )}
        </button>
      );
    };

    type Operation = typeof operations[number];

    const catGroups: DashboardGroup<Operation>[] = groupedByCat.map(({ cat, ops }) => ({
      key: cat.id,
      label: cat.is_builtin ? t(`operations.categories.${cat.id}`) : cat.name,
      items: ops,
    }));
    if (uncategorized.length > 0) {
      catGroups.push({ key: '__uncategorized__', label: '📄 Other', items: uncategorized });
    }

    const renderCategoryHeader = (group: DashboardGroup<Operation>) => {
      if (group.key === '__uncategorized__') {
        return <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider mb-2">{group.label}</p>;
      }
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
              className="flex-1 bg-stone-800/60 rounded px-2 py-0.5 text-xs text-stone-200 outline-none font-semibold uppercase tracking-wider"
            />
            <Button onClick={handleSaveEditCat} variant="ghost" className="text-jade-400"><Check size={12} /></Button>
            <Button onClick={() => setEditingCatId(null)} variant="ghost"><X size={12} /></Button>
            {!(cat.is_builtin as unknown as number) && (
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
            {cat.is_builtin ? t(`operations.categories.${cat.id}`) : cat.name}
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
      addingCategory ? (
        <div className="flex items-center gap-2 mb-2">
          <EmojiPicker
            value={newCatEmoji}
            onChange={setNewCatEmoji}
            trigger={({ toggle }) => (
              <button
                onClick={toggle}
                className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
              >
                {newCatEmoji}
              </button>
            )}
          />
          <input
            autoFocus
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') { setAddingCategory(false); } }}
            placeholder={t('operations.categoryName')}
            className="flex-1 bg-stone-800/60 rounded px-2 py-0.5 text-xs text-stone-200 outline-none font-semibold uppercase tracking-wider"
          />
          <button onClick={handleAddCategory} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
          <button onClick={() => setAddingCategory(false)} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
        </div>
      ) : (
        <button
          onClick={() => setAddingCategory(true)}
          className="flex items-center gap-2 mb-2 w-full text-stone-600 hover:text-stone-400 transition-colors"
        >
          <span className="w-5 flex items-center justify-center flex-shrink-0"><Plus size={18} /></span>
          <span className="flex-1 text-left text-xs font-semibold uppercase tracking-wider">{t('operations.addCategory')}</span>
        </button>
      )
    );

    return (
      <Dashboard<Operation>
        title={t('nav.operations')}
        primaryAction={{ label: t('operations.new'), onClick: handleNew }}
        view={view}
        sort={sort}
        onView={(v) => setOperationsPrefs({ view: v })}
        onSort={(s) => setOperationsPrefs({ sort: s })}
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
            statusChips,
            selectedStatus: filterStatus,
            onStatusToggle: (v) => setFilterStatus((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]),
            onClearAll: () => { setFilterCatIds([]); setFilterStatus([]); },
          },
        }}
        items={sortedOps}
        itemKey={(o) => o.id}
        renderItem={renderOp}
        isEmpty={operations.length === 0 && categories.length === 0}
        emptyState={{ message: t('operations.none'), actionLabel: t('operations.start'), onAction: handleNew }}
        hasNoResults={filtered.length === 0}
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
                  renderEmptyGroup: () => <p className="text-xs text-stone-700 px-1 py-1">{t('operations.none')}</p>,
                }
              : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              { label: t('contextMenu.openInNewTab'), icon: <PanelTopOpen size={12} />, onClick: () => openViewInNewTab({ type: 'operations', id: ctxMenu.id, mode: 'view' }) },
              ...(operations.find((o) => o.id === ctxMenu.id)?.category_id === 'sigils'
                ? []
                : [{ label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) }]),
              { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
              { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      />
    );
  }

  if (isSigilOperation) {
    // Kurz leer rendern, bis ensureDrawingLoaded die Zeichnung nachgeladen hat —
    // sonst initialisiert der Canvas seine Historie mit "keine Zeichnung".
    if (operation.drawing_data === undefined) return null;
    return <OperationSigilView operation={operation} />;
  }

  const currentCat = getCatById(isEditing ? categoryId : operation.category_id);
  const operationIcon = operation.icon || currentCat?.emoji || '⚡';

  return (
    <div className="h-full flex flex-col">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: 'operations' })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t('nav.operations')}
          </button>
          {isImageIcon(operationIcon)
            ? <img src={operationIcon} alt="" className="w-5 h-5 object-cover rounded" />
            : <span>{operationIcon}</span>
          }
          <span>{currentCat?.is_builtin ? t(`operations.categories.${currentCat.id}`) : currentCat?.name ?? '—'}</span>
          <span>·</span>
          <span>{format(new Date(operation.updated_at), 'MMM d, yyyy')}</span>
          {isEditing && <span className="text-stone-700 italic ml-1">{t('editor.editing')}</span>}
        </div>
      </div>

      {/* Title */}
      <div className="px-8 pt-6 pb-4 flex-shrink-0" onDoubleClick={enterEditMode}>
        {isEditing ? (
          <input autoFocus type="text" value={title}
            onChange={(e) => { const nextTitle = e.target.value; setTitle(nextTitle); triggerAutoSave(); }}
            placeholder={t('operations.untitled')}
            className="entry-view-title w-full bg-transparent text-2xl font-semibold text-stone-100
                       placeholder-stone-700 outline-none selectable" />
        ) : (
          <h1 className="entry-view-title text-2xl font-semibold text-stone-100 cursor-text">
            {operation.title || t('operations.untitled')}
          </h1>
        )}
      </div>

      {/* Cover image — read mode hero */}
      {!isEditing && operation.cover_image && (
        <div className="flex-shrink-0 px-8 pt-5">
          <img src={operation.cover_image} alt="" className="w-full max-h-48 object-cover rounded-lg border border-stone-700/40" />
        </div>
      )}

      {/* Built-in properties */}
      <div className="px-8 pb-3 flex-shrink-0 flex flex-wrap gap-2">
        {/* Active / Inactive — clickable toggle */}
        <button
          onClick={() => updateOperation(operation.id, { is_active: !operation.is_active })}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
            !!operation.is_active
              ? 'bg-jade-900/40 text-jade-400 border-jade-800/40 hover:bg-jade-900/60'
              : 'bg-stone-800/60 text-stone-500 border-stone-700/40 hover:bg-stone-700/60'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${!!operation.is_active ? 'bg-jade-400' : 'bg-stone-600'}`} />
          {!!operation.is_active ? t('operations.active') : t('operations.inactive')}
        </button>

        {operation.end_date && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40">
            <span className="text-stone-600">{t('operations.endDate')}:</span>
            <span className="text-stone-300">
              {new Date(operation.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </span>
        )}

        {operation.version && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-stone-800/60 border border-stone-700/40">
            <span className="text-stone-600">{t('operations.version')}:</span>
            <span className="text-stone-300">{operation.version}</span>
          </span>
        )}
      </div>

      {/* Tags */}
      <div className="px-8 pb-3 flex-shrink-0" onDoubleClick={enterEditMode}>
        <TagInput tags={tags} onChange={(newTags) => { setTags(newTags); triggerAutoSave(); }} readOnly={true} />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden px-8 pb-8" onDoubleClick={enterEditMode}>
        {loadedOperationId === operation.id && (
          <RichEditor
            key={operation.id}
            content={content}
            placeholder={t('operations.placeholder')}
            onChange={handleContentChange}
            editable={isEditing}
          />
        )}
      </div>
    </div>
  );
}
