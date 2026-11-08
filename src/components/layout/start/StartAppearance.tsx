import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Palette, Plus, X } from 'lucide-react';
import StartSection from './StartSection';
import { useDeviceStore } from '../../../store/deviceStore';
import noctisCss from '../../../themes/emerald-noctis.css?raw';
import parchmentCss from '../../../themes/emerald-parchment.css?raw';
import { THEME_OPTIONS, customThemeSelection, type ThemeId, type ThemeSelection } from '../../../themes/theme';
import {
  MAX_CUSTOM_THEMES, MAX_CUSTOM_THEME_FILE_BYTES, customThemeContrastProblems, parseCustomThemeFile,
} from '../../../themes/customTheme';

/** What a theme card draws: its frame, its sheet, a line of its accent and
 *  two of its edge colour. Custom themes give theirs in their file. */
interface Preview { frame: string; sheet: string; accent: string; line: string }

/** A built-in theme's card, read from its own stylesheet: a card shows
 *  another theme than the one around it, so its tokens cannot be asked for. */
function previewOf(css: string): Preview {
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim() ?? 'transparent';
  return { frame: token('shell-bg'), sheet: token('sheet-bg'), accent: token('accent'), line: token('border-strong') };
}

const BUILT_IN_PREVIEWS: Record<ThemeId, Preview> = {
  'emerald-noctis': previewOf(noctisCss),
  'emerald-parchment': previewOf(parchmentCss),
};

/** A theme in small: the frame with the sheet on it, a heading in the accent
 *  and two lines of text. */
function ThemePreview({ frame, sheet, accent, line }: Preview) {
  return (
    <span className="start-theme-preview" style={{ background: frame }} aria-hidden>
      <span className="start-theme-sheet" style={{ background: sheet }}>
        <span style={{ background: accent, width: '50%', height: 4 }} />
        <span style={{ background: line, width: '80%', height: 3 }} />
        <span style={{ background: line, width: '62%', height: 3 }} />
      </span>
    </span>
  );
}

type Status = { tone: 'error' | 'muted'; text: string } | null;

/**
 * The start page's Appearance: the theme of this installation (`deviceStore`)
 * as cards that show it in small, custom themes included: import one from a
 * JSON file (the last card), pick it, remove it.
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

  const card = (selection: ThemeSelection, label: string, preview: Preview, onRemove?: () => void) => (
    <li key={selection} className="relative group">
      <button
        type="button"
        className={`start-theme${settings.theme === selection ? ' start-theme-active' : ''}`}
        aria-pressed={settings.theme === selection}
        onClick={() => setTheme(selection)}
      >
        <ThemePreview {...preview} />
        <span className="block truncate px-0.5">{label}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          className="start-theme-remove"
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
      <ul className="start-themes">
        {THEME_OPTIONS.map(({ id, label }) => card(id, label.replace(/^Emerald /, ''), BUILT_IN_PREVIEWS[id]))}
        {settings.customThemes.map((theme) =>
          card(
            customThemeSelection(theme.id),
            theme.name,
            { frame: theme.colors.frame, sheet: theme.colors.sheet, accent: theme.colors.accent, line: theme.colors.border },
            () => {
              removeCustomTheme(theme.id);
              setStatus(null);
            },
          ),
        )}
        <li>
          <button type="button" className="start-theme-new" onClick={() => fileInput.current?.click()}>
            <Plus size={14} />
            {t('settings.customThemeImport')}
          </button>
        </li>
      </ul>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => void importFile(e)}
      />
      {status && (
        <p className={`text-xs mt-2 ${status.tone === 'error' ? 'text-danger' : 'text-muted'}`}>{status.text}</p>
      )}
    </StartSection>
  );
}
