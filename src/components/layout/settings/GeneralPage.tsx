import { useTranslation } from 'react-i18next';
import { ALargeSmall, Globe, Moon, Sun, Type } from 'lucide-react';
import { LANGUAGE_OPTIONS } from '../../../i18n';
import { useSettingsStore } from '../../../store/settingsStore';
import {
  EDITOR_FONT_SIZE_OPTIONS, FONT_OPTIONS, THEME_OPTIONS, UI_SCALE_OPTIONS, type FontId,
} from '../../../themes/theme';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import SettingsSection, { SettingsDescription } from './SettingsSection';

/** Sprache und Aussehen — was die App in diesem Vault spricht und wie sie aussieht. */
export default function GeneralPage() {
  const { t } = useTranslation();

  const appearance = useSettingsStore((s) => s.settings.appearance);
  const update = useSettingsStore((s) => s.update);

  const themeHintKeys = {
    'emerald-noctis': 'settings.themeDarkHint',
    'emerald-parchment': 'settings.themeLightHint',
  } as const;

  const themeIcons = {
    'emerald-noctis': Moon,
    'emerald-parchment': Sun,
  } as const;

  return (
    <>
      <SettingsSection icon={<Globe size={14} />} title={t('settings.language')} description={t('settings.languageHint')}>
        <SettingsChoiceRow>
          {LANGUAGE_OPTIONS.map(({ code, label }) => (
            <SettingsChoiceButton
              key={code}
              active={appearance.language === code}
              onClick={() => update('appearance', { language: code })}
            >
              {label}
            </SettingsChoiceButton>
          ))}
        </SettingsChoiceRow>
      </SettingsSection>

      <SettingsSection icon={<Sun size={14} />} title={t('settings.appearance')} description={t('settings.appearanceHint')}>
        <div className="flex gap-2">
          {THEME_OPTIONS.map(({ id, label }) => {
            const Icon = themeIcons[id];
            return (
            <SettingsChoiceButton
              key={id}
              active={appearance.theme === id}
              onClick={() => update('appearance', { theme: id })}
              title={t(themeHintKeys[id])}
              className="flex items-center gap-2"
            >
              <Icon size={14} />
              {label}
            </SettingsChoiceButton>
            );
          })}
        </div>
        <div className="mt-4 space-y-3">
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
    </>
  );
}
