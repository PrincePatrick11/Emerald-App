import { escapeHtml } from '../internalLinkHtml';
import { readBlockData, withBlockData } from './blockJson';
import type { BlockInstance } from './types';

/**
 * The sigil calculator as a building block of its own: from an intention
 * the letter bank (each letter once), and which of them the drawing already
 * holds. The sigil block carries it as one of its parts; a block of its own
 * (#189) can carry it the same way — it reads and writes a block-shaped
 * value (data JSON + readable inner HTML) and knows nothing of where that
 * value sits.
 *
 * Pure and DOM-free like the rest of `lib/blocks`.
 */

export interface SigilCalc {
  broken: boolean;
  intention: string;
  /** The letter bank: each letter once, in order of first appearance. */
  letters: string[];
  /** Those of them already implemented in the drawing. */
  implemented: string[];
}

/** A calculator's value without the `broken` flag — what the editor hands back. */
export type SigilCalcData = Omit<SigilCalc, 'broken'>;

/** Plain text as paragraphs, one line per `<p>`, escaped. */
function textParagraphs(text: string): string {
  return text.split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

/**
 * A letter list from a foreign source: only short strings, at most
 * 500. The limit protects against doctored imports — a bank of
 * hundreds of thousands of entries would otherwise cripple rendering.
 */
export function letterList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((l): l is string => typeof l === 'string' && l.length > 0 && l.length <= 8).slice(0, 500)
    : [];
}

/** Each letter once, uppercased, without accents — as the sigil view always did. */
export function extractUniqueLetters(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const char of input.normalize('NFKD').toUpperCase()) {
    if (!/\p{L}/u.test(char) || seen.has(char)) continue;
    seen.add(char);
    result.push(char);
  }
  return result;
}

/** Only what is also in the bank. */
export function implementedIn(letters: readonly string[], implemented: readonly string[]): string[] {
  const bank = new Set(letters);
  return implemented.filter((l) => bank.has(l));
}

export function parseSigilCalc(block: BlockInstance): SigilCalc {
  const { broken, data } = readBlockData(block);
  const letters = letterList(data.letters);
  return {
    broken,
    intention: typeof data.intention === 'string' ? data.intention : '',
    letters,
    implemented: implementedIn(letters, letterList(data.implemented)),
  };
}

/** The calculator with new data; the inner HTML is the readable fallback (intention, letters). */
export function serializeSigilCalc(block: BlockInstance, calc: SigilCalcData): BlockInstance {
  const done = new Set(calc.implemented);
  const intention = calc.intention.trim() ? textParagraphs(calc.intention) : '';
  const letters = calc.letters.length
    ? `<p>${calc.letters.map((l) => (done.has(l) ? `<s>${escapeHtml(l)}</s>` : escapeHtml(l))).join(' ')}</p>`
    : '';
  return withBlockData(block, { intention: calc.intention, letters: calc.letters, implemented: calc.implemented }, intention + letters);
}
