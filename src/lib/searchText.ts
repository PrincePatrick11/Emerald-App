import { parseBlocks } from './blocks/blockHtml';
import { blockSearchText } from './blocks/blockTypes';

/**
 * Plain text out of an entry's content, for the global search.
 *
 * An entry's content, as `loadAllContent` assembles it from the block rows, is
 * markup, not text. Searching the raw string would match tag names, `data-id`
 * attributes of internal links and the hashed filenames behind `<img src>`.
 * So each block says what of it can be found (`searchText` of its type,
 * `blockSearchText`): a text its words, a fields block its readable fallback,
 * a canvas or a drawing nothing — the same text `blocks.text` holds.
 */

/** Read once per entry and revision; see `plainTextFor`. */
const cache = new Map<string, { stamp: string; text: string }>();

/** What the search finds in a content: the blocks' search texts, in order. */
export function contentSearchText(content: string): string {
  return parseBlocks(content).map(blockSearchText).filter(Boolean).join(' ');
}

/**
 * The plain text of one entry, parsed at most once per revision.
 *
 * `stamp` is the entry's `updated_at`: the same id with a newer stamp re-parses,
 * the same stamp is served from the cache. That is what keeps a keystroke in the
 * search field from re-parsing the whole vault.
 */
export function plainTextFor(id: string, stamp: string, content: string): string {
  const cached = cache.get(id);
  if (cached?.stamp === stamp) return cached.text;
  const text = contentSearchText(content);
  cache.set(id, { stamp, text });
  return text;
}

/**
 * Drops everything parsed so far. Called when the vault changes: the ids of the
 * vault just closed will never be asked for again, and holding their text would
 * be a leak that grows with every switch.
 */
export function clearSearchTextCache(): void {
  cache.clear();
}

/**
 * Folds the typographic characters TipTap's `Typography` extension writes into
 * content back to the ones a keyboard produces.
 *
 * Without this the search quietly fails its own promise: the editor stores
 * `don’t` with U+2019 while the field yields `don't` with U+0027, so an entry is
 * unfindable by a word it plainly contains. It is also the one place where the
 * three platforms disagree — WKWebView applies macOS smart substitution inside
 * the input, WebView2 and WebKitGTK do not, so the same keystrokes would search
 * for different strings. Folding both sides settles both problems at once.
 *
 * Every replacement is one character for one character, deliberately: the
 * snippet is sliced out of the *unfolded* text at an index found in the folded
 * one, so the two have to stay the same length. That is why `…` is not in the
 * table — `...` is three characters and would shift every offset behind it.
 */
const FOLDED: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '–': '-', '—': '-', '−': '-',
};

const TYPOGRAPHIC = /[‘’‚‛“”„‟–—−]/g;

export function foldTypography(text: string): string {
  return text.replace(TYPOGRAPHIC, (character) => FOLDED[character]);
}
