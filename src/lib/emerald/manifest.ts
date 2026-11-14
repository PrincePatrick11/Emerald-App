import { parseBlocks, serializeBlocks } from '../blocks/blockHtml';
import { fromBlockRow, toBlockRow, type BlockRowValues } from '../blocks/blockRows';

/**
 * The manifest of a `.emerald` file (`manifest.json` in the archive that
 * `src-tauri/src/emerald_file.rs` writes and reads) and the pure steps around
 * it: blocks to rows and back, checking a foreign manifest, renaming stored
 * pictures, re-linking entries of the same file.
 *
 * Pure and free of the DOM: `scripts/check-blocks.mjs` runs it under Node.
 * What needs the stores, the dialogs or IPC is in `lib/emeraldFormat.ts`.
 */

/**
 * '6' is the archive. Every version before was one JSON file ('1' to '5');
 * those are refused before a manifest is read (`EMERALD_OLD_FORMAT`).
 */
export const EMERALD_FORMAT_VERSION = 6;

/**
 * What happens to the pictures of an item on export — the names of the export
 * menu of 0.1.3.7: as they are (`none`), downscaled and re-encoded
 * (`balanced`, `strong`), or left out (`placeholder`: the import shows a
 * placeholder picture in their place).
 */
export type ImageMode = 'none' | 'balanced' | 'strong' | 'placeholder';

/** Gentlest first: `gentlestImageMode` relies on the order. `none` means no compression, not "no pictures" (that is `placeholder`). */
export const IMAGE_MODES: readonly ImageMode[] = ['none', 'balanced', 'strong', 'placeholder'];

/** A block as a row of `blocks`, without owner, position and search text: the order of the list is the order of the blocks. */
export type ManifestBlock = Omit<BlockRowValues, 'text'>;

export interface ManifestCategory {
  /** The stored name — a built-in's is the same in every vault, its label is not. */
  name: string;
  /** The category's emoji. */
  icon: string;
  builtin: boolean;
}

export interface ManifestEntry {
  kind: 'entry';
  /** The ID in the exporting vault: what links of the same file point at. */
  id: string;
  title: string;
  /** For information only — the importing vault numbers on its own. */
  number: number | null;
  createdAt: string;
  updatedAt: string;
  /** An emoji, or the stored name of a file under `icons/`. */
  icon: string;
  /** The stored name of a picture under `images/`. */
  cover: string | null;
  category: ManifestCategory | null;
  tags: string[];
  blocks: ManifestBlock[];
}

export interface ManifestTemplate {
  kind: 'template';
  id: string;
  name: string;
  /** The title new entries from it get. */
  title: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  tags: string[];
  blocks: ManifestBlock[];
}

export type ManifestItem = ManifestEntry | ManifestTemplate;

/** A link target of the content: what the import looks for when the ID is not in this vault and not in the file. */
export interface ManifestLink {
  id: string;
  kind: 'entry' | 'task';
  title: string;
}

export interface EmeraldManifest {
  format: 'emerald';
  version: typeof EMERALD_FORMAT_VERSION;
  exportedAt: string;
  items: ManifestItem[];
  links: ManifestLink[];
  /** Pictures the content names that were left out on purpose (`placeholder`). */
  omittedImages: string[];
}

/* ---------------- Blocks ---------------- */

export function contentToBlocks(content: string): ManifestBlock[] {
  return parseBlocks(content).map((block) => {
    const { text: _text, ...row } = toBlockRow(block);
    return row;
  });
}

export function blocksToContent(blocks: readonly ManifestBlock[]): string {
  return serializeBlocks(blocks.map(fromBlockRow));
}

/* ---------------- Reading a foreign manifest ---------------- */

/** Why a manifest is not read: from an older or a newer app, or no manifest at all. */
export type ManifestProblem = 'oldVersion' | 'newVersion' | 'unsupported' | 'tooLarge';

/**
 * How many items, blocks and links a file may bring. Rust bounds the bytes
 * (and checks the item count before it stores any picture); these bound what
 * the bytes turn into — every item is a write of its own, so a crafted
 * manifest of tiny items could otherwise keep the app busy for hours.
 */
export const MANIFEST_LIMITS = { items: 1000, blocks: 50_000, links: 50_000 } as const;

/** What `generateId` makes. An entry's ID in a file must be one: re-linking replaces it wherever it stands. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** A block row from the file — `null` for one without ID or type; the other columns only as their own types. */
function readBlock(raw: unknown): ManifestBlock | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.type !== 'string' || !raw.type) return null;
  const version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 0 ? raw.version : null;
  return {
    id: raw.id,
    type: raw.type,
    version,
    hidden: raw.hidden === 1 ? 1 : 0,
    title: textOrNull(raw.title),
    show_title: raw.show_title === 0 || raw.show_title === 1 ? raw.show_title : null,
    config: textOrNull(raw.config),
    data: textOrNull(raw.data),
    attrs: typeof raw.attrs === 'string' ? raw.attrs : '{}',
    html: text(raw.html),
  };
}

function readBlocks(raw: unknown): ManifestBlock[] {
  return Array.isArray(raw) ? raw.map(readBlock).filter((b): b is ManifestBlock => b !== null) : [];
}

function readItem(raw: unknown): ManifestItem | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const common = {
    id: raw.id,
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
    icon: text(raw.icon),
    tags: strings(raw.tags),
    blocks: readBlocks(raw.blocks),
  };
  if (raw.kind === 'template') {
    return { kind: 'template', ...common, name: text(raw.name), title: text(raw.title) };
  }
  if (raw.kind !== 'entry' || !isUuid(raw.id)) return null;
  const category = isObject(raw.category) && typeof raw.category.name === 'string' && raw.category.name.trim()
    ? { name: raw.category.name, icon: text(raw.category.icon), builtin: raw.category.builtin === true }
    : null;
  return {
    kind: 'entry',
    ...common,
    title: text(raw.title),
    number: typeof raw.number === 'number' ? raw.number : null,
    cover: textOrNull(raw.cover),
    category,
  };
}

/**
 * The manifest of a file, checked field by field — the file is foreign. An
 * item it cannot read is dropped; a manifest of another version, or without
 * a single readable item, is a problem.
 */
export function parseManifest(json: string): EmeraldManifest | ManifestProblem {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return 'unsupported';
  }
  if (!isObject(raw) || raw.format !== 'emerald') return 'unsupported';
  if (raw.version !== EMERALD_FORMAT_VERSION) {
    if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) return 'unsupported';
    return raw.version < EMERALD_FORMAT_VERSION ? 'oldVersion' : 'newVersion';
  }
  if ((Array.isArray(raw.items) && raw.items.length > MANIFEST_LIMITS.items)
    || (Array.isArray(raw.links) && raw.links.length > MANIFEST_LIMITS.links)) return 'tooLarge';
  // An ID twice would create an entry nothing ever fills: the first one stays.
  const seen = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items.map(readItem) : [])
    .filter((i): i is ManifestItem => i !== null && !seen.has(i.id) && Boolean(seen.add(i.id)));
  if (items.length === 0) return 'unsupported';
  if (items.reduce((n, item) => n + item.blocks.length, 0) > MANIFEST_LIMITS.blocks) return 'tooLarge';
  const links = Array.isArray(raw.links)
    ? raw.links.flatMap((l): ManifestLink[] => (isObject(l) && typeof l.id === 'string' && l.id
      ? [{ id: l.id, kind: l.kind === 'task' ? 'task' : 'entry', title: text(l.title) }]
      : []))
    : [];
  return {
    format: 'emerald',
    version: EMERALD_FORMAT_VERSION,
    exportedAt: text(raw.exportedAt),
    items,
    links,
    omittedImages: strings(raw.omittedImages),
  };
}

/* ---------------- Rewriting the content ---------------- */

const STORED_NAME_RE = /\b([0-9a-f]{64})\.(?:png|jpe?g|gif|webp|svg)\b/g;

/** The hash part of a stored name — what the archive's pictures are matched by. */
export function storedNameStem(name: string): string {
  return name.replace(/\.[a-z]+$/, '');
}

/**
 * Renames stored pictures wherever they stand — in the markup, in a canvas's
 * scene JSON, in a field block's slot — by the hash part of their name
 * (`byStem`: stem → this vault's stored name). A stored name is a hash and
 * stands for nothing else; a picture compressed on export travels under
 * the same hash with the extension of its new type.
 */
export function renameStoredFiles(content: string, byStem: ReadonlyMap<string, string>): string {
  if (byStem.size === 0) return content;
  return content.replace(STORED_NAME_RE, (whole, stem: string) => byStem.get(stem) ?? whole);
}

/**
 * Points every reference to an item of the same file at the item as it was
 * created here (`idMap`: ID in the file → new ID) — link chips and the link
 * slots of field blocks alike. Entry IDs are UUIDs (`parseManifest` takes no
 * other) and stand for nothing else; one pass, whatever the number of items.
 */
export function relinkWithinFile(content: string, idMap: ReadonlyMap<string, string>): string {
  if (idMap.size === 0) return content;
  return content.replace(UUID_RE, (id) => idMap.get(id) ?? id);
}

/** The picture each mode keeps: the gentlest one any item asks for wins. */
export function gentlestImageMode(a: ImageMode, b: ImageMode): ImageMode {
  return IMAGE_MODES.indexOf(a) <= IMAGE_MODES.indexOf(b) ? a : b;
}
