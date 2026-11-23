import { parseBlocks, serializeBlocks } from '../blocks/blockHtml';
import { asString, isRecord, ITEM_ID_RE, LEGACY_MERGE_PREFIX, UUID_PATTERN } from '../helpers';
import { fromBlockRow, toBlockRow, type BlockRowValues } from '../blocks/blockRows';
import { FIELDS_BLOCK_TYPE, parseFields } from '../blocks/fields';

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
 * '7' is the archive behind a header that names its kind and protection, the
 * manifest deflated, starter categories with their ID, custom blocks along,
 * and the vault's content as a kind of its own. Every version before ('6',
 * the bare archive; '1' to '5', one JSON file) is refused before a manifest is
 * read (`EMERALD_OLD_FORMAT`) — 0.2.0 reads only what it writes.
 */
export const EMERALD_FORMAT_VERSION = 7;

/**
 * What a file holds, said in its header and again in the manifest: entries
 * and templates for another vault (`.emerald`), or a vault's content
 * (`.vault.emerald`, built by `lib/dbBackup.ts`).
 */
export type EmeraldKind = 'items' | 'vault';

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

/**
 * The category of an entry as it was at export. The import finds a built-in
 * or starter category by its ID, which is the same in every vault — renamed
 * or named in another language, it is still the same; every other category
 * by the name it had, created anew if there is none of that name.
 */
export interface ManifestCategory {
  /** The ID in the exporting vault. */
  id: string;
  /** The name as it was shown — a built-in's label in the exporting app's language. */
  name: string;
  /** The category's emoji. */
  icon: string;
  builtin: boolean;
}

/**
 * A custom block definition (table `block_definitions`) that a copy in the
 * file came from (`FieldsModel.definition`) — the row as the vault holds it,
 * checked on import like a backup's (`insertBlockDefinitions`).
 */
export type ManifestBlockDefinition = Record<string, unknown> & { id: string };

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

/**
 * The details of a picture taken into "Images" (table `images`) that travels
 * in the file: by its stored name in the archive, with its name, note and the
 * names of its tags — tags go by name, as an item's do; their colour stays.
 */
export interface ManifestImage {
  file: string;
  name: string;
  note: string;
  tags: string[];
}

export interface EmeraldManifest {
  format: 'emerald';
  version: typeof EMERALD_FORMAT_VERSION;
  kind: 'items';
  exportedAt: string;
  items: ManifestItem[];
  links: ManifestLink[];
  /** Pictures the content names that were left out on purpose (`placeholder`). */
  omittedImages: string[];
  /** The custom blocks the items' copies came from — empty when the export left them out. */
  blockDefinitions: ManifestBlockDefinition[];
  /** The details of the file's pictures that are in "Images" here — not of left-out ones. */
  images: ManifestImage[];
}

/**
 * The manifest of a `.vault.emerald`: the vault's content as `lib/dbBackup.ts`
 * builds and reads it (`VaultContent`). Only the frame is checked here; the
 * rows are checked where they are inserted, as foreign as anything in a file.
 */
export interface EmeraldVaultManifest {
  format: 'emerald';
  version: typeof EMERALD_FORMAT_VERSION;
  kind: 'vault';
  exportedAt: string;
  filters: unknown;
  data: Record<string, unknown>;
  settings?: unknown;
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

/* ---------------- Categories and custom blocks ---------------- */

/** An entry's category as the file carries it: its ID, and the name shown in the exporting app right now. */
export function manifestCategoryOf(
  category: { id: string; emoji: string; is_builtin: number | boolean },
  shownName: string,
): ManifestCategory {
  return { id: category.id, name: shownName, icon: category.emoji, builtin: Boolean(category.is_builtin) };
}

/** A category row the import resolves like a backup's (`resolveImportedCategories`). */
export interface CategoryImportRow {
  id: string;
  name: string;
  emoji: string;
  is_builtin: number;
  deleted_at: null;
}

/** The categories of a file's entries, once each, as rows for `resolveImportedCategories`. */
export function categoryRowsOf(items: readonly ManifestItem[], emojiOf: (icon: string) => string): CategoryImportRow[] {
  const rows = new Map<string, CategoryImportRow>();
  for (const item of items) {
    if (item.kind !== 'entry' || !item.category || rows.has(item.category.id)) continue;
    const { id, name, icon, builtin } = item.category;
    rows.set(id, { id, name: name.trim(), emoji: emojiOf(icon), is_builtin: builtin ? 1 : 0, deleted_at: null });
  }
  return [...rows.values()];
}

/** The custom block definitions the copies in the contents came from, by their quiet note (`FieldsModel.definition`). */
export function usedDefinitionIds(contents: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const content of contents) {
    for (const block of parseBlocks(content)) {
      if (block.type !== FIELDS_BLOCK_TYPE) continue;
      const { definition } = parseFields(block);
      if (definition) ids.add(definition);
    }
  }
  return [...ids];
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
// `images`, `imageTags`, `imageTagName`: a picture's details — how many, how
// many tags each, how long a tag name (as the backup's `TAG_NAME_MAX`, but a
// longer one is dropped, not cut). `items` is mirrored in Rust (`check:schema`).
export const MANIFEST_LIMITS = { items: 1000, blocks: 50_000, links: 50_000, images: 50_000, imageTags: 100, imageTagName: 100 } as const;

/**
 * An entry's ID in a file must be a UUID, perhaps with the prefix an older
 * merge import put in front (`ITEM_ID_RE`): re-linking replaces it wherever it
 * stands. `ENTRY_ID_IN_TEXT_RE` finds them in content: a prefix counts only
 * at the start of a word, so none is cut out of a longer run of characters;
 * the UUID itself needs no boundary, on purpose (it is unambiguous).
 */
const ENTRY_ID_IN_TEXT_RE = new RegExp(`(?:(?<![0-9a-z])${LEGACY_MERGE_PREFIX})?${UUID_PATTERN}`, 'gi');
const isEntryId = (v: string) => ITEM_ID_RE.test(v);

/** A category's or definition's ID from a file: harmless characters only, as `isDefinitionId`. */
const isRowId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** A block row from the file — `null` for one without ID or type; the other columns only as their own types. */
function readBlock(raw: unknown): ManifestBlock | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.type !== 'string' || !raw.type) return null;
  const version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version > 0 ? raw.version : null;
  return {
    id: raw.id,
    type: raw.type,
    version,
    hidden: raw.hidden === 1 ? 1 : 0,
    title: asString(raw.title),
    show_title: raw.show_title === 0 || raw.show_title === 1 ? raw.show_title : null,
    config: asString(raw.config),
    data: asString(raw.data),
    attrs: typeof raw.attrs === 'string' ? raw.attrs : '{}',
    html: text(raw.html),
  };
}

function readBlocks(raw: unknown): ManifestBlock[] {
  return Array.isArray(raw) ? raw.map(readBlock).filter((b): b is ManifestBlock => b !== null) : [];
}

function readItem(raw: unknown): ManifestItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
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
  if (raw.kind !== 'entry' || !isEntryId(raw.id)) return null;
  const category = isRecord(raw.category) && typeof raw.category.name === 'string' && raw.category.name.trim()
    && isRowId(raw.category.id)
    ? { id: raw.category.id, name: raw.category.name, icon: text(raw.category.icon), builtin: raw.category.builtin === true }
    : null;
  return {
    kind: 'entry',
    ...common,
    title: text(raw.title),
    number: typeof raw.number === 'number' ? raw.number : null,
    cover: asString(raw.cover),
    category,
  };
}

/** The frame every manifest shares: JSON, the format, this version, the kind. */
function readFrame(json: string, kind: EmeraldKind): Record<string, unknown> | ManifestProblem {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return 'unsupported';
  }
  if (!isRecord(raw) || raw.format !== 'emerald') return 'unsupported';
  if (raw.version !== EMERALD_FORMAT_VERSION) {
    if (typeof raw.version !== 'number' || !Number.isInteger(raw.version)) return 'unsupported';
    return raw.version < EMERALD_FORMAT_VERSION ? 'oldVersion' : 'newVersion';
  }
  return raw.kind === kind ? raw : 'unsupported';
}

/** The manifest of a `.vault.emerald`, its frame checked. */
export function parseVaultManifest(json: string): EmeraldVaultManifest | ManifestProblem {
  const raw = readFrame(json, 'vault');
  if (typeof raw === 'string') return raw;
  if (!isRecord(raw.data)) return 'unsupported';
  return {
    format: 'emerald',
    version: EMERALD_FORMAT_VERSION,
    kind: 'vault',
    exportedAt: text(raw.exportedAt),
    filters: raw.filters,
    data: raw.data,
    ...(raw.settings !== undefined && { settings: raw.settings }),
  };
}

/**
 * The manifest of a file, checked field by field — the file is foreign. An
 * item it cannot read is dropped; a manifest of another version, or without
 * a single readable item, is a problem.
 */
export function parseManifest(json: string): EmeraldManifest | ManifestProblem {
  const raw = readFrame(json, 'items');
  if (typeof raw === 'string') return raw;
  if ((Array.isArray(raw.blockDefinitions) && raw.blockDefinitions.length > MANIFEST_LIMITS.items)
    || (Array.isArray(raw.items) && raw.items.length > MANIFEST_LIMITS.items)
    || (Array.isArray(raw.links) && raw.links.length > MANIFEST_LIMITS.links)
    || (Array.isArray(raw.images) && raw.images.length > MANIFEST_LIMITS.images)) return 'tooLarge';
  // An ID twice would create an entry nothing ever fills: the first one stays.
  const seen = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items.map(readItem) : [])
    .filter((i): i is ManifestItem => i !== null && !seen.has(i.id) && Boolean(seen.add(i.id)));
  if (items.length === 0) return 'unsupported';
  if (items.reduce((n, item) => n + item.blocks.length, 0) > MANIFEST_LIMITS.blocks) return 'tooLarge';
  const links = Array.isArray(raw.links)
    ? raw.links.flatMap((l): ManifestLink[] => (isRecord(l) && typeof l.id === 'string' && l.id
      ? [{ id: l.id, kind: l.kind === 'task' ? 'task' : 'entry', title: text(l.title) }]
      : []))
    : [];
  const blockDefinitions = Array.isArray(raw.blockDefinitions)
    ? raw.blockDefinitions.filter((d): d is ManifestBlockDefinition => isRecord(d) && isRowId(d.id))
    : [];
  const images = Array.isArray(raw.images) ? raw.images.flatMap(readImage) : [];
  return {
    format: 'emerald',
    version: EMERALD_FORMAT_VERSION,
    kind: 'items',
    exportedAt: text(raw.exportedAt),
    items,
    links,
    omittedImages: strings(raw.omittedImages),
    blockDefinitions,
    images,
  };
}

/**
 * A picture's details from the file — none without a stored name. Tag names
 * trimmed, empty and overlong ones dropped, at most `MANIFEST_LIMITS.imageTags`:
 * each new one is a tag created on import.
 */
function readImage(raw: unknown): ManifestImage[] {
  if (!isRecord(raw) || typeof raw.file !== 'string' || !STORED_NAME_ONLY_RE.test(raw.file)) return [];
  const names = strings(raw.tags).map((t) => t.trim()).filter((t) => t && t.length <= MANIFEST_LIMITS.imageTagName);
  const tags = [...new Set(names)].slice(0, MANIFEST_LIMITS.imageTags);
  return [{ file: raw.file, name: text(raw.name).trim(), note: text(raw.note), tags }];
}

/* ---------------- Rewriting the content ---------------- */

/** A stored picture's name: its hash, then its type. */
const STORED_NAME = String.raw`([0-9a-f]{64})\.(?:png|jpe?g|gif|webp|svg)`;
const STORED_NAME_RE = new RegExp(String.raw`\b${STORED_NAME}\b`, 'g');
const STORED_NAME_ONLY_RE = new RegExp(`^${STORED_NAME}$`);

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
 * slots of field blocks alike. Entry IDs are UUIDs, perhaps prefixed
 * (`parseManifest` takes no other), and stand for nothing else; one pass,
 * whatever the number of items. An ID is replaced whole or not at all: a
 * link to an older merge's copy that is not in the file keeps pointing at
 * that copy, even when its original is.
 */
export function relinkWithinFile(content: string, idMap: ReadonlyMap<string, string>): string {
  if (idMap.size === 0) return content;
  return content.replace(ENTRY_ID_IN_TEXT_RE, (id) => idMap.get(id) ?? id);
}

/** The picture each mode keeps: the gentlest one any item asks for wins. */
export function gentlestImageMode(a: ImageMode, b: ImageMode): ImageMode {
  return IMAGE_MODES.indexOf(a) <= IMAGE_MODES.indexOf(b) ? a : b;
}
