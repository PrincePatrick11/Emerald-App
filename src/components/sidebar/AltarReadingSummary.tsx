import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, Sliders } from 'lucide-react';
import { useAltarStore } from '../../store/altarStore';
import { useUIStore } from '../../store/uiStore';
import {
  ALTAR_BACKGROUND_PRESETS,
  ALTAR_BACKGROUND_STYLES,
  ALTAR_IMAGE_PRESETS,
  DEFAULT_ALTAR_BACKGROUND,
  LEGACY_GRADIENT_COLORS,
  generateGradientStyle,
  getGradientColor,
  isGradientPreset,
} from '../../lib/altarConstants';
import { useBackgroundPreview } from '../altar/useAltarBackgroundPreview';

interface SummaryRowProps {
  label: string;
  value: React.ReactNode;
  badge?: { label: string; tone: 'jade' | 'muted' };
}

function SummaryRow({ label, value, badge }: SummaryRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-stone-900/40 border border-stone-800/60">
      <span className="text-[11px] uppercase tracking-wider text-stone-500">{label}</span>
      <div className="flex items-center gap-1.5">
        {badge && (
          <span
            className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${
              badge.tone === 'jade'
                ? 'border-jade-600/50 bg-jade-900/40 text-jade-300'
                : 'border-stone-700/60 bg-stone-800/60 text-stone-400'
            }`}
          >
            {badge.label}
          </span>
        )}
        <span className="text-[12px] font-medium text-stone-200 text-right">{value}</span>
      </div>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pt-3 pb-1.5">
      <span className="text-stone-500">{icon}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{label}</span>
    </div>
  );
}

function BackgroundRow({ label, name, style }: { label: string; name: string; style: React.CSSProperties }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-stone-900/40 border border-stone-800/60">
      <span className="text-[11px] uppercase tracking-wider text-stone-500">{label}</span>
      <div className="ml-auto flex items-center gap-1.5">
        <div
          className="h-5 w-8 flex-shrink-0 rounded border border-stone-700/60 overflow-hidden"
          style={style}
          aria-hidden="true"
        />
        <span className="text-[12px] font-medium text-stone-200 text-right truncate">{name}</span>
      </div>
    </div>
  );
}

export default function AltarReadingSummary() {
  const { t } = useTranslation();
  const activeAltar = useAltarStore((s) => s.altars.find((a) => a.id === s.activeAltarId) ?? null);
  const placements = useAltarStore((s) => s.placements);
  const altarWindowFullscreen = useUIStore((s) => s.altarWindowFullscreen);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);

  const customBackgroundPreview = useBackgroundPreview(activeAltar?.background_image_data ?? null);

  const backgroundInfo = useMemo(() => {
    if (!activeAltar) return null;
    const preset = activeAltar.background_preset || DEFAULT_ALTAR_BACKGROUND;
    if (activeAltar.background_image_data) {
      const safeUrl = customBackgroundPreview?.startsWith('data:image/') || customBackgroundPreview?.startsWith('tauri://')
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
    <div className="flex flex-col gap-1 px-3 pb-5">
      <button
        onClick={() => setAltarWindowFullscreen(!altarWindowFullscreen)}
        className={`mt-3 flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors ${
          altarWindowFullscreen
            ? 'border-jade-600/60 bg-jade-900/40 text-jade-200 hover:bg-jade-900/60'
            : 'border-jade-700/60 bg-jade-900/30 text-jade-300 hover:bg-jade-900/50 hover:border-jade-500/70'
        }`}
        title={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
      >
        {altarWindowFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        {t('altar.enterFullscreen')}
      </button>

      <SectionTitle icon={<Sliders size={11} />} label={t('altar.summary')} />

      <div className="flex flex-col gap-1.5">
        <SummaryRow
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
        <SummaryRow
          label={t('altar.summaryOverlay')}
          value={`${overlayPercent}% · ${t(`altar.overlay.${activeAltar.background_overlay_color ?? 'dark'}`)}`}
        />
        <SummaryRow
          label={t('altar.summaryGrid')}
          value={`${gridActive ? `${activeAltar.grid_size}px` : '—'}`}
          badge={gridActive
            ? { label: t('altar.summaryActive'), tone: 'jade' }
            : { label: t('altar.summaryInactive'), tone: 'muted' }}
        />
        <SummaryRow
          label={t('altar.summaryElements')}
          value={`${placedCount} ${t('altar.itemsPlaced')}`}
        />
      </div>

      <p className="mt-4 px-1 text-[10.5px] leading-relaxed text-stone-600">
        {t('altar.summaryEditToChange')}
      </p>
    </div>
  );
}
