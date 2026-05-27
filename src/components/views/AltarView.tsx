import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Maximize2, Minimize2, PanelRightOpen, Pencil, Plus, RotateCw, Trash2, X, MoveDiagonal2, ImagePlus } from 'lucide-react';
import { format } from 'date-fns';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import { getAltarDragItem, setAltarDragItem, subscribeAltarDrag } from '../../lib/altarDragState';
import { ALTAR_BACKGROUND_PRESETS, ALTAR_BACKGROUND_STYLES, DEFAULT_ALTAR_BACKGROUND, ALTAR_CATEGORIES, ALTAR_CATEGORY_EMOJI, CATEGORY_EMOJIS } from '../../lib/altarConstants';
import type { AltarItem, AltarItemCategory, AltarPlacement, AltarRecord } from '../../types';
import ListToolbar from '../ui/ListToolbar';
import ContextMenu from '../ui/ContextMenu';

function getAltarBackgroundStyleWithImage(altar: AltarRecord | null, imageSrc: string | null | undefined): string {
  if (!altar) return ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND];
  if (imageSrc?.startsWith('data:')) {
    return `linear-gradient(rgba(10, 10, 15, 0.35), rgba(10, 10, 15, 0.55)), url("${imageSrc}") center / cover no-repeat`;
  }
  const preset = ALTAR_BACKGROUND_PRESETS.includes(altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number])
    ? altar.background_preset as (typeof ALTAR_BACKGROUND_PRESETS)[number]
    : DEFAULT_ALTAR_BACKGROUND;
  return ALTAR_BACKGROUND_STYLES[preset];
}

export default function AltarView() {
  const { t } = useTranslation();
  const {
    altars,
    activeAltarId,
    placements,
    previewPlacements,
    fetchAltars,
    createAltar,
    duplicateAltar,
    setActiveAltar,
    updateAltar,
    deleteAltar,
  } = useAltarStore();
  const { activeView, setActiveView, toggleRightSidebar, altarPrefs, setAltarPrefs, altarCanvasGrid, altarCanvasGridSize, altarCanvasGridOpacity, altarCanvasGridColor, altarSnapToGrid, altarWindowFullscreen, setAltarWindowFullscreen } = useUIStore();

  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [title, setTitle] = useState('');
  const [backgroundPreviewMap, setBackgroundPreviewMap] = useState<Record<string, string>>({});

  useEffect(() => { fetchAltars(); }, [fetchAltars]);
  useEffect(() => {
    if (activeView.id && activeView.id !== activeAltarId) {
      setActiveAltar(activeView.id).catch(console.error);
    }
  }, [activeView.id, activeAltarId, setActiveAltar]);

  const activeAltar = altars.find((altar) => altar.id === activeView.id) ?? null;
  const isEditing = activeView.mode === 'edit';

  useEffect(() => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
  }, [activeAltar?.id, activeAltar?.title]);

  useEffect(() => {
    if (isEditing && altarWindowFullscreen) setAltarWindowFullscreen(false);
  }, [isEditing, altarWindowFullscreen, setAltarWindowFullscreen]);

  useEffect(() => {
    let cancelled = false;
    const pending = altars.filter((altar) =>
      !!altar.background_image_data &&
      !altar.background_image_data.startsWith('data:') &&
      !backgroundPreviewMap[altar.background_image_data]
    );
    pending.forEach((altar) => {
      invoke<string>('read_image_as_base64', { path: altar.background_image_data })
        .then((dataUrl) => {
          if (cancelled) return;
          setBackgroundPreviewMap((current) => current[altar.background_image_data!] ? current : {
            ...current,
            [altar.background_image_data!]: dataUrl,
          });
        })
        .catch((error) => console.error('Failed to load altar background:', altar.background_image_data, error));
    });
    return () => { cancelled = true; };
  }, [altars, backgroundPreviewMap]);

  const handleNew = async () => {
    const altar = await createAltar();
    setActiveView({ type: 'altar', id: altar.id });
  };

  const openAltar = async (altar: AltarRecord) => {
    await setActiveAltar(altar.id);
    setActiveView({ type: 'altar', id: altar.id });
  };

  const startRename = (altar: AltarRecord) => {
    setRenamingId(altar.id);
    setRenameValue(altar.title);
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await updateAltar(renamingId, { title: renameValue.trim() });
    setRenamingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteAltar(id);
    if (activeView.id === id) {
      setActiveView({ type: 'altar' });
    }
  };

  const handleDuplicate = async (id: string) => {
    const altar = await duplicateAltar(id);
    if (!altar) return;
    await openAltar(altar);
  };

  const enterEditMode = () => {
    if (!activeAltar || isEditing) return;
    setActiveView({ type: 'altar', id: activeAltar.id, mode: 'edit' });
  };

  const handleDone = async () => {
    if (!activeAltar) return;
    await updateAltar(activeAltar.id, { title: title.trim() || t('altar.untitled') });
    setActiveView({ type: 'altar', id: activeAltar.id, mode: 'view' });
  };

  const handleCancel = () => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
    setActiveView({ type: 'altar', id: activeAltar.id, mode: 'view' });
  };

  const getPreviewSrc = (altar: AltarRecord) => {
    if (!altar.background_image_data) return null;
    if (altar.background_image_data.startsWith('data:')) return altar.background_image_data;
    return backgroundPreviewMap[altar.background_image_data] ?? null;
  };

  const renderPreviewScene = (altar: AltarRecord, compact = false) => {
    const previewItems = previewPlacements[altar.id] ?? [];
    return (
      <div
        className={`relative overflow-hidden rounded-lg border border-stone-700/40 ${compact ? 'h-8 w-8' : 'h-36 w-full'}`}
        style={{ background: getAltarBackgroundStyleWithImage(altar, getPreviewSrc(altar)) }}
      >
        <div className="absolute bottom-[28%] left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-stone-700/50 to-transparent pointer-events-none" />
        <div className="absolute bottom-[26%] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-stone-800/30 to-transparent pointer-events-none" />
        {previewItems.slice(0, compact ? 1 : 7).map((placement) => {
          const size = compact
            ? 16
            : Math.max(16, Math.min(52, Math.round((placement.width ?? 8) * 2)));
          return (
            <div
              key={placement.id}
              className="absolute flex items-center justify-center"
              style={{
                left: `${placement.x}%`,
                top: `${placement.y}%`,
                transform: 'translate(-50%, -50%)',
                width: size,
                height: size,
              }}
            >
              <AltarItemVisual item={placement} size={size} candleAnimate={placement.category === 'candle'} />
            </div>
          );
        })}
      </div>
    );
  };

  if (!activeAltar) {
    const filtered = search
      ? altars.filter((altar) =>
          altar.title.toLowerCase().includes(search.toLowerCase()) ||
          altar.intention.toLowerCase().includes(search.toLowerCase())
        )
      : altars;

    const sorted = [...filtered].sort((a, b) => {
      const sort = altarPrefs.sort;
      if (sort === 'alpha_asc') return a.title.localeCompare(b.title);
      if (sort === 'alpha_desc') return b.title.localeCompare(a.title);
      if (sort === 'date_asc') return a.updated_at.localeCompare(b.updated_at);
      return b.updated_at.localeCompare(a.updated_at);
    });

    const grouped = altarPrefs.view === 'timeline'
      ? Array.from(
          sorted.reduce((map, altar) => {
            const label = format(new Date(altar.updated_at), 'MMMM yyyy');
            if (!map.has(label)) map.set(label, []);
            map.get(label)!.push(altar);
            return map;
          }, new Map<string, AltarRecord[]>())
        )
      : [['', sorted] as const];

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-8 h-14 border-b border-stone-700/60">
          <h1 className="text-lg font-semibold text-stone-100">{t('nav.altar')}</h1>
          <div className="flex items-center gap-1">
            <button onClick={handleNew} className="btn-primary">
              <Plus size={13} />{t('altar.newAltar')}
            </button>
            <button onClick={toggleRightSidebar} className="btn-ghost ml-1">
              <PanelRightOpen size={16} />
            </button>
          </div>
        </div>

        <ListToolbar
          view={altarPrefs.view}
          sort={altarPrefs.sort}
          onView={(next) => setAltarPrefs({ view: next })}
          onSort={(next) => setAltarPrefs({ sort: next === 'category' ? 'date_desc' : next })}
          search={search}
          onSearch={setSearch}
        />

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {altars.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-stone-600 text-sm">{t('altar.none')}</p>
              <button onClick={handleNew} className="mt-4 text-xs text-stone-500 hover:text-stone-300 underline transition-colors">
                {t('altar.start')}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-20 text-stone-600 text-sm">{t('search.noResults')}</p>
          ) : (
            <div className="space-y-6">
              {grouped.map(([label, items]) => (
                <div key={label || 'all'}>
                  {label && (
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider whitespace-nowrap">{label}</span>
                      <div className="flex-1 h-px bg-stone-700/50" />
                    </div>
                  )}
                  {altarPrefs.view === 'cards' ? (
                    <div className="grid grid-cols-3 gap-3">
                      {items.map((altar) => (
                        renamingId === altar.id ? (
                          <div key={altar.id} className="panel-interactive px-4 py-4 text-left">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') commitRename();
                                if (event.key === 'Escape') setRenamingId(null);
                              }}
                              className="mb-2 w-full bg-transparent text-sm font-medium text-stone-200 outline-none selectable"
                            />
                            <p className="text-xs text-stone-600">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</p>
                          </div>
                        ) : (
                          <button
                            key={altar.id}
                            onClick={() => openAltar(altar)}
                            onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
                            className="panel-interactive px-4 py-4 text-left"
                          >
                            <div className="mb-3">
                              {renderPreviewScene(altar)}
                            </div>
                            <div className="text-sm font-medium text-stone-200 truncate">{altar.title}</div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <span className="text-parchment-500/70">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
                            </div>
                            {altar.intention && (
                              <p className="mt-2 max-h-8 overflow-hidden text-xs leading-4 text-stone-500">{altar.intention}</p>
                            )}
                          </button>
                        )
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map((altar) => (
                        renamingId === altar.id ? (
                          <div key={altar.id} className="panel-interactive flex items-center gap-3 px-4 py-3">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') commitRename();
                                if (event.key === 'Escape') setRenamingId(null);
                              }}
                              className="flex-1 bg-transparent text-sm text-stone-300 outline-none selectable"
                            />
                            <span className="text-xs text-parchment-500/70">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
                          </div>
                        ) : (
                          <button
                            key={altar.id}
                            onClick={() => openAltar(altar)}
                            onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
                            className="panel-interactive w-full text-left flex items-center gap-3 px-4 py-3"
                          >
                            <span className="flex-shrink-0">
                              {renderPreviewScene(altar, true)}
                            </span>
                            <span className="flex-1 text-sm text-stone-300 truncate">{altar.title}</span>
                            <span className="text-xs text-stone-600">{format(new Date(altar.updated_at), 'MMM d, yyyy')}</span>
                          </button>
                        )
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {ctxMenu && (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={[
              { label: t('contextMenu.duplicate'), icon: <Copy size={12} />, onClick: () => handleDuplicate(ctxMenu.id) },
              { label: t('contextMenu.rename'), icon: <Pencil size={12} />, onClick: () => {
                const altar = altars.find((entry) => entry.id === ctxMenu.id);
                if (altar) startRename(altar);
              } },
              { label: t('contextMenu.delete'), icon: <Trash2 size={12} />, onClick: () => handleDelete(ctxMenu.id), danger: true },
            ]}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 h-14 border-b border-stone-700/60 flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-stone-600">
          <button onClick={() => setActiveView({ type: 'altar' })} className="text-stone-500 transition-colors hover:text-stone-300">
            {t('nav.altar')}
          </button>
          <span>{format(new Date(activeAltar.updated_at), 'MMM d, yyyy')}</span>
        </div>
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button onClick={handleDone} className="flex items-center gap-1.5 rounded-md border border-jade-800/40 bg-jade-900/40 px-3 py-1.5 text-xs font-medium text-jade-400 transition-colors hover:bg-jade-900/60">
                <Check size={13} />{t('editor.done')}
              </button>
              <button onClick={handleCancel} className="btn-ghost">
                <X size={15} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setAltarWindowFullscreen(!altarWindowFullscreen)}
                className="btn-ghost"
                title={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
              >
                {altarWindowFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button onClick={enterEditMode} className="btn-ghost" title={t('editor.edit')}>
                <Pencil size={15} />
              </button>
              <button onClick={toggleRightSidebar} className="btn-ghost">
                <PanelRightOpen size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {!altarWindowFullscreen && (
        <div className="px-6 pt-6 pb-4 border-b border-stone-700/30" onDoubleClick={enterEditMode}>
          {isEditing ? (
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="entry-view-title w-full bg-transparent text-2xl font-semibold text-stone-100 placeholder-stone-700 outline-none selectable"
              placeholder={t('altar.untitled')}
            />
          ) : (
            <h1 className="entry-view-title w-full cursor-text text-2xl font-semibold text-stone-100">
              {activeAltar.title || t('altar.untitled')}
            </h1>
          )}
        </div>
      )}

      <AltarCanvas altar={activeAltar} backgroundSrc={getPreviewSrc(activeAltar)} placements={placements} editable={isEditing} showGrid={altarCanvasGrid} gridSize={altarCanvasGridSize} gridOpacity={altarCanvasGridOpacity} gridColor={altarCanvasGridColor} snapToGrid={altarSnapToGrid} />

      {isEditing && !altarWindowFullscreen && <AltarLibraryStrip editable={isEditing} />}
    </div>
  );
}

function AltarLibraryStrip({ editable }: { editable: boolean }) {
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
      <div
        className={`pointer-events-none absolute top-0 left-0 right-0 h-1 transition-colors ${(isResizing || isResizeHotspot) ? 'bg-jade-500/20' : 'bg-transparent'}`}
      />
      <input ref={editImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleEditImageChange} />

      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{t('altar.libraryTitle')}</p>
        </div>
        <button onClick={openCreateModal} className="btn-ghost flex-shrink-0" title={t('altar.addItem')}>
          <Plus size={14} />
        </button>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveCategoryTab('all')}
          className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === 'all' ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}
        >
          {t('altar.all')}
        </button>
        {ALTAR_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategoryTab(cat)}
            className={`px-2 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${activeCategoryTab === cat ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`}
            title={t(`altar.categories.${cat}`)}
          >
            {ALTAR_CATEGORY_EMOJI[cat]} {t(`altar.categories.${cat}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {filteredItems.length === 0 && <p className="text-xs text-stone-700 px-2 py-3">{t('altar.noItems')}</p>}
        <div className="grid [grid-template-columns:repeat(auto-fill,70px)] gap-1.5 justify-start">
          {filteredItems.map((item) => (
            <div key={item.id} onPointerDown={(e) => {
              if (!editable) return;
              e.preventDefault();
              setAltarDragItem(item);
            }} className={`group w-[70px] h-[85px] rounded-md border border-stone-700/60 bg-stone-900/40 px-1.5 py-2 flex flex-col ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default opacity-90'}`}>
              <div className="mb-1 w-full h-12 flex items-center justify-center overflow-hidden rounded-sm bg-stone-950/35">
                {item.image_data ? (
                  <img src={item.image_data} alt="" className="h-full w-full object-contain" draggable={false} />
                ) : (
                  <span className={`leading-none select-none ${item.category === 'candle' ? 'candle-flame' : ''}`} style={{ fontSize: 34 }}>
                    {item.emoji}
                  </span>
                )}
              </div>
              <div className="mt-auto flex items-center gap-1">
                <span className="flex-1 truncate text-[10px] text-stone-300">{item.name}</span>
                {editable ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(item);
                    }}
                    className="text-stone-600 hover:text-stone-300 transition-colors p-0.5"
                    title={t('editor.edit')}
                  >
                    <Pencil size={10} />
                  </button>
                ) : null}
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
                        <button key={emoji} onClick={() => { setEditEmoji(emoji); setEditImageData(null); setShowEditEmojiPicker(false); }} className={`text-xl p-1 rounded transition-colors ${editEmoji === emoji ? 'bg-stone-700' : ''}`}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => editImageInputRef.current?.click()} className="flex-shrink-0 flex items-center gap-1 px-2 py-2 bg-stone-800/60 rounded-lg hover:bg-stone-700/60 transition-colors text-stone-500 hover:text-stone-300" title={t('altar.uploadImage')}>
                <ImagePlus size={14} />
              </button>
            </div>

            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('altar.itemName')} className="w-full bg-stone-800/60 rounded-lg px-3 py-2 text-xs text-stone-200 outline-none selectable" />

            <div className="flex flex-wrap gap-1">
              {ALTAR_CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => { setEditCategory(cat); setEditEmoji(''); setShowEditEmojiPicker(false); }} className={`text-xs px-2 py-1 rounded-md transition-colors ${editCategory === cat ? 'bg-stone-700 text-stone-200' : 'text-stone-600 hover:text-stone-400'}`} title={t(`altar.categories.${cat}`)}>
                  {ALTAR_CATEGORY_EMOJI[cat]} {t(`altar.categories.${cat}`)}
                </button>
              ))}
            </div>

            {editingItemId && confirmDeleteId === editingItemId ? (
              <div className="flex items-center justify-between rounded-lg border border-red-700/40 bg-red-950/20 px-3 py-2">
                <span className="text-xs text-red-300">{t('altar.removeElement')}?</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => {
                    const target = items.find((item) => item.id === editingItemId);
                    if (target) handleDelete(target);
                  }} className="text-xs text-red-300 hover:text-red-200">{t('trash.confirmYes')}</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-stone-400 hover:text-stone-200">{t('trash.confirmNo')}</button>
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                {editingItemId ? (
                  <button onClick={() => setConfirmDeleteId(editingItemId)} className="text-xs text-red-400 hover:text-red-300">{t('altar.removeElement')}</button>
                ) : <span />}
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
}

function AltarCanvas({ altar, backgroundSrc, placements, editable, showGrid, gridSize, gridOpacity, gridColor, snapToGrid }: { altar: AltarRecord | null; backgroundSrc: string | null; placements: AltarPlacement[]; editable: boolean; showGrid: boolean; gridSize: number; gridOpacity: number; gridColor: string; snapToGrid: boolean }) {
  const { t } = useTranslation();
  const { placeItem, movePlacement, savePlacementPosition, updatePlacement, selectPlacement, selectedPlacementId } = useAltarStore();
  const gridRgb = hexToRgb(gridColor);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const [sidebarDragItem, setSidebarDragItem] = useState<AltarItem | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const coordsToPercent = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    let x = Math.max(3, Math.min(97, ((clientX - rect.left) / rect.width) * 100));
    let y = Math.max(3, Math.min(97, ((clientY - rect.top) / rect.height) * 100));
    if (snapToGrid) {
      const stepX = (gridSize / rect.width) * 100;
      const stepY = (gridSize / rect.height) * 100;
      if (stepX > 0) x = Math.round(x / stepX) * stepX;
      if (stepY > 0) y = Math.round(y / stepY) * stepY;
      x = Math.max(3, Math.min(97, x));
      y = Math.max(3, Math.min(97, y));
    }
    return { x, y };
  };

  useEffect(() => subscribeAltarDrag(setSidebarDragItem), []);

  useEffect(() => {
    if (!editable || !sidebarDragItem) {
      setGhostPos(null);
      return;
    }

    const handlePointerMove = (e: PointerEvent) => {
      setGhostPos({ x: e.clientX, y: e.clientY });
    };

    const handlePointerUp = (e: PointerEvent) => {
      const item = getAltarDragItem();
      setAltarDragItem(null);
      if (!item) return;
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const { x, y } = coordsToPercent(e.clientX, e.clientY);
        placeItem(item, x, y);
      }
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [editable, sidebarDragItem, placeItem]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!editable) return;
    if (!draggingRef.current) return;
    const { x, y } = coordsToPercent(e.clientX, e.clientY);
    movePlacement(draggingRef.current, x, y);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!editable) return;
    if (!draggingRef.current) return;
    const { x, y } = coordsToPercent(e.clientX, e.clientY);
    savePlacementPosition(draggingRef.current, x, y);
    draggingRef.current = null;
  };

  return (
    <div
      ref={canvasRef}
      className="flex-1 relative overflow-hidden select-none"
      style={{ background: getAltarBackgroundStyleWithImage(altar, backgroundSrc) }}
      onMouseDown={() => selectPlacement(null)}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute bottom-[28%] left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-stone-700/50 to-transparent pointer-events-none" />
      <div className="absolute bottom-[26%] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-stone-800/30 to-transparent pointer-events-none" />
      {showGrid && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(${gridRgb.r},${gridRgb.g},${gridRgb.b},${gridOpacity}) 1px, transparent 1px), linear-gradient(to bottom, rgba(${gridRgb.r},${gridRgb.g},${gridRgb.b},${gridOpacity}) 1px, transparent 1px)`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
          }}
        />
      )}

      {editable && sidebarDragItem && (
        <div className="absolute inset-2 border border-dashed border-stone-600/40 rounded-lg pointer-events-none z-10" />
      )}

      {placements.length === 0 && !sidebarDragItem && (
        <p className="absolute inset-0 flex items-center justify-center text-stone-800 text-sm pointer-events-none">
          {t('altar.dropHint')}
        </p>
      )}

      {[...placements].sort((a, b) => a.z_index - b.z_index).map((p) => (
        <PlacedItem
          key={p.id}
          placement={p}
          editable={editable}
          selected={selectedPlacementId === p.id}
          onStartDrag={() => { draggingRef.current = p.id; }}
          onSelect={() => selectPlacement(p.id)}
          onResize={(width, height) => updatePlacement(p.id, { width, height })}
          onRotate={(rotation) => updatePlacement(p.id, { rotation })}
        />
      ))}

      {editable && sidebarDragItem && ghostPos && (
        <div
          className="fixed pointer-events-none z-50 flex flex-col items-center gap-0.5 opacity-75"
          style={{ left: ghostPos.x, top: ghostPos.y, transform: 'translate(-50%, -50%)' }}
        >
          <AltarItemVisual item={sidebarDragItem} size={32} />
          <span className="text-xs text-stone-400 whitespace-nowrap">{sidebarDragItem.name}</span>
        </div>
      )}
    </div>
  );
}

const BASE_SIZE = 40;

function PlacedItem({ placement, editable, selected, onStartDrag, onSelect, onResize, onRotate }: {
  placement: AltarPlacement;
  editable: boolean;
  selected: boolean;
  onStartDrag: () => void;
  onSelect: () => void;
  onResize: (width: number, height: number) => void;
  onRotate: (rotation: number) => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = placement.width ?? 8;
  const height = placement.height ?? 8;
  const displayWidth = Math.round(BASE_SIZE * (width / 8));
  const displayHeight = Math.round(BASE_SIZE * (height / 8));

  const handleWheel = (e: React.WheelEvent) => {
    if (!editable || placement.locked) return;
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.4 : -0.4;
    const nextWidth = Math.round(Math.max(2, Math.min(500, width + delta)) * 100) / 100;
    const nextHeight = Math.round(Math.max(2, Math.min(500, height + delta)) * 100) / 100;
    onResize(nextWidth, nextHeight);
  };

  const startRotate = (event: React.MouseEvent) => {
    if (!editable || placement.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const onMove = (moveEvent: MouseEvent) => {
      const angle = (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) * 180) / Math.PI + 90;
      let normalized = Math.round((((angle % 360) + 360) % 360) * 10) / 10;
      if (moveEvent.shiftKey) {
        normalized = Math.round(normalized / 15) * 15;
      }
      onRotate(normalized);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setIsRotating(false);
    };

    setIsRotating(true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const startResize = (event: React.MouseEvent) => {
    if (!editable || placement.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = width;
    const startHeight = height;
    const startSize = (startWidth + startHeight) / 2;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientX - startX + (moveEvent.clientY - startY)) / 2;
      const nextSize = Math.max(2, Math.min(500, startSize + (delta * 8) / BASE_SIZE));
      const normalized = Math.round(nextSize * 100) / 100;
      onResize(normalized, normalized);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={rootRef}
      className={`absolute flex items-center justify-center ${editable && !placement.locked ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
      style={{
        left: `${placement.x}%`,
        top: `${placement.y}%`,
        transform: `translate(-50%, -50%) rotate(${placement.rotation ?? 0}deg)`,
        width: displayWidth,
        height: displayHeight,
        zIndex: placement.z_index,
        display: placement.hidden ? 'none' : undefined,
        pointerEvents: placement.locked ? 'none' : undefined,
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (placement.locked) return;
        onSelect();
        if (!editable) return;
        e.preventDefault();
        onStartDrag();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onWheel={handleWheel}
    >
      <div style={{ opacity: placement.opacity ?? 1 }}>
        <AltarItemVisual item={placement} size={Math.max(displayWidth, displayHeight)} candleAnimate={placement.category === 'candle'} />
      </div>
      {(selected || (editable && hovered)) && <span className="absolute inset-0 rounded border border-jade-500/50 pointer-events-none" />}
      {editable && isRotating && (
        <span className="absolute -top-16 left-1/2 -translate-x-1/2 rounded bg-stone-950 border border-jade-500/60 px-2 py-0.5 text-[11px] font-semibold text-jade-200 shadow-lg pointer-events-none">
          {Math.round((placement.rotation ?? 0) * 10) / 10}°
        </span>
      )}
      {editable && selected && !placement.locked && (
        <button
          onMouseDown={startRotate}
          className="absolute -top-8 left-1/2 -translate-x-1/2 w-4 h-4 bg-stone-800 border border-stone-600 rounded-full text-stone-300 hover:text-jade-300 hover:border-jade-600 transition-colors z-10 flex items-center justify-center"
          title={t('altar.rotate')}
        >
          <RotateCw size={9} />
        </button>
      )}
      {editable && selected && !placement.locked && (
        <button
          onMouseDown={startResize}
          className="absolute -bottom-2 -right-2 w-4 h-4 bg-stone-800 border border-stone-600 rounded-full text-stone-300 hover:text-jade-300 hover:border-jade-600 transition-colors z-10 flex items-center justify-center"
          title={t('altar.scale')}
        >
          <MoveDiagonal2 size={9} />
        </button>
      )}
    </div>
  );
}

export function AltarItemVisual({
  item,
  size = 24,
  candleAnimate = false,
}: {
  item: { emoji: string; image_data?: string; category?: string };
  size?: number;
  candleAnimate?: boolean;
}) {
  if (item.image_data) {
    return (
      <img
        src={item.image_data}
        alt=""
        style={{ width: size, height: size }}
        className="object-contain rounded"
        draggable={false}
      />
    );
  }

  return (
    <span
      className={`leading-none select-none ${candleAnimate ? 'candle-flame' : ''}`}
      style={{ fontSize: Math.round(size * 0.8) }}
    >
      {item.emoji}
    </span>
  );
}
