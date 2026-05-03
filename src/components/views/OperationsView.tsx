import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, PanelRightOpen, Check, X, Plus, Pencil, Copy } from 'lucide-react';
import ContextMenu from '../ui/ContextMenu';
import FilterPanel from '../ui/FilterPanel';
import { getDb } from '../../lib/db';

const OPERATION_EMOJIS = [
  '⚡','🔯','👁️','🌙','☀️','🌟','✨','🔮','🌀','⚗️',
  '🗡️','📜','🕯️','🔑','🪄','🧿','🌊','🔥','💀','🌺',
  '🐍','🦅','🌿','💎','🌈','⭐','🪬','☯️','🔱','🌑',
];
import { useUIStore } from '../../store/uiStore';
import { useOperationStore } from '../../store/operationStore';
import { useUndoStore } from '../../store/undoStore';
import ListToolbar from '../ui/ListToolbar';
import RichEditor from '../editor/RichEditor';
import TagInput from '../editor/TagInput';
import EntryCustomProperties from '../editor/EntryCustomProperties';
import { format } from 'date-fns';
import OperationSigilView from './OperationSigilView';

export default function OperationsView() {
  const { t } = useTranslation();
  const { activeView, setActiveView, toggleRightSidebar, operationsPrefs, setOperationsPrefs } = useUIStore();
  const { operations, categories, createOperation, updateOperation, deleteOperation, restoreOperation, getOperation, addCategory, updateCategory, deleteCategory, restoreCategory } = useOperationStore();
  const pushUndo = useUndoStore((s) => s.push);

  const operation = activeView.id ? getOperation(activeView.id) : null;
  const isEditing = activeView.mode === 'edit';
  const isSigilOperation = operation?.category_id === 'sigils';

  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCatIds, setFilterCatIds] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterPropSlots, setFilterPropSlots] = useState<{ name: string; value: string }[]>([]);
  const [allPropRows, setAllPropRows] = useState<{ entry_id: string; name: string; value: string | null }[]>([]);
  const [allPropNames, setAllPropNames] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [endDate, setEndDate] = useState<string>('');
  const [version, setVersion] = useState<string>('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('⚡');
  const [showCatEmojiPicker, setShowCatEmojiPicker] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatEmoji, setEditCatEmoji] = useState('⚡');
  const [showEditEmojiPicker, setShowEditEmojiPicker] = useState(false);
  const [confirmDeleteCatId, setConfirmDeleteCatId] = useState<string | null>(null);

  const pendingRef = useRef({ title, content, category_id: categoryId, tags, is_active: isActive, end_date: endDate || null, version: version || null });
  pendingRef.current = { title, content, category_id: categoryId, tags, is_active: isActive, end_date: endDate || null, version: version || null };
  const isEditingRef = useRef(false);
  isEditingRef.current = isEditing;
  const opIdRef = useRef<string | undefined>(undefined);
  opIdRef.current = operation?.id;

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (!isEditingRef.current) return;
      const id = opIdRef.current;
      if (id) updateOperation(id, pendingRef.current);
    }, 1500);
  }, [updateOperation]);

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
      setTags((prev) => [...new Set([...prev, ...routineTags])]);
      triggerAutoSave();
    };
    document.addEventListener('routine-drop', handler);
    return () => document.removeEventListener('routine-drop', handler);
  }, [isEditing, operation?.id, triggerAutoSave]);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const [nameRows, valueRows] = await Promise.all([
        db.select<{ name: string }[]>(
          'SELECT DISTINCT name FROM custom_properties WHERE entry_type = $1 ORDER BY name ASC',
          ['operation']
        ),
        db.select<{ entry_id: string; name: string; value: string | null }[]>(
          'SELECT entry_id, name, value FROM custom_properties WHERE entry_type = $1',
          ['operation']
        ),
      ]);
      setAllPropNames(nameRows.map((r) => r.name));
      setAllPropRows(valueRows);
    })();
  }, [operations.length]);

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
    pushUndo({ id: crypto.randomUUID(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
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
    pushUndo({ id: crypto.randomUUID(), description: t('undo.operationDeleted'), undo: () => restoreOperation(id) });
    setActiveView({ type: 'operations' });
  };

  const handleContentChange = useCallback((html: string) => {
    setContent(html);
    triggerAutoSave();
  }, [triggerAutoSave]);

  const enterEditMode = () => {
    if (!isEditing && operation) setActiveView({ type: 'operations', id: operation.id, mode: 'edit' });
  };

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const cat = await addCategory(newCatName.trim(), newCatEmoji);
    setCategoryId(cat.id);
    setNewCatName(''); setNewCatEmoji('⚡'); setAddingCategory(false); setShowCatEmojiPicker(false);
    triggerAutoSave();
  };

  const getCatById = (id: string) => categories.find((c) => c.id === id);

  const startEditCat = (cat: typeof categories[0]) => {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatEmoji(cat.emoji);
    setShowEditEmojiPicker(false);
  };

  const handleSaveEditCat = async () => {
    if (!editingCatId || !editCatName.trim()) return;
    await updateCategory(editingCatId, editCatName.trim(), editCatEmoji);
    setEditingCatId(null);
    setShowEditEmojiPicker(false);
  };

  const handleDeleteCat = async (id: string) => {
    if (confirmDeleteCatId !== id) { setConfirmDeleteCatId(id); return; }
    setConfirmDeleteCatId(null);
    await deleteCategory(id);
    pushUndo({ id: crypto.randomUUID(), description: t('undo.categoryDeleted'), undo: () => restoreCategory(id) });
  };

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

    const filtered = filterPropSlots.some((s) => s.name && s.value)
      ? statusFiltered.filter((o) =>
          filterPropSlots.filter((s) => s.name && s.value).every(({ name, value }) =>
            allPropRows.some(
              (r) => r.entry_id === o.id && r.name === name &&
                     (r.value ?? '').toLowerCase().includes(value.toLowerCase())
            )
          )
        )
      : statusFiltered;

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
      (filterStatus.length > 0 ? 1 : 0) +
      filterPropSlots.filter((s) => s.name && s.value).length;

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
      const emoji = cat?.emoji ?? '⚡';
      const catDisplayName = cat ? opCatName(cat) : '';
      const isSigil = op.category_id === 'sigils';
      const dateStr = `${catDisplayName}${catDisplayName ? ' · ' : ''}${format(new Date(op.updated_at), 'MMM d, yyyy')}`;
      const createdDate = format(new Date(op.created_at), 'MMM d, yyyy');
      const activeDot = <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${op.is_active ? 'bg-jade-400' : 'bg-stone-700'}`} />;
      if (renamingId === op.id) return (
        <div key={op.id} className={view === 'cards' ? 'panel-interactive px-4 py-4 text-left' : 'panel-interactive w-full flex items-center gap-3 px-4 py-3'}>
          {view === 'cards' ? (
            <>
              <div className="text-xl mb-2">{emoji}</div>
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
              <span className="text-base flex-shrink-0">{emoji}</span>
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
                      <span className="text-xl">{emoji}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xl mb-2">{emoji}</div>
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
              <span className="text-base flex-shrink-0">{emoji}</span>
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

    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-8 h-14 border-b border-stone-700/60">
          <h1 className="text-lg font-semibold text-stone-100">{t('nav.operations')}</h1>
          <div className="flex items-center gap-1">
            <button onClick={handleNew} className="btn-primary">
              <Plus size={13} />{t('operations.new')}
            </button>
            <button onClick={toggleRightSidebar} className="btn-ghost ml-1"><PanelRightOpen size={16} /></button>
          </div>
        </div>

        <ListToolbar
          view={view} sort={sort} onView={(v) => setOperationsPrefs({ view: v })} onSort={(s) => setOperationsPrefs({ sort: s })}
          search={search} onSearch={setSearch}
          showFilters={showFilters} onToggleFilters={() => setShowFilters((v) => !v)} activeFilterCount={activeFilterCount}
        />
        {showFilters && (
          <FilterPanel
            chipLabel={t('filters.category')}
            chips={catChips}
            selectedChips={filterCatIds}
            onChipToggle={(v) => setFilterCatIds((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
            statusChips={statusChips}
            selectedStatus={filterStatus}
            onStatusToggle={(v) => setFilterStatus((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
            propNames={allPropNames}
            propFilters={filterPropSlots}
            onAddPropFilter={() => setFilterPropSlots((prev) => [...prev, { name: '', value: '' }])}
            onUpdatePropFilter={(i, pf) => setFilterPropSlots((prev) => prev.map((s, idx) => idx === i ? pf : s))}
            onRemovePropFilter={(i) => setFilterPropSlots((prev) => prev.filter((_, idx) => idx !== i))}
            activeFilterCount={activeFilterCount}
            onClearAll={() => { setFilterCatIds([]); setFilterStatus([]); setFilterPropSlots([]); }}
          />
        )}

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {operations.length === 0 && categories.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-stone-600 text-sm">{t('operations.none')}</p>
              <button onClick={handleNew} className="mt-4 text-xs text-stone-500 hover:text-stone-300 underline transition-colors">{t('operations.start')}</button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-20 text-stone-600 text-sm">{t('search.noResults')}</p>
          ) : view === 'timeline' ? (
            <div className="space-y-6">
              {timelineGroups.map(({ label, items }) => (
                <div key={label}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider whitespace-nowrap">{label}</span>
                    <div className="flex-1 h-px bg-stone-700/50" />
                  </div>
                  <div className="space-y-1.5">{items.map(renderOp)}</div>
                </div>
              ))}
            </div>
          ) : sort === 'category' ? (
            <div className="space-y-6">
              {/* Add category */}
              {addingCategory ? (
                <div className="relative flex items-center gap-2 mb-2">
                  <button
                    onClick={() => setShowCatEmojiPicker(!showCatEmojiPicker)}
                    className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
                  >
                    {newCatEmoji}
                  </button>
                  {showCatEmojiPicker && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2 w-52">
                      <div className="flex flex-wrap gap-1">
                        {OPERATION_EMOJIS.map((e) => (
                          <button key={e}
                            onClick={() => { setNewCatEmoji(e); setShowCatEmojiPicker(false); }}
                            className={`text-base p-1 rounded hover:bg-stone-700 transition-colors ${newCatEmoji === e ? 'bg-stone-700' : ''}`}
                          >{e}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  <input
                    autoFocus
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') { setAddingCategory(false); setShowCatEmojiPicker(false); } }}
                    placeholder="Name…"
                    className="flex-1 bg-stone-800/60 rounded px-2 py-0.5 text-xs text-stone-200 outline-none font-semibold uppercase tracking-wider"
                  />
                  <button onClick={handleAddCategory} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
                  <button onClick={() => { setAddingCategory(false); setShowCatEmojiPicker(false); }} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingCategory(true)}
                  className="flex items-center gap-2 mb-2 w-full text-stone-600 hover:text-stone-400 transition-colors"
                >
                  <span className="w-5 flex items-center justify-center flex-shrink-0"><Plus size={18} /></span>
                  <span className="flex-1 text-left text-xs font-semibold uppercase tracking-wider">{t('operations.addCategory')}</span>
                </button>
              )}
              {groupedByCat.map(({ cat, ops }) => (
                <div key={cat.id}>
                  {editingCatId === cat.id ? (
                    <div className="relative flex items-center gap-2 mb-2">
                      <button
                        onClick={() => setShowEditEmojiPicker(!showEditEmojiPicker)}
                        className="w-5 text-center flex-shrink-0 text-base hover:opacity-70 transition-opacity"
                      >
                        {editCatEmoji}
                      </button>
                      {showEditEmojiPicker && (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2 w-52">
                          <div className="flex flex-wrap gap-1">
                            {OPERATION_EMOJIS.map((e) => (
                              <button key={e}
                                onClick={() => { setEditCatEmoji(e); setShowEditEmojiPicker(false); }}
                                className={`text-base p-1 rounded hover:bg-stone-700 transition-colors ${editCatEmoji === e ? 'bg-stone-700' : ''}`}
                              >{e}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <input
                        autoFocus
                        value={editCatName}
                        onChange={(e) => setEditCatName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEditCat(); if (e.key === 'Escape') { setEditingCatId(null); setShowEditEmojiPicker(false); } }}
                        className="flex-1 bg-stone-800/60 rounded px-2 py-0.5 text-xs text-stone-200 outline-none font-semibold uppercase tracking-wider"
                      />
                      <button onClick={handleSaveEditCat} className="text-jade-400 hover:text-jade-300"><Check size={12} /></button>
                      <button onClick={() => { setEditingCatId(null); setShowEditEmojiPicker(false); }} className="text-stone-600 hover:text-stone-400"><X size={12} /></button>
                      {!(cat.is_builtin as unknown as number) && (
                        confirmDeleteCatId === cat.id ? (
                          <>
                            <button onClick={() => handleDeleteCat(cat.id)} className="text-xs text-red-400 hover:text-red-300 px-1">{t('trash.confirmYes')}</button>
                            <button onClick={() => setConfirmDeleteCatId(null)} className="text-xs text-stone-500 hover:text-stone-300">{t('trash.confirmNo')}</button>
                          </>
                        ) : (
                          <button onClick={() => handleDeleteCat(cat.id)} className="text-stone-500 hover:text-red-400 transition-colors p-0.5 ml-1">
                            <Trash2 size={12} />
                          </button>
                        )
                      )}
                    </div>
                  ) : (
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
                  )}
                  <div className={view === 'cards' ? 'grid grid-cols-3 gap-3' : 'space-y-1.5'}>
                    {ops.length === 0 ? (
                      <p className="text-xs text-stone-700 px-1 py-1">{t('operations.none')}</p>
                    ) : ops.map(renderOp)}
                  </div>
                </div>
              ))}
              {uncategorized.length > 0 && (
                <div>
                  <p className="text-xs text-stone-600 font-semibold uppercase tracking-wider mb-2">📄 Other</p>
                  <div className={view === 'cards' ? 'grid grid-cols-3 gap-3' : 'space-y-1.5'}>
                    {uncategorized.map(renderOp)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={view === 'cards' ? 'grid grid-cols-3 gap-3' : 'space-y-1.5'}>
              {sortedOps.map(renderOp)}
            </div>
          )}
        </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          actions={[
            ...(operations.find((o) => o.id === ctxMenu.id)?.category_id === 'sigils'
              ? []
              : [{ label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) }]),
            { label: t('contextMenu.rename'),    icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.id) },
            { label: t('contextMenu.delete'),    icon: <Trash2 size={12} />, onClick: () => handleCtxDelete(ctxMenu.id), danger: true },
          ]}
        />
      )}
      </div>
    );
  }

  if (isSigilOperation) {
    return <OperationSigilView operation={operation} />;
  }

  const currentCat = getCatById(isEditing ? categoryId : operation.category_id);

  return (
    <div className="h-full flex flex-col">
      {/* Topbar */}
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          {operation.icon
            ? <img src={operation.icon} alt="" className="w-5 h-5 object-cover rounded" />
            : <span>{currentCat?.emoji ?? '⚡'}</span>
          }
          <span>{currentCat?.name ?? '—'}</span>
          <span>·</span>
          <span>{format(new Date(operation.updated_at), 'MMM d, yyyy')}</span>
          {isEditing && <span className="text-stone-700 italic ml-1">{t('editor.editing')}</span>}
        </div>
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button onClick={handleDone}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-jade-900/40 hover:bg-jade-900/60
                           text-jade-400 text-xs font-medium rounded-md border border-jade-800/40 transition-colors">
                <Check size={13} />{t('editor.done')}
              </button>
              <button onClick={handleDelete} className="btn-ghost text-red-600 hover:text-red-400">
                <Trash2 size={15} />
              </button>
              <button onClick={handleCancel} className="btn-ghost"><X size={15} /></button>
            </>
          ) : (
            <>
              <button onClick={enterEditMode} className="btn-ghost" title={t('editor.edit')}>
                <Pencil size={15} />
              </button>
              <button onClick={toggleRightSidebar} className="btn-ghost">
                <PanelRightOpen size={15} />
              </button>
            </>
          )}
        </div>
      </div>


      {/* Title */}
      <div className="px-8 pt-6 pb-4 flex-shrink-0" onDoubleClick={enterEditMode}>
        {isEditing ? (
          <input autoFocus type="text" value={title}
            onChange={(e) => { setTitle(e.target.value); triggerAutoSave(); }}
            placeholder={t('operations.untitled')}
            className="w-full bg-transparent text-2xl font-semibold text-stone-100
                       placeholder-stone-700 outline-none selectable font-serif" />
        ) : (
          <h1 className="text-2xl font-semibold text-stone-100 font-serif cursor-text">
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

      {/* Custom properties marked "show in entry" */}
      <EntryCustomProperties entryId={operation.id} entryType="operation" isEditing={false} />

      {/* Tags */}
      <div className="px-8 pb-3 flex-shrink-0" onDoubleClick={enterEditMode}>
        <TagInput tags={tags} onChange={(newTags) => { setTags(newTags); triggerAutoSave(); }} readOnly={true} />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden px-8 pb-8" onDoubleClick={enterEditMode}>
        <RichEditor
          key={operation.id}
          content={content}
          placeholder={t('operations.placeholder')}
          onChange={handleContentChange}
          editable={isEditing}
        />
      </div>
    </div>
  );
}
