export function safeParseArray<T = unknown>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T[]; } catch { return []; }
  }
  return [];
}
