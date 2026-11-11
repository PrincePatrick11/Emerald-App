import { nowIso } from './helpers';

/**
 * When a write advances "Last modified" (`updated_at`). Only what someone
 * changes on exactly this entry counts — what comes in as a consequence from
 * elsewhere leaves the stamp alone, and with it the order of the lists.
 *
 * Applies to the entries of the three modules, tasks, templates, custom
 * blocks and the lexicon — every method that writes `updated_at` asks
 * `needsWrite` and stamps via `stampFor`.
 *
 * - `true` (default): now.
 * - `false`: a consequence — a renamed tag, "Update all", a
 *   new thumbnail.
 * - a timestamp: exactly that one. Cancel uses it to restore the earlier one.
 */
export type Touch = boolean | string;

export interface WriteOptions {
  touch?: Touch;
}

/** For every write that is a consequence of something elsewhere — so they can all be found. */
export const AS_A_CONSEQUENCE: WriteOptions = { touch: false };

export function stampFor(current: string, touch: Touch = true): string {
  if (touch === true) return nowIso();
  return touch === false ? current : touch;
}

/**
 * Does a store have to write for `patch` at all? Not if nothing
 * changes — a "Done" without changes or an autosave to the same state would
 * otherwise advance "Last modified". Missing and `null` count as equal.
 * An explicitly set stamp that differs is also a change.
 */
export function needsWrite(current: { updated_at: string }, patch: object, touch?: Touch): boolean {
  if (typeof touch === 'string' && touch !== current.updated_at) return true;
  const fields = current as Record<string, unknown>;
  return Object.entries(patch).some(([key, value]) =>
    JSON.stringify(fields[key] ?? null) !== JSON.stringify(value ?? null));
}
