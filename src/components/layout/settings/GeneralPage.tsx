import { useTranslation } from 'react-i18next';
import { ALargeSmall, Type } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import {
  EDITOR_FONT_SIZE_OPTIONS, FONT_OPTIONS, UI_SCALE_OPTIONS, type FontId,
} from '../../../themes/theme';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection, { SettingsDescription } from './SettingsSection';

/** The vault's fonts and sizes. Language and theme belong to the device, on the start page. */
export default function GeneralPage() {
  const { t } = useTranslation();

  const appearance = useSettingsStore((s) => s.settings.appearance);
  const update = useSettingsStore((s) => s.update);

  return (
      <SettingsSection icon={<Type size={14} />} title={t('settings.text')}>
        <div className="space-y-3">
          <div>
            <label className="label-xs flex items-center gap-2 mb-1">
              <Type size={14} />
              {t('settings.uiFont')}
            </label>
            <SettingsDescription>{t('settings.uiFontHint')}</SettingsDescription>
            <select
              value={appearance.uiFont}
              onChange={(e) => update('appearance', { uiFont: e.target.value as FontId })}
              className="input-field settings-field"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.id} value={font.id}>{font.label}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="label-xs flex items-center gap-2 mb-1">
              <ALargeSmall size={14} />
              {t('settings.uiScale')}
            </p>
            <SettingsDescription>{t('settings.uiScaleHint')}</SettingsDescription>
            <SettingsChoiceRow>
              {UI_SCALE_OPTIONS.map((scale) => (
                <SettingsChoiceButton
                  key={scale}
                  active={appearance.uiScale === scale}
                  onClick={() => update('appearance', { uiScale: scale })}
                  className="tabular-nums"
                >
                  {t('common.percentValue', { value: scale })}
                </SettingsChoiceButton>
              ))}
            </SettingsChoiceRow>
          </div>
          <div>
            <label className="label-xs flex items-center gap-2 mb-1">
              <Type size={14} />
              {t('settings.editorFont')}
            </label>
            <SettingsDescription>{t('settings.editorFontHint')}</SettingsDescription>
            <select
              value={appearance.editorFont}
              onChange={(e) => update('appearance', { editorFont: e.target.value as FontId })}
              className="input-field settings-field"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.id} value={font.id}>{font.label}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="label-xs flex items-center gap-2 mb-1">
              <ALargeSmall size={14} />
              {t('settings.editorFontSize')}
            </p>
            <SettingsDescription>{t('settings.editorFontSizeHint')}</SettingsDescription>
            <SettingsChoiceRow>
              {EDITOR_FONT_SIZE_OPTIONS.map((size) => (
                <SettingsChoiceButton
                  key={size}
                  active={appearance.editorFontSize === size}
                  onClick={() => update('appearance', { editorFontSize: size })}
                  className="tabular-nums"
                >
                  {t('common.pixelValue', { value: size })}
                </SettingsChoiceButton>
              ))}
            </SettingsChoiceRow>
          </div>
        </div>
      </SettingsSection>
  );
}
