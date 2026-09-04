import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Check, ChevronDown, ChevronRight, Grid3x3, Image as ImageIcon, Magnet, Pencil, RotateCw, Scaling, Trash2, X } from 'lucide-react';
import { useAltarStore } from '../../../store/altarStore';
import {
  ALTAR_RATIOS,
  ALTAR_BACKGROUND_PRESETS,
  ALTAR_BACKGROUND_STYLES,
  ALTAR_IMAGE_PRESETS,
  DEFAULT_ALTAR_BACKGROUND,
  DEFAULT_BACKGROUND_OVERLAY,
  GRADIENT_PRESET_COLORS,
  LEGACY_GRADIENT_COLORS,
  generateGradientStyle,
  isGradientPreset,
  getGradientColor,
  parseResolution,
  isRatioFormat,
  ratioFromResolution,
} from '../../../lib/altarConstants';
import { readFileAsDataUrl, ACCEPTED_IMAGE_MIME, isAcceptedImageFile } from '../../../lib/helpers';
import Button from '../../ui/Button';
import { useUIStore } from '../../../store/uiStore';
import { imageSrc, saveImage } from '../../../lib/images';
import { PlacedElementRow, PlacedElementInspector } from '../fields/PlacedElementRow';
import AltarReadingSummary from '../fields/AltarReadingSummary';
import Favicon from '../fields/Favicon';
import Modal from '../../ui/Modal';

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
  const [overlayOpen, setOverlayOpen] = useState(true);
  const [gradientModalOpen, setGradientModalOpen] = useState(false);
  const [gradientOriginalColor, setGradientOriginalColor] = useState<string>(GRADIENT_PRESET_COLORS[0]);
  const [gradientOriginalPreset, setGradientOriginalPreset] = useState<string>('');
const [gridOpen, setGridOpen] = useState(true);
  const [faviconOpen, setFaviconOpen] = useState(true);
  const [canvasOptionsOpen, setCanvasOptionsOpen] = useState(true);
  const [placementsOpen, setPlacementsOpen] = useState(true);
  const altarId = activeAltar?.id;
  const altarIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    altarIdRef.current = altarId;
    if (!altarId) return;
    try {
      const stored = localStorage.getItem(`altar-sidebar-sections-${altarId}`);
      const s = stored ? JSON.parse(stored) : {};
      setBackgroundOpen(typeof s.backgroundOpen === 'boolean' ? s.backgroundOpen : true);
      setOverlayOpen(typeof s.overlayOpen === 'boolean' ? s.overlayOpen : true);
      setGridOpen(typeof s.gridOpen === 'boolean' ? s.gridOpen : true);
      setFaviconOpen(typeof s.faviconOpen === 'boolean' ? s.faviconOpen : true);
      setCanvasOptionsOpen(typeof s.canvasOptionsOpen === 'boolean' ? s.canvasOptionsOpen : true);
      setPlacementsOpen(typeof s.placementsOpen === 'boolean' ? s.placementsOpen : true);
    } catch {}
  }, [altarId]);

  useEffect(() => {
    const id = altarIdRef.current;
    if (!id) return;
    localStorage.setItem(`altar-sidebar-sections-${id}`, JSON.stringify({
      backgroundOpen, overlayOpen, gridOpen, faviconOpen, canvasOptionsOpen, placementsOpen,
    }));
  // altarIdRef ist absichtlich nicht in den Deps – nur Section-Toggles sollen speichern, nicht der Altar-Wechsel
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundOpen, overlayOpen, gridOpen, faviconOpen, canvasOptionsOpen, placementsOpen]);

  const [dragState, setDragState] = useState<{ fromId: string; overIndex: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // keeps onUp closure current without re-subscribing drag listeners
  const visualPlacementsRef = useRef<typeof sortedPlacements>([]);
  // In-memory cache of previously uploaded background paths for the current session.
  // Allows re-activating a custom background after switching to a preset without
  // re-uploading. Not persisted — the active path is authoritative in the DB.
  const [customBackgroundMap, setCustomBackgroundMap] = useState<Record<string, string>>({});
  const [gradientColorMap, setGradientColorMap] = useState<Record<string, string>>({});
  const customBackgroundSource = activeAltar?.background_image_data || (activeAltar ? customBackgroundMap[activeAltar.id] : null);
  const customBackgroundPreview = imageSrc(customBackgroundSource);
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
  const backgroundUrl = customBackgroundPreview
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

  const updateBackgroundPreset = async (preset: string) => {
    if (!activeAltar) return;
    await updateAltar(activeAltar.id, { background_preset: preset, background_image_data: null });
  };

  const handleBackgroundUpload = (file: File) => {
    if (!activeAltar) return;
    if (!isAcceptedImageFile(file)) {
      showBackgroundNotice(t('common.unsupportedImageFormat'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showBackgroundNotice(t('altar.imageTooLarge', { max: '5 MB' }));
      return;
    }
    readFileAsDataUrl(file)
      .then((data) => saveImage(data))
      .then((filename) => {
        setCustomBackgroundMap((current) => ({ ...current, [activeAltar.id]: filename }));
        return updateAltar(activeAltar.id, { background_preset: 'custom', background_image_data: filename });
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
      {activeAltar && !isEditing && <AltarReadingSummary />}
      <input
        ref={backgroundInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_MIME}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          handleBackgroundUpload(file);
          e.target.value = '';
        }}
      />
      {activeAltar && isEditing && (
        <div className="pb-5">
          <>
              <button
                onClick={() => setFaviconOpen((v) => !v)}
                className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-400"
              >
                {faviconOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('altar.favicon')}
              </button>
              {faviconOpen && (
                <div className="mt-2 mb-4">
                  <Favicon
                    value={activeAltar.icon_data}
                    onChange={(icon_data) => updateAltar(activeAltar.id, { icon_data })}
                    onRemove={() => updateAltar(activeAltar.id, { icon_data: null })}
                  />
                </div>
              )}
              <button
                onClick={() => setCanvasOptionsOpen((v) => !v)}
                className="flex items-center gap-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-400"
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
                {ALTAR_IMAGE_PRESETS.map((name) => {
                  const selected = !activeAltar.background_image_data && activeAltar.background_preset === name;
                  return (
                    <button
                      key={name}
                      onClick={() => { if (isEditing) updateBackgroundPreset(name); }}
                      disabled={!isEditing}
                      className={`relative overflow-hidden rounded-md border transition-colors ${
                        selected ? 'border-jade-600/70 ring-1 ring-jade-700/40' : 'border-stone-700/50 hover:border-stone-500/60'
                      }`}
                      title={t(`altar.backgrounds.${name}`)}
                    >
                      <img
                        src={`/backgrounds/thumbs/${name}.webp`}
                        alt={t(`altar.backgrounds.${name}`)}
                        className="h-9 w-full object-cover"
                      />
                      {selected && (
                        <span className="absolute right-1 top-1 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                          <Check size={8} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const currentPreset = activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND;
                const isLegacyGradient = ALTAR_BACKGROUND_PRESETS.includes(currentPreset as (typeof ALTAR_BACKGROUND_PRESETS)[number]);
                const isGradientActive = !activeAltar.background_image_data && (isGradientPreset(currentPreset) || isLegacyGradient);
                const activeGradientColor = isGradientPreset(currentPreset)
                  ? getGradientColor(currentPreset)
                  : isLegacyGradient
                    ? LEGACY_GRADIENT_COLORS[currentPreset as (typeof ALTAR_BACKGROUND_PRESETS)[number]]
                    : GRADIENT_PRESET_COLORS[0];
                const lastGradientColor = gradientColorMap[activeAltar.id] ?? (isGradientActive ? activeGradientColor : null);
                const hasGradient = lastGradientColor !== null;
                const displayColor = lastGradientColor ?? GRADIENT_PRESET_COLORS[0];

                const applyGradient = (color: string) => {
                  setGradientColorMap((prev) => ({ ...prev, [activeAltar.id]: color }));
                  updateBackgroundPreset(`gradient:${color}`);
                };
                const removeGradient = () => {
                  setGradientColorMap((prev) => { const next = { ...prev }; delete next[activeAltar.id]; return next; });
                  if (isGradientActive) updateBackgroundPreset(ALTAR_IMAGE_PRESETS[0]);
                };
                const openModal = () => {
                  setGradientOriginalColor(displayColor);
                  setGradientOriginalPreset(activeAltar.background_preset);
                  setGradientModalOpen(true);
                };

                return (
                  <>
                    {hasGradient ? (
                      <div className="grid grid-cols-4 items-center gap-1.5">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => { if (isEditing) applyGradient(displayColor); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isEditing) applyGradient(displayColor); } }}
                          className={`relative h-9 overflow-hidden rounded-md border cursor-pointer transition-colors ${
                            isGradientActive ? 'border-jade-600/70 ring-1 ring-jade-700/40' : 'border-stone-700/50 hover:border-stone-500/60'
                          }`}
                          title={t('altar.backgrounds.gradient')}
                        >
                          <div className="h-full w-full" style={{ background: generateGradientStyle(displayColor) }} />
                          {isGradientActive && (
                            <span className="absolute right-0.5 top-0.5 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                              <Check size={7} />
                            </span>
                          )}
                        </div>
                        <div className="col-span-3 flex gap-1.5">
                        <Button tone="neutral" small fill onClick={openModal}>
                          <Pencil size={12} />{t('altar.change')}
                        </Button>
                        <Button tone="danger" small fill onClick={removeGradient}>
                          <Trash2 size={12} />{t('altar.remove')}
                        </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        tone="neutral"
                        onClick={() => { if (isEditing) openModal(); }}
                        disabled={!isEditing}
                        className="w-full"
                      >
                        <div className="h-3 w-5 rounded-sm flex-shrink-0" style={{ background: generateGradientStyle(GRADIENT_PRESET_COLORS[0]) }} />
                        {t('altar.backgrounds.gradient')}
                      </Button>
                    )}
                    {gradientModalOpen && (() => {
                      const res = activeAltar.resolution;
                      const { w, h } = isRatioFormat(res)
                        ? { w: Number(res.split(':')[0]), h: Number(res.split(':')[1]) }
                        : parseResolution(res);
                      const maxW = 240;
                      const previewW = w >= h ? maxW : Math.round(128 * w / h);
                      const previewH = w >= h ? Math.round(maxW * h / w) : 128;
                      const revertAndClose = () => {
                        updateAltar(activeAltar.id, { background_preset: gradientOriginalPreset || DEFAULT_ALTAR_BACKGROUND, background_image_data: null }).catch(console.error);
                        if (isGradientPreset(gradientOriginalPreset) || ALTAR_BACKGROUND_PRESETS.includes(gradientOriginalPreset as (typeof ALTAR_BACKGROUND_PRESETS)[number])) {
                          setGradientColorMap((prev) => ({ ...prev, [activeAltar.id]: gradientOriginalColor }));
                        } else {
                          setGradientColorMap((prev) => { const next = { ...prev }; delete next[activeAltar.id]; return next; });
                        }
                        setGradientModalOpen(false);
                      };
                      return (
                        <Modal
                          title={t('altar.backgrounds.gradient')}
                          onClose={revertAndClose}
                          widthClassName="w-72"
                          bodyClassName="p-4 space-y-3"
                          className="overflow-hidden"
                        >
                              <div className="flex justify-center">
                                <div
                                  className="rounded-lg overflow-hidden border border-stone-700/50"
                                  style={{ width: previewW, height: previewH, background: generateGradientStyle(displayColor) }}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                {GRADIENT_PRESET_COLORS.map((color) => (
                                  <button
                                    key={color}
                                    onClick={() => applyGradient(color)}
                                    title={color}
                                    className={`h-6 w-6 flex-shrink-0 rounded-full border-2 transition-all ${
                                      displayColor === color ? 'border-jade-400 scale-110' : 'border-stone-600 hover:border-stone-400'
                                    }`}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                                <button
                                  title={t('altar.customColor')}
                                  className={`relative flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-all ${
                                    !GRADIENT_PRESET_COLORS.includes(displayColor as (typeof GRADIENT_PRESET_COLORS)[number])
                                      ? 'border-jade-400 scale-110'
                                      : 'border-stone-600 hover:border-stone-400'
                                  }`}
                                  style={
                                    !GRADIENT_PRESET_COLORS.includes(displayColor as (typeof GRADIENT_PRESET_COLORS)[number])
                                      ? { backgroundColor: displayColor }
                                      : { backgroundColor: '#44403c' }
                                  }
                                >
                                  <input
                                    type="color"
                                    value={displayColor}
                                    onChange={(e) => applyGradient(e.target.value)}
                                    className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
                                  />
                                  {GRADIENT_PRESET_COLORS.includes(displayColor as (typeof GRADIENT_PRESET_COLORS)[number]) && (
                                    <span className="text-[10px] leading-none text-stone-400 pointer-events-none">+</span>
                                  )}
                                </button>
                              </div>
                              <div className="flex items-center justify-end gap-1">
                                <Button onClick={revertAndClose} variant="ghost"><X size={13} /></Button>
                                <Button onClick={() => { applyGradient(displayColor); setGradientModalOpen(false); }} variant="ghost" className="text-jade-400"><Check size={13} /></Button>
                              </div>
                        </Modal>
                      );
                    })()}
                  </>
                );
              })()}
              {hasCustomBackground ? (
                <div className="grid grid-cols-4 items-center gap-1.5">
                  <div
                    onClick={activateCustomBackground}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateCustomBackground(); }
                    }}
                    className={`relative h-9 overflow-hidden rounded-md border cursor-pointer transition-colors ${
                      activeAltar.background_image_data
                        ? 'border-jade-600/70 ring-1 ring-jade-700/40'
                        : 'border-stone-700/50 hover:border-stone-500/60'
                    }`}
                    title={t('altar.customBackground')}
                  >
                    <div
                      className="h-full w-full bg-gradient-to-br from-stone-800/80 via-stone-900/70 to-stone-950/80"
                      style={backgroundUrl ? { backgroundImage: backgroundUrl, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    />
                    {activeAltar.background_image_data && (
                      <span className="absolute right-0.5 top-0.5 rounded-full border border-jade-600/60 bg-jade-900/70 p-0.5 text-jade-200">
                        <Check size={7} />
                      </span>
                    )}
                  </div>
                  <div className="col-span-3 flex gap-1.5">
                  <Button tone="neutral" small fill onClick={() => backgroundInputRef.current?.click()}>
                    <Pencil size={12} />{t('altar.change')}
                  </Button>
                  <Button tone="danger" small fill onClick={removeCustomBackground}>
                    <Trash2 size={12} />{t('altar.remove')}
                  </Button>
                  </div>
                </div>
              ) : (
                <Button tone="neutral" onClick={() => backgroundInputRef.current?.click()} className="w-full">
                  <ImageIcon size={12} />{t('altar.customBackground')}
                </Button>
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
                  style={(() => {
                    const p = activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND;
                    if (activeAltar.background_image_data && backgroundUrl)
                      return { backgroundImage: backgroundUrl, backgroundSize: 'cover', backgroundPosition: 'center' };
                    if (ALTAR_IMAGE_PRESETS.includes(p as (typeof ALTAR_IMAGE_PRESETS)[number]))
                      return { backgroundImage: `url("/backgrounds/thumbs/${p}.webp")`, backgroundSize: 'cover', backgroundPosition: 'center' };
                    if (isGradientPreset(p))
                      return { background: generateGradientStyle(getGradientColor(p) ?? '#ffffff') };
                    return { background: ALTAR_BACKGROUND_STYLES[(p) as (typeof ALTAR_BACKGROUND_PRESETS)[number]] ?? ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND] };
                  })()}
                >
                  {!activeAltar.background_image_data && <div className="h-full w-full" />}
                </div>
                <div className="altar-bg-preset-label border-t border-stone-800/70 bg-stone-900/80 px-2 py-1 text-left text-[11px] text-stone-300">
                  {activeAltar.background_image_data
                    ? t('altar.customBackground')
                    : isGradientPreset(activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND)
                      ? t('altar.backgrounds.gradient')
                      : t(`altar.backgrounds.${activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND}`)}
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
                onClick={() => setOverlayOpen((v) => !v)}
                className="mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 hover:text-stone-400"
              >
                {overlayOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('altar.overlayOptions')}
              </button>
              {overlayOpen && (() => {
                const overlayPercent = Math.round((activeAltar.background_overlay ?? DEFAULT_BACKGROUND_OVERLAY) * 100);
                const overlayColor = activeAltar.background_overlay_color ?? 'dark';
                return (
                  <div className="mt-2 rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2 space-y-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.backgroundOverlay')}</span>
                        <span className="text-[11px] tabular-nums text-stone-300">{overlayPercent}%</span>
                      </div>
                      <div className="relative h-4 flex items-center">
                        <div className="absolute inset-x-0 h-1 rounded-full bg-stone-800/80" />
                        <div className="absolute left-0 h-1 rounded-full bg-jade-600/60" style={{ width: `${overlayPercent}%` }} />
                        <div
                          className="absolute h-2.5 w-2.5 rounded-full bg-jade-500 border border-jade-400/50 shadow pointer-events-none"
                          style={{ left: `calc(${overlayPercent}% - 5px)` }}
                        />
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={overlayPercent}
                          onChange={(e) => updateAltar(activeAltar.id, { background_overlay: Number(e.target.value) / 100 })}
                          className="absolute inset-x-0 w-full opacity-0 cursor-pointer h-4"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['dark', 'light'] as const).map((color) => (
                        <button
                          key={color}
                          onClick={() => updateAltar(activeAltar.id, { background_overlay_color: color })}
                          className={`flex items-center justify-center gap-1.5 rounded border py-1 text-[10px] uppercase tracking-wide transition-colors ${
                            overlayColor === color
                              ? 'border-jade-600/70 bg-jade-900/40 text-jade-300'
                              : 'border-stone-700/60 bg-stone-900/45 text-stone-400 hover:border-stone-500/70 hover:text-stone-300'
                          }`}
                        >
                          <span
                            className="h-3 w-3 rounded-full border border-stone-600/60 flex-shrink-0"
                            style={{ background: color === 'dark' ? '#0a0a0f' : '#ffffff' }}
                          />
                          {t(`altar.overlay.${color}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
                  { key: 'grid_enabled' as const, icon: Grid3x3, label: t('altar.gridToggleGrid'), title: t('altar.gridOverlay'), toggle: () => updateAltarGrid(activeAltar.id, { grid_enabled: !activeAltar.grid_enabled }), active: activeAltar.grid_enabled },
                  { key: 'snap_to_grid' as const, icon: Magnet, label: t('altar.gridToggleSnap'), title: t('altar.snapToGrid'), toggle: () => updateAltarGrid(activeAltar.id, { snap_to_grid: !activeAltar.snap_to_grid }), active: activeAltar.snap_to_grid },
                  { key: 'rotation_snap_enabled' as const, icon: RotateCw, label: t('altar.gridToggleRotate'), title: t('altar.rotationSnap'), toggle: () => updateAltarGrid(activeAltar.id, { rotation_snap_enabled: !activeAltar.rotation_snap_enabled }), active: activeAltar.rotation_snap_enabled },
                  { key: 'snap_scale_to_grid' as const, icon: Scaling, label: t('altar.gridToggleScale'), title: t('altar.snapScaleToGrid'), toggle: () => updateAltarGrid(activeAltar.id, { snap_scale_to_grid: !activeAltar.snap_scale_to_grid }), active: activeAltar.snap_scale_to_grid },
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
                <div className="mt-2 rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2 space-y-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridSize')}</span>
                      <span className="text-[11px] tabular-nums text-stone-300">{activeAltar.grid_size}px</span>
                    </div>
                    <div className="relative h-4 flex items-center">
                      <div className="absolute inset-x-0 h-1 rounded-full bg-stone-800/80" />
                      <div className="absolute left-0 h-1 rounded-full bg-jade-600/60" style={{ width: `${((activeAltar.grid_size - 8) / 120) * 100}%` }} />
                      <div
                        className="absolute h-2.5 w-2.5 rounded-full bg-jade-500 border border-jade-400/50 shadow pointer-events-none"
                        style={{ left: `calc(${((activeAltar.grid_size - 8) / 120) * 100}% - 5px)` }}
                      />
                      <input
                        type="range"
                        min={8}
                        max={128}
                        value={activeAltar.grid_size}
                        disabled={!isEditing}
                        onChange={(event) => updateAltarGrid(activeAltar.id, { grid_size: Number(event.target.value) })}
                        className="absolute inset-x-0 w-full opacity-0 cursor-pointer h-4 disabled:cursor-default"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.gridOpacity')}</span>
                      <span className="text-[11px] tabular-nums text-stone-300">{gridOpacityPercent}%</span>
                    </div>
                    <div className="relative h-4 flex items-center">
                      <div className="absolute inset-x-0 h-1 rounded-full bg-stone-800/80" />
                      <div className="absolute left-0 h-1 rounded-full bg-jade-600/60" style={{ width: `${((gridOpacityPercent - 1) / 24) * 100}%` }} />
                      <div
                        className="absolute h-2.5 w-2.5 rounded-full bg-jade-500 border border-jade-400/50 shadow pointer-events-none"
                        style={{ left: `calc(${((gridOpacityPercent - 1) / 24) * 100}% - 5px)` }}
                      />
                      <input
                        type="range"
                        min={1}
                        max={25}
                        value={gridOpacityPercent}
                        disabled={!isEditing}
                        onChange={(event) => updateAltarGrid(activeAltar.id, { grid_opacity: Number(event.target.value) / 100 })}
                        className="absolute inset-x-0 w-full opacity-0 cursor-pointer h-4 disabled:cursor-default"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
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
                <div className="mt-2 rounded-lg border border-stone-700/60 bg-stone-900/45 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-stone-500">{t('altar.rotationSnapAngle')}</span>
                    <span className="text-[11px] tabular-nums text-stone-300">{activeAltar.rotation_snap_angle}°</span>
                  </div>
                  <div className="relative h-4 flex items-center">
                    <div className="absolute inset-x-0 h-1 rounded-full bg-stone-800/80" />
                    <div className="absolute left-0 h-1 rounded-full bg-jade-600/60" style={{ width: `${((activeAltar.rotation_snap_angle - 1) / 179) * 100}%` }} />
                    <div
                      className="absolute h-2.5 w-2.5 rounded-full bg-jade-500 border border-jade-400/50 shadow pointer-events-none"
                      style={{ left: `calc(${((activeAltar.rotation_snap_angle - 1) / 179) * 100}% - 5px)` }}
                    />
                    <input
                      type="range"
                      min={1}
                      max={180}
                      value={activeAltar.rotation_snap_angle}
                      onChange={(e) => updateAltarGrid(activeAltar.id, { rotation_snap_angle: Number(e.target.value) })}
                      className="absolute inset-x-0 w-full opacity-0 cursor-pointer h-4"
                    />
                  </div>
                </div>
              )}
              </>}
            </>
          )}
        </div>
      )}

      {activeAltar && isEditing && (
        <div className="pb-4 border-t border-stone-700/60">
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
