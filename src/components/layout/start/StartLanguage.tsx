import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import Dropdown from '../../ui/Dropdown';
import { LANGUAGE_OPTIONS, type AppLanguage } from '../../../i18n';
import { useDeviceStore } from '../../../store/deviceStore';

/** One flag per language: English as the United Kingdom's. Windows draws
 *  flag emoji as their two letters, which still tells them apart. */
const FLAGS: Record<AppLanguage, string> = { en: '🇬🇧', de: '🇩🇪', es: '🇪🇸', fr: '🇫🇷' };

const OPTIONS = LANGUAGE_OPTIONS.map(({ code, label }) => ({ value: code, label, emoji: FLAGS[code] }));

/** The language of this installation (`deviceStore`), at the left of the start
 *  page's foot: the flag and name of the chosen one, the others in a menu. */
export default function StartLanguage() {
  const { t } = useTranslation();
  const language = useDeviceStore((s) => s.settings.language);
  const setLanguage = useDeviceStore((s) => s.setLanguage);

  return (
    <Dropdown<AppLanguage>
      value={language}
      options={OPTIONS}
      onChange={setLanguage}
      portal
      trigger={({ open, toggle, selectedLabel }) => (
        <button
          type="button"
          className="start-foot-action"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${t('settings.language')}: ${selectedLabel}`}
          onClick={toggle}
        >
          <span aria-hidden className="text-sm leading-none">{FLAGS[language]}</span>
          {selectedLabel}
          <ChevronDown size={12} />
        </button>
      )}
    />
  );
}
