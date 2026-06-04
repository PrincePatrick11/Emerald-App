import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Check, Image as ImageIcon, Pencil, Trash2 } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import {
  ALTAR_BACKGROUND_PRESETS,
  ALTAR_BACKGROUND_STYLES,
  DEFAULT_ALTAR_BACKGROUND,
} from '../../lib/altarConstants';
import { useUIStore } from '../../store/uiStore';
import { useBackgroundPreview } from '../altar/useAltarBackgroundPreview';
import { PlacedElementRow, PlacedElementInspector } from './PlacedElementRow';

function ToggleRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-2 w-full rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2 transition-colors hover:border-stone-500/70"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-xs text-stone-300">{label}</span>
        <span
          className={`relative h-5 w-9 rounded-full border transition-colors ${checked ? 'border-jade-600/70 bg-jade-900/45' : 'border-stone-600 bg-stone-800/80'}`}
          aria-hidden="true"
        >
          <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${checked ? 'left-[18px] bg-jade-300' : 'left-0.5 bg-stone-400'}`} />
        </span>
      </span>
    </button>
  );
}

export default function AltarSidebarPanel() {
  const { t } = useTranslation();
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementId = useAltarStore((s) => s.selectedPlacementId);
  const {
    updateAltar,
    selectPlacement,
    updatePlacement,
    removePlacement,
    bringPlacementForward,
    sendPlacementBackward,
    bringPlacementToFront,
    sendPlacementToBack,
  } = useAltarStore(
    useShallow((s) => ({
      updateAltar: s.updateAltar,
      selectPlacement: s.selectPlacement,
      updatePlacement: s.updatePlacement,
      removePlacement: s.removePlacement,
      bringPlacementForward: s.bringPlacementForward,
      sendPlacementBackward: s.sendPlacementBackward,
      bringPlacementToFront: s.bringPlacementToFront,
      sendPlacementToBack: s.sendPlacementToBack,
    })),
  );
  const updateAltarGrid = useAltarStore((s) => s.updateAltarGrid);
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.type === 'altar' && activeView.mode === 'edit';
  const activeAltar = useAltarStore((s) => s.altars.find((a) => a.id === s.activeAltarId) ?? null);
  const gridOpacityPercent = Math.round((activeAltar?.grid_opacity ?? 0) * 100);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const [customBackgroundMap, setCustomBackgroundMap] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('altar-custom-backgrounds');
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  });
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
  const hasCustomBackground = !!(activeAltar && (activeAltar.background_image_data || customBackgroundMap[activeAltar.id]));

  useEffect(() => {
    localStorage.setItem('altar-custom-backgrounds', JSON.stringify(customBackgroundMap));
  }, [customBackgroundMap]);

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const showBackgroundNotice = (message: string) => {
    setBackgroundNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setBackgroundNotice(null), 1800);
  };

  const handleImageFile = (file: File, onResult: (data: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = () => onResult(reader.result as string);
    reader.readAsDataURL(file);
  };

  const updateBackgroundPreset = async (preset: (typeof ALTAR_BACKGROUND_PRESETS)[number]) => {
    if (!activeAltar) return;
    await updateAltar(activeAltar.id, { background_preset: preset, background_image_data: null });
  };

  const handleBackgroundUpload = (file: File) => {
    if (!activeAltar) return;
    handleImageFile(file, (data) => {
      invoke<string>('save_image', { dataUrl: data })
        .then((savedPath) => {
          setCustomBackgroundMap((current) => ({ ...current, [activeAltar.id]: savedPath }));
          return updateAltar(activeAltar.id, { background_preset: 'custom', background_image_data: savedPath });
        })
        .then(() => showBackgroundNotice(t('altar.backgroundUpdated')))
        .catch((error) => {
          console.error(error);
          showBackgroundNotice(t('altar.backgroundUpdateFailed'));
        });
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
    <div className="flex flex-col h-full" onClick={(e) => { if (e.target === e.currentTarget) selectPlacement(null); }}>
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            {t('altar.changeBackground')}
          </p>
          {isEditing ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ALTAR_BACKGROUND_PRESETS.map((preset) => {
                  const selected = !activeAltar.background_image_data && (activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND) === preset;
                return (
                  <button
                    key={preset}
                    onClick={() => { if (isEditing) updateBackgroundPreset(preset); }}
                    disabled={!isEditing}
                    className={`relative altar-bg-preset overflow-hidden rounded-lg border transition-colors ${
                      selected ? 'border-jade-600/70 ring-1 ring-jade-700/40' : 'border-stone-700/50'
                      } ${isEditing ? 'hover:border-stone-500/60' : 'opacity-85 cursor-default'}`}
                    title={t(`altar.backgrounds.${preset}`)}
                  >
                    <div className="h-14 w-full" style={{ background: ALTAR_BACKGROUND_STYLES[preset] }} />
                    <div className="altar-bg-preset-label border-t border-stone-800/70 bg-stone-900/80 px-2 py-1 text-left text-[11px] text-stone-300">
                      {t(`altar.backgrounds.${preset}`)}
                    </div>
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                        <Check size={10} />
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="space-y-1">
                <div
                  onClick={activateCustomBackground}
                  role="button"
                  tabIndex={isEditing ? 0 : -1}
                  onKeyDown={(event) => {
                    if (!isEditing) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      activateCustomBackground();
                    }
                  }}
                  className={`relative altar-bg-preset overflow-hidden rounded-lg border transition-colors ${
                    activeAltar.background_image_data
                      ? 'border-jade-600/70 ring-1 ring-jade-700/40'
                      : 'border-stone-700/50'
                  } ${isEditing ? 'hover:border-stone-500/60 cursor-pointer' : 'opacity-85 cursor-default'}`}
                  title={t('altar.customBackground')}
                >
                  <div
                    className="h-14 w-full flex items-center justify-center bg-gradient-to-br from-stone-800/80 via-stone-900/70 to-stone-950/80"
                    style={customBackgroundPreview ? { backgroundImage: `url("${customBackgroundPreview}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                  >
                    {!customBackgroundPreview && <ImageIcon size={16} className="text-stone-300" />}
                  </div>
                  <div className="altar-bg-preset-label border-t border-stone-800/70 bg-stone-900/80 px-2 py-1 text-left text-[11px] text-stone-300">
                    {t('altar.customBackground')}
                  </div>
                  {activeAltar.background_image_data && (
                    <span className="absolute right-1.5 top-1.5 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                      <Check size={10} />
                    </span>
                  )}
                </div>
                {isEditing && hasCustomBackground && (
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => backgroundInputRef.current?.click()}
                      className="flex items-center justify-center gap-1 rounded border border-stone-600/70 bg-stone-800/70 px-1 py-0.5 text-[9px] uppercase tracking-wide text-stone-200 hover:border-stone-400"
                      title={t('altar.change')}
                    >
                      <Pencil size={8} />
                      <span>{t('altar.change')}</span>
                    </button>
                    <button
                      onClick={removeCustomBackground}
                      className="flex items-center justify-center gap-1 rounded border border-red-700/60 bg-red-950/30 px-1 py-0.5 text-[9px] uppercase tracking-wide text-red-200 hover:border-red-500"
                      title={t('altar.remove')}
                    >
                      <Trash2 size={8} />
                      <span>{t('altar.remove')}</span>
                    </button>
                  </div>
                )}
              </div>
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
                    activeAltar.background_image_data
                      ? { backgroundImage: `url("${customBackgroundPreview ?? ''}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
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
          )}
          {backgroundNotice && <p className="mt-2 text-xs text-jade-300">{backgroundNotice}</p>}
          {isEditing && (
            <>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                {t('altar.gridOptions')}
              </p>
              <ToggleRow
                label={t('altar.gridOverlay')}
                checked={activeAltar.grid_enabled}
                onClick={() => updateAltarGrid(activeAltar.id, { grid_enabled: !activeAltar.grid_enabled })}
              />
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
              <ToggleRow
                label={t('altar.snapToGrid')}
                checked={activeAltar.snap_to_grid}
                onClick={() => updateAltarGrid(activeAltar.id, { snap_to_grid: !activeAltar.snap_to_grid })}
              />
              <ToggleRow
                label={t('altar.rotationSnap')}
                checked={activeAltar.rotation_snap_enabled}
                onClick={() => updateAltarGrid(activeAltar.id, { rotation_snap_enabled: !activeAltar.rotation_snap_enabled })}
              />
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
              <ToggleRow
                label={t('altar.snapScaleToGrid')}
                checked={activeAltar.snap_scale_to_grid}
                onClick={() => updateAltarGrid(activeAltar.id, { snap_scale_to_grid: !activeAltar.snap_scale_to_grid })}
              />
            </>
          )}
        </div>
      )}

      {activeAltar && (
        <div className="flex-1 min-h-0 px-3 pb-4 border-t border-stone-700/60 flex flex-col">
          <p className="pt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            {t('altar.placedElements')}
          </p>
          <div className="mt-2 flex-1 min-h-0 overflow-y-auto space-y-1 pr-1" onClick={(e) => { if (e.target === e.currentTarget) selectPlacement(null); }}>
            {sortedPlacements.length === 0 && (
              <p className="px-2 py-2 text-xs text-stone-600">{t('altar.noPlacedElements')}</p>
            )}
            {sortedPlacements.map((placement) => (
              <div key={placement.id} className="space-y-1">
                <PlacedElementRow
                  placement={placement}
                  isEditing={isEditing}
                  isSelected={selectedPlacementId === placement.id}
                  onSelect={() => selectPlacement(placement.id)}
                  onToggleHidden={() => updatePlacement(placement.id, { hidden: !placement.hidden })}
                  onToggleLocked={() => updatePlacement(placement.id, { locked: !placement.locked })}
                  onRemove={() => removePlacement(placement.id)}
                />
                {isEditing && selectedPlacementId === placement.id && selectedPlacement && (
                  <PlacedElementInspector
                    placement={selectedPlacement}
                    onUpdate={(patch) => updatePlacement(placement.id, patch)}
                    onBringToFront={() => bringPlacementToFront(placement.id)}
                    onBringForward={() => bringPlacementForward(placement.id)}
                    onSendBackward={() => sendPlacementBackward(placement.id)}
                    onSendToBack={() => sendPlacementToBack(placement.id)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
