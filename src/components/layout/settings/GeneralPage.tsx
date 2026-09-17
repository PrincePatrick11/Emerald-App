import { useTranslation } from 'react-i18next';
import { Globe, Moon, Sun, Type } from 'lucide-react';
import { LANGUAGE_OPTIONS } from '../../../i18n';
import { useSettingsStore } from '../../../store/settingsStore';
import { FONT_OPTIONS, THEME_OPTIONS, type FontId } from '../../../themes/theme';
import SettingsChoiceButton from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** Sprache und Aussehen — was die App in diesem Vault spricht und wie sie aussieht. */
export default function GeneralPage() {
  const { t } = useTranslation();

  const appearance = useSettingsStore((s) => s.settings.appearance);
  const update = useSettingsStore((s) => s.update);

  const themeIcons = {
    'emerald-noctis': Moon,
    'emerald-parchment': Sun,
  } as const;

  return (
    <>
      <SettingsSection icon={<Globe size={14} />} title={t('settings.language')}>
        <div className="flex gap-2 flex-wrap">
          {LANGUAGE_OPTIONS.map(({ code, label }) => (
            <SettingsChoiceButton
              key={code}
              active={appearance.language === code}
              onClick={() => update('appearance', { language: code })}
              className="px-3 py-1.5 text-sm"
            >
              {label}
            </SettingsChoiceButton>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection icon={<Sun size={14} />} title={t('settings.appearance')}>
        <div className="flex gap-2">
          {THEME_OPTIONS.map(({ id, label }) => {
            const Icon = themeIcons[id];
            return (
            <SettingsChoiceButton
              key={id}
              active={appearance.theme === id}
              onClick={() => update('appearance', { theme: id })}
              className="flex items-center gap-2 px-3 py-1.5 text-sm"
            >
              <Icon size={14} />
              {label}
            </SettingsChoiceButton>
            );
          })}
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <label className="label-xs flex items-center gap-2 mb-2">
              <Type size={14} />
              {t('settings.uiFont')}
            </label>
            <select
              value={appearance.uiFont}
              onChange={(e) => update('appearance', { uiFont: e.target.value as FontId })}
              className="w-full bg-stone-800/70 border border-stone-700/60 rounded-lg px-3 py-2 text-sm text-stone-200 outline-none focus:border-jade-500/60"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.id} value={font.id}>{font.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-xs flex items-center gap-2 mb-2">
              <Type size={14} />
              {t('settings.editorFont')}
            </label>
            <select
              value={appearance.editorFont}
              onChange={(e) => update('appearance', { editorFont: e.target.value as FontId })}
              className="w-full bg-stone-800/70 border border-stone-700/60 rounded-lg px-3 py-2 text-sm text-stone-200 outline-none focus:border-jade-500/60"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.id} value={font.id}>{font.label}</option>
              ))}
            </select>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
