import { useTranslation } from 'react-i18next';
import { Image, Maximize2, Weight } from 'lucide-react';
import { IMAGE_MAX_EDGE_OPTIONS, IMAGE_MAX_SIZE_MB_OPTIONS } from '../../../lib/vaultSettings';
import { useSettingsStore } from '../../../store/settingsStore';
import SettingsChoiceButton from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** Wie groß eingefügte Bilder werden dürfen: erst verkleinert, dann geprüft. */
export default function ImageLimitsSection() {
  const { t } = useTranslation();
  const images = useSettingsStore((s) => s.settings.images);
  const update = useSettingsStore((s) => s.update);

  return (
    <SettingsSection icon={<Image size={14} />} title={t('settings.images')} description={t('settings.imagesHint')}>
      <div className="space-y-3">
        <div>
          <p className="label-xs flex items-center gap-2 mb-2">
            <Maximize2 size={14} />
            {t('settings.imageMaxEdge')}
          </p>
          <div className="flex gap-2 flex-wrap">
            {IMAGE_MAX_EDGE_OPTIONS.map((edge) => (
              <SettingsChoiceButton
                key={edge ?? 'original'}
                active={images.maxEdge === edge}
                onClick={() => update('images', { maxEdge: edge })}
                title={edge === null ? t('settings.imageMaxEdgeOriginalHint') : t('settings.imageMaxEdgeOption', { value: edge })}
                className="px-3 py-1.5 text-sm tabular-nums"
              >
                {edge === null ? t('settings.imageMaxEdgeOriginal') : t('common.pixelValue', { value: edge })}
              </SettingsChoiceButton>
            ))}
          </div>
        </div>
        <div>
          <p className="label-xs flex items-center gap-2 mb-2">
            <Weight size={14} />
            {t('settings.imageMaxSize')}
          </p>
          <div className="flex gap-2 flex-wrap">
            {IMAGE_MAX_SIZE_MB_OPTIONS.map((mb) => (
              <SettingsChoiceButton
                key={mb ?? 'unlimited'}
                active={images.maxSizeMb === mb}
                onClick={() => update('images', { maxSizeMb: mb })}
                title={mb === null
                  ? t('settings.imageMaxSizeUnlimitedHint')
                  : t('settings.imageMaxSizeOption', { max: `${mb} ${t('common.megabytes')}` })}
                className="px-3 py-1.5 text-sm tabular-nums"
              >
                {mb === null ? t('settings.imageMaxSizeUnlimited') : `${mb} ${t('common.megabytes')}`}
              </SettingsChoiceButton>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
