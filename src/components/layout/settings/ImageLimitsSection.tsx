import { useTranslation } from 'react-i18next';
import { Image, Maximize2, Sparkles, Weight } from 'lucide-react';
import { IMAGE_MAX_EDGE_OPTIONS, IMAGE_MAX_SIZE_MB_OPTIONS } from '../../../lib/vaultSettings';
import { useSettingsStore } from '../../../store/settingsStore';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';
import { SwitchRow } from '../../ui/Switch';

/** How inserted images are stored: photos as JPEG, then scaled down and checked. */
export default function ImageLimitsSection() {
  const { t } = useTranslation();
  const images = useSettingsStore((s) => s.settings.images);
  const update = useSettingsStore((s) => s.update);

  return (
    <SettingsSection icon={<Image size={14} />} title={t('settings.images')} description={t('settings.imagesHint')}>
      <div className="space-y-3">
        <SwitchRow
          variant="panel"
          icon={Sparkles}
          label={t('settings.imageOptimizePhotos')}
          hint={t('settings.imageOptimizePhotosHint')}
          checked={images.optimizePhotos}
          onChange={(value) => update('images', { optimizePhotos: value })}
        />
        <div>
          <p className="label-xs flex items-center gap-2 mb-2">
            <Maximize2 size={14} />
            {t('settings.imageMaxEdge')}
          </p>
          <SettingsChoiceRow>
            {IMAGE_MAX_EDGE_OPTIONS.map((edge) => (
              <SettingsChoiceButton
                key={edge ?? 'original'}
                active={images.maxEdge === edge}
                onClick={() => update('images', { maxEdge: edge })}
                title={edge === null ? t('settings.imageMaxEdgeOriginalHint') : t('settings.imageMaxEdgeOption', { value: edge })}
                className="tabular-nums"
              >
                {edge === null ? t('settings.imageMaxEdgeOriginal') : t('common.pixelValue', { value: edge })}
              </SettingsChoiceButton>
            ))}
          </SettingsChoiceRow>
        </div>
        <div>
          <p className="label-xs flex items-center gap-2 mb-2">
            <Weight size={14} />
            {t('settings.imageMaxSize')}
          </p>
          <SettingsChoiceRow>
            {IMAGE_MAX_SIZE_MB_OPTIONS.map((mb) => (
              <SettingsChoiceButton
                key={mb ?? 'unlimited'}
                active={images.maxSizeMb === mb}
                onClick={() => update('images', { maxSizeMb: mb })}
                title={mb === null
                  ? t('settings.imageMaxSizeUnlimitedHint')
                  : t('settings.imageMaxSizeOption', { max: `${mb} ${t('common.megabytes')}` })}
                className="tabular-nums"
              >
                {mb === null ? t('settings.imageMaxSizeUnlimited') : `${mb} ${t('common.megabytes')}`}
              </SettingsChoiceButton>
            ))}
          </SettingsChoiceRow>
        </div>
      </div>
    </SettingsSection>
  );
}
