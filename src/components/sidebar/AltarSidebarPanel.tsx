import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { X, Plus, Check, ImagePlus } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { setAltarDragItem } from '../../lib/altarDragState';
import { useUIStore } from '../../store/uiStore';
import { AltarItemVisual } from '../views/AltarView';
import type { AltarItem, AltarItemCategory } from '../../types';

const ALTAR_BACKGROUND_PRESETS = ['midnight', 'ember', 'forest', 'moon'] as const;
const ALTAR_BACKGROUND_STYLES: Record<(typeof ALTAR_BACKGROUND_PRESETS)[number], string> = {
  midnight: 'radial-gradient(ellipse at 50% 30%, #1a1a2e 0%, #0d0d15 60%, #0a0a0f 100%)',
  ember: 'radial-gradient(circle at 50% 24%, #4a2917 0%, #25140f 42%, #120d10 100%)',
  forest: 'radial-gradient(circle at 50% 22%, #183126 0%, #0d1a16 48%, #09110f 100%)',
  moon: 'radial-gradient(circle at 50% 18%, #2b253d 0%, #171222 44%, #0b0a12 100%)',
};

const ALTAR_CATEGORY_EMOJI: Record<AltarItemCategory, string> = {
  candle: '🕯️', crystal: '🔮', herb: '🌿', deity: '✨',
  symbol: '🌙', tool: '⚗️', other: '📿',
};
const ALTAR_CATEGORIES: AltarItemCategory[] = ['candle', 'crystal', 'herb', 'deity', 'symbol', 'tool', 'other'];
const CATEGORY_EMOJIS: Record<AltarItemCategory, string[]> = {
  candle:  ['🕯️','🔥','🕎','💡','🪔'],
  crystal: ['🔮','💎','💜','🌟','⭐','🪨'],
  herb:    ['🌿','🍃','🌱','🌾','🪴','🌺','🍀'],
  deity:   ['👁️','☀️','🌙','🦅','🐉','🦋','🌟','⚡'],
  symbol:  ['☯️','🔱','⚡','🌀','🔯','🪬','☽','🌈'],
  tool:    ['⚗️','🪄','🗡️','🏺','📜','🔑','🪬','🧿'],
  other:   ['📿','💫','🌀','🎭','🌈','🧿','🫧','✨'],
};

export default function AltarSidebarPanel() {
  const { t } = useTranslation();
  const { items, altars, activeAltarId, addItem, updateItem, deleteItem, fetchAltars, updateAltar } = useAltarStore();
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.type === 'altar' && activeView.mode === 'edit';
  const activeAltar = altars.find((altar) => altar.id === activeAltarId) ?? null;
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [newCategory, setNewCategory] = useState<AltarItemCategory>('other');
  const [newImageData, setNewImageData] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editImageInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);

  useEffect(() => { fetchAltars(); }, [fetchAltars]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const emoji = newEmoji || ALTAR_CATEGORY_EMOJI[newCategory];
    await addItem(newName.trim(), emoji, newCategory, undefined, newImageData ?? undefined);
    setNewName(''); setNewEmoji(''); setNewImageData(null); setAdding(false); setShowEmojiPicker(false);
  };

  const handleDelete = async (item: AltarItem) => {
    if (!isEditing) return;
    if (confirmDeleteId !== item.id) { setConfirmDeleteId(item.id); return; }
    setConfirmDeleteId(null);
    await deleteItem(item.id);
  };

  const handleImageFile = (file: File, onResult: (data: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => onResult(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleEditImage = (itemId: string) => {
    if (!isEditing) return;
    setEditingImageId(itemId);
    editImageInputRef.current?.click();
  };

  const handleEditImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingImageId) return;
    handleImageFile(file, (data) => {
      updateItem(editingImageId, { image_data: data });
      setEditingImageId(null);
    });
    e.target.value = '';
  };

  const resetAdding = () => {
    setAdding(false); setShowEmojiPicker(false); setNewImageData(null);
  };

  const updateBackgroundPreset = async (preset: (typeof ALTAR_BACKGROUND_PRESETS)[number]) => {
    if (!activeAltar) return;
    await updateAltar(activeAltar.id, { background_preset: preset, background_image_data: null });
  };

  const handleBackgroundUpload = (file: File) => {
    if (!activeAltar) return;
    handleImageFile(file, (data) => {
      invoke<string>('save_image', { dataUrl: data })
        .then((savedPath) => updateAltar(activeAltar.id, { background_preset: 'custom', background_image_data: savedPath }))
        .catch(console.error);
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          handleImageFile(file, setNewImageData);
          e.target.value = '';
        }}
      />
      <input
        ref={editImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleEditImageChange}
      />
      <input
        ref={backgroundInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          handleBackgroundUpload(file);
          e.target.value = '';
        }}
      />

      {activeAltar && isEditing && (
        <div className="px-3 pb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            {t('altar.changeBackground')}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ALTAR_BACKGROUND_PRESETS.map((preset) => {
              const selected = !activeAltar.background_image_data && (activeAltar.background_preset || 'midnight') === preset;
              return (
                <button
                  key={preset}
                  onClick={() => updateBackgroundPreset(preset)}
                  className={`overflow-hidden rounded-lg border transition-colors ${
                    selected ? 'border-jade-600/70 ring-1 ring-jade-700/40' : 'border-stone-700/50'
                  } hover:border-stone-500/60`}
                  title={t(`altar.backgrounds.${preset}`)}
                >
                  <div className="h-14 w-full" style={{ background: ALTAR_BACKGROUND_STYLES[preset] }} />
                  <div className="border-t border-stone-800/70 bg-stone-900/80 px-2 py-1 text-left text-[11px] text-stone-300">
                    {t(`altar.backgrounds.${preset}`)}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => backgroundInputRef.current?.click()}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
                activeAltar.background_image_data
                  ? 'border-jade-600/70 bg-jade-950/20 text-jade-300'
                  : 'border-stone-700/60 bg-stone-900/60 text-stone-300'
              } hover:border-stone-500/60`}
            >
              {t('altar.uploadBackground')}
            </button>
            {activeAltar.background_image_data && (
              <button
                onClick={() => updateBackgroundPreset('midnight')}
                className="btn-ghost text-xs"
              >
                {t('altar.usePreset')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`px-2 pb-3 ${activeAltar && isEditing ? 'pt-4 border-t border-stone-700/60' : 'pt-0'}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              {t('altar.libraryTitle')}
            </p>
            <p className="mt-1 text-xs text-stone-600">
              {isEditing ? t('altar.dragHint') : t('altar.readOnlyHint')}
            </p>
          </div>
          <button onClick={() => setAdding(!adding)} className="btn-ghost flex-shrink-0" title={t('altar.addItem')}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="px-3 py-3 border-b border-stone-700/60 space-y-2">
          {/* Symbol / Bild */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <button
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="w-full flex items-center gap-2 bg-stone-800/60 rounded-lg px-3 py-2 text-sm hover:bg-stone-700/60 transition-colors"
              >
                {newImageData
                  ? <img src={newImageData} alt="" className="w-6 h-6 object-contain rounded" />
                  : <span className="text-xl">{newEmoji || ALTAR_CATEGORY_EMOJI[newCategory]}</span>
                }
                <span className="text-xs text-stone-500">{t('altar.chooseEmoji')}</span>
              </button>
              {showEmojiPicker && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-stone-800 border border-stone-700 rounded-lg shadow-xl p-2">
                  <div className="flex flex-wrap gap-1">
                    {CATEGORY_EMOJIS[newCategory].map((e) => (
                      <button
                        key={e}
                        onClick={() => { setNewEmoji(e); setNewImageData(null); setShowEmojiPicker(false); }}
                        className={`text-xl p-1 rounded hover:bg-stone-700 transition-colors ${newEmoji === e ? 'bg-stone-700' : ''}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* Image upload button */}
            <button
              onClick={() => { setShowEmojiPicker(false); imageInputRef.current?.click(); }}
              className="flex-shrink-0 flex items-center gap-1 px-2 py-2 bg-stone-800/60 rounded-lg hover:bg-stone-700/60 transition-colors text-stone-500 hover:text-stone-300"
              title={t('altar.uploadImage')}
            >
              <ImagePlus size={14} />
            </button>
          </div>

          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') resetAdding(); }}
            placeholder={t('altar.itemName')}
            className="w-full bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable"
          />

          <div className="flex flex-wrap gap-1">
            {ALTAR_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => { setNewCategory(cat); setNewEmoji(''); setShowEmojiPicker(false); }}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  newCategory === cat ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'
                }`}
                title={t(`altar.categories.${cat}`)}
              >
                {ALTAR_CATEGORY_EMOJI[cat]} {t(`altar.categories.${cat}`)}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            <button onClick={handleAdd} className="flex-1 flex items-center justify-center gap-1 btn-ghost text-jade-400 text-xs">
              <Check size={12} /> {t('altar.add')}
            </button>
            <button onClick={resetAdding} className="btn-ghost text-xs">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 && (
          <p className="text-xs text-stone-700 px-2 py-3">{t('altar.noItems')}</p>
        )}
        {ALTAR_CATEGORIES.map((cat) => {
          const catItems = items.filter((i) => i.category === cat);
          if (catItems.length === 0) return null;
          return (
            <div key={cat} className="mb-3">
              <p className="text-xs text-stone-700 px-2 mb-1">
                {ALTAR_CATEGORY_EMOJI[cat]} {t(`altar.categories.${cat}`)}
              </p>
              {catItems.map((item) => (
                <div
                  key={item.id}
                  onPointerDown={(e) => {
                    if (!isEditing) return;
                    e.preventDefault();
                    setAltarDragItem(item);
                  }}
                  className={`sidebar-item group ${isEditing ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-90'}`}
                >
                  <span className="flex-shrink-0">
                    <AltarItemVisual
                      item={item}
                      size={22}
                      candleAnimate={item.category === 'candle'}
                    />
                  </span>
                  <span className="flex-1 truncate text-xs">{item.name}</span>
                  {isEditing && confirmDeleteId === item.id ? (
                    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleDelete(item)} className="text-xs text-red-400 hover:text-red-300">{t('trash.confirmYes')}</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-stone-600">{t('trash.confirmNo')}</button>
                    </span>
                  ) : isEditing ? (
                    <span className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditImage(item.id); }}
                        className="text-stone-700 hover:text-stone-400 transition-colors p-0.5"
                        title={t('altar.uploadImage')}
                      >
                        <ImagePlus size={11} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                        className="text-stone-700 hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
