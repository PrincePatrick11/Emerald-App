/**
 * Plain text out of the editor's HTML, for the global search.
 *
 * `journal_entries.content`, `wiki_articles.content` and `operations.content`
 * hold what TipTap's `getHTML()` emitted — markup, not text. Searching the raw
 * string would match tag names, `data-id` attributes of internal links and the
 * hashed filenames behind `<img src>`, so every one of them is reduced to its
 * text first.
 *
 * `DOMParser` rather than `innerHTML` on a detached `<div>`: the parsed
 * document is inert, so an `<img onerror>` that arrived through an import never
 * runs. It is also the parser `lib/links.ts` already reads content with.
 */

/**
 * Elements whose edges are word boundaries. Without a separator `textContent`
 * returns `<p>Ende</p><p>Anfang</p>` as `Endeanfang` — which both hides the two
 * words from a search and invents a third.
 *
 * The internal-link span rides along although it is inline: it is one discrete
 * chip in the editor, not a run of text, so two of them in a row are two words.
 * `<strong>` and friends deliberately do not, because they mark up *within* a
 * word — `Ein <strong>fett</strong>es Wort` has to stay `fettes`.
 */
const SEPARATED_ELEMENTS = 'address, blockquote, br, div, dd, dt, h1, h2, h3, h4, h5, h6, hr, li, ol, p, pre, table, td, th, tr, ul, span[data-type="internalLink"]';

/** Parsed once per entry and revision; see `plainTextFor`. */
const cache = new Map<string, { stamp: string; text: string }>();

const parser = new DOMParser();

export function htmlToText(html: string): string {
  if (!html) return '';
  const doc = parser.parseFromString(html, 'text/html');
  // TipTap emits neither, but imported content can carry both, and
  // `textContent` — unlike `innerText` — would hand their source back as if it
  // were the entry's prose.
  for (const el of doc.body.querySelectorAll('script, style, noscript')) el.remove();
  // Both sides, not just the trailing one: an `</a><ul>` would otherwise get no
  // separator, because the `<a>` before it is not one — `Link` and `eins` would
  // be a single word. The `\s+` collapse below eats the doubled spaces anyway.
  for (const el of doc.body.querySelectorAll(SEPARATED_ELEMENTS)) {
    el.before(' ');
    el.after(' ');
  }
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The plain text of one entry, parsed at most once per revision.
 *
 * `stamp` is the entry's `updated_at`: the same id with a newer stamp re-parses,
 * the same stamp is served from the cache. That is what keeps a keystroke in the
 * search field from re-parsing the whole vault.
 */
export function plainTextFor(id: string, stamp: string, html: string): string {
  const cached = cache.get(id);
  if (cached?.stamp === stamp) return cached.text;
  const text = htmlToText(html);
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
