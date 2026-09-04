import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAltarStore } from '../../../store/altarStore';
import {
  ALTAR_BACKGROUND_PRESETS,
  ALTAR_BACKGROUND_STYLES,
  ALTAR_IMAGE_PRESETS,
  DEFAULT_ALTAR_BACKGROUND,
  LEGACY_GRADIENT_COLORS,
  generateGradientStyle,
  getGradientColor,
  isGradientPreset,
} from '../../../lib/altarConstants';
import { imageSrc } from '../../../lib/images';
import { PropertySummaryRow } from './PropertySummaryRow';
import PropertiesReadView from './PropertiesReadView';
import { FaviconGlyph } from './Favicon';

function BackgroundRow({ label, name, style }: { label: string; name: string; style: React.CSSProperties }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-900/45 border border-stone-700/60">
      <span className="text-[11px] uppercase tracking-wider text-stone-500">{label}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <div
          className="h-5 w-8 flex-shrink-0 rounded border border-stone-700/60 overflow-hidden"
          style={style}
          aria-hidden="true"
        />
        <span className="text-[11px] font-medium text-stone-300 text-right truncate">{name}</span>
      </div>
    </div>
  );
}

export default function AltarReadingSummary() {
  const { t } = useTranslation();
  const activeAltar = useAltarStore((s) => s.altars.find((a) => a.id === s.activeAltarId) ?? null);
  const placements = useAltarStore((s) => s.placements);

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
  const placedCount = placements.length;
  const gridActive = activeAltar.grid_enabled;
  const resolution = activeAltar.resolution;

  return (
    <PropertiesReadView
      sectionTitle={t('altar.summary')}
      footnote={t('altar.summaryEditToChange')}
    >
      {activeAltar.icon_data && (
        <PropertySummaryRow
          label={t('properties.icon')}
          value={<FaviconGlyph value={activeAltar.icon_data} />}
        />
      )}
      <PropertySummaryRow
        label={t('altar.summaryRatio')}
        value={resolution}
      />
      {backgroundInfo && (
        <BackgroundRow
          label={t('altar.summaryBackground')}
          name={backgroundInfo.label}
          style={backgroundInfo.style}
        />
      )}
      <PropertySummaryRow
        label={t('altar.summaryOverlay')}
        value={`${overlayPercent}% · ${t(`altar.overlay.${activeAltar.background_overlay_color ?? 'dark'}`)}`}
      />
      <PropertySummaryRow
        label={t('altar.summaryGrid')}
        value={`${gridActive ? `${activeAltar.grid_size}px` : '—'}`}
        badge={gridActive
          ? { label: t('altar.summaryActive'), tone: 'jade' }
          : { label: t('altar.summaryInactive'), tone: 'muted' }}
      />
      <PropertySummaryRow
        label={t('altar.summaryElements')}
        value={`${placedCount} ${t('altar.elementsPlaced')}`}
      />
    </PropertiesReadView>
  );
}
