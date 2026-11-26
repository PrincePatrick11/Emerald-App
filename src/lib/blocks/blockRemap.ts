import { rewriteInternalLinkIds } from '../internalLinkHtml';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { blockTagsOf } from './blockRefs';
import { BLOCK_ATTR, type BlockInstance } from './types';

/**
 * A block brought along by an import, pointed at the vault it arrives in:
 * the pictures under the names they were stored under here, and — on a merge,
 * where the entries arrive under fresh IDs — every link at the new ID.
 *
 * Pictures are named after their content (a hash), so a name is replaced
 * wherever it stands: in the markup and in every attribute, the JSON of a
 * drawing's layers, a canvas's scene and a copy's image prefills included
 * (as `remapPaths` in `dbBackup.ts` does for the other columns).
 *
 * Links stand in two forms: as chips in the markup (`data-id`), and as plain
 * IDs in the JSON of config and data (a copy's link prefill). The JSON is
 * walked, and only a string that IS a known ID is replaced, so text that
 * merely contains one stays.
 *
 * Tags a block gives its entry (`properties.tags`) are named by ID in its
 * JSON; `tags` points them at the tags here — only the IDs the block's type
 * says it gives, so no other value that happens to look like one changes.
 *
 * Pure and DOM-free: the schema harness runs the import under Node.
 */

export interface BlockRemap {
  /** Stored name in the file → stored name here. */
  images?: ReadonlyMap<string, string>;
  /** Entry or task ID in the file → ID here; `undefined` keeps it. */
  id?: (id: string) => string | undefined;
  /** Tag ID in the file → the tag here, for the tags the block gives; `undefined` keeps it. */
  tags?: (id: string) => string | undefined;
}

const patterns = new WeakMap<ReadonlyMap<string, string>, RegExp | null>();

/** One alternation of the names that change, longest first, so a name never matches inside a longer one. */
function patternOf(names: ReadonlyMap<string, string>): RegExp | null {
  if (patterns.has(names)) return patterns.get(names)!;
  const keys = [...names].filter(([from, to]) => from && from !== to).map(([from]) => from).sort((a, b) => b.length - a.length);
  const re = keys.length ? new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  patterns.set(names, re);
  return re;
}

/**
 * Every name of `names` in `text` replaced by its new one, in a single pass:
 * a name just written is never matched again, so a crafted file with short
 * keys cannot make the text grow with every key (`remapPaths` in `dbBackup.ts`
 * uses it too). An empty key is ignored. The pattern is cached per map: the map must not change after its first use.
 */
export function renameAll(text: string, names: ReadonlyMap<string, string>): string {
  const re = patternOf(names);
  return re ? text.replace(re, (match) => names.get(match) ?? match) : text;
}

function remapIdsDeep(value: unknown, id: (id: string) => string | undefined): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const next = id(value);
    return next === undefined || next === value ? { value, changed: false } : { value: next, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = remapIdsDeep(v, id);
      changed ||= r.changed;
      return r.value;
    });
    return { value: changed ? out : value, changed };
  }
  if (typeof value === 'object' && value !== null) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = remapIdsDeep(v, id);
      changed ||= r.changed;
      out[k] = r.value;
    }
    return { value: changed ? out : value, changed };
  }
  return { value, changed: false };
}

/** The IDs in a JSON attribute; unreadable JSON stays as it is. */
function remapJsonAttr(raw: string, id: (id: string) => string | undefined): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  const r = remapIdsDeep(parsed, id);
  return r.changed ? JSON.stringify(r.value) : raw;
}

const JSON_ATTRS: readonly string[] = [BLOCK_ATTR.config, BLOCK_ATTR.data];

export function remapBlock(block: BlockInstance, { images, id, tags }: BlockRemap): BlockInstance {
  // Read before anything changes: the type names its tags in the block as it came.
  const given = tags ? new Set(blockTagsOf([block])) : null;
  let html = block.html;
  const attrs: Record<string, string> = { ...block.attrs };
  if (images?.size) {
    html = renameAll(html, images);
    for (const [name, value] of Object.entries(attrs)) attrs[name] = renameAll(value, images);
  }
  if (id) {
    html = rewriteInternalLinkIds(html, id);
    for (const name of JSON_ATTRS) {
      if (attrs[name] !== undefined) attrs[name] = remapJsonAttr(attrs[name], id);
    }
  }
  if (tags && given?.size) {
    const tag = (value: string) => (given.has(value) ? tags(value) : undefined);
    for (const name of JSON_ATTRS) {
      if (attrs[name] !== undefined) attrs[name] = remapJsonAttr(attrs[name], tag);
    }
  }
  return { ...block, html, attrs };
}

/** A block stack with the tags its blocks give pointed at other tags (`remapBlock`'s `tags`); the same string if none changes. */
export function retagContent(content: string, tags: (id: string) => string | undefined): string {
  if (!content) return content;
  const blocks = parseBlocks(content);
  const next = blocks.map((block) => remapBlock(block, { tags }));
  const changed = next.some((block, i) => JSON.stringify(block.attrs) !== JSON.stringify(blocks[i].attrs));
  return changed ? serializeBlocks(next) : content;
}
