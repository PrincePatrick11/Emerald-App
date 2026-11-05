import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS, type AppLanguage } from '../../../i18n';
import { useDeviceStore } from '../../../store/deviceStore';

/** One flag per language: English as the United Kingdom's. Windows draws
 *  flag emoji as their two letters, which still tells them apart. */
const FLAGS: Record<AppLanguage, string> = { en: '🇬🇧', de: '🇩🇪', es: '🇪🇸', fr: '🇫🇷' };

/** The language of this installation (`deviceStore`), at the foot of the
 *  start page's brand: one flag per language, its name as the tooltip. */
export default function StartLanguage() {
  const { t } = useTranslation();
  const language = useDeviceStore((s) => s.settings.language);
  const setLanguage = useDeviceStore((s) => s.setLanguage);

  return (
    <div className="flex items-center gap-1 -ml-1.5" role="group" aria-label={t('settings.language')}>
      {LANGUAGE_OPTIONS.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          lang={code}
          title={label}
          aria-label={label}
          aria-pressed={language === code}
          className={`start-flag${language === code ? ' start-flag-active' : ''}`}
          onClick={() => setLanguage(code)}
        >
          <span aria-hidden>{FLAGS[code]}</span>
        </button>
      ))}
    </div>
  );
}
