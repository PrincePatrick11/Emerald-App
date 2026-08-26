import { format, formatDistanceToNow } from 'date-fns';
import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import type { AppLanguage } from '../i18n';

/**
 * Nur enUS liegt im Start-Bundle — die anderen date-fns-Locales laden als
 * eigene Chunks beim Sprachwechsel nach, nach demselben Muster wie die
 * i18n-Bundles (siehe changeAppLanguage in i18n/index.ts, das preload +
 * setDateLocale aufruft). Eine neue App-Sprache braucht einen Loader hier —
 * der Record über AppLanguage macht das Vergessen zum Compile-Fehler.
 *
 * lib/export.ts und lib/emeraldFormat.ts formatieren bewusst NICHT hierüber:
 * Dateiexporte bleiben locale-unabhängig (englisch bzw. yyyy-MM-dd).
 */
const LOCALE_LOADERS: Record<Exclude<AppLanguage, 'en'>, () => Promise<Locale>> = {
  de: () => import('date-fns/locale/de').then((m) => m.de),
  es: () => import('date-fns/locale/es').then((m) => m.es),
  fr: () => import('date-fns/locale/fr').then((m) => m.fr),
};

const loaded: Record<string, Locale> = { en: enUS };

let activeLocale: Locale = enUS;

/**
 * Lädt die date-fns-Locale einer Sprache nach (gecacht); aktiviert noch nichts.
 * Ein fehlgeschlagener Chunk-Download fällt auf enUS zurück, statt den
 * Sprachwechsel des UI-Textes mitzureißen.
 */
export async function preloadDateLocale(lng: string): Promise<Locale> {
  const key = lng.slice(0, 2).toLowerCase();
  if (!loaded[key]) {
    const load = (LOCALE_LOADERS as Partial<Record<string, () => Promise<Locale>>>)[key];
    if (!load) return enUS;
    try {
      loaded[key] = await load();
    } catch (err) {
      console.error('[formatDate] date-fns locale load failed:', err);
      return enUS;
    }
  }
  return loaded[key];
}

/** Aktiviert eine (vorab geladene) Locale für alle format*-Helper. */
export function setDateLocale(locale: Locale): void {
  activeLocale = locale;
}

// 'PP'/'PPP' statt fester US-Muster: die Locale bestimmt auch die Reihenfolge
// (de: „26.08.2026" / „26. August 2026" statt „Aug. 26, 2026"). Für enUS ist
// 'PP' identisch mit dem früheren 'MMM d, yyyy'.

/** Mittleres Datum ('PP', enUS: "Aug 26, 2026") — die Standard-Metazeile in Listen und Karten. */
export function formatEntryDate(date: string | Date): string {
  return format(new Date(date), 'PP', { locale: activeLocale });
}

/** Langes Datum ('PPP', enUS: "August 26th, 2026") — Journal-Detailkopf. */
export function formatEntryDateLong(date: string | Date): string {
  return format(new Date(date), 'PPP', { locale: activeLocale });
}

/** Standalone-Monat + Jahr — Monats-Header der Timeline-Gruppierung. */
export function formatMonthGroup(date: string | Date): string {
  return format(new Date(date), 'LLLL yyyy', { locale: activeLocale });
}

/** 'EEEE, MMMM d' — die Tagesüberschrift der Home-Ansicht. */
export function formatDayHeading(date: string | Date): string {
  return format(new Date(date), 'EEEE, MMMM d', { locale: activeLocale });
}

/**
 * Lokalisierte Distanz OHNE Suffix („3 Tagen"), für Keys wie trash.deletedAgo
 * („Gelöscht vor {{time}}"), die das „vor/ago" selbst mitbringen.
 */
export function formatTimeDistance(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { locale: activeLocale });
}
