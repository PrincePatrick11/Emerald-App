import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Check, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { setAltarDragItem } from '../../lib/altarDragState';
import { ALTAR_CAT_EMOJIS, CATEGORY_EMOJIS, FALLBACK_CATEGORY_EMOJIS } from '../../lib/altarConstants';
import { readFileAsDataUrl } from '../../lib/helpers';
import type { AltarCategory, AltarItem } from '../../types';

const LIBRARY_DEFAULT_HEIGHT = 240;
const UNCATEGORIZED_TAB = '__uncategorized__' as const;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// ─── Item create/edit modal ───────────────────────────────────────────────────

function ItemModal({
  item,
  categories,
  defaultCategory,
  onClose,
}: {
  item: AltarItem | null;
  categories: AltarCategory[];
  defaultCategory: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { addItem, updateItem, deleteItem } = useAltarStore(
    useShallow((s) => ({ addItem: s.addItem, updateItem: s.updateItem, deleteItem: s.deleteItem })),
  );
  const [editName, setEditName] = useState(item?.name ?? '');
  const [editEmoji, setEditEmoji] = useState(item?.emoji ?? '');
  const [editCategory, setEditCategory] = useState(item?.category ?? defaultCategory);
  const [editImageData, setEditImageData] = useState<string | null>(item?.image_data ?? null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const getCategoryEmoji = (catName: string) => categories.find((c) => c.name === catName)?.emoji ?? '✨';
  const getEmojiSuggestions = (catName: string) => CATEGORY_EMOJIS[catName] ?? FALLBACK_CATEGORY_EMOJIS;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > IMAGE_MAX_BYTES) {
      setImageError(t('altar.imageTooLarge', { max: '2 MB' }));
      e.target.value = '';
      return;
    }
    setImageError(null);
    readFileAsDataUrl(file).then((data) => {
      setEditImageData(data);
      if (!editName.trim()) {
        setEditName(file.name.replace(/\.[^.]+$/, ''));
        setTimeout(() => nameInputRef.current?.select(), 0);
      }
    });
    e.target.value = '';
  };

  const save = async () => {
    if (!editName.trim()) return;
    const fallbackEmoji = getCategoryEmoji(editCategory);
    if (item) {
      await updateItem(item.id, {
        name: editName.trim(),
        emoji: editEmoji || fallbackEmoji,
        category: editCategory,
        image_data: editImageData ?? undefined,
      });
    } else {
      await addItem(editName.trim(), editEmoji || fallbackEmoji, editCategory, undefined, editImageData ?? undefined);
    }
    onClose();
  };

  const doDelete = async () => {
    if (!item) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await deleteItem(item.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-xl border border-stone-700/80 bg-stone-900 p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-stone-200">{item ? t('editor.edit') : t('altar.addItem')}</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="w-full flex items-center gap-2 bg-stone-800/60 rounded-lg px-3 py-2 text-sm hover:bg-stone-700/60 transition-colors">
              {editImageData?.startsWith('data:image/')
                ? <img src={editImageData} alt="" className="w-6 h-6 object-contain rounded" />
                : <span className="text-xl">{editEmoji || getCategoryEmoji(editCategory)}</span>}
              <span className="text-xs text-stone-500">{t('altar.chooseEmoji')}</span>
            </button>
            {showEmojiPicker && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2">
                <div className="flex flex-wrap gap-1">
                  {getEmojiSuggestions(editCategory).map((emoji) => (
                    <button key={emoji} onClick={() => { setEditEmoji(emoji); setEditImageData(null); setShowEmojiPicker(false); }} className={`text-xl p-1 rounded transition-colors ${editEmoji === emoji ? 'bg-stone-700' : ''}`}>{emoji}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={() => imageInputRef.current?.click()} className="flex-shrink-0 flex items-center gap-1 px-2 py-2 bg-stone-800/60 rounded-lg hover:bg-stone-700/60 transition-colors text-stone-500 hover:text-stone-300" title={t('altar.uploadImage')}><ImagePlus size={14} /></button>
        </div>
        {imageError && <p className="text-xs text-red-400">{imageError}</p>}
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
        <input ref={nameInputRef} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('altar.itemName')} className="w-full bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable" />
        <div className="flex flex-wrap gap-1">
          {categories.map((cat) => (
            <button key={cat.id} onClick={() => { setEditCategory(cat.name); setEditEmoji(''); setShowEmojiPicker(false); }} className={`text-xs px-2 py-1 rounded-md transition-colors ${editCategory === cat.name ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{cat.emoji} {cat.name}</button>
          ))}
        </div>
        {item && confirmDelete ? (
          <div className="flex items-center justify-between rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
            <span className="text-xs text-red-300">{t('altar.removeElement')}?</span>
            <span className="flex items-center gap-2">
              <button onClick={doDelete} className="text-xs text-red-300 hover:text-red-200">{t('trash.confirmYes')}</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-stone-400 hover:text-stone-200">{t('trash.confirmNo')}</button>
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {item ? <button onClick={doDelete} className="text-xs text-red-400 hover:text-red-300">{t('altar.removeElement')}</button> : <span />}
            <div className="flex items-center gap-1">
              <button onClick={onClose} className="btn-ghost"><X size={13} /></button>
              <button onClick={save} className="btn-ghost text-jade-400"><Check size={13} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Category create/edit modal ───────────────────────────────────────────────

function CategoryModal({
  category,
  onClose,
  onTabChange,
}: {
  category: AltarCategory | null;
  onClose: () => void;
  onTabChange: (tabName: string) => void;
}) {
  const { t } = useTranslation();
  const { addCategory, updateCategory, deleteCategory } = useAltarStore(
    useShallow((s) => ({ addCategory: s.addCategory, updateCategory: s.updateCategory, deleteCategory: s.deleteCategory })),
  );
  const [catName, setCatName] = useState(category?.name ?? '');
  const [catEmoji, setCatEmoji] = useState(category?.emoji ?? '📦');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    if (!catName.trim()) return;
    const emoji = catEmoji.trim() || '📦';
    if (category) {
      await updateCategory(category.id, catName.trim(), emoji);
    } else {
      const cat = await addCategory(catName.trim(), emoji);
      onTabChange(cat.name);
    }
    setShowEmojiPicker(false);
    onClose();
  };

  const doDelete = async () => {
    if (!category) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await deleteCategory(category.id);
    onTabChange(UNCATEGORIZED_TAB);
    setShowEmojiPicker(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={() => { onClose(); setShowEmojiPicker(false); }}>
      <div className="w-full max-w-xs rounded-xl border border-stone-700/80 bg-stone-900 p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-stone-200">{category ? t('editor.edit') : (t('altar.addCategory') ?? 'Add Category')}</p>
        <div className="flex gap-2 items-center">
          <div className="relative flex-shrink-0">
            <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="w-10 h-10 flex items-center justify-center text-2xl bg-stone-800/60 rounded-lg hover:bg-stone-700/60 transition-colors">{catEmoji}</button>
            {showEmojiPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2 w-52">
                <div className="flex flex-wrap gap-1">
                  {ALTAR_CAT_EMOJIS.map((e) => (
                    <button key={e} onClick={() => { setCatEmoji(e); setShowEmojiPicker(false); }} className={`text-xl p-1 rounded transition-colors ${catEmoji === e ? 'bg-stone-700' : 'hover:bg-stone-700/50'}`}>{e}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder={t('altar.categoryName') ?? 'Category name'} className="flex-1 bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable" onKeyDown={(e) => { if (e.key === 'Enter') save(); }} autoFocus />
        </div>
        {category && confirmDelete ? (
          <div className="flex items-center justify-between rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
            <span className="text-xs text-red-300">{t('common.deleteConfirm')}</span>
            <span className="flex items-center gap-2">
              <button onClick={doDelete} className="text-xs text-red-300 hover:text-red-200">{t('trash.confirmYes')}</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-stone-400 hover:text-stone-200">{t('trash.confirmNo')}</button>
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {category ? (
              <button onClick={doDelete} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                <Trash2 size={11} /> {t('common.delete')}
              </button>
            ) : <span />}
            <div className="flex items-center gap-1">
              <button onClick={() => { setShowEmojiPicker(false); onClose(); }} className="btn-ghost"><X size={13} /></button>
              <button onClick={save} className="btn-ghost text-jade-400"><Check size={13} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Library strip ────────────────────────────────────────────────────────────

export function AltarLibraryStrip({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const { items, categories } = useAltarStore(
    useShallow((s) => ({ items: s.items, categories: s.categories })),
  );

  // Strip-level state
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | string>('all');
  const [isResizeHotspot, setIsResizeHotspot] = useState(false);
  const isResizeHotspotRef = useRef(false); // keeps onMouseLeave closure current without re-subscribing
  const [isResizing, setIsResizing] = useState(false);
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = Number(localStorage.getItem('altar-library-height'));
    if (Number.isFinite(saved) && saved >= 160 && saved <= 460) return saved;
    return LIBRARY_DEFAULT_HEIGHT;
  });

  // Modal control state (modals manage their own edit state internally)
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AltarItem | null>(null);
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<AltarCategory | null>(null);

  const hasUncategorized = items.some((i) => !categories.find((c) => c.name === i.category));

  useEffect(() => {
    if (activeCategoryTab === UNCATEGORIZED_TAB && !hasUncategorized) {
      setActiveCategoryTab('all');
    }
  }, [hasUncategorized, activeCategoryTab]);

  const openCreateModal = () => { setEditingItem(null); setIsItemModalOpen(true); };
  const openEditModal = (item: AltarItem) => { setEditingItem(item); setIsItemModalOpen(true); };
  const openAddCategoryModal = () => { setEditingCat(null); setIsCatModalOpen(true); };
  const openEditCategoryModal = (cat: AltarCategory) => { setEditingCat(cat); setIsCatModalOpen(true); };

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    const startY = event.clientY;
    const startHeight = panelHeight;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      setPanelHeight(Math.max(160, Math.min(460, startHeight + delta)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    localStorage.setItem('altar-library-height', String(panelHeight));
  }, [panelHeight]);

  useEffect(() => {
    const unlisten = listen('reset-sidebar-widths', () => {
      setPanelHeight(LIBRARY_DEFAULT_HEIGHT);
      localStorage.removeItem('altar-library-height');
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handlePanelMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientY - bounds.top <= 6) startResize(event);
  };

  const handlePanelMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextHotspot = event.clientY - bounds.top <= 6;
    if (nextHotspot === isResizeHotspotRef.current) return;
    isResizeHotspotRef.current = nextHotspot;
    setIsResizeHotspot(nextHotspot);
  };

  const defaultCategory = categories[0]?.name ?? '';

  const filteredItems = activeCategoryTab === 'all'
    ? items
    : activeCategoryTab === UNCATEGORIZED_TAB
      ? items.filter((i) => !categories.find((c) => c.name === i.category))
      : items.filter((item) => item.category === activeCategoryTab);

  return (
    <div
      className={`relative flex-shrink-0 border-t border-stone-700/60 px-6 py-3 flex flex-col min-h-0 ${isResizing || isResizeHotspot ? 'cursor-row-resize' : 'cursor-default'}`}
      style={{ height: panelHeight }}
      onMouseDown={handlePanelMouseDown}
      onMouseMove={handlePanelMouseMove}
      onMouseLeave={() => {
        if (!isResizeHotspotRef.current) return;
        isResizeHotspotRef.current = false;
        setIsResizeHotspot(false);
      }}
    >
      <div className={`pointer-events-none absolute top-0 left-0 right-0 h-1 transition-colors ${(isResizing || isResizeHotspot) ? 'bg-jade-500/20' : 'bg-transparent'}`} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{t('altar.libraryTitle')}</p>
        <button onClick={openCreateModal} className="btn-ghost flex-shrink-0 flex items-center gap-1 text-xs" title={t('altar.addItem')}><Plus size={12} />{t('altar.element')}</button>
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        <button onClick={() => setActiveCategoryTab('all')} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === 'all' ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{t('altar.all')}</button>
        {categories.map((cat) => (
          <div key={cat.id} className="group relative flex items-center">
            <button onClick={() => setActiveCategoryTab(cat.name)} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === cat.name ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{cat.emoji} {cat.name}</button>
            <button onClick={(e) => { e.stopPropagation(); openEditCategoryModal(cat); }} className="absolute -right-1 -top-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-stone-700 text-stone-400 hover:text-stone-200 transition-colors" title={t('editor.edit')}><Pencil size={8} /></button>
          </div>
        ))}
        {hasUncategorized && (
          <button
            onClick={() => setActiveCategoryTab(UNCATEGORIZED_TAB)}
            className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === UNCATEGORIZED_TAB ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}
          >
            {t('altar.uncategorized')}
          </button>
        )}
        <button onClick={openAddCategoryModal} className="px-2 py-1 rounded-md text-xs text-stone-600 hover:text-stone-400 transition-colors whitespace-nowrap flex-shrink-0 flex items-center gap-1" title={t('altar.addCategory')}><Plus size={11} />{t('altar.category')}</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {filteredItems.length === 0 && <p className="text-xs text-stone-700 px-2 py-3">{t('altar.noItems')}</p>}
        <div className="grid [grid-template-columns:repeat(auto-fill,70px)] gap-1.5 justify-start">
          {filteredItems.map((item) => (
            <div key={item.id} onPointerDown={(e) => { if (!editable) return; e.preventDefault(); setAltarDragItem(item); }} className={`group w-[70px] h-[85px] rounded-md border border-stone-700/60 bg-stone-900/40 px-1.5 py-2 flex flex-col ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-90'}`}>
              <div className="mb-1 w-full h-12 flex items-center justify-center overflow-hidden rounded-sm bg-stone-950/35">
                {item.image_data?.startsWith('data:image/')
                  ? <img src={item.image_data} alt="" className="h-full w-full object-contain" draggable={false} />
                  : <span className={`leading-none select-none ${item.category === 'candle' ? 'candle-flame' : ''}`} style={{ fontSize: 34 }}>{item.emoji}</span>}
              </div>
              <div className="mt-auto flex items-center gap-1">
                <span className="flex-1 truncate text-[10px] text-stone-300">{item.name}</span>
                {editable ? <button onClick={(e) => { e.stopPropagation(); openEditModal(item); }} className="text-stone-600 hover:text-stone-300 transition-colors p-0.5" title={t('editor.edit')}><Pencil size={10} /></button> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isItemModalOpen && (
        <ItemModal
          key={editingItem?.id ?? 'create'}
          item={editingItem}
          categories={categories}
          defaultCategory={defaultCategory}
          onClose={() => setIsItemModalOpen(false)}
        />
      )}

      {isCatModalOpen && (
        <CategoryModal
          key={editingCat?.id ?? 'create'}
          category={editingCat}
          onClose={() => setIsCatModalOpen(false)}
          onTabChange={setActiveCategoryTab}
        />
      )}
    </div>
  );
}
