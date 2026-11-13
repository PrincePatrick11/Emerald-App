/**
 * The position of a block among its siblings (`blocks.position`): a key that
 * sorts as a plain string, so that moving or inserting one block writes that
 * one row and leaves every other where it is.
 *
 * A key is the fraction digits of a number between 0 and 1 in base 62
 * (`0-9A-Za-z`, the order of their ASCII codes, hence of SQLite's BINARY
 * collation), never ending in `0`: `"V"` is about one half, `"V8"` a little
 * more. Between any two keys there is always a third.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const KEY_RE = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export function isPositionKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= 256 && KEY_RE.test(key);
}

function digit(ch: string | undefined): number {
  return ch === undefined ? 0 : DIGITS.indexOf(ch);
}

/** The fraction digits between `a` (or 0 for `''`) and `b` (or 1 for `null`); `a < b`. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = digit(a[0]);
  const db = b !== null ? digit(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  // Neighbouring digits: `b`'s first digit is enough if `b` goes on after it…
  if (b !== null && b.length > 1) return b[0];
  // …otherwise stay on `a`'s digit and go one place further.
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** A key between `before` and `after`; `null` stands for the start or the end. */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error(`[position] ${before} is not before ${after}`);
  }
  return midpoint(before ?? '', after);
}

/** `count` keys spread evenly — what a stack gets that has none yet. */
export function evenKeys(count: number): string[] {
  if (count <= 0) return [];
  let length = 1;
  while (BASE ** length <= count) length++;
  const span = BASE ** length;
  return Array.from({ length: count }, (_, i) => {
    let value = Math.floor(((i + 1) * span) / (count + 1));
    let key = '';
    for (let p = 0; p < length; p++) {
      key = DIGITS[value % BASE] + key;
      value = Math.floor(value / BASE);
    }
    return key.replace(/0+$/, '');
  });
}

/** Indexes of a longest strictly increasing run of `keys` (entries `null` take no part). */
function longestIncreasing(keys: readonly (string | null)[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(keys.length).fill(-1);
  keys.forEach((key, i) => {
    if (key === null) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[tails[mid]]! < key) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const kept = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = previous[i]) kept.add(i);
  return kept;
}

/** Keys for `out[from..to)` between `lower` and `upper`, halving the gap — a long run stays short. */
function fillBetween(out: (string | null)[], from: number, to: number, lower: string | null, upper: string | null): void {
  if (from >= to) return;
  const mid = (from + to) >> 1;
  const key = keyBetween(lower, upper);
  out[mid] = key;
  fillBetween(out, from, mid, lower, key);
  fillBetween(out, mid + 1, to, key, upper);
}

/**
 * Keys for the blocks `ids` in this order, keeping every key of `previous`
 * (block ID → key) that still fits: the longest run of blocks whose old keys
 * still ascend stays as it is, every other block gets a key between its
 * neighbours. Moving one block thus changes one key, inserting one adds one.
 */
export function positionsFor(previous: ReadonlyMap<string, string>, ids: readonly string[]): string[] {
  const old = ids.map((id) => {
    const key = previous.get(id);
    return isPositionKey(key) ? key : null;
  });
  if (old.every((key) => key === null)) return evenKeys(ids.length);
  const kept = longestIncreasing(old);
  const out: (string | null)[] = old.map((key, i) => (kept.has(i) ? key : null));
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    // A run of blocks without a key, between the last key and the next kept one.
    let end = i;
    while (end < out.length && out[end] === null) end++;
    fillBetween(out, i, end, i > 0 ? out[i - 1] : null, end < out.length ? out[end] : null);
    i = end - 1;
  }
  return out as string[];
}
