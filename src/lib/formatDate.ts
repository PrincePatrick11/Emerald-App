import { format, formatDistanceToNow } from 'date-fns';
import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import type { AppLanguage } from '../i18n';

/**
 * Only enUS is in the startup bundle — the other date-fns locales load as
 * separate chunks on a language switch, following the same pattern as the
 * i18n bundles (see changeAppLanguage in i18n/index.ts, which calls preload +
 * setDateLocale). A new app language needs a loader here —
 * the Record over AppLanguage makes forgetting it a compile error.
 *
 * lib/export.ts and lib/emeraldFormat.ts deliberately do NOT format through here:
 * file exports stay locale-independent (English or yyyy-MM-dd).
 */
const LOCALE_LOADERS: Record<Exclude<AppLanguage, 'en'>, () => Promise<Locale>> = {
  de: () => import('date-fns/locale/de').then((m) => m.de),
  es: () => import('date-fns/locale/es').then((m) => m.es),
  fr: () => import('date-fns/locale/fr').then((m) => m.fr),
};

const loaded: Record<string, Locale> = { en: enUS };

let activeLocale: Locale = enUS;

/**
 * Loads the date-fns locale of a language (cached); activates nothing yet.
 * A failed chunk download falls back to enUS instead of taking the
 * UI text's language switch down with it.
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

/** Activates a (preloaded) locale for all format* helpers. */
export function setDateLocale(locale: Locale): void {
  activeLocale = locale;
}

// 'PP'/'PPP' instead of fixed US patterns: the locale also decides the order
// (de: "26.08.2026" / "26. August 2026" instead of "Aug. 26, 2026"). For enUS,
// 'PP' is identical to the former 'MMM d, yyyy'.

/** Medium date ('PP', enUS: "Aug 26, 2026") — the standard meta line in lists and cards. */
export function formatEntryDate(date: string | Date): string {
  return format(new Date(date), 'PP', { locale: activeLocale });
}

/** Long date ('PPP', enUS: "August 26th, 2026") — the basis of `formatIsoDateLong`. */
function formatEntryDateLong(date: string | Date): string {
  return format(new Date(date), 'PPP', { locale: activeLocale });
}

/** Standalone month + year — month header of the timeline grouping. */
export function formatMonthGroup(date: string | Date): string {
  return format(new Date(date), 'LLLL yyyy', { locale: activeLocale });
}

/** 'EEEE, MMMM d' — the day heading of the Home view. */
export function formatDayHeading(date: string | Date): string {
  return format(new Date(date), 'EEEE, MMMM d', { locale: activeLocale });
}

/**
 * Localized distance WITHOUT a suffix ("3 days"), for keys like trash.deletedAgo
 * ("Deleted {{time}} ago") that bring the "ago" themselves.
 */
export function formatTimeDistance(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { locale: activeLocale });
}

/**
 * An ISO date (`YYYY-MM-DD`) in the long form of the app language. Built as a local
 * date — the ISO string directly would mean UTC midnight and thus, west of
 * Greenwich, the previous day. An impossible date (31 February) is left
 * raw instead of silently rolling over into March.
 */
export function formatIsoDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (!y || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return iso;
  return formatEntryDateLong(date);
}

/** Weekday like `Date.getDay()`: 0 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The name of a weekday (`Date.getDay()`: 0 = Sunday) in the app language —
 * `short` for selection buttons ("Mo"), `long` for their tooltip ("Monday").
 */
export function formatWeekday(day: Weekday, width: 'short' | 'long'): string {
  // 1 January 2023 was a Sunday.
  const name = format(new Date(2023, 0, 1 + day), width === 'short' ? 'EEEEEE' : 'EEEE', { locale: activeLocale });
  // date-fns writes weekdays in lower case in Spanish and French ("lu"); as
  // the label of a button they stand on their own and start with a capital.
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/** The seven weekdays, starting with the first one of the app language (enUS: Sunday, otherwise Monday). */
export function weekdaysInLocaleOrder(): Weekday[] {
  const first = activeLocale.options?.weekStartsOn ?? 0;
  return Array.from({ length: 7 }, (_, i) => ((first + i) % 7) as Weekday);
}
