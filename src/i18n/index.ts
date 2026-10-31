import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import { preloadDateLocale, setDateLocale } from '../lib/formatDate';

// Only English — the start and fallback language — is in the start bundle. The
// other three locales load as their own chunks only when switching,
// following the same pattern as the emoji data in `EmojiPicker`.
const loaders: Record<string, () => Promise<{ default: typeof en }>> = {
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
};

/**
 * The single source for "which languages exist": Settings renders its
 * buttons from it, savedAppLanguage validates against it, changeAppLanguage
 * rejects anything unknown. A new language means: entry here, loader above,
 * locale file — nothing else.
 */
export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
] as const;

export type AppLanguage = (typeof LANGUAGE_OPTIONS)[number]['code'];

const SUPPORTED = new Set<string>(LANGUAGE_OPTIONS.map((o) => o.code));

// The language belongs to the vault's settings (settingsStore). Under this
// key sits only its mirror — the language of the last opened vault, which
// `main.tsx` starts with before a vault is loaded.
export const LANGUAGE_STORAGE_KEY = 'app-language';

/** The language of the last opened vault, validated against LANGUAGE_OPTIONS. */
export function savedAppLanguage(): string {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored && SUPPORTED.has(stored) ? stored : 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

// `{{label, lowercase}}`: a noun in the middle of a sentence ("Group by
// category"). German capitalises it and omits the formatter.
i18n.services.formatter?.add('lowercase', (value, lng) =>
  typeof value === 'string' ? value.toLocaleLowerCase(lng) : value);

/**
 * Switches the app language and loads the locale bundle beforehand if it is
 * still missing. Always use this function instead of calling
 * `i18n.changeLanguage` directly — otherwise the UI switches to the English
 * fallback.
 *
 * With quick double clicks, the sequence counter lets the LAST chosen request
 * win: without it, a slow first download could finish after the faster
 * second one and flip the language back.
 */
let switchSeq = 0;

export async function changeAppLanguage(lng: string): Promise<void> {
  if (!SUPPORTED.has(lng)) return;
  const seq = ++switchSeq;
  if (!i18n.hasResourceBundle(lng, 'translation')) {
    const load = loaders[lng];
    if (load) {
      const bundle = (await load()).default;
      i18n.addResourceBundle(lng, 'translation', bundle, true, true);
    }
  }
  // The date-fns locale follows in the same step — before changeLanguage, so
  // the re-render it triggers already formats with the right locale.
  const dateLocale = await preloadDateLocale(lng);
  if (seq !== switchSeq) return;
  setDateLocale(dateLocale);
  await i18n.changeLanguage(lng);
  // Second check: if a later switch overtook this one while changeLanguage
  // was running, localStorage and <html lang> must not be written for the loser.
  // Only this spot writes the language mirror (the others are set by
  // `applyAppearance` in the settingsStore) — only once the bundle really applies.
  if (seq !== switchSeq) return;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  // For spell checking and screen readers — index.html starts with "en".
  document.documentElement.lang = lng;
}

export default i18n;
