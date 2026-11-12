import { escapeHtml } from '../internalLinkHtml';
import { generateId } from '../helpers';
import { BLOCK_ATTR, TEXT_BLOCK_TYPE, type BlockInstance } from './types';

/**
 * The block format in the stored `content` — reading and writing.
 *
 * An entry is a sequence of blocks; each one stands as
 * `<section data-block="<type>" data-block-id="<id>" …>inner HTML</section>`
 * at the top level of the HTML. Three rules carry the format:
 *
 * 1. Content OUTSIDE a block section is text. Legacy content without any
 *    wrapper is thus a single text block, and whatever imports or migrations
 *    append as raw HTML becomes another text block — existing entries need
 *    no migration.
 * 2. A single text block without further attributes is written WITHOUT a
 *    wrapper. The vast majority of entries thus stay byte for byte what they
 *    were; export, search and older app versions notice nothing.
 * 3. Block sections stand only at the top level. TipTap has no section
 *    node, so there is none inside a block's text.
 *
 * Deliberately without `DOMParser`, like `extractInternalLinks`: migrations and
 * `scripts/check-blocks.mjs` run under Node. Every tag is read once,
 * quote-aware — a `>` in a quoted attribute value does not end a tag,
 * and a `</section>` in an attribute value or comment is not one.
 * Only `<section>` tags are counted, including ordinary ones without
 * `data-block` (from an import), so that their end tag does not close a
 * block prematurely.
 *
 * Deliberately lenient where browsers would parse differently: `<section data-block …/>`
 * counts as an empty block (a browser would open an element), an ordinary
 * `<section/>` does not count towards depth. Unknown named entities in an
 * attribute value (`&hellip;`) are left alone and become `&amp;hellip;`
 * when written back — the value itself does not change in the process.
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

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
/** Only `data-*` is passed through. Everything else on a section has no
 *  meaning for the format and should not get one either (`onclick` …). */
const KEPT_ATTR_RE = /^data-[a-z0-9-]+$/;

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|quot|apos|lt|gt|amp|nbsp);/gi;
const NAMED_ENTITIES: Record<string, string> = {
  quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: ' ',
};

/** Resolve entities in an attribute value — like the browser, without a DOM. */
export function decodeHtmlAttr(value: string): string {
  return decodeAttr(value);
}

function decodeAttr(value: string): string {
  return value.replace(ENTITY_RE, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#')) {
      const cp = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

/** The attributes of a section tag — `body` is everything between the tag name and `>`. */
function parseSectionAttrs(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\s*$/, '').matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    // As in the browser, the first occurrence of an attribute wins.
    if (!KEPT_ATTR_RE.test(name) || name in out) continue;
    out[name] = decodeAttr(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function toBlock(attrs: Record<string, string>, html: string): BlockInstance {
  const { 'data-block': type, 'data-block-id': id, ...rest } = attrs;
  return { id: id || generateId(), type, html, attrs: rest };
}

/**
 * Defuses `<section`/`</section` in the HTML an editor delivers. TipTap
 * never writes a real section element — a match is therefore always in an
 * attribute value (the title of a linked entry in a chip's `data-label`, an
 * `alt` text). Older WebKit versions do not escape `<` in attribute values;
 * the parser above would see a block tag there and tear the entry apart.
 * `&lt;` decodes to the same character in the attribute — lossless.
 */
export function neutralizeSectionTags(html: string): string {
  return html.replace(/<(\/?section)\b/gi, '&lt;$1');
}

export function createTextBlock(html = ''): BlockInstance {
  return { id: generateId(), type: TEXT_BLOCK_TYPE, html, attrs: {} };
}

/** The blocks of stored content, in order. Empty content → `[]`. */
export function parseBlocks(html: string): BlockInstance[] {
  const blocks: BlockInstance[] = [];
  if (!html) return blocks;

  let depth = 0;
  let looseFrom = 0;
  let open: { attrs: Record<string, string>; contentFrom: number } | null = null;

  const pushLoose = (to: number) => {
    const loose = html.slice(looseFrom, to);
    if (loose.trim()) blocks.push(createTextBlock(loose));
  };

  for (const t of htmlTags(html)) {
    // Skip comments (no tag name) and everything except <section>.
    if (t.name.toLowerCase() !== 'section') continue;
    const at = t.index;
    if (t.close) {
      if (depth === 0) continue; // stray end tag — belongs to the loose text
      depth--;
      if (depth === 0 && open) {
        blocks.push(toBlock(open.attrs, html.slice(open.contentFrom, at)));
        looseFrom = at + t.length;
        open = null;
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(t.attrs);
    if (depth === 0) {
      const attrs = parseSectionAttrs(t.attrs);
      if (attrs['data-block']) {
        pushLoose(at);
        if (selfClosing) {
          blocks.push(toBlock(attrs, ''));
          looseFrom = at + t.length;
          continue;
        }
        open = { attrs, contentFrom: at + t.length };
      }
    }
    if (!selfClosing) depth++;
  }

  // A block that is never closed keeps everything up to the end — better too
  // much in the block than lost data.
  if (open) blocks.push(toBlock(open.attrs, html.slice(open.contentFrom)));
  else pushLoose(html.length);

  // Duplicate IDs (hand-copied content, an import) get a new one:
  // the stack tracks blocks by their ID, and two identical ones would lose
  // one of the two when moved.
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.id)) block.id = generateId();
    seen.add(block.id);
  }
  return blocks;
}

/**
 * The order the instance attributes are written in; whatever else a block
 * carries follows in its own order. Fixed, because a block row
 * (`blockRows.ts`) keeps these attributes in columns of their own: written
 * from a row or from the stack, a block comes out as the same string.
 */
const ATTR_ORDER: readonly string[] = [
  BLOCK_ATTR.version, BLOCK_ATTR.hidden, BLOCK_ATTR.title, BLOCK_ATTR.showTitle, BLOCK_ATTR.config, BLOCK_ATTR.data,
];

/** The attributes of a block in the order they are written (`ATTR_ORDER`, then the rest). */
export function orderedBlockAttrs(attrs: Record<string, string>): Array<[string, string]> {
  const known = ATTR_ORDER.filter((name) => name in attrs).map((name): [string, string] => [name, attrs[name]]);
  return [...known, ...Object.entries(attrs).filter(([name]) => !ATTR_ORDER.includes(name))];
}

/** A section, attributes double-quoted and escaped — the same form that
 *  `DOMParser` + `innerHTML` output again on merge import. */
export function blockSectionHtml(block: BlockInstance): string {
  const attrs: Array<[string, string]> = [
    ['data-block', block.type],
    ['data-block-id', block.id],
    ...orderedBlockAttrs(block.attrs),
  ];
  return `<section ${attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ')}>${block.html}</section>`;
}

function isPlainTextBlock(block: BlockInstance): boolean {
  return block.type === TEXT_BLOCK_TYPE && Object.keys(block.attrs).length === 0;
}

/** The stored content for a sequence of blocks — see rule 2 in the header. */
export function serializeBlocks(blocks: BlockInstance[]): string {
  if (blocks.length === 1 && isPlainTextBlock(blocks[0])) return blocks[0].html;
  return blocks.map(blockSectionHtml).join('');
}
