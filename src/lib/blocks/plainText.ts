import { htmlTags } from '../htmlTags';
import { decodeHtmlAttr } from '../internalLinkHtml';

/** Elements whose edges are word boundaries — block elements, the fields block's `<dl>`, pictures. */
const SEPARATED_TAG_RE = /^(address|blockquote|br|div|dd|dl|dt|h[1-6]|hr|li|ol|p|pre|section|table|td|th|tr|ul|img)$/i;
/** Elements whose content is no text: their source would read as if it were the entry's prose. */
const DROPPED_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'noscript']);
const CHIP_ATTR_RE = /\bdata-type=["']internalLink["']/i;

/**
 * The plain text of markup, without a DOM: tags gone, block elements and link
 * chips as word boundaries, entities decoded — what the search finds in a
 * block (`searchText` of its type) and what `blocks.text` holds.
 */
export function htmlPlainText(html: string): string {
  if (!html) return '';
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let textFrom = 0;
  /** Up to where the content of a dropped element runs. */
  let skipTo = 0;
  /** Per open `<span>`: is it a link chip? A chip is one word of its own. */
  const spans: boolean[] = [];
  const unclosedDropped = new Set<string>();
  for (const tag of htmlTags(html)) {
    if (tag.index < skipTo) continue;
    parts.push(html.slice(textFrom, tag.index));
    textFrom = tag.index + tag.length;
    const name = tag.name.toLowerCase();
    if (!tag.close && DROPPED_TAGS.has(name) && !unclosedDropped.has(name)) {
      const end = lower.indexOf(`</${name}`, textFrom);
      const gt = end === -1 ? -1 : html.indexOf('>', end);
      if (gt !== -1) {
        parts.push(' ');
        skipTo = gt + 1;
        textFrom = skipTo;
        continue;
      }
      unclosedDropped.add(name);
    }
    if (name === 'span') {
      const chip = tag.close ? spans.pop() ?? false : CHIP_ATTR_RE.test(tag.attrs);
      if (!tag.close) spans.push(chip);
      parts.push(chip ? ' ' : '');
      continue;
    }
    parts.push(!name || SEPARATED_TAG_RE.test(name) ? ' ' : '');
  }
  parts.push(html.slice(textFrom));
  return decodeHtmlAttr(parts.join('')).replace(/\s+/g, ' ').trim();
}
