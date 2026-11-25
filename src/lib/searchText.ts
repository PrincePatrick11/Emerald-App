import { parseBlocks } from './blocks/blockHtml';
import { blockSearchText, entryEffects } from './blocks/blockTypes';
import { localIsoDay } from './helpers';

/**
 * Plain text out of an entry's content, for the global search.
 *
 * An entry's content, as `loadAllContent` assembles it from the block rows, is
 * markup, not text. Searching the raw string would match tag names, `data-id`
 * attributes of internal links and the hashed filenames behind `<img src>`.
 * So each block says what of it can be found (`searchText` of its type,
 * `blockSearchText`): a text its words, a fields block its readable fallback,
 * a canvas or a drawing nothing. What a block's effect conceals today (a
 * loaded sigil) is not found: a concealed block is left out, a concealed part
 * its block leaves out itself.
 */

/** Read once per entry and revision; see `plainTextFor`. */
const cache = new Map<string, { stamp: string; text: string }>();

/** What the search finds in a content today: the blocks' search texts, in order. */
export function contentSearchText(content: string, today = localIsoDay()): string {
  const blocks = parseBlocks(content);
  const { concealed } = entryEffects(blocks, { today });
  return blocks
    .filter((block) => !concealed.has(block.id))
    .map((block) => blockSearchText(block, { today }))
    .filter(Boolean)
    .join(' ');
}

/**
 * The plain text of one entry, parsed at most once per revision.
 *
 * Re-parsed when the entry's `updated_at` changes, when its content arrives
 * after startup (`pendingContent`: empty until then, so its length changes),
 * and on a new day (what is concealed until a day is found from that day on);
 * otherwise served from the cache. That is what keeps a keystroke in the
 * search field from re-parsing the whole vault.
 */
export function plainTextFor(id: string, updatedAt: string, content: string, today = localIsoDay()): string {
  const stamp = `${updatedAt}|${content.length}|${today}`;
  const cached = cache.get(id);
  if (cached?.stamp === stamp) return cached.text;
  const text = contentSearchText(content, today);
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
