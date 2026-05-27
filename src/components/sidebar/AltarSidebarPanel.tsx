import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown, ChevronsUp, ChevronsDown, Trash2, Check, Image as ImageIcon, Pencil } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import {
  ALTAR_BACKGROUND_PRESETS,
  ALTAR_BACKGROUND_STYLES,
  DEFAULT_ALTAR_BACKGROUND,
} from '../../lib/altarConstants';
import { useUIStore } from '../../store/uiStore';
import { AltarItemVisual } from '../altar/AltarItemVisual';
import { useBackgroundPreview } from '../altar/useAltarBackgroundPreview';

export default function AltarSidebarPanel() {
  const { t } = useTranslation();
  const {
    altars,
    activeAltarId,
    placements,
    selectedPlacementId,
    updateAltar,
    selectPlacement,
    updatePlacement,
    removePlacement,
    bringPlacementForward,
    sendPlacementBackward,
    bringPlacementToFront,
    sendPlacementToBack,
  } = useAltarStore();
  const activeView = useUIStore((s) => s.activeView);
  const altarCanvasGrid = useUIStore((s) => s.altarCanvasGrid);
  const altarCanvasGridSize = useUIStore((s) => s.altarCanvasGridSize);
  const altarCanvasGridOpacity = useUIStore((s) => s.altarCanvasGridOpacity);
  const altarCanvasGridColor = useUIStore((s) => s.altarCanvasGridColor);
  const altarSnapToGrid = useUIStore((s) => s.altarSnapToGrid);
  const setAltarCanvasGrid = useUIStore((s) => s.setAltarCanvasGrid);
  const setAltarCanvasGridSize = useUIStore((s) => s.setAltarCanvasGridSize);
  const setAltarCanvasGridOpacity = useUIStore((s) => s.setAltarCanvasGridOpacity);
  const setAltarCanvasGridColor = useUIStore((s) => s.setAltarCanvasGridColor);
  const setAltarSnapToGrid = useUIStore((s) => s.setAltarSnapToGrid);
  const isEditing = activeView.type === 'altar' && activeView.mode === 'edit';
  const activeAltar = altars.find((altar) => altar.id === activeAltarId) ?? null;
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
  const [inspectorDraft, setInspectorDraft] = useState({ x: '', y: '', scalePercent: '', rotation: '', opacity: '', zIndex: '' });
  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null;
  const sortedPlacements = [...placements].sort((a, b) => b.z_index - a.z_index);
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

  useEffect(() => {
    if (!selectedPlacement) {
      setInspectorDraft({ x: '', y: '', scalePercent: '', rotation: '', opacity: '', zIndex: '' });
      return;
    }
    const scalePercent = Math.round((((selectedPlacement.width + selectedPlacement.height) / 2) / 40) * 100);
    setInspectorDraft({
      x: selectedPlacement.x.toFixed(1),
      y: selectedPlacement.y.toFixed(1),
      scalePercent: scalePercent.toString(),
      rotation: selectedPlacement.rotation.toFixed(0),
      opacity: Math.round(selectedPlacement.opacity * 100).toString(),
      zIndex: selectedPlacement.z_index.toString(),
    });
  }, [selectedPlacement]);

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

  const updatePlacementNumber = (key: 'x' | 'y' | 'rotation' | 'opacity' | 'z_index', value: string) => {
    if (!selectedPlacement) return;
    const next = Number(value);
    if (Number.isNaN(next)) return;
    if (key === 'z_index') {
      const normalized = Math.max(0, Math.round(next));
      setInspectorDraft((current) => ({ ...current, zIndex: normalized.toString() }));
      updatePlacement(selectedPlacement.id, { z_index: normalized });
      return;
    }
    if (key === 'x' || key === 'y') {
      const normalized = Math.max(0, Math.min(100, next));
      updatePlacement(selectedPlacement.id, { [key]: normalized });
      return;
    }
    if (key === 'rotation') {
      const normalized = Math.max(-360, Math.min(360, next));
      updatePlacement(selectedPlacement.id, { rotation: normalized });
      return;
    }
    const normalizedOpacity = Math.max(0, Math.min(100, next)) / 100;
    updatePlacement(selectedPlacement.id, { opacity: normalizedOpacity });
  };

  const updatePlacementScalePercent = (value: string) => {
    if (!selectedPlacement) return;
    const percent = Number(value);
    if (Number.isNaN(percent)) return;
    const normalized = (Math.max(10, Math.min(1250, percent)) / 100) * 40;
    updatePlacement(selectedPlacement.id, { width: normalized, height: normalized });
  };

  const bindInspectorInput = (field: keyof typeof inspectorDraft, apply: () => void) => ({
    value: inspectorDraft[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setInspectorDraft((current) => ({ ...current, [field]: value }));
    },
    onBlur: apply,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.currentTarget.blur();
      }
    },
  });

  return (
    <div className="flex flex-col h-full">
      {/* Hidden file inputs */}
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
              <button
                onClick={() => setAltarCanvasGrid(!altarCanvasGrid)}
                className="mt-2 w-full rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2 transition-colors hover:border-stone-500/70"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-xs text-stone-300">{t('altar.gridOverlay')}</span>
                  <span
                    className={`relative h-5 w-9 rounded-full border transition-colors ${altarCanvasGrid ? 'border-jade-600/70 bg-jade-900/45' : 'border-stone-600 bg-stone-800/80'}`}
                    aria-hidden="true"
                  >
                    <span
                      className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${altarCanvasGrid ? 'left-[18px] bg-jade-300' : 'left-0.5 bg-stone-400'}`}
                    />
                  </span>
                </span>
              </button>
              {altarCanvasGrid && (
                <div className="mt-2 rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridSize')}</span>
                <input
                  type="number"
                  min={8}
                  max={128}
                  value={altarCanvasGridSize}
                  disabled={!isEditing}
                  onChange={(event) => setAltarCanvasGridSize(Number(event.target.value) || 8)}
                  className="w-14 rounded bg-stone-800/70 px-1.5 py-0.5 text-right text-xs text-stone-300 outline-none"
                />
              </div>
              <input
                type="range"
                min={8}
                max={128}
                value={altarCanvasGridSize}
                disabled={!isEditing}
                onChange={(event) => setAltarCanvasGridSize(Number(event.target.value))}
                className="w-full"
              />
              <div className="mt-2 mb-1 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridOpacity')}</span>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={Math.round(altarCanvasGridOpacity * 100)}
                  disabled={!isEditing}
                  onChange={(event) => setAltarCanvasGridOpacity((Number(event.target.value) || 1) / 100)}
                  className="w-14 rounded bg-stone-800/70 px-1.5 py-0.5 text-right text-xs text-stone-300 outline-none"
                />
              </div>
              <input
                type="range"
                min={1}
                max={25}
                value={Math.round(altarCanvasGridOpacity * 100)}
                disabled={!isEditing}
                onChange={(event) => setAltarCanvasGridOpacity(Number(event.target.value) / 100)}
                className="w-full"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridColor')}</span>
                <input
                  type="color"
                  value={altarCanvasGridColor}
                  disabled={!isEditing}
                  onChange={(event) => setAltarCanvasGridColor(event.target.value)}
                  className="h-6 w-10 rounded border border-stone-700 bg-stone-800 p-0"
                />
              </div>
                </div>
              )}
              <button
                onClick={() => setAltarSnapToGrid(!altarSnapToGrid)}
                className="mt-2 w-full rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2 transition-colors hover:border-stone-500/70"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-xs text-stone-300">{t('altar.snapToGrid')}</span>
                  <span
                    className={`relative h-5 w-9 rounded-full border transition-colors ${altarSnapToGrid ? 'border-jade-600/70 bg-jade-900/45' : 'border-stone-600 bg-stone-800/80'}`}
                    aria-hidden="true"
                  >
                    <span
                      className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${altarSnapToGrid ? 'left-[18px] bg-jade-300' : 'left-0.5 bg-stone-400'}`}
                    />
                  </span>
                </span>
              </button>
            </>
          )}
        </div>
      )}

      {activeAltar && (
        <div className="flex-1 min-h-0 px-3 pb-4 border-t border-stone-700/60 flex flex-col">
          <p className="pt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            {t('altar.placedElements')}
          </p>
          <div className="mt-2 flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
            {sortedPlacements.length === 0 && (
              <p className="px-2 py-2 text-xs text-stone-600">{t('altar.noPlacedElements')}</p>
            )}
            {sortedPlacements.map((placement) => (
              <div key={placement.id} className="space-y-1">
                <div
                  onClick={() => { if (isEditing) selectPlacement(placement.id); }}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${isEditing ? 'cursor-pointer' : 'cursor-default'} ${selectedPlacementId === placement.id ? 'bg-stone-700/70 text-stone-100' : 'bg-stone-900/40 text-stone-300'} ${isEditing ? 'hover:bg-stone-800/60' : ''}`}
                >
                  <AltarItemVisual item={placement} size={16} candleAnimate={placement.category === 'candle'} />
                  <span className="flex-1 truncate text-xs">{placement.name}</span>
                  <span className="text-[10px] text-stone-500">z{placement.z_index}</span>
                  {isEditing && <span className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
                    <button
                      onClick={() => updatePlacement(placement.id, { hidden: !placement.hidden })}
                      className="text-stone-500 hover:text-stone-300"
                      title={placement.hidden ? t('altar.show') : t('altar.hide')}
                    >
                      {placement.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button
                      onClick={() => updatePlacement(placement.id, { locked: !placement.locked })}
                      className="text-stone-500 hover:text-stone-300"
                      title={placement.locked ? t('altar.unlock') : t('altar.lock')}
                    >
                      {placement.locked ? <Lock size={12} /> : <Unlock size={12} />}
                    </button>
                    <button
                      onClick={() => removePlacement(placement.id)}
                      className="text-stone-500 hover:text-red-400"
                      title={t('altar.removeElement')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>}
                </div>

                {isEditing && selectedPlacementId === placement.id && selectedPlacement && (
                  <div className="rounded-lg border border-stone-700/60 bg-stone-900/40 p-2.5 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">{t('altar.inspector')}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorX')}</span>
                        <input {...bindInspectorInput('x', () => updatePlacementNumber('x', inspectorDraft.x))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="x" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorY')}</span>
                        <input {...bindInspectorInput('y', () => updatePlacementNumber('y', inspectorDraft.y))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="y" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorScale')}</span>
                        <input {...bindInspectorInput('scalePercent', () => updatePlacementScalePercent(inspectorDraft.scalePercent))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="scale" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorRotation')}</span>
                        <input {...bindInspectorInput('rotation', () => updatePlacementNumber('rotation', inspectorDraft.rotation))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="rotation" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorOpacity')}</span>
                        <input {...bindInspectorInput('opacity', () => updatePlacementNumber('opacity', inspectorDraft.opacity))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="opacity" />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">{t('altar.inspectorZIndex')}</span>
                        <input {...bindInspectorInput('zIndex', () => updatePlacementNumber('z_index', inspectorDraft.zIndex))} className="w-full bg-stone-800/60 rounded px-2 py-1 text-xs" aria-label="z-index" />
                      </label>
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      <button onClick={() => bringPlacementToFront(placement.id)} className="btn-ghost" title={t('altar.toFront')}><ChevronsUp size={12} /></button>
                      <button onClick={() => bringPlacementForward(placement.id)} className="btn-ghost" title={t('altar.forward')}><ArrowUp size={12} /></button>
                      <button onClick={() => sendPlacementBackward(placement.id)} className="btn-ghost" title={t('altar.backward')}><ArrowDown size={12} /></button>
                      <button onClick={() => sendPlacementToBack(placement.id)} className="btn-ghost" title={t('altar.toBack')}><ChevronsDown size={12} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
