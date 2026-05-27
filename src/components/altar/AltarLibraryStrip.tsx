import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Check, ImagePlus, Pencil, Plus, X } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { setAltarDragItem } from '../../lib/altarDragState';
import { ALTAR_CATEGORIES, ALTAR_CATEGORY_EMOJI, CATEGORY_EMOJIS } from '../../lib/altarConstants';
import type { AltarItem, AltarItemCategory } from '../../types';

export function AltarLibraryStrip({ editable }: { editable: boolean }) {
  const LIBRARY_DEFAULT_HEIGHT = 240;
  const { t } = useTranslation();
  const { items, addItem, updateItem, deleteItem } = useAltarStore();
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [activeCategoryTab, setActiveCategoryTab] = useState<'all' | AltarItemCategory>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editCategory, setEditCategory] = useState<AltarItemCategory>('other');
  const [editImageData, setEditImageData] = useState<string | null>(null);
  const [showEditEmojiPicker, setShowEditEmojiPicker] = useState(false);
  const editImageInputRef = useRef<HTMLInputElement>(null);
  const [isResizeHotspot, setIsResizeHotspot] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = Number(localStorage.getItem('altar-library-height'));
    if (Number.isFinite(saved) && saved >= 160 && saved <= 460) return saved;
    return LIBRARY_DEFAULT_HEIGHT;
  });

  const handleImageFile = (file: File, onResult: (data: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => onResult(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleDelete = async (item: AltarItem) => {
    if (!editable) return;
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id);
      return;
    }
    setConfirmDeleteId(null);
    if (editingItemId === item.id) {
      setEditingItemId(null);
      setIsItemModalOpen(false);
    }
    await deleteItem(item.id);
  };

  const handleEditImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleImageFile(file, (data) => setEditImageData(data));
    e.target.value = '';
  };

  const openEditModal = (item: AltarItem) => {
    setIsItemModalOpen(true);
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditEmoji(item.emoji);
    setEditCategory(item.category as AltarItemCategory);
    setEditImageData(item.image_data ?? null);
    setShowEditEmojiPicker(false);
    setConfirmDeleteId(null);
  };

  const openCreateModal = () => {
    setIsItemModalOpen(true);
    setEditingItemId(null);
    setEditName('');
    setEditCategory('other');
    setEditEmoji('');
    setEditImageData(null);
    setShowEditEmojiPicker(false);
    setConfirmDeleteId(null);
  };

  const saveEditModal = async () => {
    if (!editName.trim()) return;
    if (editingItemId) {
      await updateItem(editingItemId, {
        name: editName.trim(),
        emoji: editEmoji || ALTAR_CATEGORY_EMOJI[editCategory],
        category: editCategory,
        image_data: editImageData ?? undefined,
      });
    } else {
      await addItem(
        editName.trim(),
        editEmoji || ALTAR_CATEGORY_EMOJI[editCategory],
        editCategory,
        undefined,
        editImageData ?? undefined
      );
    }
    setIsItemModalOpen(false);
    setEditingItemId(null);
  };

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    const startY = event.clientY;
    const startHeight = panelHeight;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const nextHeight = Math.max(160, Math.min(460, startHeight + delta));
      setPanelHeight(nextHeight);
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
    const nearTopEdge = event.clientY - bounds.top <= 6;
    if (!nearTopEdge) return;
    startResize(event);
  };

  const handlePanelMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setIsResizeHotspot(event.clientY - bounds.top <= 6);
  };

  const filteredItems = activeCategoryTab === 'all'
    ? items
    : items.filter((item) => item.category === activeCategoryTab);

  return (
    <div
      className={`relative flex-shrink-0 border-t border-stone-700/60 px-6 py-3 flex flex-col min-h-0 ${isResizing || isResizeHotspot ? 'cursor-row-resize' : 'cursor-default'}`}
      style={{ height: panelHeight }}
      onMouseDown={handlePanelMouseDown}
      onMouseMove={handlePanelMouseMove}
      onMouseLeave={() => setIsResizeHotspot(false)}
    >
      <div className={`pointer-events-none absolute top-0 left-0 right-0 h-1 transition-colors ${(isResizing || isResizeHotspot) ? 'bg-jade-500/20' : 'bg-transparent'}`} />
      <input ref={editImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditImageChange} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{t('altar.libraryTitle')}</p>
        <button onClick={openCreateModal} className="btn-ghost flex-shrink-0" title={t('altar.addItem')}><Plus size={14} /></button>
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        <button onClick={() => setActiveCategoryTab('all')} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === 'all' ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}>{t('altar.all')}</button>
        {ALTAR_CATEGORIES.map((cat) => (
          <button key={cat} onClick={() => setActiveCategoryTab(cat)} className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === cat ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`} title={t(`altar.categories.${cat}`)}>{ALTAR_CATEGORY_EMOJI[cat]} {t(`altar.categories.${cat}`)}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {filteredItems.length === 0 && <p className="text-xs text-stone-700 px-2 py-3">{t('altar.noItems')}</p>}
        <div className="grid [grid-template-columns:repeat(auto-fill,70px)] gap-1.5 justify-start">
          {filteredItems.map((item) => (
            <div key={item.id} onPointerDown={(e) => { if (!editable) return; e.preventDefault(); setAltarDragItem(item); }} className={`group w-[70px] h-[85px] rounded-md border border-stone-700/60 bg-stone-900/40 px-1.5 py-2 flex flex-col ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-90'}`}>
              <div className="mb-1 w-full h-12 flex items-center justify-center overflow-hidden rounded-sm bg-stone-950/35">
                {item.image_data ? <img src={item.image_data} alt="" className="h-full w-full object-contain" draggable={false} /> : <span className={`leading-none select-none ${item.category === 'candle' ? 'candle-flame' : ''}`} style={{ fontSize: 34 }}>{item.emoji}</span>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={() => { setIsItemModalOpen(false); setEditingItemId(null); }}>
          <div className="w-full max-w-md rounded-xl border border-stone-700/80 bg-stone-900 p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-stone-200">{editingItemId ? t('editor.edit') : t('altar.addItem')}</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <button onClick={() => setShowEditEmojiPicker(!showEditEmojiPicker)} className="w-full flex items-center gap-2 bg-stone-800/60 rounded-lg px-3 py-2 text-sm hover:bg-stone-700/60 transition-colors">
                  {editImageData ? <img src={editImageData} alt="" className="w-6 h-6 object-contain rounded" /> : <span className="text-xl">{editEmoji || ALTAR_CATEGORY_EMOJI[editCategory]}</span>}
                  <span className="text-xs text-stone-500">{t('altar.chooseEmoji')}</span>
                </button>
                {showEditEmojiPicker && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2">
                    <div className="flex flex-wrap gap-1">
                      {CATEGORY_EMOJIS[editCategory].map((emoji) => (
                        <button key={emoji} onClick={() => { setEditEmoji(emoji); setEditImageData(null); setShowEditEmojiPicker(false); }} className={`text-xl p-1 rounded transition-colors ${editEmoji === emoji ? 'bg-stone-700' : ''}`}>{emoji}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => editImageInputRef.current?.click()} className="flex-shrink-0 flex items-center gap-1 px-2 py-2 bg-stone-800/60 rounded-lg hover:bg-stone-700/60 transition-colors text-stone-500 hover:text-stone-300" title={t('altar.uploadImage')}><ImagePlus size={14} /></button>
            </div>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('altar.itemName')} className="w-full bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable" />
            <div className="flex flex-wrap gap-1">
              {ALTAR_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => { setEditCategory(cat); setEditEmoji(''); setShowEditEmojiPicker(false); }} className={`text-xs px-2 py-1 rounded-md transition-colors ${editCategory === cat ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`} title={t(`altar.categories.${cat}`)}>{ALTAR_CATEGORY_EMOJI[cat]} {t(`altar.categories.${cat}`)}</button>
              ))}
            </div>
            {editingItemId && confirmDeleteId === editingItemId ? (
              <div className="flex items-center justify-between rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
                <span className="text-xs text-red-300">{t('altar.removeElement')}?</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => { const target = items.find((item) => item.id === editingItemId); if (target) handleDelete(target); }} className="text-xs text-red-300 hover:text-red-200">{t('trash.confirmYes')}</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-stone-400 hover:text-stone-200">{t('trash.confirmNo')}</button>
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                {editingItemId ? <button onClick={() => setConfirmDeleteId(editingItemId)} className="text-xs text-red-400 hover:text-red-300">{t('altar.removeElement')}</button> : <span />}
                <div className="flex items-center gap-1">
                  <button onClick={() => { setIsItemModalOpen(false); setEditingItemId(null); }} className="btn-ghost"><X size={13} /></button>
                  <button onClick={saveEditModal} className="btn-ghost text-jade-400"><Check size={13} /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
