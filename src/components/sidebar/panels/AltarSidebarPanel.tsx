import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import { Grid3x3, Magnet, RotateCw, Scaling } from 'lucide-react';
import SidebarSectionHeader from '../fields/SidebarSectionHeader';
import { useAltarStore } from '../../../store/altarStore';
import { ALTAR_RATIOS, ratioFromResolution } from '../../../lib/altarConstants';
import { generateId } from '../../../lib/helpers';
import { useUIStore } from '../../../store/uiStore';
import { useUndoStore } from '../../../store/undoStore';
import { useDisplayedAltar } from '../../../hooks/useDisplayedAltar';
import { usePointerReorder } from '../../../hooks/usePointerReorder';
import { usePersistedFlag } from '../../../hooks/usePersistedFlag';
import { PlacedElementRow, PlacedElementInspector } from '../fields/PlacedElementRow';
import AltarReadingSummary from '../fields/AltarReadingSummary';
import Favicon from '../fields/Favicon';


// The collapse states used to live per altar in localStorage; whatever is left of them goes.
try {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('altar-sidebar-sections-')) localStorage.removeItem(key);
  }
} catch {
  // Without storage there is nothing to clean up.
}

export default function AltarSidebarPanel() {
  const { t } = useTranslation();
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementIds = useAltarStore((s) => s.selectedPlacementIds);
  const {
    updateAltar,
    selectPlacement,
    selectPlacements,
    updatePlacement,
    duplicatePlacement,
    removePlacement,
    restorePlacement,
  } = useAltarStore(
    useShallow((s) => ({
      updateAltar: s.updateAltar,
      selectPlacement: s.selectPlacement,
      selectPlacements: s.selectPlacements,
      updatePlacement: s.updatePlacement,
      duplicatePlacement: s.duplicatePlacement,
      removePlacement: s.removePlacement,
      restorePlacement: s.restorePlacement,
    })),
  );
  const updateAltarGrid = useAltarStore((s) => s.updateAltarGrid);
  const pushUndo = useUndoStore((s) => s.push);
  /** Without confirmation, like every deletion; the notice offers Undo. */
  const removeWithUndo = async (id: string) => {
    const removed = await removePlacement(id);
    if (!removed) return;
    pushUndo({ id: generateId(), description: t('undo.placementRemoved'), undo: () => restorePlacement(removed) });
  };
  const updateAltarResolution = useAltarStore((s) => s.updateAltarResolution);
  const activeView = useUIStore((s) => s.activeView);
  const isEditing = activeView.type === 'altar' && activeView.mode === 'edit';
  const activeAltar = useDisplayedAltar();
  const gridOpacityPercent = Math.round((activeAltar?.grid_opacity ?? 0) * 100);
  // Collapse states as everywhere: a vault preference, the same for every altar.
  const [gridOpen, toggleGrid] = usePersistedFlag('altar-edit-grid-open', true);
  const [faviconOpen, toggleFavicon] = usePersistedFlag('altar-edit-favicon-open', true);
  const [canvasOptionsOpen, toggleCanvasOptions] = usePersistedFlag('altar-edit-canvas-open', true);
  const [placementsOpen, togglePlacements] = usePersistedFlag('altar-edit-placements-open', true);

  const sortedPlacements = useMemo(
    () => [...placements].sort((a, b) => b.z_index - a.z_index),
    [placements],
  );
  // The inspector is for one element; with several selected the builder's bar applies to all.
  const selectedPlacement = useMemo(
    () => (selectedPlacementIds.length === 1 ? sortedPlacements.find((p) => p.id === selectedPlacementIds[0]) ?? null : null),
    [sortedPlacements, selectedPlacementIds],
  );
  const selectRow = (id: string, additive: boolean) => {
    if (additive) {
      selectPlacements(selectedPlacementIds.includes(id) ? selectedPlacementIds.filter((sel) => sel !== id) : [...selectedPlacementIds, id]);
    } else {
      selectPlacement(selectedPlacementIds.length === 1 && selectedPlacementIds[0] === id ? null : id);
    }
  };
  const { listRef, visualItems: visualPlacements, draggingId, startDrag } = usePointerReorder(sortedPlacements, (ordered) => {
    const maxZ = ordered.length - 1;
    ordered.forEach((p, i) => {
      const newZ = maxZ - i;
      if (p.z_index !== newZ) updatePlacement(p.id, { z_index: newZ });
    });
  });

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) selectPlacement(null); }}>
      {activeAltar && !isEditing && <AltarReadingSummary />}
      {activeAltar && isEditing && (
        <div className="pb-5">
          <>
              <SidebarSectionHeader label={t('altar.favicon')} open={faviconOpen} onToggle={toggleFavicon} />
              {faviconOpen && (
                <div className="mt-2 mb-4">
                  <Favicon
                    value={activeAltar.icon_data}
                    onChange={(icon_data) => updateAltar(activeAltar.id, { icon_data })}
                    onRemove={() => updateAltar(activeAltar.id, { icon_data: null })}
                  />
                </div>
              )}
              <SidebarSectionHeader
                label={t('altar.canvasOptions')}
                open={canvasOptionsOpen}
                onToggle={toggleCanvasOptions}
                className="mt-4"
              />
              {canvasOptionsOpen && (
                <div className="mt-2">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle">{t('altar.ratio')}</p>
                  <div className="grid grid-cols-3 gap-1">
                    {ALTAR_RATIOS.map((r) => {
                      const active = ratioFromResolution(activeAltar.resolution) === r;
                      return (
                        <button
                          key={r}
                          onClick={() => updateAltarResolution(activeAltar.id, r)}
                          className={`rounded-md border py-1.5 text-[11px] font-medium text-center transition-colors ${
                            active
                              ? 'border-accent-edge bg-accent-fill text-on-accent'
                              : 'border-edge bg-well-sunk text-muted hover:border-edge-raise hover:text-raise'
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
          {isEditing && (
            <>
              <SidebarSectionHeader
                label={t('altar.gridOptions')}
                open={gridOpen}
                onToggle={toggleGrid}
                className="mt-4"
              />
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
                    className={`flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 transition-colors ${active ? 'border-accent-edge bg-accent-fill text-on-accent' : 'border-edge bg-well-sunk text-subtle hover:border-edge-raise hover:text-raise'}`}
                  >
                    <Icon size={14} />
                    <span className="text-[11px] leading-none">{label}</span>
                  </button>
                ))}
              </div>
              {/* The size also applies to snapping to the hidden grid; opacity and colour only to the visible one. */}
              {(activeAltar.grid_enabled || activeAltar.snap_to_grid || activeAltar.snap_scale_to_grid) && (
                <div className="mt-2 rounded-lg border border-edge bg-well-sunk px-3 py-2 space-y-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-subtle">{t('altar.gridSize')}</span>
                      <span className="text-[11px] tabular-nums text-soft">{activeAltar.grid_size}px</span>
                    </div>
                    <div className="relative h-4 flex items-center">
                      <div className="absolute inset-x-0 h-1 rounded-full bg-well-tint" />
                      <div className="absolute left-0 h-1 rounded-full bg-accent-track" style={{ width: `${((activeAltar.grid_size - 8) / 120) * 100}%` }} />
                      <div
                        className="absolute h-2.5 w-2.5 rounded-full bg-accent border border-accent-edge shadow-menu pointer-events-none"
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
                  {activeAltar.grid_enabled && <>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-subtle">{t('altar.gridOpacity')}</span>
                      <span className="text-[11px] tabular-nums text-soft">{gridOpacityPercent}%</span>
                    </div>
                    <div className="relative h-4 flex items-center">
                      <div className="absolute inset-x-0 h-1 rounded-full bg-well-tint" />
                      <div className="absolute left-0 h-1 rounded-full bg-accent-track" style={{ width: `${((gridOpacityPercent - 1) / 24) * 100}%` }} />
                      <div
                        className="absolute h-2.5 w-2.5 rounded-full bg-accent border border-accent-edge shadow-menu pointer-events-none"
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
                    <span className="text-[11px] uppercase tracking-wider text-subtle">{t('altar.gridColor')}</span>
                    <input
                      type="color"
                      value={activeAltar.grid_color}
                      disabled={!isEditing}
                      onChange={(event) => updateAltarGrid(activeAltar.id, { grid_color: event.target.value })}
                      className="h-6 w-10 rounded-md border border-edge-default bg-well-solid p-0"
                    />
                  </div>
                  </>}
                </div>
              )}
              {activeAltar.rotation_snap_enabled && (
                <div className="mt-2 rounded-lg border border-edge bg-well-sunk px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-subtle">{t('altar.rotationSnapAngle')}</span>
                    <span className="text-[11px] tabular-nums text-soft">{activeAltar.rotation_snap_angle}°</span>
                  </div>
                  <div className="relative h-4 flex items-center">
                    <div className="absolute inset-x-0 h-1 rounded-full bg-well-tint" />
                    <div className="absolute left-0 h-1 rounded-full bg-accent-track" style={{ width: `${((activeAltar.rotation_snap_angle - 1) / 179) * 100}%` }} />
                    <div
                      className="absolute h-2.5 w-2.5 rounded-full bg-accent border border-accent-edge shadow-menu pointer-events-none"
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
        <div className="sidebar-divider pb-4 border-t">
          <SidebarSectionHeader
            label={t('altar.placedElements')}
            open={placementsOpen}
            onToggle={togglePlacements}
            className="pt-4"
          />
          {placementsOpen && <div ref={listRef} className="mt-2 space-y-1 pr-1" onClick={(e) => { if (e.target === e.currentTarget) selectPlacement(null); }}>
            {sortedPlacements.length === 0 && (
              <p className="px-2 py-2 text-xs text-subtle">{t('altar.noElementsPlaced')}</p>
            )}
            {visualPlacements.map((placement) => (
              <div key={placement.id} className="space-y-1">
                <PlacedElementRow
                  placement={placement}
                  isEditing={isEditing}
                  isSelected={selectedPlacementIds.includes(placement.id)}
                  isDragging={draggingId === placement.id}
                  onSelect={(additive) => selectRow(placement.id, additive)}
                  onToggleHidden={() => updatePlacement(placement.id, { hidden: !placement.hidden })}
                  onToggleLocked={() => updatePlacement(placement.id, { locked: !placement.locked })}
                  onDuplicate={() => duplicatePlacement(placement.id)}
                  onRemove={() => void removeWithUndo(placement.id)}
                  onGripPointerDown={(e) => startDrag(e, placement.id)}
                />
                {isEditing && selectedPlacement?.id === placement.id && (
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
