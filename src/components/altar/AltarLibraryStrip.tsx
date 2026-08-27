import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Check, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { FALLBACK_CATEGORY } from '../../lib/schema';
import { altarCategoryLabel } from '../../lib/categories';
import { setAltarDragItem } from '../../lib/altarDragState';
import { readFileAsDataUrl, ACCEPTED_IMAGE_MIME, isAcceptedImageFile } from '../../lib/helpers';
import { imageSrc } from '../../lib/images';
import type { AltarCategory, AltarItem } from '../../types';
import Modal from '../ui/Modal';
import EmojiPicker from '../ui/EmojiPicker';
import Button from '../ui/Button';

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
  const [editCategory, setEditCategory] = useState(item?.category_id ?? defaultCategory);
  const [editImageData, setEditImageData] = useState<string | null>(item?.image_data ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const getCategoryEmoji = (catId: string) => categories.find((c) => c.id === catId)?.emoji ?? '✨';

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAcceptedImageFile(file)) {
      setImageError(t('common.unsupportedImageFormat'));
      e.target.value = '';
      return;
    }
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
        category_id: editCategory,
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
    <Modal
      title={item ? t('editor.edit') : t('altar.addElement')}
      onClose={onClose}
      widthClassName="w-full max-w-md"
      bodyClassName="p-4 space-y-3"
    >
        <div className="flex gap-2">
          <EmojiPicker
            value={editEmoji}
            onChange={(emoji) => { setEditEmoji(emoji); setEditImageData(null); }}
            size="lg"
            wrapperClassName="relative flex-1"
            trigger={({ toggle }) => (
              <button onClick={toggle} className="w-full flex items-center gap-2 bg-stone-800/60 rounded-lg px-3 py-2 text-sm hover:bg-stone-700/60 transition-colors">
                {imageSrc(editImageData)
                  ? <img src={imageSrc(editImageData)} alt="" className="w-6 h-6 object-contain rounded" />
                  : <span className="text-xl">{editEmoji || getCategoryEmoji(editCategory)}</span>}
                <span className="text-xs text-stone-500">{t('altar.chooseEmoji')}</span>
              </button>
            )}
          />
          <button onClick={() => imageInputRef.current?.click()} className="flex-shrink-0 flex items-center gap-1 px-2 py-2 bg-stone-800/60 rounded-lg hover:bg-stone-700/60 transition-colors text-stone-500 hover:text-stone-300" title={t('altar.uploadImage')}><ImagePlus size={14} /></button>
        </div>
        {imageError && <p className="text-xs text-red-400">{imageError}</p>}
        <input ref={imageInputRef} type="file" accept={ACCEPTED_IMAGE_MIME} className="hidden" onChange={handleImageChange} />
        <input ref={nameInputRef} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('altar.elementName')} className="w-full bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable" />
        <div className="flex flex-wrap gap-1">
          {categories.map((cat) => (
            <button key={cat.id} onClick={() => { setEditCategory(cat.id); setEditEmoji(''); }} className={`text-xs px-2 py-1 rounded-md transition-colors ${editCategory === cat.id ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{cat.emoji} {altarCategoryLabel(t, cat)}</button>
          ))}
        </div>
        {item && confirmDelete ? (
          <div className="flex items-center justify-between rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
            <span className="text-xs text-red-300">{t('common.deleteConfirm')}</span>
            <span className="flex items-center gap-2">
              <Button onClick={doDelete} variant="danger" className="text-xs">{t('common.confirmYes')}</Button>
              <Button onClick={() => setConfirmDelete(false)} variant="ghost" className="text-xs">{t('common.confirmNo')}</Button>
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {item ? (
              <Button onClick={doDelete} variant="danger" className="flex items-center gap-1 text-xs">
                <Trash2 size={11} /> {t('common.delete')}
              </Button>
            ) : <span />}
            <div className="flex items-center gap-1">
              <Button onClick={onClose} variant="ghost"><X size={13} /></Button>
              <Button onClick={save} variant="ghost" className="text-jade-400"><Check size={13} /></Button>
            </div>
          </div>
        )}
    </Modal>
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
  onTabChange: (tabId: string) => void;
}) {
  const { t } = useTranslation();
  const { addCategory, updateCategory, deleteCategory } = useAltarStore(
    useShallow((s) => ({ addCategory: s.addCategory, updateCategory: s.updateCategory, deleteCategory: s.deleteCategory })),
  );
  // Bewusst der gespeicherte Name, nicht altarCategoryLabel(): das Feld
  // editiert den DB-Wert. Die Uebersetzung vorzubefuellen wuerde sie beim
  // Speichern in die DB schreiben und die Kategorie auf eine Sprache nageln.
  const [catName, setCatName] = useState(category?.name ?? '');
  const [catEmoji, setCatEmoji] = useState(category?.emoji ?? '📦');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState('');

  // Die Default-Kategorie ist das Ziel, auf das die Objekte anderer Kategorien
  // beim Löschen umgehängt werden. Sie selbst zu löschen lehnt der Store ab —
  // also den Knopf gar nicht erst anbieten, statt still nichts zu tun.
  const isFallback = category?.id === FALLBACK_CATEGORY.altar_items;

  const save = async () => {
    if (!catName.trim()) return;
    setNameError('');
    const emoji = catEmoji.trim() || '📦';
    try {
      if (category) {
        await updateCategory(category.id, catName.trim(), emoji);
      } else {
        const cat = await addCategory(catName.trim(), emoji);
        onTabChange(cat.id);
      }
    } catch (e) {
      setNameError(e instanceof Error ? e.message : String(e));
      return;
    }
    onClose();
  };

  const doDelete = async () => {
    if (!category) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await deleteCategory(category.id);
    // Die Items der Kategorie wandern nach 'other', nicht ins Kategorielose.
    onTabChange('all');
    onClose();
  };

  return (
    <Modal
      title={category ? t('editor.edit') : t('altar.addCategory')}
      onClose={onClose}
      widthClassName="w-full max-w-xs"
      bodyClassName="p-4 space-y-3"
    >
        <div className="flex gap-2 items-center">
          <EmojiPicker
            value={catEmoji}
            onChange={setCatEmoji}
            size="lg"
            trigger={({ toggle }) => (
              <button onClick={toggle} className="w-10 h-10 flex items-center justify-center text-2xl bg-stone-800/60 rounded-lg hover:bg-stone-700/60 transition-colors">{catEmoji}</button>
            )}
          />
          <input value={catName} onChange={(e) => { setCatName(e.target.value); setNameError(''); }} placeholder={t('altar.categoryName')} className="flex-1 bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable" onKeyDown={(e) => { if (e.key === 'Enter') save(); }} autoFocus />
        </div>
        {nameError && <p className="text-xs text-red-400">{nameError}</p>}
        {category && !isFallback && confirmDelete ? (
          <div className="flex items-center justify-between rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
            <span className="text-xs text-red-300">{t('common.deleteConfirm')}</span>
            <span className="flex items-center gap-2">
              <Button onClick={doDelete} variant="danger" className="text-xs">{t('common.confirmYes')}</Button>
              <Button onClick={() => setConfirmDelete(false)} variant="ghost" className="text-xs">{t('common.confirmNo')}</Button>
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {category && !isFallback ? (
              <Button onClick={doDelete} variant="danger" className="flex items-center gap-1 text-xs">
                <Trash2 size={11} /> {t('common.delete')}
              </Button>
            ) : <span />}
            <div className="flex items-center gap-1">
              <Button onClick={onClose} variant="ghost"><X size={13} /></Button>
              <Button onClick={save} variant="ghost" className="text-jade-400"><Check size={13} /></Button>
            </div>
          </div>
        )}
    </Modal>
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
  const pointerDragRef = useRef<{ id: string; hasMoved: boolean } | null>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const liveOrderRef = useRef<string[] | null>(null);
  const lastHoverIdRef = useRef<string | null>(null);
  const [dragCatId, setDragCatId] = useState<string | null>(null);
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const catScrollRef = useRef<HTMLDivElement>(null);
  const [catScrollState, setCatScrollState] = useState({ left: false, right: false });
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

  const hasUncategorized = items.some((i) => !categories.find((c) => c.id === i.category_id));

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

  const applyFlipAndUpdate = (newOrder: string[]) => {
    const firstPositions = new Map<string, number>();
    for (const [id, el] of tabRefs.current) {
      firstPositions.set(id, el.getBoundingClientRect().left);
    }
    liveOrderRef.current = newOrder;
    flushSync(() => setLiveOrder([...newOrder]));
    for (const [id, el] of tabRefs.current) {
      const first = firstPositions.get(id);
      if (first === undefined) continue;
      const delta = first - el.getBoundingClientRect().left;
      if (Math.abs(delta) < 0.5) continue;
      el.style.transition = 'none';
      el.style.transform = `translateX(${delta}px)`;
    }
    requestAnimationFrame(() => {
      for (const [, el] of tabRefs.current) {
        if (!el.style.transform) continue;
        el.style.transition = 'transform 150ms ease';
        el.style.transform = '';
      }
    });
  };

  const handleCatPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    pointerDragRef.current = { id, hasMoved: false };
    liveOrderRef.current = categories.map((c) => c.id);
    lastHoverIdRef.current = null;

    const onMove = (me: PointerEvent) => {
      if (!pointerDragRef.current) return;
      if (!pointerDragRef.current.hasMoved) {
        pointerDragRef.current.hasMoved = true;
        setDragCatId(id);
        document.body.style.cursor = 'grabbing';
      }
      const el = document.elementFromPoint(me.clientX, me.clientY);
      const catEl = el?.closest('[data-cat-id]');
      const hoverId = catEl?.getAttribute('data-cat-id') ?? null;
      if (!hoverId || hoverId === id || hoverId === lastHoverIdRef.current) return;
      lastHoverIdRef.current = hoverId;
      const current = liveOrderRef.current!;
      const fromIdx = current.indexOf(id);
      const toIdx = current.indexOf(hoverId);
      if (fromIdx === -1 || toIdx === -1) return;
      const newOrder = [...current];
      const [removed] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, removed);
      applyFlipAndUpdate(newOrder);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      const state = pointerDragRef.current;
      const finalOrder = liveOrderRef.current;
      pointerDragRef.current = null;
      liveOrderRef.current = null;
      lastHoverIdRef.current = null;
      for (const [, el] of tabRefs.current) {
        el.style.transition = '';
        el.style.transform = '';
      }
      setDragCatId(null);
      setLiveOrder(null);
      if (state?.hasMoved && finalOrder) {
        useAltarStore.getState().reorderCategories(finalOrder);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const displayCategories = liveOrder
    ? liveOrder.map((id) => categories.find((c) => c.id === id)).filter((c): c is AltarCategory => !!c)
    : categories;

  const checkCatScroll = useCallback(() => {
    const el = catScrollRef.current;
    if (!el) return;
    setCatScrollState({
      left: el.scrollLeft > 0,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
    });
  }, []);

  useEffect(() => { checkCatScroll(); }, [displayCategories, checkCatScroll]);

  const defaultCategory = categories[0]?.id ?? '';

  // Die Tab-IDs sind Kategorie-IDs, und item.category_id haelt seit v33
  // ebenfalls die ID — der Umweg über den Namen entfällt damit.
  const filteredItems = activeCategoryTab === 'all'
    ? items
    : activeCategoryTab === UNCATEGORIZED_TAB
      ? items.filter((i) => !categories.find((c) => c.id === i.category_id))
      : items.filter((item) => item.category_id === activeCategoryTab);

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
        <Button onClick={openCreateModal} variant="ghost" className="flex-shrink-0 flex items-center gap-1 text-xs" title={t('altar.addElement')}><Plus size={12} />{t('altar.element')}</Button>
      </div>
      <div className="mb-3 flex items-center gap-1">
        <div className="relative flex-1 min-w-0">
          <div className={`altar-cat-scroll-fade pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-stone-900 to-transparent transition-opacity duration-150 ${catScrollState.left ? 'opacity-100' : 'opacity-0'}`} />
          <div className={`altar-cat-scroll-fade pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-stone-900 to-transparent transition-opacity duration-150 ${catScrollState.right ? 'opacity-100' : 'opacity-0'}`} />
          <div ref={catScrollRef} onScroll={checkCatScroll} className="scrollbar-none flex gap-1 overflow-x-auto">
            <button onClick={() => setActiveCategoryTab('all')} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === 'all' ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{t('altar.all')}</button>
            {displayCategories.map((cat) => (
              <div
                key={cat.id}
                data-cat-id={cat.id}
                ref={(el) => { if (el) tabRefs.current.set(cat.id, el); else tabRefs.current.delete(cat.id); }}
                onPointerDown={(e) => handleCatPointerDown(e, cat.id)}
                className={`group relative flex items-center select-none ${dragCatId === cat.id ? 'opacity-40' : 'opacity-100'}`}
              >
                <button onClick={() => setActiveCategoryTab(cat.id)} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap cursor-grab ${activeCategoryTab === cat.id ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{cat.emoji} {altarCategoryLabel(t, cat)}</button>
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
          </div>
        </div>
        <button onClick={openAddCategoryModal} className="flex-shrink-0 px-2 py-1 rounded-md text-xs text-stone-600 hover:text-stone-400 transition-colors flex items-center gap-1" title={t('altar.addCategory')}><Plus size={11} />{t('altar.category')}</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {filteredItems.length === 0 && <p className="text-xs text-stone-700 px-2 py-3">{t('altar.noElements')}</p>}
        <div className="grid [grid-template-columns:repeat(auto-fill,70px)] gap-1.5 justify-start">
          {filteredItems.map((item) => (
            <div key={item.id} onPointerDown={(e) => { if (!editable) return; e.preventDefault(); setAltarDragItem(item); }} className={`group w-[70px] h-[85px] rounded-md border border-stone-700/60 bg-stone-900/40 px-1.5 py-2 flex flex-col ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-90'}`}>
              <div className="mb-1 w-full h-12 flex items-center justify-center overflow-hidden rounded-sm bg-stone-950/35">
                {imageSrc(item.image_data)
                  ? <img src={imageSrc(item.image_data)} alt="" className="h-full w-full object-contain" draggable={false} />
                  : <span className={`leading-none select-none ${item.category_id === 'candle' ? 'candle-flame' : ''}`} style={{ fontSize: 34 }}>{item.emoji}</span>}
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
