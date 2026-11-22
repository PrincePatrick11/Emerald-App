/**
 * The files the import window takes, by their ending — chosen in its dialog or
 * dragged in alike. `.vault.emerald` ends in `.emerald`; what a file really is,
 * Rust reads from its header. A module of its own: the picture drops ask it
 * too, without loading the import.
 */
export const IMPORT_EXTENSIONS = ['emerald', 'md'] as const;

const IMPORT_PATH_RE = /\.(emerald|md)$/i;

export function isImportPath(path: string): boolean {
  return IMPORT_PATH_RE.test(path);
}
