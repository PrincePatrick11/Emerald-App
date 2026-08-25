import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

// Nur Englisch — Start- und Fallback-Sprache — liegt im Start-Bundle. Die
// anderen drei Locales laden als eigene Chunks erst beim Umschalten nach,
// nach demselben Muster wie die Emoji-Daten in `EmojiPicker`.
const loaders: Record<string, () => Promise<{ default: typeof en }>> = {
  de: () => import('./locales/de.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
};

/**
 * Die eine Quelle fuer "welche Sprachen gibt es": Settings rendert seine
 * Buttons daraus, savedAppLanguage validiert dagegen, changeAppLanguage
 * lehnt Unbekanntes ab. Eine neue Sprache heisst: Eintrag hier, Loader oben,
 * Locale-Datei — sonst nichts.
 */
export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
] as const;

export type AppLanguage = (typeof LANGUAGE_OPTIONS)[number]['code'];

const SUPPORTED = new Set<string>(LANGUAGE_OPTIONS.map((o) => o.code));

// Gleicher Mechanismus wie 'theme-id' und die Font-Keys: localStorage, damit
// die Wahl Sessions und Vault-Wechsel uebersteht. Vorher startete die App bei
// jedem Launch auf Englisch.
const LANGUAGE_STORAGE_KEY = 'app-language';

/** Die zuletzt gewaehlte Sprache, gegen LANGUAGE_OPTIONS validiert. */
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

/**
 * Wechselt die App-Sprache und laedt das Locale-Bundle vorher nach, falls es
 * noch fehlt. Immer diese Funktion statt `i18n.changeLanguage` direkt
 * verwenden — sonst schaltet die UI auf den englischen Fallback um.
 *
 * Der Sequenzzaehler laesst bei schnellen Doppel-Klicks den ZULETZT gewaehlten
 * Wunsch gewinnen: ohne ihn koennte ein langsamer erster Download nach dem
 * schnelleren zweiten fertig werden und die Sprache zurueckdrehen.
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
  if (seq !== switchSeq) return;
  await i18n.changeLanguage(lng);
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  // Fuer Rechtschreibpruefung und Screenreader — index.html startet mit "en".
  document.documentElement.lang = lng;
}

export default i18n;
