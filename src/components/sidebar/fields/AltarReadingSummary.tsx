import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3, Layers, Palette, Proportions, Smile } from 'lucide-react';
import { useAltarStore } from '../../../store/altarStore';
import { useDisplayedAltar } from '../../../hooks/useDisplayedAltar';
import {
  ALTAR_BACKGROUND_PRESETS,
  ALTAR_BACKGROUND_STYLES,
  ALTAR_IMAGE_PRESETS,
  DEFAULT_ALTAR_BACKGROUND,
  LEGACY_GRADIENT_COLORS,
  generateGradientStyle,
  getGradientColor,
  isCandleEmoji,
  isGradientPreset,
} from '../../../lib/altarConstants';
import { imageSrc } from '../../../lib/images';
import { AltarItemVisual } from '../../altar/AltarItemVisual';
import { FaviconGlyph } from './Favicon';
import SidebarSection, { SidebarEmpty, SidebarItemRow, SidebarPropertyRow } from './SidebarSection';
import { PropertiesSection } from './EntryReadSections';

/**
 * Die Leseansicht eines Altars in der rechten Seitenleiste: seine
 * Eigenschaften (Format, Hintergrund, Überlagerung, Raster) und die sichtbaren
 * Elemente — ein Klick markiert eines auf der Fläche, wie im Bearbeiten.
 */
export default function AltarReadingSummary() {
  const { t } = useTranslation();
  const activeAltar = useDisplayedAltar();
  const placements = useAltarStore((s) => s.placements);
  const selectedPlacementId = useAltarStore((s) => s.selectedPlacementId);
  const selectPlacement = useAltarStore((s) => s.selectPlacement);
  // Was auf dem Altar zu sehen ist, oben das Vorderste — wie die Liste im Bearbeiten.
  const visiblePlacements = useMemo(
    () => placements.filter((p) => !p.hidden).sort((a, b) => b.z_index - a.z_index),
    [placements],
  );

  const customBackgroundPreview = imageSrc(activeAltar?.background_image_data);

  const backgroundInfo = useMemo(() => {
    if (!activeAltar) return null;
    const preset = activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND;
    if (activeAltar.background_image_data) {
      const safeUrl = customBackgroundPreview?.startsWith('data:image/')
        ? `url("${customBackgroundPreview}")`
        : null;
      return {
        label: t('altar.customBackground'),
        style: safeUrl
          ? { backgroundImage: safeUrl, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND] },
      };
    }
    if (isGradientPreset(preset)) {
      const hex = getGradientColor(preset) ?? LEGACY_GRADIENT_COLORS[DEFAULT_ALTAR_BACKGROUND];
      return { label: t('altar.backgrounds.gradient'), style: { background: generateGradientStyle(hex) } };
    }
    if (ALTAR_IMAGE_PRESETS.includes(preset as (typeof ALTAR_IMAGE_PRESETS)[number])) {
      return {
        label: t(`altar.backgrounds.${preset}`),
        style: { backgroundImage: `url("/backgrounds/thumbs/${preset}.webp")`, backgroundSize: 'cover', backgroundPosition: 'center' },
      };
    }
    if (ALTAR_BACKGROUND_PRESETS.includes(preset as (typeof ALTAR_BACKGROUND_PRESETS)[number])) {
      return { label: t(`altar.backgrounds.${preset}`), style: { background: ALTAR_BACKGROUND_STYLES[preset as (typeof ALTAR_BACKGROUND_PRESETS)[number]] } };
    }
    return { label: t(`altar.backgrounds.${DEFAULT_ALTAR_BACKGROUND}`), style: { background: ALTAR_BACKGROUND_STYLES[DEFAULT_ALTAR_BACKGROUND] } };
  }, [activeAltar, customBackgroundPreview, t]);

  if (!activeAltar) {
    return null;
  }

  const overlayPercent = Math.round((activeAltar.background_overlay ?? 0) * 100);
  const gridActive = activeAltar.grid_enabled;

  // Eigener Abstand: das Panel des Altars liegt als ein Kind im Körper der Leiste.
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
          // Wie die übrigen Werte gesetzt; nur das „x“ der Auflösung wird zum Malzeichen.
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
          icon={<Layers size={14} />}
          label={t('altar.summaryOverlay')}
          value={`${overlayPercent} % · ${t(`altar.overlay.${activeAltar.background_overlay_color ?? 'dark'}`)}`}
        />
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
            icon={<AltarItemVisual item={placement} size={16} candleAnimate={isCandleEmoji(placement.emoji)} />}
            label={placement.name}
            active={selectedPlacementId === placement.id}
            onClick={() => selectPlacement(selectedPlacementId === placement.id ? null : placement.id)}
          />
        ))}
      </SidebarSection>
    </div>
  );
}
