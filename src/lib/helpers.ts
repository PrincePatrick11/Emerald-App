export function isImageIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  return icon.startsWith('data:image/') || icon.startsWith('blob:') || icon.startsWith('/');
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
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
 * Dateigroesse fuer die Anzeige — eine Nachkommastelle ab MB.
 *
 * Die Einheiten kommen von aussen statt fest im Code zu stehen: Franzoesisch
 * rechnet in Oktett und schreibt `o` / `Ko` / `Mo`, nicht `B` / `KB` / `MB`.
 */
export function formatBytes(bytes: number, units: [string, string, string]): string {
  if (bytes < 1024) return `${bytes} ${units[0]}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${units[1]}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${units[2]}`;
}
