import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Palette, Upload, X } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { DEFAULT_THEME_ID, customThemeSelection } from '../../../themes/theme';
import {
  MAX_CUSTOM_THEMES, MAX_CUSTOM_THEME_FILE_BYTES, customThemeContrastProblems, parseCustomThemeFile,
} from '../../../themes/customTheme';
import Button from '../../ui/Button';
import SettingsChoiceButton, { SettingsChoiceRow } from './SettingsChoiceButton';
import { SettingsDescription, SettingsStatus } from './SettingsSection';

type Status = { tone: 'error' | 'muted' | 'success'; text: string } | null;

/** The themes imported into this vault, inside the General page's appearance section. */
export default function CustomThemesSection() {
  const { t } = useTranslation();
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const update = useSettingsStore((s) => s.update);
  const [status, setStatus] = useState<Status>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // The same file again has to fire `change` again.
    e.target.value = '';
    if (!file) return;
    if (appearance.customThemes.length >= MAX_CUSTOM_THEMES) {
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
    const { theme } = result;
    update('appearance', {
      customThemes: [...appearance.customThemes, theme],
      theme: customThemeSelection(theme.id),
    });
    const problems = customThemeContrastProblems(theme);
    setStatus(problems.length
      ? { tone: 'muted', text: t('settings.customThemeContrast', { pairs: problems.join(', ') }) }
      : { tone: 'success', text: t('settings.customThemeImported', { name: theme.name }) });
  };

  const remove = (id: string) => {
    const wasActive = appearance.theme === customThemeSelection(id);
    update('appearance', {
      customThemes: appearance.customThemes.filter((theme) => theme.id !== id),
      ...(wasActive ? { theme: DEFAULT_THEME_ID } : {}),
    });
    setStatus(null);
  };

  return (
    <div className="mt-3">
      <SettingsDescription>{t('settings.customThemesHint')}</SettingsDescription>
      <SettingsChoiceRow>
        {appearance.customThemes.map((theme) => (
          <span key={theme.id} className="inline-flex items-center gap-1">
            <SettingsChoiceButton
              active={appearance.theme === customThemeSelection(theme.id)}
              onClick={() => update('appearance', { theme: customThemeSelection(theme.id) })}
              className="flex items-center gap-2"
            >
              <Palette size={14} />
              {theme.name}
            </SettingsChoiceButton>
            <Button
              tone="neutral"
              small
              compact
              onClick={() => remove(theme.id)}
              title={t('settings.customThemeRemove', { name: theme.name })}
              aria-label={t('settings.customThemeRemove', { name: theme.name })}
            >
              <X size={12} />
            </Button>
          </span>
        ))}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void importFile(e)}
        />
        <Button tone="neutral" onClick={() => fileInput.current?.click()}>
          <Upload size={12} />
          {t('settings.customThemeImport')}
        </Button>
      </SettingsChoiceRow>
      {status && (
        <SettingsStatus
          tone={status.tone}
          icon={status.tone === 'muted' ? <AlertTriangle size={14} /> : undefined}
          className="mt-2"
        >
          {status.text}
        </SettingsStatus>
      )}
    </div>
  );
}
