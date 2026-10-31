export function isImageIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  return icon.startsWith('data:image/') || icon.startsWith('blob:') || icon.startsWith('/');
}

/**
 * Icon and name as one line — for lists that show both side by side
 * (trash). An image icon is a data URL and would appear as Base64 in front of the
 * name; in that case the row already carries its symbol in its own column.
 */
export function iconTitle(icon: string, name: string): string {
  return isImageIcon(icon) ? name : `${icon} ${name}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

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

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!isValidHexColor(hex)) return { r: 0, g: 0, b: 0 };
  const normalized = hex.replace('#', '');
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
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

/** `raw` if it is exactly one of the `options`, otherwise `fallback` — for values
 *  from files and localStorage that have to pick from a fixed set. */
export function oneOf<T>(raw: unknown, options: readonly T[], fallback: T): T {
  return options.includes(raw as T) ? (raw as T) : fallback;
}
