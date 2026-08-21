import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Maximize2, Minimize2 } from 'lucide-react';
import { format } from 'date-fns';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import { getAltarBackgroundStyle, DEFAULT_ALTAR_RESOLUTION, parseResolution, isRatioFormat } from '../../lib/altarConstants';
import type { AltarRecord } from '../../types';
import Dashboard, { type DashboardGroup } from '../ui/Dashboard';
import ContextMenu from '../ui/ContextMenu';
import Button from '../ui/Button';
import { AltarCanvas, captureCurrentAltar } from '../altar/AltarCanvas';
import { AltarLibraryStrip } from '../altar/AltarLibraryStrip';
import { AltarCard, AltarListRow, buildAltarContextMenuActions } from '../altar/AltarCard';
import { imageSrc } from '../../lib/images';

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
  const setEditActions = useUIStore((s) => s.setEditActions);
  const rightSidebarOpen = useUIStore((s) => s.rightSidebarOpen);
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
  // ref keeps ResizeObserver callback current without re-observing on fullscreen toggle
  const altarWindowFullscreenRef = useRef(altarWindowFullscreen);
  const [canvasTransform, setCanvasTransform] = useState<{ scale: number; offsetX: number; offsetY: number; nativeW: number; nativeH: number }>({ scale: 1, offsetX: 0, offsetY: 0, nativeW: 1920, nativeH: 1080 });
  // Set to true while handleDone/handleCancel are running their own capture so the
  // isEditing cleanup effect doesn't fire a redundant second capture.
  const thumbnailSavingRef = useRef(false);

  useEffect(() => { fetchAltars(); }, [fetchAltars]);

  // Must be placed BEFORE the activeView.id effect so that when both run in the same
  // commit (e.g. back-button press), getState() is called before clearActiveAltar().
  const isEditing = activeView.mode === 'edit';
  useEffect(() => {
    if (!isEditing) return;
    return () => {
      if (thumbnailSavingRef.current) return; // handleDone / handleCancel already owns it
      const altarId = useAltarStore.getState().activeAltarId;
      if (!altarId) return;
      captureCurrentAltar()
        .then((thumbnailData) => {
          if (thumbnailData !== null && thumbnailData.length <= 524288)
            useAltarStore.getState().updateAltar(altarId, { thumbnail_data: thumbnailData });
        })
        .catch(console.error);
    };
  }, [isEditing]);

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

  const handleDeleteActive = () => {
    if (!activeAltar) return;
    handleDelete(activeAltar.id);
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
    thumbnailSavingRef.current = true;
    const altarId = activeAltar.id;
    const capturePromise = captureCurrentAltar(); // start before any state changes
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    try {
      await updateAltar(altarId, { title: title.trim() || t('altar.untitled') });
      const thumbnailData = await capturePromise;
      if (thumbnailData !== null && thumbnailData.length <= 524288)
        await updateAltar(altarId, { thumbnail_data: thumbnailData });
    } catch (err) {
      console.error('[handleDone]', err);
    } finally {
      thumbnailSavingRef.current = false;
    }
  };

  const handleCancel = async () => {
    if (!activeAltar) return;
    thumbnailSavingRef.current = true;
    const altarId = activeAltar.id;
    setTitle(activeAltar.title);
    const capturePromise = captureCurrentAltar(); // start before navigation
    setActiveView({ type: 'altar', id: altarId, mode: 'view' });
    try {
      const thumbnailData = await capturePromise;
      if (thumbnailData !== null && thumbnailData.length <= 524288)
        await updateAltar(altarId, { thumbnail_data: thumbnailData });
    } catch (err) {
      console.error('[handleCancel]', err);
    } finally {
      thumbnailSavingRef.current = false;
    }
  };

  const editHandlersRef = useRef({ onSave: handleDone, onCancel: handleCancel, onDelete: handleDeleteActive });
  editHandlersRef.current = { onSave: handleDone, onCancel: handleCancel, onDelete: handleDeleteActive };

  useEffect(() => {
    if (!isEditing) return;
    setEditActions({
      onSave: () => editHandlersRef.current.onSave(),
      onCancel: () => editHandlersRef.current.onCancel(),
      onDelete: () => editHandlersRef.current.onDelete(),
    });
    return () => setEditActions(null);
  }, [isEditing]);

  const backgroundSrc = imageSrc(activeAltar?.background_image_data);

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

    const filteredCount = filtered.length;

    const renderAltarItem = (altar: AltarRecord) =>
      altarPrefs.view === 'cards' ? (
        <AltarCard
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
      ) : (
        <AltarListRow
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
      );

    return (
      <Dashboard<AltarRecord>
        title={t('nav.altar')}
        primaryAction={{ label: t('altar.newAltar'), onClick: handleNew }}
        view={altarPrefs.view}
        sort={altarPrefs.sort}
        onView={(next) => setAltarPrefs({ view: next })}
        onSort={(next) => setAltarPrefs({ sort: next === 'category' ? 'date_desc' : next })}
        search={search}
        onSearch={setSearch}
        items={sorted}
        itemKey={(altar) => altar.id}
        renderItem={renderAltarItem}
        isEmpty={altars.length === 0}
        emptyState={{ message: t('altar.none'), actionLabel: t('altar.start'), onAction: handleNew }}
        hasNoResults={filteredCount === 0}
        noResultsMessage={t('search.noResults')}
        grouping={
          altarPrefs.view === 'timeline'
            ? { mode: 'timeline', groups: grouped.map(([label, items]): DashboardGroup<AltarRecord> => ({ label, items })) }
            : { mode: 'flat' }
        }
        contextMenuSlot={ctxMenu && (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            actions={buildAltarContextMenuActions({
              t,
              altar: altars.find((a) => a.id === ctxMenu.id) ?? altars[0],
              onDuplicate: handleDuplicate,
              onRename: startRename,
              onDelete: handleDelete,
            })}
          />
        )}
      />
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
          {isEditing ? null : (
            <>
              {altarWindowFullscreen ? (
                <Button
                  onClick={() => setAltarWindowFullscreen(false)}
                  variant="ghost"
                  title={t('altar.exitWindowFullscreen')}
                >
                  <Minimize2 size={15} />
                </Button>
              ) : !rightSidebarOpen && (
                <Button
                  onClick={() => setAltarWindowFullscreen(true)}
                  variant="ghost"
                  title={t('altar.windowFullscreen')}
                >
                  <Maximize2 size={15} />
                </Button>
              )}
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
          <AltarCanvas
            altar={activeAltar}
            backgroundSrc={backgroundSrc}
            editable={isEditing}
            showGrid={activeAltar.grid_enabled}
            gridSize={activeAltar.grid_size}
            gridOpacity={activeAltar.grid_opacity}
            gridColor={activeAltar.grid_color}
            snapToGrid={activeAltar.snap_to_grid}
            rotationSnapEnabled={activeAltar.rotation_snap_enabled}
            rotationSnapAngle={activeAltar.rotation_snap_angle}
            snapScaleToGrid={activeAltar.snap_scale_to_grid}
            resolution={activeAltar.resolution}
            nativeW={canvasTransform.nativeW}
            nativeH={canvasTransform.nativeH}
            cssScale={canvasTransform.scale}
            getBackgroundStyle={getAltarBackgroundStyle}
          />
        </div>
      </div>

      {isEditing && !altarWindowFullscreen && <AltarLibraryStrip editable={isEditing} />}
    </div>
  );
}
