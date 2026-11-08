/**
 * What a stored symbol may hold, apart from the editor: the line weight's
 * range and a check of its path data. Kept free of React, since the altar's
 * storage code reads it outside the app too.
 */

export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 16;
export const DEFAULT_WEIGHT = 5;

/** Path data as it may be stored: commands, numbers and separators only, and not endless. */
export function isSymbolPath(d: unknown): d is string {
  return typeof d === 'string' && d.length > 0 && d.length <= 20000 && /^[MLHVCSQTAZmlhvcsqtaz0-9 .,eE+-]+$/.test(d);
}
