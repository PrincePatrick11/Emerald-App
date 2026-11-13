import type Database from './sqlite';
import { blockSectionHtml, parseBlocks, serializeBlocks } from './blocks/blockHtml';
import { blockRefs } from './blocks/blockRefs';
import { fromBlockRow, toBlockRow, type StoredBlockRow } from './blocks/blockRows';
import { isPositionKey, positionsFor } from './blocks/position';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './blocks/types';

/**
 * The blocks of entries and templates as rows (`blocks`, `block_refs`, since
 * v65) — reading, and writing only what changed. Since v66 the rows are the
 * only record: there is no `content` column any more. In memory the stores
 * still carry an owner's blocks as one string (`contentOf`, the block HTML of
 * `serializeBlocks`), the form `.emerald`, export and backup files hold too.
 *
 * A write that has a whole block stack as a string and no saved state to
 * compare with (sync, a seed, an import) replaces the owner's rows
 * (`replaceOwnerBlocks`). Tools for the old `content` column — migrations
 * and an import's working copy — are in `contentColumn.ts`.
 *
 * Free of `db.ts` (which imports this file for the migration) and of the DOM
 * (the schema harness runs it under Node).
 */

export type BlockOwnerKind = 'entry' | 'template';

export interface BlockOwner {
  kind: BlockOwnerKind;
  id: string;
}

export type Statement = readonly [query: string, values: readonly unknown[]];

/** Table and owner column per owner kind. */
export const OWNER: Record<BlockOwnerKind, { column: 'entry_id' | 'template_id'; table: 'entries' | 'templates' }> = {
  entry: { column: 'entry_id', table: 'entries' },
  template: { column: 'template_id', table: 'templates' },
};

/** The columns a block is read with. */
const ROW_COLUMNS = 'id, position, type, version, hidden, title, show_title, config, data, attrs, html';

/** Bound values per `IN (…)` list — far below SQLite's limit. */
const ID_CHUNK = 500;

/* ---------------- What was last saved ---------------- */

/** Per block: its position and its written form — what the next save compares against. */
type SavedBlocks = Map<string, { position: string; written: string }>;

const savedByOwner = new Map<string, SavedBlocks>();

const ownerKey = (owner: BlockOwner) => `${owner.kind}:${owner.id}`;

/** Forgets what was saved — a vault switch or a replaced database (`db.ts`). */
export function clearSavedBlocks(): void {
  savedByOwner.clear();
}

function remember(owner: BlockOwner, blocks: readonly BlockInstance[], positions: readonly string[]): void {
  savedByOwner.set(ownerKey(owner), new Map(blocks.map((b, i) => [b.id, { position: positions[i], written: blockSectionHtml(b) }])));
}

/* ---------------- Reading ---------------- */

type ReadRow = StoredBlockRow & { position: string; owner: string };

function placeholders(count: number, from = 1): string {
  return Array.from({ length: count }, (_, i) => `$${i + from}`).join(', ');
}

/** The blocks of these owners and their positions, in order — every owner in the result, one without rows with `[]`. */
async function readBlocks(
  db: Database, kind: BlockOwnerKind, ids: readonly string[],
): Promise<{ blocks: Map<string, BlockInstance[]>; positions: Map<string, string[]> }> {
  const { column } = OWNER[kind];
  const blocks = new Map<string, BlockInstance[]>(ids.map((id) => [id, []]));
  const positions = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const rows = await db.select<ReadRow[]>(
      `SELECT ${column} AS owner, ${ROW_COLUMNS} FROM blocks WHERE ${column} IN (${placeholders(chunk.length)}) ORDER BY ${column}, position`,
      [...chunk],
    );
    for (const row of rows) {
      blocks.get(row.owner)?.push(fromBlockRow(row));
      positions.get(row.owner)?.push(row.position);
    }
  }
  return { blocks, positions };
}

/**
 * Like `readBlocks` — what the stores load with — and remembers the blocks as
 * saved where nothing is remembered yet. A load runs outside the owner's write
 * queue: a save that committed while it read is newer than what it read, and
 * must not be overwritten by it.
 */
export async function loadBlocks(db: Database, kind: BlockOwnerKind, ids: readonly string[]): Promise<Map<string, BlockInstance[]>> {
  const { blocks, positions } = await readBlocks(db, kind, ids);
  for (const id of ids) {
    if (!savedByOwner.has(ownerKey({ kind, id }))) remember({ kind, id }, blocks.get(id)!, positions.get(id)!);
  }
  return blocks;
}

/** An owner's blocks as one string — the block HTML the stores and the files carry. */
export function contentOf(blocks: readonly BlockInstance[]): string {
  return serializeBlocks([...blocks]);
}

/** The block HTML of one owner from its rows, or `null` if the owner is gone. Remembers its blocks as saved, like `loadBlocks`. */
export async function readContent(db: Database, owner: BlockOwner): Promise<string | null> {
  const { table } = OWNER[owner.kind];
  const [row] = await db.select<{ id: string }[]>(`SELECT id FROM ${table} WHERE id = $1`, [owner.id]);
  if (!row) return null;
  return contentOf((await loadBlocks(db, owner.kind, [owner.id])).get(owner.id) ?? []);
}

/** The block HTML of many owners from their rows, by ID — every ID in the result, one without rows with `''`. Does not remember. */
export async function readContents(db: Database, kind: BlockOwnerKind, ids: readonly string[]): Promise<Map<string, string>> {
  const { blocks } = await readBlocks(db, kind, ids);
  return new Map([...blocks].map(([id, list]) => [id, contentOf(list)]));
}

/**
 * Rows of entries or templates with their block HTML as `content` — the form
 * backup files and sync carry (as the column did until v66). In place.
 */
export async function withContents<T extends Record<string, unknown>>(db: Database, kind: BlockOwnerKind, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const contents = await readContents(db, kind, rows.map((row) => String(row.id)));
  for (const row of rows) (row as Record<string, unknown>).content = contents.get(String(row.id)) ?? '';
  return rows;
}

/* ---------------- From content to blocks ---------------- */

function isPlainText(block: BlockInstance): boolean {
  return block.type === TEXT_BLOCK_TYPE && Object.keys(block.attrs).length === 0;
}

/**
 * The blocks of a content string. A single plain text block is written
 * without its section, so without its ID (`serializeBlocks`, rule 2); it keeps
 * the ID it was saved under, or every save of a one-text entry would replace its row.
 */
export function blocksOfContent(content: string, previousIds: readonly string[] | null): BlockInstance[] {
  const blocks = parseBlocks(content);
  if (blocks.length === 1 && isPlainText(blocks[0]) && previousIds?.length === 1) {
    blocks[0] = { ...blocks[0], id: previousIds[0] };
  }
  return blocks;
}

/** The IDs of saved blocks, in order (`remember` keeps them in block order). */
function idsOf(saved: SavedBlocks | undefined): string[] | null {
  return saved ? [...saved.keys()] : null;
}

async function savedBlocksOf(db: Database, owner: BlockOwner): Promise<SavedBlocks> {
  const known = savedByOwner.get(ownerKey(owner));
  if (known) return known;
  await loadBlocks(db, owner.kind, [owner.id]);
  return savedByOwner.get(ownerKey(owner))!;
}

/**
 * `planBlockWrite` for a content string — what every writer of `content`
 * uses: its blocks, a single plain text block under the ID it was saved under.
 */
export async function planContentWrite(db: Database, owner: BlockOwner, content: string, now: string): Promise<BlockWrite> {
  const saved = await savedBlocksOf(db, owner);
  return planBlockWrite(db, owner, blocksOfContent(content, idsOf(saved)), now);
}

/* ---------------- Writing ---------------- */

/** References per INSERT: three bound values each, far below SQLite's limit. */
const REF_CHUNK = 100;

/** Insert or update one block, then rewrite its references. `now` becomes its `updated_at`. */
function blockStatements(owner: BlockOwner, block: BlockInstance, position: string, now: string): Statement[] {
  const { column } = OWNER[owner.kind];
  const row = toBlockRow(block);
  const statements: Statement[] = [[
    `INSERT INTO blocks (id, ${column}, position, type, version, hidden, title, show_title, config, data, attrs, html, text, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (${column}, id) DO UPDATE SET
       position = excluded.position, type = excluded.type, version = excluded.version, hidden = excluded.hidden,
       title = excluded.title, show_title = excluded.show_title, config = excluded.config, data = excluded.data,
       attrs = excluded.attrs, html = excluded.html, text = excluded.text, updated_at = excluded.updated_at`,
    [row.id, owner.id, position, row.type, row.version, row.hidden, row.title, row.show_title, row.config, row.data,
      row.attrs, row.html, row.text, now],
  ], [
    `DELETE FROM block_refs WHERE block_row = (SELECT row_id FROM blocks WHERE ${column} = $1 AND id = $2)`,
    [owner.id, block.id],
  ]];
  const refs = blockRefs(block);
  for (let i = 0; i < refs.length; i += REF_CHUNK) {
    const chunk = refs.slice(i, i + REF_CHUNK);
    const values = chunk.map((_, j) => `($${3 * j + 1}, $${3 * j + 2}, $${3 * j + 3})`).join(', ');
    const n = 3 * chunk.length;
    statements.push([
      `INSERT OR IGNORE INTO block_refs (block_row, target_kind, target, role)
       SELECT b.row_id, v.column1, v.column2, v.column3 FROM (VALUES ${values}) AS v, blocks b
        WHERE b.${column} = $${n + 1} AND b.id = $${n + 2}`,
      [...chunk.flatMap((r) => [r.kind, r.target, r.role]), owner.id, block.id],
    ]);
  }
  return statements;
}

function deleteStatements(owner: BlockOwner, ids: readonly string[]): Statement[] {
  const { column } = OWNER[owner.kind];
  const out: Statement[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push([`DELETE FROM blocks WHERE ${column} = $1 AND id IN (${placeholders(chunk.length, 2)})`, [owner.id, ...chunk]]);
  }
  return out;
}

export interface BlockWrite {
  /** The statements for the rows; the caller adds its own row's and runs them in one batch. */
  statements: Statement[];
  /** The block HTML as it follows from the blocks — what the store keeps in memory. */
  content: string;
  /** How many blocks are written (inserted, changed or moved) or removed. */
  changed: number;
  /** After the batch went through: remember the blocks as saved. */
  commit: () => void;
}

/**
 * What saving `blocks` as the owner's blocks takes: only blocks that are new,
 * changed or moved are written (a move writes the position alone), removed
 * ones are deleted, and each written block's references are rewritten.
 */
export async function planBlockWrite(
  db: Database, owner: BlockOwner, blocks: readonly BlockInstance[], now: string,
): Promise<BlockWrite> {
  const saved = await savedBlocksOf(db, owner);
  const positions = positionsFor(new Map([...saved].map(([id, s]) => [id, s.position])), blocks.map((b) => b.id));
  const { column } = OWNER[owner.kind];
  const statements: Statement[] = [];
  let changed = 0;
  blocks.forEach((block, i) => {
    const before = saved.get(block.id);
    const written = blockSectionHtml(block);
    if (before?.written === written) {
      if (before.position === positions[i]) return;
      statements.push([`UPDATE blocks SET position = $1 WHERE ${column} = $2 AND id = $3`, [positions[i], owner.id, block.id]]);
    } else {
      statements.push(...blockStatements(owner, block, positions[i], now));
    }
    changed++;
  });
  const kept = new Set(blocks.map((b) => b.id));
  const removed = [...saved.keys()].filter((id) => !kept.has(id));
  statements.push(...deleteStatements(owner, removed));
  changed += removed.length;
  return {
    statements,
    content: contentOf(blocks),
    changed,
    commit: () => remember(owner, blocks, positions),
  };
}

/**
 * Every row of the owner anew from a block stack given as one string — for
 * sync, seeds and imports, which have no saved state to compare with. The
 * owner row must exist (or be inserted before in the same batch). `hasRows:
 * false` leaves out the delete, for an owner that is new. `content` is the
 * string as the rows give it back.
 */
export function replaceOwnerBlocks(
  owner: BlockOwner, html: string, now: string, { hasRows }: { hasRows: boolean },
): { statements: Statement[]; content: string; commit: () => void } {
  const { column } = OWNER[owner.kind];
  const blocks = blocksOfContent(html, idsOf(savedByOwner.get(ownerKey(owner))));
  const positions = positionsFor(new Map(), blocks.map((b) => b.id));
  const statements: Statement[] = hasRows ? [[`DELETE FROM blocks WHERE ${column} = $1`, [owner.id]]] : [];
  blocks.forEach((block, i) => statements.push(...blockStatements(owner, block, positions[i], now)));
  return { statements, content: contentOf(blocks), commit: () => remember(owner, blocks, positions) };
}

/** A block as a file brings it along: with the position and the time it was written. */
export interface CopiedBlock {
  block: BlockInstance;
  /** As the file gives it; `null` when it is no string. */
  position: string | null;
  updatedAt: string | null;
}

/**
 * The rows of a new owner as copies of the given blocks — a backup import,
 * which carries the rows of `blocks` themselves. Each block keeps its
 * `updated_at` (else `now`) and, when every position is a valid key and no two
 * are equal, its position, in position order; otherwise the blocks keep the
 * given order under fresh, evenly spread keys. Its references are written anew
 * from the block (`block_refs` does not travel). The first block of an ID
 * wins. The owner row must exist; it has no rows yet.
 */
export function copyBlockStatements(owner: BlockOwner, copies: readonly CopiedBlock[], now: string): Statement[] {
  const byId = new Map<string, CopiedBlock>();
  for (const copy of copies) if (!byId.has(copy.block.id)) byId.set(copy.block.id, copy);
  let ordered = [...byId.values()];
  const keyed = ordered.every((c) => isPositionKey(c.position)) && new Set(ordered.map((c) => c.position)).size === ordered.length;
  if (keyed) ordered = ordered.sort((a, b) => (a.position! < b.position! ? -1 : 1));
  const positions = keyed ? ordered.map((c) => c.position!) : positionsFor(new Map(), ordered.map((c) => c.block.id));
  return ordered.flatMap((c, i) => blockStatements(owner, c.block, positions[i], c.updatedAt ?? now));
}
