import { format } from 'date-fns';
import { storedImageName } from './schema';

/**
 * Whether an icon is an uploaded picture — the stored name of a file in the
 * vault's `icons/` (`lib/icons.ts`) — rather than an emoji. Shown through
 * `iconSrc`.
 */
export function isImageIcon(icon: string | null | undefined): boolean {
  return !!icon && storedImageName(icon) === icon;
}

/**
 * Icon and name as one line — for lists that show both side by side
 * (trash). An image icon is a file name and would appear as text in front of the
 * name; in that case the row already carries its symbol in its own column.
 */
export function iconTitle(icon: string, name: string): string {
  return isImageIcon(icon) ? name : `${icon} ${name}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

/** What `generateId` makes. */
export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** The prefix a merge import used to put in front of the UUIDs of its copies; vaults merged before still carry it. */
export const LEGACY_MERGE_PREFIX = '[0-9a-z]{8}-';
/** An entry's or task's ID as a whole value: a UUID, perhaps with the legacy merge prefix. */
export const ITEM_ID_RE = new RegExp(`^(?:${LEGACY_MERGE_PREFIX})?${UUID_PATTERN}$`, 'i');

export function nowIso(): string {
  return new Date().toISOString();
}

/** A day as `YYYY-MM-DD` in local time — `toISOString()` would be UTC and the wrong day at night. */
export function localIsoDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isValidHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

const ACCEPTED_IMAGE_MIME_LIST = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;

export const ACCEPTED_IMAGE_MIME = ACCEPTED_IMAGE_MIME_LIST.join(',');

export function isAcceptedImageFile(file: File): boolean {
  return (ACCEPTED_IMAGE_MIME_LIST as readonly string[]).includes(file.type);
}

/** A file, or any Blob (an encoded canvas, a worker's result), as a data URL. */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * File size for display — one decimal place from MB upwards.
 *
 * The units come from outside instead of being hard-coded: French
 * counts in octets and writes `o` / `Ko` / `Mo`, not `B` / `KB` / `MB`.
 */
export function formatBytes(bytes: number, units: [string, string, string]): string {
  if (bytes < 1024) return `${bytes} ${units[0]}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${units[1]}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${units[2]}`;
}

/** A non-null object that is not an array — the shape of parsed JSON worth reading keys from. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` if it is a record (`isRecord`), otherwise an empty one. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** `value` if it is a string, otherwise `null`. */
export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `<title>_<yyyy-MM-dd>.<ext>`, the title reduced to what a file name takes — every export's default name. */
export function exportFilename(title: string, date: string, ext: string): string {
  return `${safeFileBase(title)}_${format(new Date(date), 'yyyy-MM-dd')}.${ext}`;
}

/** A text as the stem of a file name: only letters (of any language), digits, `_` and hyphens, spaces as `_`. */
export function safeFileBase(text: string): string {
  return text.replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '_') || 'export';
}

/** `raw` if it is exactly one of the `options`, otherwise `fallback` — for values
 *  from files and localStorage that have to pick from a fixed set. */
export function oneOf<T>(raw: unknown, options: readonly T[], fallback: T): T {
  return options.includes(raw as T) ? (raw as T) : fallback;
}

/** Items as a sentence part in the language's own way: "A, B and C", in the app language. */
export function listOf(items: readonly string[], language: string): string {
  return new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(items);
}
