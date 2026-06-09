import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Check, Maximize2, Minimize2, PanelRightOpen, Pencil, Plus, X } from 'lucide-react';
import { format } from 'date-fns';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import { DEFAULT_ALTAR_BACKGROUND, ALTAR_BACKGROUND_PRESETS, ALTAR_BACKGROUND_STYLES, DEFAULT_ALTAR_RESOLUTION, parseResolution, isRatioFormat } from '../../lib/altarConstants';
import type { AltarRecord } from '../../types';
import ListToolbar from '../ui/ListToolbar';
import ContextMenu from '../ui/ContextMenu';
import { AltarCanvas } from '../altar/AltarCanvas';
import { AltarLibraryStrip } from '../altar/AltarLibraryStrip';
import { AltarCard, AltarListRow, AltarContextMenuActions } from '../altar/AltarCard';
import { useBackgroundPreview } from '../altar/useAltarBackgroundPreview';

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
  const altars = useAltarStore((s) => s.altars);
  const activeAltarId = useAltarStore((s) => s.activeAltarId);
  const previewPlacements = useAltarStore((s) => s.previewPlacements);
  const { fetchAltars, createAltar, duplicateAltar, setActiveAltar, clearActiveAltar, updateAltar, deleteAltar } = useAltarStore(
    useShallow((s) => ({
      fetchAltars: s.fetchAltars,
      createAltar: s.createAltar,
      duplicateAltar: s.duplicateAltar,
      setActiveAltar: s.setActiveAltar,
      clearActiveAltar: s.clearActiveAltar,
      updateAltar: s.updateAltar,
      deleteAltar: s.deleteAltar,
    })),
  );
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);
  const altarPrefs = useUIStore((s) => s.altarPrefs);
  const setAltarPrefs = useUIStore((s) => s.setAltarPrefs);
  const altarWindowFullscreen = useUIStore((s) => s.altarWindowFullscreen);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);

  const [search, setSearch] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [title, setTitle] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);
  const altarWindowFullscreenRef = useRef(altarWindowFullscreen);
  const [canvasTransform, setCanvasTransform] = useState<{ scale: number; offsetX: number; offsetY: number; nativeW: number; nativeH: number }>({ scale: 1, offsetX: 0, offsetY: 0, nativeW: 1920, nativeH: 1080 });

  useEffect(() => { fetchAltars(); }, [fetchAltars]);
  useEffect(() => {
    if (activeView.id) {
      if (activeView.id !== activeAltarId) {
        setActiveAltar(activeView.id).catch(console.error);
      }
    } else if (activeAltarId !== null) {
      clearActiveAltar();
    }
  }, [activeView.id, activeAltarId, setActiveAltar, clearActiveAltar]);

  const activeAltar = altars.find((altar) => altar.id === activeAltarId) ?? null;
  const isEditing = activeView.mode === 'edit';

  useEffect(() => {
    if (!activeAltar) return;
    setTitle(activeAltar.title);
  }, [activeAltar?.id, activeAltar?.title]);

  useEffect(() => { altarWindowFullscreenRef.current = altarWindowFullscreen; }, [altarWindowFullscreen]);

  useEffect(() => {
    if (isEditing && altarWindowFullscreen) setAltarWindowFullscreen(false);
  }, [isEditing, altarWindowFullscreen, setAltarWindowFullscreen]);

  useEffect(() => {
    if (!altarWindowFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAltarWindowFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [altarWindowFullscreen, setAltarWindowFullscreen]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const res = activeAltar?.resolution ?? DEFAULT_ALTAR_RESOLUTION;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (isRatioFormat(res)) {
        const [rw, rh] = res.split(':').map(Number);
        const fitW = Math.min(width, height * rw / rh);
        const fitH = fitW * rh / rw;
        const nativeW = Math.round(fitW);
        const nativeH = Math.round(fitH);
        setCanvasTransform({ scale: 1, offsetX: (width - nativeW) / 2, offsetY: altarWindowFullscreenRef.current ? (height - nativeH) / 2 : 0, nativeW, nativeH });
      } else {
        const { w, h } = parseResolution(res);
        const s = Math.min(width / w, height / h);
        setCanvasTransform({ scale: s, offsetX: (width - w * s) / 2, offsetY: altarWindowFullscreenRef.current ? (height - h * s) / 2 : 0, nativeW: w, nativeH: h });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeAltar?.id, activeAltar?.resolution]);

  const handleNew = async () => {
    const altar = await createAltar();
    setActiveView({ type: 'altar', id: altar.id, mode: 'edit' });
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

  const backgroundSrc = useBackgroundPreview(activeAltar?.background_image_data ?? null);

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
                        <AltarCard
                          key={altar.id}
                          altar={altar}
                          previewItems={previewPlacements[altar.id] ?? []}
                          isRenaming={renamingId === altar.id}
                          renameValue={renameValue}
                          onChangeRename={setRenameValue}
                          onCommitRename={commitRename}
                          onCancelRename={() => setRenamingId(null)}
                          onOpen={() => openAltar(altar)}
                          onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map((altar) => (
                        <AltarListRow
                          key={altar.id}
                          altar={altar}
                          previewItems={previewPlacements[altar.id] ?? []}
                          isRenaming={renamingId === altar.id}
                          renameValue={renameValue}
                          onChangeRename={setRenameValue}
                          onCommitRename={commitRename}
                          onCancelRename={() => setRenamingId(null)}
                          onOpen={() => openAltar(altar)}
                          onContextMenu={(event) => { event.preventDefault(); setCtxMenu({ id: altar.id, x: event.clientX, y: event.clientY }); }}
                        />
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
            actions={AltarContextMenuActions({
              t,
              altar: altars.find((a) => a.id === ctxMenu.id) ?? altars[0],
              onDuplicate: handleDuplicate,
              onRename: startRename,
              onDelete: handleDelete,
            })}
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

      <div ref={viewportRef} className="flex-1 relative overflow-hidden min-h-0">
        <div style={{
          position: 'absolute',
          width: canvasTransform.nativeW,
          height: canvasTransform.nativeH,
          transformOrigin: '0 0',
          transform: `translate(${canvasTransform.offsetX}px, ${canvasTransform.offsetY}px) scale(${canvasTransform.scale})`,
        }}>
          <AltarCanvas altar={activeAltar} backgroundSrc={backgroundSrc} editable={isEditing} showGrid={activeAltar.grid_enabled} gridSize={activeAltar.grid_size} gridOpacity={activeAltar.grid_opacity} gridColor={activeAltar.grid_color} snapToGrid={activeAltar.snap_to_grid} rotationSnapEnabled={activeAltar.rotation_snap_enabled} rotationSnapAngle={activeAltar.rotation_snap_angle} snapScaleToGrid={activeAltar.snap_scale_to_grid} resolution={activeAltar.resolution} nativeW={canvasTransform.nativeW} nativeH={canvasTransform.nativeH} cssScale={canvasTransform.scale} getBackgroundStyle={getAltarBackgroundStyleWithImage} />
        </div>
      </div>

      {isEditing && !altarWindowFullscreen && <AltarLibraryStrip editable={isEditing} />}
    </div>
  );
}
