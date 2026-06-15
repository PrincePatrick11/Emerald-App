export function isImageIcon(icon: string | null | undefined): boolean {
  if (!icon) return false;
  return icon.startsWith('data:image/') || icon.startsWith('blob:') || icon.startsWith('/');
}

export function safeParseArray<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T[]; } catch { return []; }
  }
  return [];
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

export function boolToInt(v: boolean): 0 | 1 {
  return v ? 1 : 0;
}

export const ACCEPTED_IMAGE_MIME = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

const ACCEPTED_IMAGE_MIME_LIST = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

export function isAcceptedImageFile(file: File): boolean {
  return ACCEPTED_IMAGE_MIME_LIST.includes(file.type);
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
