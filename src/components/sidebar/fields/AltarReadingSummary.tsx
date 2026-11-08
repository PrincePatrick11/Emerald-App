import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3, Palette, Proportions, Smile } from 'lucide-react';
import { useAltarStore } from '../../../store/altarStore';
import { useDisplayedAltar } from '../../../hooks/useDisplayedAltar';
import { altarBackgroundUrl, altarCanvasBackground } from '../../../lib/altarBackground';
import { backgroundCss } from '../../editors/canvas/background';
import { AltarPlacementVisual, placementLabel } from '../../altar/AltarPlacementVisual';
import { FaviconGlyph } from './Favicon';
import SidebarSection, { SidebarEmpty, SidebarItemRow, SidebarPropertyRow } from './SidebarSection';
import { PropertiesSection } from './EntryReadSections';

/**
 * The read view of an altar in the right sidebar: its
 * properties (format, background, grid) and the visible
 * elements; a click selects one on the canvas, as when editing.
 */
export default function AltarReadingSummary() {
  const { t } = useTranslation();
  const activeAltar = useDisplayedAltar();
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementIds = useAltarStore((s) => s.selectedPlacementIds);
  const selectPlacement = useAltarStore((s) => s.selectPlacement);
  // What is visible on the altar, frontmost on top, like the list when editing.
  const visiblePlacements = useMemo(
    () => placements.filter((p) => !p.hidden).sort((a, b) => b.z_index - a.z_index),
    [placements],
  );

  // The background as the canvas editor has it: a swatch of it, and what it is made of.
  const backgroundInfo = useMemo(() => {
    if (!activeAltar) return null;
    const bg = altarCanvasBackground(activeAltar);
    const parts = [
      bg.fill.kind !== 'none' && t(`canvas.background.${bg.fill.kind}`),
      bg.image && t('canvas.background.image'),
      bg.tint && t(bg.tint.color === '#ffffff' ? 'canvas.background.lighten' : 'canvas.background.darken'),
    ].filter(Boolean);
    return { label: parts.join(' · ') || t('canvas.background.none'), style: { background: backgroundCss(bg, altarBackgroundUrl) } };
  }, [activeAltar, t]);

  if (!activeAltar) {
    return null;
  }

  const gridActive = activeAltar.grid_enabled;

  // Own spacing: the altar's panel sits as a single child in the sidebar body.
  return (
    <div className="flex flex-col gap-5">
      <PropertiesSection>
        {activeAltar.icon_data && (
          <SidebarPropertyRow
            icon={<Smile size={14} />}
            label={t('properties.icon')}
            value={<FaviconGlyph value={activeAltar.icon_data} className="w-4 h-4 text-sm" />}
          />
        )}
        <SidebarPropertyRow
          icon={<Proportions size={14} />}
          label={t('altar.summaryFormat')}
          // Set like the other values; only the "x" of the resolution becomes a multiplication sign.
          value={activeAltar.resolution.replace('x', ' × ')}
        />
        {backgroundInfo && (
          <SidebarPropertyRow
            icon={<Palette size={14} />}
            label={t('altar.summaryBackground')}
            value={(
              <>
                <span className="h-3.5 w-3.5 flex-shrink-0 rounded-sm border border-[var(--border-soft)]" style={backgroundInfo.style} aria-hidden="true" />
                <span className="truncate">{backgroundInfo.label}</span>
              </>
            )}
          />
        )}
        <SidebarPropertyRow
          icon={<Grid3x3 size={14} />}
          label={t('altar.summaryGrid')}
          value={gridActive ? `${activeAltar.grid_size} px` : t('altar.summaryGridOff')}
          muted={!gridActive}
        />
      </PropertiesSection>

      <SidebarSection storageKey="altar-sidebar-elements-open" label={t('altar.summaryElements')} count={visiblePlacements.length}>
        {visiblePlacements.length === 0 && <SidebarEmpty>{t('altar.noElementsPlaced')}</SidebarEmpty>}
        {visiblePlacements.map((placement) => (
          <SidebarItemRow
            key={placement.id}
            icon={<AltarPlacementVisual placement={placement} size={16} />}
            label={placementLabel(placement, t)}
            active={selectedPlacementIds.includes(placement.id)}
            onClick={() => selectPlacement(selectedPlacementIds.length === 1 && selectedPlacementIds[0] === placement.id ? null : placement.id)}
          />
        ))}
      </SidebarSection>
    </div>
  );
}
