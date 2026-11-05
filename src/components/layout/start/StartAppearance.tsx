import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Palette, Sun, Upload, X } from 'lucide-react';
import Button from '../../ui/Button';
import StartSection from './StartSection';
import { useDeviceStore } from '../../../store/deviceStore';
import { THEME_OPTIONS, customThemeSelection, type ThemeSelection } from '../../../themes/theme';
import {
  MAX_CUSTOM_THEMES, MAX_CUSTOM_THEME_FILE_BYTES, customThemeContrastProblems, parseCustomThemeFile,
} from '../../../themes/customTheme';

const THEME_ICONS = { 'emerald-noctis': Moon, 'emerald-parchment': Sun } as const;

type Status = { tone: 'error' | 'muted'; text: string } | null;

/**
 * The start page's Appearance: the theme of this installation (`deviceStore`),
 * custom themes included: import one from a JSON file, pick it, remove it.
 * The language sits at the foot of the brand (`StartLanguage`).
 */
export default function StartAppearance() {
  const { t } = useTranslation();
  const settings = useDeviceStore((s) => s.settings);
  const setTheme = useDeviceStore((s) => s.setTheme);
  const addCustomTheme = useDeviceStore((s) => s.addCustomTheme);
  const removeCustomTheme = useDeviceStore((s) => s.removeCustomTheme);
  const [status, setStatus] = useState<Status>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // The same file again has to fire `change` again.
    e.target.value = '';
    if (!file) return;
    if (settings.customThemes.length >= MAX_CUSTOM_THEMES) {
      setStatus({ tone: 'error', text: t('settings.customThemeTooMany', { count: MAX_CUSTOM_THEMES }) });
      return;
    }
    if (file.size > MAX_CUSTOM_THEME_FILE_BYTES) {
      setStatus({ tone: 'error', text: t('settings.customThemeInvalid') });
      return;
    }
    const result = parseCustomThemeFile(await file.text(), crypto.randomUUID());
    if ('error' in result) {
      setStatus({
        tone: 'error',
        text: t(result.error === 'unreadableText' ? 'settings.customThemeUnreadable' : 'settings.customThemeInvalid'),
      });
      return;
    }
    addCustomTheme(result.theme);
    const problems = customThemeContrastProblems(result.theme);
    setStatus(problems.length ? { tone: 'muted', text: t('settings.customThemeContrast', { pairs: problems.join(', ') }) } : null);
  };

  const option = (selection: ThemeSelection, label: string, icon: ReactNode, onRemove?: () => void) => (
    <li key={selection} className="start-option-row group">
      <button
        type="button"
        className={`start-option${onRemove ? ' start-option-removable' : ''}${settings.theme === selection ? ' start-option-active' : ''}`}
        aria-pressed={settings.theme === selection}
        onClick={() => setTheme(selection)}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          className="start-option-remove"
          title={t('settings.customThemeRemove', { name: label })}
          aria-label={t('settings.customThemeRemove', { name: label })}
          onClick={onRemove}
        >
          <X size={12} />
        </button>
      )}
    </li>
  );

  return (
    <StartSection id="start-appearance-heading" icon={<Palette size={12} />} label={t('start.appearance')}>
      <div>
        <ul className="space-y-2">
          {THEME_OPTIONS.map(({ id, label }) => {
            const Icon = THEME_ICONS[id];
            return option(id, label, <Icon size={14} className="shrink-0" />);
          })}
          {settings.customThemes.map((theme) =>
            option(customThemeSelection(theme.id), theme.name, <Palette size={14} className="shrink-0" />, () => {
              removeCustomTheme(theme.id);
              setStatus(null);
            }),
          )}
        </ul>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void importFile(e)}
        />
        <Button tone="neutral" className="mt-2" onClick={() => fileInput.current?.click()}>
          <Upload size={12} />
          {t('settings.customThemeImport')}
        </Button>
        {status && (
          <p className={`text-xs mt-2 ${status.tone === 'error' ? 'text-danger' : 'text-muted'}`}>{status.text}</p>
        )}
      </div>
    </StartSection>
  );
}
