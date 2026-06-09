import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Check, ChevronDown, ChevronRight, Grid3x3, Image as ImageIcon, Magnet, Pencil, RotateCw, Scaling, Trash2 } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import {
  ALTAR_RATIOS,
  ALTAR_BACKGROUND_PRESETS,
  ALTAR_BACKGROUND_STYLES,
  DEFAULT_ALTAR_BACKGROUND,
  ratioFromResolution,
} from '../../lib/altarConstants';
import { readFileAsDataUrl } from '../../lib/helpers';
import { useUIStore } from '../../store/uiStore';
import { useBackgroundPreview } from '../altar/useAltarBackgroundPreview';
import { PlacedElementRow, PlacedElementInspector } from './PlacedElementRow';


export default function AltarSidebarPanel() {
  const { t } = useTranslation();
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementId = useAltarStore((s) => s.selectedPlacementId);
  const {
    updateAltar,
    selectPlacement,
    updatePlacement,
    duplicatePlacement,
    removePlacement,
  } = useAltarStore(
    useShallow((s) => ({
      updateAltar: s.updateAltar,
      selectPlacement: s.selectPlacement,
      updatePlacement: s.updatePlacement,
      duplicatePlacement: s.duplicatePlacement,
      removePlacement: s.removePlacement,
    })),
  );
  const updateAltarGrid = useAltarStore((s) => s.updateAltarGrid);
  const updateAltarResolution = useAltarStore((s) => s.updateAltarResolution);
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.type === 'altar' && activeView.mode === 'edit';
  const activeAltar = useAltarStore((s) => s.altars.find((a) => a.id === s.activeAltarId) ?? null);
  const gridOpacityPercent = Math.round((activeAltar?.grid_opacity ?? 0) * 100);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const [backgroundOpen, setBackgroundOpen] = useState(true);
  const [gridOpen, setGridOpen] = useState(true);
  const [canvasOptionsOpen, setCanvasOptionsOpen] = useState(true);
  const [placementsOpen, setPlacementsOpen] = useState(true);
  const [dragState, setDragState] = useState<{ fromId: string; overIndex: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // keeps onUp closure current without re-subscribing drag listeners
  const visualPlacementsRef = useRef<typeof sortedPlacements>([]);
  // In-memory cache of previously uploaded background paths for the current session.
  // Allows re-activating a custom background after switching to a preset without
  // re-uploading. Not persisted — the active path is authoritative in the DB.
  const [customBackgroundMap, setCustomBackgroundMap] = useState<Record<string, string>>({});
  const customBackgroundSource = activeAltar?.background_image_data || (activeAltar ? customBackgroundMap[activeAltar.id] : null);
  const customBackgroundPreview = useBackgroundPreview(customBackgroundSource);
  const sortedPlacements = useMemo(
    () => [...placements].sort((a, b) => b.z_index - a.z_index),
    [placements],
  );
  const selectedPlacement = useMemo(
    () => sortedPlacements.find((p) => p.id === selectedPlacementId) ?? null,
    [sortedPlacements, selectedPlacementId],
  );
  const visualPlacements = useMemo(() => {
    if (!dragState) return sortedPlacements;
    const list = [...sortedPlacements];
    const fromIdx = list.findIndex((p) => p.id === dragState.fromId);
    if (fromIdx < 0) return sortedPlacements;
    const [item] = list.splice(fromIdx, 1);
    list.splice(Math.min(dragState.overIndex, list.length), 0, item);
    return list;
  }, [dragState, sortedPlacements]);
  useEffect(() => { visualPlacementsRef.current = visualPlacements; }, [visualPlacements]);

  const startDrag = useCallback((e: React.PointerEvent, fromId: string) => {
    e.preventDefault();
    const sorted = sortedPlacements;
    const fromIndex = sorted.findIndex((p) => p.id === fromId);
    setDragState({ fromId, overIndex: fromIndex });

    const getOverIndex = (clientY: number): number => {
      if (!listRef.current) return fromIndex;
      const wrappers = Array.from(listRef.current.children) as HTMLElement[];
      let best = 0, bestDist = Infinity;
      wrappers.forEach((wrapper, i) => {
        const row = (wrapper.firstElementChild as HTMLElement | null) ?? wrapper;
        const rect = row.getBoundingClientRect();
        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      return best;
    };

    const onMove = (ev: PointerEvent) => {
      setDragState((prev) => prev ? { ...prev, overIndex: getOverIndex(ev.clientY) } : null);
    };
    const onUp = () => {
      const finalOrder = visualPlacementsRef.current;
      const maxZ = finalOrder.length - 1;
      finalOrder.forEach((p, i) => {
        const newZ = maxZ - i;
        if (p.z_index !== newZ) updatePlacement(p.id, { z_index: newZ });
      });
      setDragState(null);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [sortedPlacements, updatePlacement]);

  const hasCustomBackground = !!(activeAltar && (activeAltar.background_image_data || customBackgroundMap[activeAltar.id]));
  const safeBackgroundUrl = customBackgroundPreview?.startsWith('data:image/') || customBackgroundPreview?.startsWith('tauri://')
    ? `url("${customBackgroundPreview}")`
    : null;

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const showBackgroundNotice = (message: string) => {
    setBackgroundNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setBackgroundNotice(null), 1800);
  };

  const updateBackgroundPreset = async (preset: (typeof ALTAR_BACKGROUND_PRESETS)[number]) => {
    if (!activeAltar) return;
    await updateAltar(activeAltar.id, { background_preset: preset, background_image_data: null });
  };

  const handleBackgroundUpload = (file: File) => {
    if (!activeAltar) return;
    if (file.size > 5 * 1024 * 1024) {
      showBackgroundNotice(t('altar.imageTooLarge', { max: '5 MB' }));
      return;
    }
    readFileAsDataUrl(file)
      .then((data) => invoke<string>('save_image', { dataUrl: data }))
      .then((savedPath) => {
        setCustomBackgroundMap((current) => ({ ...current, [activeAltar.id]: savedPath }));
        return updateAltar(activeAltar.id, { background_preset: 'custom', background_image_data: savedPath });
      })
      .then(() => showBackgroundNotice(t('altar.backgroundUpdated')))
      .catch((error) => {
        console.error(error);
        showBackgroundNotice(t('altar.backgroundUpdateFailed'));
      });
  };

  const activateCustomBackground = () => {
    if (!activeAltar) return;
    const savedPath = customBackgroundMap[activeAltar.id];
    if (!savedPath) {
      if (isEditing) backgroundInputRef.current?.click();
      return;
    }
    if (!isEditing) return;
    updateAltar(activeAltar.id, { background_preset: 'custom', background_image_data: savedPath }).catch(console.error);
  };

  const removeCustomBackground = () => {
    if (!activeAltar || !isEditing) return;
    setCustomBackgroundMap((current) => {
      const next = { ...current };
      delete next[activeAltar.id];
      return next;
    });
    updateAltar(activeAltar.id, { background_preset: DEFAULT_ALTAR_BACKGROUND, background_image_data: null }).catch(console.error);
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) selectPlacement(null); }}>
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

      {activeAltar && (
        <div className="px-3 pb-5">
          {isEditing && (
            <>
              <button
                onClick={() => setCanvasOptionsOpen((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-400"
              >
                {canvasOptionsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('altar.canvasOptions')}
              </button>
              {canvasOptionsOpen && (
                <div className="mt-2">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wider text-stone-500">{t('altar.ratio')}</p>
                  <div className="grid grid-cols-3 gap-1">
                    {ALTAR_RATIOS.map((r) => {
                      const active = ratioFromResolution(activeAltar.resolution) === r;
                      return (
                        <button
                          key={r}
                          onClick={() => updateAltarResolution(activeAltar.id, r)}
                          className={`rounded border py-1.5 text-[11px] font-medium text-center transition-colors ${
                            active
                              ? 'border-jade-600/70 bg-jade-900/40 text-jade-300'
                              : 'border-stone-700/60 bg-stone-900/45 text-stone-400 hover:border-stone-500/70 hover:text-stone-300'
                          }`}
                        >
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          <div className={isEditing ? 'mt-4' : ''}>
          <button
            onClick={() => setBackgroundOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-400"
          >
            {backgroundOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {isEditing ? t('altar.changeBackground') : t('altar.background')}
          </button>
          {backgroundOpen && (isEditing ? (
            <div className="mt-2 space-y-1.5">
              <div className="grid grid-cols-4 gap-1.5">
                {ALTAR_BACKGROUND_PRESETS.map((preset) => {
                  const selected = !activeAltar.background_image_data && (activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND) === preset;
                  return (
                    <button
                      key={preset}
                      onClick={() => { if (isEditing) updateBackgroundPreset(preset); }}
                      disabled={!isEditing}
                      className={`relative overflow-hidden rounded-md border transition-colors ${
                        selected ? 'border-jade-600/70 ring-1 ring-jade-700/40' : 'border-stone-700/50 hover:border-stone-500/60'
                      }`}
                      title={t(`altar.backgrounds.${preset}`)}
                    >
                      <div className="h-9 w-full" style={{ background: ALTAR_BACKGROUND_STYLES[preset] }} />
                      {selected && (
                        <span className="absolute right-1 top-1 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                          <Check size={8} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {hasCustomBackground ? (
                <div className="flex items-center gap-1.5">
                  <div
                    onClick={activateCustomBackground}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateCustomBackground(); }
                    }}
                    className={`relative h-9 w-12 flex-shrink-0 overflow-hidden rounded-md border cursor-pointer transition-colors ${
                      activeAltar.background_image_data
                        ? 'border-jade-600/70 ring-1 ring-jade-700/40'
                        : 'border-stone-700/50 hover:border-stone-500/60'
                    }`}
                    title={t('altar.customBackground')}
                  >
                    <div
                      className="h-full w-full bg-gradient-to-br from-stone-800/80 via-stone-900/70 to-stone-950/80"
                      style={safeBackgroundUrl ? { backgroundImage: safeBackgroundUrl, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    />
                    {activeAltar.background_image_data && (
                      <span className="absolute right-0.5 top-0.5 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                        <Check size={7} />
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => backgroundInputRef.current?.click()}
                    className="flex flex-1 items-center justify-center gap-1 rounded border border-stone-600/70 bg-stone-800/70 py-1.5 text-[10px] uppercase tracking-wide text-stone-300 hover:border-stone-400 transition-colors"
                  >
                    <Pencil size={9} />{t('altar.change')}
                  </button>
                  <button
                    onClick={removeCustomBackground}
                    className="flex flex-1 items-center justify-center gap-1 rounded border border-red-700/60 bg-red-950/30 py-1.5 text-[10px] uppercase tracking-wide text-red-200 hover:border-red-500 transition-colors"
                  >
                    <Trash2 size={9} />{t('altar.remove')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => backgroundInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-stone-700/50 bg-stone-900/45 py-1.5 text-[11px] text-stone-400 hover:border-stone-500/60 hover:text-stone-300 transition-colors"
                >
                  <ImageIcon size={12} />{t('altar.customBackground')}
                </button>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <div
                className={`relative altar-bg-preset overflow-hidden rounded-lg border ${
                  activeAltar.background_image_data
                    ? 'border-jade-600/70 ring-1 ring-jade-700/40'
                    : 'border-stone-700/50 opacity-85'
                }`}
                title={t('altar.customBackground')}
              >
                <div
                  className="h-14 w-full"
                  style={
                    activeAltar.background_image_data && safeBackgroundUrl
                      ? { backgroundImage: safeBackgroundUrl, backgroundSize: 'cover', backgroundPosition: 'center' }
                      : { background: ALTAR_BACKGROUND_STYLES[(activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND) as (typeof ALTAR_BACKGROUND_PRESETS)[number]] }
                  }
                >
                  {!activeAltar.background_image_data && <div className="h-full w-full" />}
                </div>
                <div className="altar-bg-preset-label border-t border-stone-800/70 bg-stone-900/80 px-2 py-1 text-left text-[11px] text-stone-300">
                  {activeAltar.background_image_data
                    ? t('altar.customBackground')
                    : t(`altar.backgrounds.${(activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND) as (typeof ALTAR_BACKGROUND_PRESETS)[number]}`)}
                </div>
                <span className="absolute right-1.5 top-1.5 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                  <Check size={10} />
                </span>
              </div>
            </div>
          ))}
          {backgroundNotice && <p className="mt-2 text-xs text-jade-300">{backgroundNotice}</p>}
          </div>
          {isEditing && (
            <>
              <button
                onClick={() => setGridOpen((v) => !v)}
                className="mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-400"
              >
                {gridOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('altar.gridOptions')}
              </button>
              {gridOpen && <>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {([
                  { key: 'grid_enabled' as const, icon: Grid3x3, label: 'Grid', title: t('altar.gridOverlay'), toggle: () => updateAltarGrid(activeAltar.id, { grid_enabled: !activeAltar.grid_enabled }), active: activeAltar.grid_enabled },
                  { key: 'snap_to_grid' as const, icon: Magnet, label: 'Snap', title: t('altar.snapToGrid'), toggle: () => updateAltarGrid(activeAltar.id, { snap_to_grid: !activeAltar.snap_to_grid }), active: activeAltar.snap_to_grid },
                  { key: 'rotation_snap_enabled' as const, icon: RotateCw, label: 'Rotate', title: t('altar.rotationSnap'), toggle: () => updateAltarGrid(activeAltar.id, { rotation_snap_enabled: !activeAltar.rotation_snap_enabled }), active: activeAltar.rotation_snap_enabled },
                  { key: 'snap_scale_to_grid' as const, icon: Scaling, label: 'Scale', title: t('altar.snapScaleToGrid'), toggle: () => updateAltarGrid(activeAltar.id, { snap_scale_to_grid: !activeAltar.snap_scale_to_grid }), active: activeAltar.snap_scale_to_grid },
                ] as const).map(({ key, icon: Icon, label, title, toggle, active }) => (
                  <button
                    key={key}
                    onClick={toggle}
                    title={title}
                    className={`flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 transition-colors ${active ? 'border-jade-600/70 bg-jade-900/40 text-jade-300' : 'border-stone-700/60 bg-stone-900/45 text-stone-500 hover:border-stone-500/70 hover:text-stone-300'}`}
                  >
                    <Icon size={13} />
                    <span className="text-[9px] leading-none">{label}</span>
                  </button>
                ))}
              </div>
              {activeAltar.grid_enabled && (
                <div className="mt-2 rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridSize')}</span>
                <input
                  type="number"
                  min={8}
                  max={128}
                  value={activeAltar.grid_size}
                  disabled={!isEditing}
                  onChange={(event) => updateAltarGrid(activeAltar.id, { grid_size: Number(event.target.value) || 8 })}
                  className="w-14 rounded bg-stone-800/70 px-1.5 py-0.5 text-right text-xs text-stone-300 outline-none"
                />
              </div>
              <input
                type="range"
                min={8}
                max={128}
                value={activeAltar.grid_size}
                disabled={!isEditing}
                onChange={(event) => updateAltarGrid(activeAltar.id, { grid_size: Number(event.target.value) })}
                className="w-full"
              />
              <div className="mt-2 mb-1 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridOpacity')}</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={gridOpacityPercent}
                  disabled={!isEditing}
                  onChange={(event) => updateAltarGrid(activeAltar.id, { grid_opacity: (Number(event.target.value) || 1) / 100 })}
                  className="w-14 rounded bg-stone-800/70 px-1.5 py-0.5 text-right text-xs text-stone-300 outline-none"
                />
              </div>
              <input
                type="range"
                min={1}
                max={25}
                value={gridOpacityPercent}
                disabled={!isEditing}
                onChange={(event) => updateAltarGrid(activeAltar.id, { grid_opacity: Number(event.target.value) / 100 })}
                className="w-full"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridColor')}</span>
                <input
                  type="color"
                  value={activeAltar.grid_color}
                  disabled={!isEditing}
                  onChange={(event) => updateAltarGrid(activeAltar.id, { grid_color: event.target.value })}
                  className="h-6 w-10 rounded border border-stone-700 bg-stone-800 p-0"
                />
              </div>
                </div>
              )}
              {activeAltar.rotation_snap_enabled && (
                <div className="mt-2 rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.rotationSnapAngle')}</span>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={activeAltar.rotation_snap_angle}
                      onChange={(e) => updateAltarGrid(activeAltar.id, { rotation_snap_angle: Number(e.target.value) || 15 })}
                      className="w-14 rounded bg-stone-800/70 px-1.5 py-0.5 text-right text-xs text-stone-300 outline-none"
                    />
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={180}
                    value={activeAltar.rotation_snap_angle}
                    onChange={(e) => updateAltarGrid(activeAltar.id, { rotation_snap_angle: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>
              )}
              </>}
            </>
          )}
        </div>
      )}

      {activeAltar && (
        <div className="px-3 pb-4 border-t border-stone-700/60">
          <button
            onClick={() => setPlacementsOpen((v) => !v)}
            className="pt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-400"
          >
            {placementsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('altar.placedElements')}
          </button>
          {placementsOpen && <div ref={listRef} className="mt-2 space-y-1 pr-1" onClick={(e) => { if (e.target === e.currentTarget) selectPlacement(null); }}>
            {sortedPlacements.length === 0 && (
              <p className="px-2 py-2 text-xs text-stone-600">{t('altar.noPlacedElements')}</p>
            )}
            {visualPlacements.map((placement) => (
              <div key={placement.id} className="space-y-1">
                <PlacedElementRow
                  placement={placement}
                  isEditing={isEditing}
                  isSelected={selectedPlacementId === placement.id}
                  isDragging={dragState?.fromId === placement.id}
                  onSelect={() => selectPlacement(selectedPlacementId === placement.id ? null : placement.id)}
                  onToggleHidden={() => updatePlacement(placement.id, { hidden: !placement.hidden })}
                  onToggleLocked={() => updatePlacement(placement.id, { locked: !placement.locked })}
                  onDuplicate={() => duplicatePlacement(placement.id)}
                  onRemove={() => removePlacement(placement.id)}
                  onGripPointerDown={(e) => startDrag(e, placement.id)}
                />
                {isEditing && selectedPlacementId === placement.id && selectedPlacement && (
                  <PlacedElementInspector
                    placement={selectedPlacement}
                    onUpdate={(patch) => updatePlacement(placement.id, patch)}
                  />
                )}
              </div>
            ))}
          </div>}
        </div>
      )}
    </div>
  );
}
