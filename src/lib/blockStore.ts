import type Database from './sqlite';
import { blockSectionHtml, parseBlocks, serializeBlocks } from './blocks/blockHtml';
import { blockRefs } from './blocks/blockRefs';
import { fromBlockRow, toBlockRow, type StoredBlockRow } from './blocks/blockRows';
import { positionsFor } from './blocks/position';
import { TEXT_BLOCK_TYPE, type BlockInstance } from './blocks/types';

/**
 * The blocks of entries and templates as rows (`blocks`, `block_refs`, since
 * v65) — reading, writing only what changed, and rebuilding from `content`.
 *
 * Until `content` goes (step 3 of the block rebuild), every write keeps the
 * two in step: the rows, their references and `content` = `serializeBlocks`
 * of the rows go into one `Database.batch`. The stores write through
 * `planBlockWrite`; a path that writes `content` with plain SQL rebuilds the
 * rows of what it touched (`rebuildOwnerStatements`), and every open fills in
 * owners without rows (`fillMissingBlockRows`).
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

const OWNER: Record<BlockOwnerKind, { column: 'entry_id' | 'template_id'; table: 'entries' | 'templates' }> = {
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

/** The content of an owner's blocks — what `content` holds until it goes. */
export function contentOf(blocks: readonly BlockInstance[]): string {
  return serializeBlocks([...blocks]);
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

/** Insert or update one block, then rewrite its references. */
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
  /** `content` as it follows from the blocks. */
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
 * Every row of the owner anew from `content`, which is normalised to what the
 * rows give (without touching `updated_at`) — for paths that wrote `content`
 * with plain SQL, the migration and imports, and for sync in the batch that writes `content`. The owner row must exist.
 */
export function rebuildOwnerStatements(
  owner: BlockOwner, content: string, now: string, { hasRows }: { hasRows: boolean },
): { statements: Statement[]; commit: () => void } {
  const { column, table } = OWNER[owner.kind];
  const blocks = blocksOfContent(content, idsOf(savedByOwner.get(ownerKey(owner))));
  const positions = positionsFor(new Map(), blocks.map((b) => b.id));
  const statements: Statement[] = hasRows ? [[`DELETE FROM blocks WHERE ${column} = $1`, [owner.id]]] : [];
  blocks.forEach((block, i) => statements.push(...blockStatements(owner, block, positions[i], now)));
  const normalized = contentOf(blocks);
  if (normalized !== content) statements.push([`UPDATE ${table} SET content = $1 WHERE id = $2`, [normalized, owner.id]]);
  return { statements, commit: () => remember(owner, blocks, positions) };
}

/** Owners per batch when rebuilding: one batch stays small, a crash loses at most this many. */
const OWNER_CHUNK = 50;

/**
 * Rebuilds the rows of these owners from their stored `content`, one batch per
 * chunk of owners. `hasRows: false` (the owners have none yet) leaves out the
 * delete. Every owner read is remembered as saved, an empty one too.
 */
async function rebuildChunked(db: Database, kind: BlockOwnerKind, ids: readonly string[], hasRows: boolean): Promise<void> {
  const { table } = OWNER[kind];
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += OWNER_CHUNK) {
    const chunk = ids.slice(i, i + OWNER_CHUNK);
    const rows = await db.select<{ id: string; content: string | null }[]>(
      `SELECT id, content FROM ${table} WHERE id IN (${placeholders(chunk.length)})`, [...chunk],
    );
    const plans = rows.map((r) => rebuildOwnerStatements({ kind, id: r.id }, r.content ?? '', now, { hasRows }));
    const statements = plans.flatMap((p) => p.statements);
    if (statements.length) await db.batch(statements);
    plans.forEach((p) => p.commit());
  }
}

/** Rebuilds the rows of these owners from their stored `content` — after a write with plain SQL. */
export async function rebuildOwners(db: Database, kind: BlockOwnerKind, ids: readonly string[]): Promise<void> {
  await rebuildChunked(db, kind, ids, true);
}

/**
 * Builds the rows of every entry and template that has none yet — the
 * migration v65, a fresh vault's seeds, and on every open whatever came in by
 * plain SQL (an import's working copy, the MCP seed). Owners with rows are
 * found through the index without reading their content; the rest is read in
 * chunks. Repeatable: an owner is done the moment its batch is.
 */
export async function fillMissingBlockRows(db: Database): Promise<void> {
  for (const kind of ['template', 'entry'] as const) {
    const { column, table } = OWNER[kind];
    const missing = await db.select<{ id: string }[]>(
      `SELECT id FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.${column} = t.id)`,
    );
    // An owner without content stays without rows; reading it is cheap, and it is remembered as empty.
    await rebuildChunked(db, kind, missing.map((r) => r.id), false);
  }
}

/** The owners whose rows do not give their `content` — `checkBlockRows` reports them, `reconcileBlockRows` rebuilds them. */
async function mismatchedOwners(db: Database, kind: BlockOwnerKind): Promise<string[]> {
  const { table } = OWNER[kind];
  const ids = (await db.select<{ id: string }[]>(`SELECT id FROM ${table}`)).map((r) => r.id);
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const contents = await db.select<{ id: string; content: string | null }[]>(
      `SELECT id, content FROM ${table} WHERE id IN (${placeholders(chunk.length)})`, chunk,
    );
    const { blocks } = await readBlocks(db, kind, chunk);
    for (const { id, content } of contents) {
      if (contentOf(blocks.get(id) ?? []) !== (content ?? '')) out.push(id);
    }
  }
  return out;
}

/** Diagnostic: entries and templates whose rows and `content` disagree. Writes nothing. */
export async function checkBlockRows(db: Database): Promise<{ entries: string[]; templates: string[] }> {
  return { entries: await mismatchedOwners(db, 'entry'), templates: await mismatchedOwners(db, 'template') };
}

/**
 * Rebuilds every owner whose rows and `content` disagree — at the end of an
 * import, in its working copy, where many paths have written `content` with
 * plain SQL. Reads the whole vault; not for the everyday path.
 */
export async function reconcileBlockRows(db: Database): Promise<void> {
  for (const kind of ['template', 'entry'] as const) {
    const ids = await mismatchedOwners(db, kind);
    if (ids.length) await rebuildOwners(db, kind, ids);
  }
}
