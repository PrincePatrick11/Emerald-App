import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Check, Copy, PanelRightOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import { getAltarDragItem, setAltarDragItem, subscribeAltarDrag } from '../../lib/altarDragState';
import { ALTAR_BACKGROUND_PRESETS, ALTAR_BACKGROUND_STYLES, DEFAULT_ALTAR_BACKGROUND } from '../../lib/altarConstants';
import type { AltarItem, AltarPlacement, AltarRecord } from '../../types';
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
    intention,
    fetchAltars,
    createAltar,
    duplicateAltar,
    setActiveAltar,
    updateAltar,
    deleteAltar,
    saveIntention,
    setIntentionLocal,
  } = useAltarStore();
  const { activeView, setActiveView, toggleRightSidebar, altarPrefs, setAltarPrefs } = useUIStore();

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
    setIntentionLocal(activeAltar.intention);
  }, [activeAltar?.id, activeAltar?.title, activeAltar?.intention, setIntentionLocal]);

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
    await saveIntention(intention);
    setActiveView({ type: 'altar', id: activeAltar.id, mode: 'view' });
  };

  const handleCancel = () => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
    setIntentionLocal(activeAltar.intention);
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
            : Math.max(18, Math.min(42, Math.round(20 * (placement.scale ?? 1))));
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

      <AltarCanvas altar={activeAltar} backgroundSrc={getPreviewSrc(activeAltar)} placements={placements} editable={isEditing} />

      <div className="flex-shrink-0 border-t border-stone-700/60 px-6 py-4">
        <p className="text-xs text-stone-600 mb-1.5">{t('altar.intention')}</p>
        <textarea
          value={intention}
          onChange={(e) => setIntentionLocal(e.target.value)}
          onBlur={() => { if (isEditing) saveIntention(intention); }}
          placeholder={t('altar.intentionPlaceholder')}
          rows={2}
          readOnly={!isEditing}
          className="entry-view-body w-full bg-transparent text-sm text-stone-300 placeholder-stone-700 outline-none resize-none selectable leading-relaxed"
        />
      </div>
    </div>
  );
}

function AltarCanvas({ altar, backgroundSrc, placements, editable }: { altar: AltarRecord | null; backgroundSrc: string | null; placements: AltarPlacement[]; editable: boolean }) {
  const { t } = useTranslation();
  const { placeItem, movePlacement, savePlacementPosition, removePlacement, updatePlacementScale } = useAltarStore();
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);
  const [sidebarDragItem, setSidebarDragItem] = useState<AltarItem | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const coordsToPercent = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(3, Math.min(97, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(3, Math.min(97, ((clientY - rect.top) / rect.height) * 100)),
    };
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
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute bottom-[28%] left-[8%] right-[8%] h-px bg-gradient-to-r from-transparent via-stone-700/50 to-transparent pointer-events-none" />
      <div className="absolute bottom-[26%] left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-stone-800/30 to-transparent pointer-events-none" />

      {editable && sidebarDragItem && (
        <div className="absolute inset-2 border border-dashed border-stone-600/40 rounded-lg pointer-events-none z-10" />
      )}

      {placements.length === 0 && !sidebarDragItem && (
        <p className="absolute inset-0 flex items-center justify-center text-stone-800 text-sm pointer-events-none">
          {t('altar.dropHint')}
        </p>
      )}

      {placements.map((p) => (
        <PlacedItem
          key={p.id}
          placement={p}
          editable={editable}
          onStartDrag={() => { draggingRef.current = p.id; }}
          onRemove={() => removePlacement(p.id)}
          onScaleChange={(scale) => updatePlacementScale(p.id, scale)}
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

function PlacedItem({ placement, editable, onStartDrag, onRemove, onScaleChange }: {
  placement: AltarPlacement;
  editable: boolean;
  onStartDrag: () => void;
  onRemove: () => void;
  onScaleChange: (scale: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const scale = placement.scale ?? 1;
  const displaySize = Math.round(BASE_SIZE * scale);

  const handleWheel = (e: React.WheelEvent) => {
    if (!editable) return;
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    const newScale = Math.round(Math.max(0.3, Math.min(16, scale + delta)) * 100) / 100;
    onScaleChange(newScale);
  };

  return (
    <div
      className="absolute flex items-center justify-center cursor-grab active:cursor-grabbing"
      style={{
        left: `${placement.x}%`,
        top: `${placement.y}%`,
        transform: 'translate(-50%, -50%)',
        width: displaySize,
        height: displaySize,
      }}
      onMouseDown={(e) => { if (!editable) return; e.preventDefault(); onStartDrag(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onWheel={handleWheel}
    >
      <AltarItemVisual item={placement} size={displaySize} candleAnimate={placement.category === 'candle'} />
      {editable && hovered && (
        <button
          onMouseDown={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-stone-800 border border-stone-600 rounded-full flex items-center justify-center text-stone-400 hover:text-red-400 hover:border-red-700 transition-colors z-10"
        >
          <X size={9} />
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
