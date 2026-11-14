import type { ContentType, LinkTargetKind } from '../types';
import { htmlTags } from './htmlTags';

/**
 * Reading and writing the stored HTML of an internal link chip —
 * deliberately without a DB import, so that the migration in `db.ts` can use it too,
 * without opening a cycle through `lib/links.ts` (which pulls in `getDb`).
 *
 * The markup has to match `InternalLinkExtension`: `parseHTML` recognizes the
 * chip by `span[data-type="internalLink"]`, the attributes by their
 * `data-*` names. If this deviates, TipTap reads the chip in as text.
 */

/**
 * The start tags of `<span>`s, as written (`<` to `>`) — through the linear,
 * quote-aware `htmlTags` rather than a regular expression: this runs over
 * every imported, saved and backed-up block (`blockRefs`), and a pattern
 * like `<span[^>]*>` over a long run of `<span` without a `>` takes minutes.
 */
function* spanStartTags(html: string): Generator<{ index: number; tag: string }> {
  for (const t of htmlTags(html)) {
    if (!t.close && t.name.toLowerCase() === 'span') yield { index: t.index, tag: html.slice(t.index, t.index + t.length) };
  }
}

/** `html` with every `<span>` start tag replaced by what `replace` makes of it. */
function replaceSpanStartTags(html: string, replace: (tag: string) => string): string {
  let out = '';
  let from = 0;
  for (const { index, tag } of spanStartTags(html)) {
    out += html.slice(from, index) + replace(tag);
    from = index + tag.length;
  }
  return out + html.slice(from);
}

function tagAttr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? '';
}

/**
 * All internal link targets in the content — only `id` and `entryType`.
 *
 * Deliberately without `DOMParser`: this function sits on the database path
 * (migration v36 and the import) and has to run without a browser too, otherwise the
 * migration cannot be checked in the schema harness (Node). For two attributes,
 * reading the start tag is enough — and both are entity-free: IDs are UUIDs,
 * `entryType` is a fixed word. Anyone who rebuilds the markup themselves uses
 * `remapInternalLinks` further down; that needs a real DOM.
 */
export function extractInternalLinks(
  html: string
): Array<{ id: string; entryType: string }> {
  if (!html) return [];
  const out: Array<{ id: string; entryType: string }> = [];
  for (const { tag } of spanStartTags(html)) {
    if (tagAttr(tag, 'data-type') !== 'internalLink') continue;
    const id = tagAttr(tag, 'data-id');
    if (!id) continue;
    out.push({ id, entryType: linkTargetKindOf(tagAttr(tag, 'data-entry-type')) });
  }
  return out;
}

/**
 * The target kind a chip's `data-entry-type` stands for: `task`, or an
 * entry of whatever kind. Entries have no type — the kind they show under
 * is looked up live.
 */
export function linkTargetKindOf(value: string | null | undefined): LinkTargetKind {
  return value?.trim() === 'task' ? 'task' : 'entry';
}

const DATA_ID_ATTR_RE = /\bdata-id=("[^"]*"|'[^']*')/i;

/**
 * Points every chip whose target `next` knows at the new ID — the merge
 * import, where the same entries arrive under prefixed IDs. A chip `next`
 * returns `undefined` for stays as it is.
 *
 * Via the start tag like `extractInternalLinks`: no DOM (the schema harness
 * runs the import under Node), and everything but the one attribute stays
 * byte for byte. Only the label is untouched: the target's title does not change.
 */
export function rewriteInternalLinkIds(html: string, next: (id: string) => string | undefined): string {
  if (!html || !html.includes('internalLink')) return html;
  return replaceSpanStartTags(html, (tag) => {
    if (tagAttr(tag, 'data-type') !== 'internalLink') return tag;
    const id = tagAttr(tag, 'data-id');
    const to = id ? next(id) : undefined;
    if (to === undefined || to === id) return tag;
    // The ID comes from a file: never let it close the attribute.
    return tag.replace(DATA_ID_ATTR_RE, () => `data-id="${to.replace(/"/g, '&quot;')}"`);
  });
}

/**
 * Does the stored HTML carry visible content? A fresh entry is
 * `<p></p>` — in front of the first link block there belongs no separator line,
 * since it separates the text from the links, and there is no text yet.
 *
 * Like `extractInternalLinks`, deliberately without `DOMParser`: the migrations ask
 * this too, and they run in the schema harness under Node.
 */
export function isBlankContent(html: string): boolean {
  if (!html) return true;
  // Elements that stand on their own — an image without a word next to it is content.
  if (/<(img|hr|br|iframe|table|svg|video|audio|span)\b/i.test(html)) return false;
  // The text between the tags, through the linear `htmlTags` — a regular
  // expression over a long run of `<` without a `>` would take minutes.
  let text = '';
  let from = 0;
  for (const tag of htmlTags(html)) {
    text += html.slice(from, tag.index);
    from = tag.index + tag.length;
  }
  text += html.slice(from);
  return !text.replace(/&nbsp;/gi, ' ').trim();
}

export interface ParsedInternalLink {
  id: string;
  entryType: string;
  label: string;
}

/** Where a chip points after the rewrite. `label` overrides the
 *  stored display text — without it, after a change of target it could
 *  claim something other than what the link actually hits. */
export interface ResolvedInternalLink {
  id: string;
  label?: string;
}

/**
 * Rewrites the target IDs of the link chips in the content — the repair step on
 * import into a foreign vault, where the same note has a different ID.
 *
 * `resolve` receives each chip and returns the target in the target vault, or
 * `null`. For `null` the chip is replaced by its text: a link whose
 * target does not exist here would otherwise be a chip that leads nowhere
 * on click — this way the words it stood for are at least preserved.
 */
export function remapInternalLinks(
  html: string,
  resolve: (link: ParsedInternalLink) => ResolvedInternalLink | null,
): string {
  if (!html.includes('data-type="internalLink"')) return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const span of Array.from(doc.querySelectorAll('span[data-type="internalLink"]'))) {
    const link: ParsedInternalLink = {
      id: span.getAttribute('data-id') ?? '',
      entryType: linkTargetKindOf(span.getAttribute('data-entry-type')),
      label: span.getAttribute('data-label') ?? span.textContent ?? '',
    };
    const resolved = link.id ? resolve(link) : null;
    if (resolved === null) {
      span.replaceWith(doc.createTextNode(link.label));
      continue;
    }
    if (resolved.id !== link.id) span.setAttribute('data-id', resolved.id);
    if (resolved.label !== undefined && resolved.label !== link.label) {
      span.setAttribute('data-label', resolved.label);
      span.textContent = resolved.label;
    }
  }
  return doc.body.innerHTML;
}

const VALID_TARGET_KINDS: readonly string[] = ['entry', 'task'];
/** Standard UUIDs and the 8-character prefix put in front of them on merge import. */
const LINK_ID_RE = /^([0-9a-z]{8}-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is this a plausible link target? The link events travel via
 * `document` and are thus reachable for any script in the WebView; the
 * handlers therefore check what they receive before they navigate or even write into
 * the entry. One check for all three events (navigate,
 * append, reveal) — before, only navigating had one, as a copy.
 * The same check applies to the link presets of custom blocks.
 */
export function isValidLinkTarget(target: { id?: unknown; entryType?: unknown } | null | undefined): boolean {
  if (!target) return false;
  return typeof target.id === 'string'
    && LINK_ID_RE.test(target.id)
    && VALID_TARGET_KINDS.includes(String(target.entryType).trim());
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface InternalLinkChip {
  id: string;
  /** The target kind — `entry` or `task`; an entry's kind is not stored. */
  entryType: LinkTargetKind;
  label: string;
  icon?: string | null;
  entry_number?: number | null;
}

/** The chip attributes of a link target — the same names as the node attributes
 *  of `InternalLinkExtension`, so also usable directly as `attrs`. `entryType`
 *  may be a display kind (journal, wiki, …); the chip stores the target kind. */
export function toInternalLinkChip(item: {
  id: string;
  entryType: ContentType | LinkTargetKind;
  label: string;
  icon?: string | null;
  entry_number?: number | null;
}): InternalLinkChip {
  return {
    id: item.id,
    entryType: linkTargetKindOf(item.entryType),
    label: item.label,
    icon: item.icon ?? null,
    entry_number: item.entry_number ?? null,
  };
}

/**
 * The chip as TipTap's `renderHTML` would write it. Empty attributes
 * are left out — `mergeAttributes` drops `null` too.
 */
export function internalLinkChipHtml(chip: InternalLinkChip): string {
  const attrs: Array<[string, string]> = [
    ['data-type', 'internalLink'],
    ['class', 'internal-link'],
    ['data-id', chip.id],
    ['data-entry-type', chip.entryType],
    ['data-label', chip.label],
  ];
  if (chip.icon) attrs.push(['data-icon', chip.icon]);
  if (chip.entry_number != null) attrs.push(['data-entry-number', String(chip.entry_number)]);

  const rendered = attrs.map(([k, v]) => `${k}="${escapeHtml(v)}"`).join(' ');
  return `<span ${rendered}>${escapeHtml(chip.label || chip.id)}</span>`;
}

export interface LinkBlockOptions {
  /** `false` omits the separator line — for the first block in a still
   *  empty entry, where there is nothing to separate (see `isBlankContent`). */
  separator?: boolean;
  /** Text after the chip, in the same paragraph. Carries the meditation duration from
   *  the replaced journal field ("(20 min)"), which has no link target. */
  suffix?: string;
}

/**
 * An appended link block: separator line, category as heading,
 * then the chip. The one definition of this block — `appendEntryLink` in the
 * text editor's commands, the migrations v36/v37 and the `.emerald` import all build
 * on it.
 */
export function internalLinkBlockHtml(
  chip: InternalLinkChip,
  categoryLabel: string,
  { separator = true, suffix }: LinkBlockOptions = {},
): string {
  const rule = separator ? '<hr>' : '';
  const heading = categoryLabel ? `<h3>${escapeHtml(categoryLabel)}</h3>` : '';
  const tail = suffix ? ` ${escapeHtml(suffix)}` : '';
  return `${rule}${heading}<p>${internalLinkChipHtml(chip)}${tail} </p>`;
}
