import { useTranslation } from 'react-i18next';
import { Globe, Moon, Sun, Type } from 'lucide-react';
import { LANGUAGE_OPTIONS, changeAppLanguage } from '../../../i18n';
import { useUIStore } from '../../../store/uiStore';
import { FONT_OPTIONS, THEME_OPTIONS } from '../../../themes/theme';
import SettingsChoiceButton from './SettingsChoiceButton';
import SettingsSection from './SettingsSection';

/** Sprache und Aussehen — was die App spricht und wie sie aussieht. */
export default function GeneralPage() {
  const { t, i18n } = useTranslation();

  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const uiFontId = useUIStore((s) => s.uiFontId);
  const editorFontId = useUIStore((s) => s.editorFontId);
  const setUIFontId = useUIStore((s) => s.setUIFontId);
  const setEditorFontId = useUIStore((s) => s.setEditorFontId);

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
              active={i18n.language === code}
              onClick={() => changeAppLanguage(code)}
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
              active={theme === id}
              onClick={() => setTheme(id)}
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
              value={uiFontId}
              onChange={(e) => setUIFontId(e.target.value as typeof uiFontId)}
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
              value={editorFontId}
              onChange={(e) => setEditorFontId(e.target.value as typeof editorFontId)}
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
