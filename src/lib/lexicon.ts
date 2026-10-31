/**
 * The lexicon as a rule set: the alphabet of a language, the lookup of
 * its words and translating a text with them.
 *
 * Translation works exclusively from what is in the vault — no word
 * goes to the network (see `Documentation/security.md`). What the lexicon does not
 * know stays untranslated and is reported as such, instead of being silently
 * swallowed or guessed.
 *
 * Import rule as in the rest of `lib/`: no stores, no components, no
 * i18n — only the rule lives here, the UI labels it.
 */
import type { AlphabetPair, Language, LexiconEntry } from '../types';

/** What a new language starts with — the emoji of the lexicon dashboard. */
export const DEFAULT_LANGUAGE_ICON = '🗣️';

/**
 * Direction of the translation. `toLanguage` rewrites the user's own text into the
 * language (word: `translation` → `term`), `fromLanguage` the other way.
 */
export type TranslateDirection = 'toLanguage' | 'fromLanguage';

/**
 * What the translation draws on: the word list, the character table or
 * both — where "both" means that a word is first looked up as a word and
 * only then rewritten character by character.
 */
export type TranslateMode = 'words' | 'letters' | 'both';

/**
 * A piece of the result. `source` is what was in the input text — the UI
 * shows it in the tooltip and uses it to mark what was not matched.
 */
export interface TranslationSegment {
  text: string;
  source: string;
  /** `gap` is everything between the words: spaces, punctuation, line breaks. */
  kind: 'word' | 'letters' | 'unknown' | 'gap';
}

export interface TranslationResult {
  segments: TranslationSegment[];
  /** The segments joined together — what the copy button takes. */
  text: string;
  /** How many words the input text had (not counting the gaps). */
  wordCount: number;
  /** How many of those the lexicon does not know. */
  unknownCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alphabet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A character pair only takes effect if both sides carry something — the one rule
 * for that, here instead of spelled out three separate times.
 */
export function isUsablePair(pair: AlphabetPair): boolean {
  return pair.from.trim() !== '' && pair.to.trim() !== '';
}

/**
 * Whether the row is kept at all. Half-filled yes — whoever still fills in the left
 * side later should find the right one again on the next load;
 * completely empty no, that is a row that never existed.
 */
export function isFilledPair(pair: AlphabetPair): boolean {
  return pair.from.trim() !== '' || pair.to.trim() !== '';
}

/**
 * The alphabet from the JSON column. As everywhere when reading foreign data
 * (`row.ts`): broken content becomes an empty table, not an
 * error — an unreadable row must not hold up the whole lexicon.
 */
export function parseAlphabet(value: unknown): AlphabetPair[] {
  const raw = typeof value === 'string' ? safeParse(value) : value;
  if (!Array.isArray(raw)) return [];
  const pairs: AlphabetPair[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const pair = {
      from: String((item as AlphabetPair).from ?? ''),
      to: String((item as AlphabetPair).to ?? ''),
    };
    if (isFilledPair(pair)) pairs.push(pair);
  }
  return pairs;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function alphabetToJson(pairs: readonly AlphabetPair[]): string {
  return JSON.stringify(pairs.map((p) => ({ from: p.from, to: p.to })));
}

/**
 * The character table as a lookup, longest sequence first.
 *
 * The sorting is the whole trick: if "t" comes before "th", the transliteration
 * would never find the "th", because it moves on at the first match.
 */
function transliterationTable(
  pairs: readonly AlphabetPair[],
  direction: TranslateDirection,
): [string, string][] {
  const table: [string, string][] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    if (!isUsablePair(pair)) continue;
    const [from, to] = direction === 'toLanguage' ? [pair.from, pair.to] : [pair.to, pair.from];
    const key = from.toLowerCase();
    // Two rows with the same left side: the first one wins, as with the words.
    if (seen.has(key)) continue;
    seen.add(key);
    table.push([key, to]);
  }
  return table.sort((a, b) => b[0].length - a[0].length);
}

/**
 * Rewrites `text` character by character. Whatever is in no row of the table
 * stays unchanged — a punctuation mark should not disappear
 * just because the alphabet does not know it.
 */
function transliterate(
  text: string,
  pairs: readonly AlphabetPair[],
  direction: TranslateDirection,
): string {
  const table = transliterationTable(pairs, direction);
  if (table.length === 0) return text;
  let out = '';
  let i = 0;
  outer: while (i < text.length) {
    for (const [from, to] of table) {
      // Lower-case per position instead of once for the whole text: `İ` becomes
      // two characters long when lower-cased, and a copy built in advance
      // would drift out of step with `text` — from there on every
      // position would be wrong.
      const slice = text.slice(i, i + from.length);
      if (slice.toLowerCase() === from) {
        out += to;
        i += from.length;
        continue outer;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both sides of every comparison go through this: lower case, and the
 * typographic apostrophes collapsed to the straight one — otherwise
 * a word entered with "’" does not find its input typed with "'".
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Word characters: letters, digits, combining marks and the word apostrophe. */
const WORD_RE = /[\p{L}\p{N}\p{M}'’]+/gu;

interface Token {
  text: string;
  isWord: boolean;
}

/**
 * Splits the text into words and everything in between. Both are kept:
 * line breaks and punctuation appear in the result at the same place as in
 * the input, so that a translated invocation keeps its shape.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;
    if (start > last) tokens.push({ text: text.slice(last, start), isWord: false });
    tokens.push({ text: match[0], isWord: true });
    last = start + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), isWord: false });
  return tokens;
}

interface VocabularyIndex {
  /** Folded search term → translation. */
  byKey: Map<string, string>;
  /** How many words the longest entry consists of — the upper bound of the phrase search. */
  maxWords: number;
}

/**
 * The words of a language as a lookup for one direction.
 *
 * Multi-word entries are explicitly allowed ("good spirit" → …): the
 * index remembers the longest word count, and `translateText` tries the
 * longest phrase first at each position. Two entries with the same left side:
 * the first in the list wins, i.e. the one with the smaller `sort_order`.
 */
function vocabularyIndex(
  entries: readonly LexiconEntry[],
  direction: TranslateDirection,
): VocabularyIndex {
  const byKey = new Map<string, string>();
  let maxWords = 1;
  for (const entry of entries) {
    const [from, to] = direction === 'toLanguage'
      ? [entry.translation, entry.term]
      : [entry.term, entry.translation];
    const key = fold(from);
    if (!key || !to.trim() || byKey.has(key)) continue;
    byKey.set(key, to.trim());
    const words = key.split(' ').length;
    if (words > maxWords) maxWords = words;
  }
  return { byKey, maxWords };
}

/**
 * Carries the capitalization of the source over to the result: UPPER stays upper,
 * a leading capital stays a leading capital, everything else stays as it was
 * entered. Without this, a sentence start would come back in lower case from the translation.
 */
function matchCase(source: string, translated: string): string {
  const letters = source.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return translated.toUpperCase();
  }
  const first = source[0] ?? '';
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return translated.charAt(0).toUpperCase() + translated.slice(1);
  }
  return translated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Translating
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translates `text` with what the language brings along.
 *
 * Word by word, not sentence by sentence: a self-maintained lexicon has no
 * grammar, and pretending it did would be the more dishonest
 * option. What is not found stays unchanged and is marked in the
 * result — with `both` only after the character table has been tried as well.
 */
export function translateText(
  text: string,
  language: Pick<Language, 'alphabet'>,
  entries: readonly LexiconEntry[],
  direction: TranslateDirection,
  mode: TranslateMode,
): TranslationResult {
  const segments: TranslationSegment[] = [];
  let wordCount = 0;
  let unknownCount = 0;

  if (!text.trim()) return { segments, text: '', wordCount, unknownCount };

  // Pure transliteration: the lexicon plays no part, the text runs as a whole
  // through the table — including the punctuation marks it may know.
  if (mode === 'letters') {
    for (const token of tokenize(text)) {
      if (!token.isWord) {
        segments.push({ text: transliterate(token.text, language.alphabet, direction), source: token.text, kind: 'gap' });
        continue;
      }
      wordCount += 1;
      const out = transliterate(token.text, language.alphabet, direction);
      // Unchanged means: no character of the word was in the table.
      if (out === token.text) unknownCount += 1;
      segments.push({ text: out, source: token.text, kind: out === token.text ? 'unknown' : 'letters' });
    }
    return toResult(segments, wordCount, unknownCount);
  }

  const index = vocabularyIndex(entries, direction);
  const tokens = tokenize(text);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.isWord) {
      segments.push({ text: token.text, source: token.text, kind: 'gap' });
      i += 1;
      continue;
    }

    const phrase = longestMatchAt(tokens, i, index);
    if (phrase) {
      wordCount += phrase.words.length;
      segments.push({ text: matchCase(phrase.words[0], phrase.hit), source: phrase.source, kind: 'word' });
      i = phrase.nextIndex;
      continue;
    }

    wordCount += 1;
    i += 1;
    // "Both": first the lexicon, then the character table. If the word comes back
    // unchanged from that as well, the language really does not know it.
    if (mode === 'both') {
      const rewritten = transliterate(token.text, language.alphabet, direction);
      if (rewritten !== token.text) {
        segments.push({ text: rewritten, source: token.text, kind: 'letters' });
        continue;
      }
    }
    unknownCount += 1;
    segments.push({ text: token.text, source: token.text, kind: 'unknown' });
  }

  return toResult(segments, wordCount, unknownCount);
}

/**
 * The longest word match from `start` — phrases first, so that "good spirit"
 * does not already end at "good".
 */
function longestMatchAt(
  tokens: readonly Token[],
  start: number,
  index: VocabularyIndex,
): { words: string[]; source: string; hit: string; nextIndex: number } | null {
  for (let span = Math.min(index.maxWords, tokens.length - start); span >= 1; span -= 1) {
    const phrase = phraseAt(tokens, start, span);
    if (!phrase) continue;
    const hit = index.byKey.get(fold(phrase.words.join(' ')));
    if (hit !== undefined) return { ...phrase, hit };
  }
  return null;
}

/**
 * The `span` words from `start` as one phrase — together with how it looked in
 * the input text, and the position after it.
 *
 * Only whitespace **within a line** may stand between them: a
 * punctuation mark ends the phrase anyway, and a line break does too.
 * Otherwise it would vanish in the result — the translation takes the place of the
 * whole phrase, and the text would lose a line it had in the original.
 */
function phraseAt(
  tokens: readonly Token[],
  start: number,
  span: number,
): { words: string[]; source: string; nextIndex: number } | null {
  const words: string[] = [];
  let source = '';
  let i = start;
  while (i < tokens.length && words.length < span) {
    const token = tokens[i];
    if (token.isWord) {
      words.push(token.text);
    } else if (token.text.trim() !== '' || /[\n\r]/.test(token.text)) {
      return null;
    }
    source += token.text;
    i += 1;
  }
  return words.length === span ? { words, source, nextIndex: i } : null;
}

function toResult(segments: TranslationSegment[], wordCount: number, unknownCount: number): TranslationResult {
  return { segments, text: segments.map((s) => s.text).join(''), wordCount, unknownCount };
}

/**
 * The words of a language in display order — `sort_order`, ties broken
 * alphabetically by term. One source of truth for the table on the
 * language page, the translation and the count in the dashboard.
 */
export function entriesOfLanguage(
  entries: readonly LexiconEntry[],
  languageId: string,
): LexiconEntry[] {
  return entries
    .filter((e) => e.language_id === languageId)
    .sort((a, b) => a.sort_order - b.sort_order || a.term.localeCompare(b.term));
}
