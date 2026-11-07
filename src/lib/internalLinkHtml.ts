import type { ContentType } from '../types';

/**
 * Reading and writing the stored HTML of an internal link chip —
 * deliberately without a DB import, so that the migration in `db.ts` can use it too,
 * without opening a cycle through `lib/links.ts` (which pulls in `getDb`).
 *
 * The markup has to match `InternalLinkExtension`: `parseHTML` recognizes the
 * chip by `span[data-type="internalLink"]`, the attributes by their
 * `data-*` names. If this deviates, TipTap reads the chip in as text.
 */

const SPAN_TAG_RE = /<span\b[^>]*>/gi;

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
  for (const match of html.matchAll(SPAN_TAG_RE)) {
    const tag = match[0];
    if (tagAttr(tag, 'data-type') !== 'internalLink') continue;
    const id = tagAttr(tag, 'data-id');
    if (!id) continue;
    out.push({ id, entryType: tagAttr(tag, 'data-entry-type') ?? 'wiki' });
  }
  return out;
}

const ENTRY_TYPE_ATTR_RE = /\bdata-entry-type=("[^"]*"|'[^']*')/i;

/**
 * Sets the type of all chips pointing at `id` to `entryType` — for an
 * entry that has changed its type (`lib/entryTypeChange.ts`). The ID
 * stays the same, so the one attribute is enough.
 *
 * Deliberately via the start tag like `extractInternalLinks` instead of via
 * `remapInternalLinks`: this runs over the stored content of the whole
 * vault, and a DOM pass would re-serialize every one of them — here only
 * the one attribute changes, everything else stays byte for byte.
 */
export function retypeInternalLinks(html: string, id: string, entryType: string): string {
  if (!html || !html.includes(id)) return html;
  return html.replace(SPAN_TAG_RE, (tag) => {
    if (tagAttr(tag, 'data-type') !== 'internalLink' || tagAttr(tag, 'data-id') !== id) return tag;
    const attr = `data-entry-type="${entryType}"`;
    return ENTRY_TYPE_ATTR_RE.test(tag) ? tag.replace(ENTRY_TYPE_ATTR_RE, attr) : tag.replace(/^<span\b/i, `<span ${attr}`);
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
  return !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
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
      entryType: span.getAttribute('data-entry-type') ?? 'wiki',
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

const VALID_ENTRY_TYPES: readonly string[] = ['journal', 'wiki', 'operation', 'task', 'altar'];
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
    && VALID_ENTRY_TYPES.includes(String(target.entryType).trim());
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
  entryType: ContentType;
  label: string;
  icon?: string | null;
  entry_number?: number | null;
}

/** The chip attributes of a link target — the same names as the node attributes
 *  of `InternalLinkExtension`, so also usable directly as `attrs`. */
export function toInternalLinkChip(item: {
  id: string;
  entryType: ContentType;
  label: string;
  icon?: string | null;
  entry_number?: number | null;
}): InternalLinkChip {
  return {
    id: item.id,
    entryType: item.entryType,
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

/**
 * The same block without a chip — for a replaced value whose target does not
 * (or no longer) exist: a set `is_bannung` without an article, say. Without this, migration
 * v37 would lose the information without replacement.
 */
export function plainBlockHtml(text: string, { separator = true }: LinkBlockOptions = {}): string {
  return `${separator ? '<hr>' : ''}<p>${escapeHtml(text)}</p>`;
}
