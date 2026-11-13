/**
 * The tags and comments of markup, without a DOM — on its own, free of any
 * import, so that both the block format (`blocks/blockHtml.ts`) and the link
 * chips (`internalLinkHtml.ts`, which `blockHtml.ts` imports) can use it.
 */

/** A tag or comment in markup, as `htmlTags` finds it. */
export interface HtmlTag {
  /** Where it starts, and how long it is (`<` to `>` inclusive). */
  index: number;
  length: number;
  /** An end tag (`</p>`). */
  close: boolean;
  /** The tag name as written; `''` for a comment. */
  name: string;
  /** Everything between the name and `>`. */
  attrs: string;
}

const NAME_START_RE = /[a-z]/i;
const NAME_END_RE = /[\s/>]/;
const UNKNOWN = -2;
const FAILS = -1;

/**
 * The tags and comments of markup, in order — quote-aware: a `>` in a quoted
 * attribute value does not end a tag. A `<` that does not start one is text.
 *
 * A scan rather than a regular expression: markup comes from imports and
 * other devices, and a backtracking pattern over a few kilobytes of `<a` without
 * a `>` takes minutes. Every character is looked at a bounded number of times:
 * a tag that is found is skipped as a whole, a comment without an end is
 * remembered as such, and where an attribute scan ends (at a `>`, or failing
 * at a quote that never closes) is remembered for every position it passed,
 * so a later scan that reaches one of them takes the answer from there.
 */
export function* htmlTags(html: string): Generator<HtmlTag> {
  const lastGt = html.lastIndexOf('>');
  const lastQuote = { '"': html.lastIndexOf('"'), "'": html.lastIndexOf("'") };
  /** Per position outside quotes: where the tag's `>` is (≥ 0), `FAILS`, or `UNKNOWN`. */
  let ends: Int32Array | null = null;
  let commentsEnd = true;
  for (let i = html.indexOf('<'); i !== -1 && i < lastGt; ) {
    if (commentsEnd && html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      if (end !== -1) {
        yield { index: i, length: end + 3 - i, close: false, name: '', attrs: '' };
        i = html.indexOf('<', end + 3);
        continue;
      }
      // No `-->` after this one, so none after any later `<!--` either.
      commentsEnd = false;
    }
    let j = i + 1;
    const close = html[j] === '/';
    if (close) j++;
    if (!NAME_START_RE.test(html[j] ?? '')) {
      i = html.indexOf('<', i + 1);
      continue;
    }
    const nameStart = j;
    while (j < html.length && !NAME_END_RE.test(html[j])) j++;
    const nameEnd = j;
    ends ??= new Int32Array(html.length + 1).fill(UNKNOWN);
    const passed: number[] = [];
    let end: number = FAILS;
    while (j <= lastGt) {
      if (ends[j] !== UNKNOWN) { end = ends[j]; break; }
      passed.push(j);
      const c = html[j];
      if (c === '>') { end = j; break; }
      if (c === '"' || c === "'") {
        // A quote closes if another of its kind follows.
        if (j >= lastQuote[c]) break;
        j = html.indexOf(c, j + 1) + 1;
        continue;
      }
      j++;
    }
    for (const p of passed) ends[p] = end;
    if (end === FAILS) {
      i = html.indexOf('<', i + 1);
      continue;
    }
    yield { index: i, length: end + 1 - i, close, name: html.slice(nameStart, nameEnd), attrs: html.slice(nameEnd, end) };
    i = html.indexOf('<', end + 1);
  }
}
