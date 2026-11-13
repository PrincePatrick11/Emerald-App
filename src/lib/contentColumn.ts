import type Database from './sqlite';
import { ID_CHUNK, OWNER, placeholders, readContents, replaceOwnerBlocks, type BlockOwner, type BlockOwnerKind, type Statement } from './blockStore';

/**
 * The old `content` column of `entries` and `templates` — the block stack as
 * one HTML string, the only record of the blocks up to v64, written along
 * with the rows in v65 and dropped in v66.
 *
 * Only these places still meet it:
 * - the migrations v62–v64 (`altarLinkStatements` in `migrateAltars.ts`,
 *   `convertLegacySigilsInPlace` in `migrateLegacySigils.ts`), v65
 *   (`fillMissingBlockRows`) and v66 (`reconcileBlockRows`, then the drop),
 *   on vaults that still have it;
 * - the working copy of an import of a backup older than '14', which gets the column back for as long as
 *   the import runs (`addContentColumns`/`dropContentColumns`, see
 *   `importStaging.ts`): its converters for older files read and write
 *   `content` with plain SQL, and the rows are built from it at the end;
 * - two writers that run both before v66 and after it, and ask
 *   `hasContentColumn` which form to write: `insertTemplateRow`
 *   (`templateRows.ts`, the seeds and v43/v44/v61) and `altarInserts`
 *   (`migrateAltars.ts`, v62/v63, the import's working copy, `.emerald`).
 *
 * Free of `db.ts` and of the DOM, like `blockStore.ts`.
 */

const KINDS = ['template', 'entry'] as const;

/** Owners per batch when rebuilding: one batch stays small, a crash loses at most this many. */
const OWNER_CHUNK = 50;

export async function hasContentColumn(db: Database, kind: BlockOwnerKind): Promise<boolean> {
  const columns = await db.select<{ name: string }[]>(`PRAGMA table_info(${OWNER[kind].table})`);
  return columns.some((c) => c.name === 'content');
}

/** Every row of the owner anew from its `content`, and `content` normalised to what the rows give (`updated_at` untouched). */
function rebuildFromColumnStatements(
  owner: BlockOwner, content: string, now: string, hasRows: boolean,
): { statements: Statement[]; commit: () => void } {
  const { table } = OWNER[owner.kind];
  const plan = replaceOwnerBlocks(owner, content, now, { hasRows });
  const statements = [...plan.statements];
  if (plan.content !== content) statements.push([`UPDATE ${table} SET content = $1 WHERE id = $2`, [plan.content, owner.id]]);
  return { statements, commit: plan.commit };
}

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
    const plans = rows.map((r) => rebuildFromColumnStatements({ kind, id: r.id }, r.content ?? '', now, hasRows));
    const statements = plans.flatMap((p) => p.statements);
    if (statements.length) await db.batch(statements);
    plans.forEach((p) => p.commit());
  }
}

/** Rebuilds the rows of these owners from their stored `content`. */
async function rebuildOwners(db: Database, kind: BlockOwnerKind, ids: readonly string[]): Promise<void> {
  await rebuildChunked(db, kind, ids, true);
}

/**
 * Builds the rows of every entry and template that has none yet, from
 * `content` — migration v65, and the migrations before v66 that seed
 * templates. Owners with rows are found through the index without reading
 * their content. Repeatable: an owner is done the moment its batch is.
 */
export async function fillMissingBlockRows(db: Database): Promise<void> {
  for (const kind of KINDS) {
    const { column, table } = OWNER[kind];
    const missing = await db.select<{ id: string }[]>(
      `SELECT id FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE b.${column} = t.id)`,
    );
    await rebuildChunked(db, kind, missing.map((r) => r.id), false);
  }
}

/** The owners whose rows do not give their `content`. */
async function mismatchedOwners(db: Database, kind: BlockOwnerKind): Promise<string[]> {
  const { table } = OWNER[kind];
  const ids = (await db.select<{ id: string }[]>(`SELECT id FROM ${table}`)).map((r) => r.id);
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const contents = await db.select<{ id: string; content: string | null }[]>(
      `SELECT id, content FROM ${table} WHERE id IN (${placeholders(chunk.length)})`, chunk,
    );
    const fromRows = await readContents(db, kind, chunk);
    for (const { id, content } of contents) {
      if ((fromRows.get(id) ?? '') !== (content ?? '')) out.push(id);
    }
  }
  return out;
}

/** Diagnostic: entries and templates whose rows and `content` disagree. Writes nothing. */
export async function checkBlockRows(db: Database): Promise<{ entries: string[]; templates: string[] }> {
  return { entries: await mismatchedOwners(db, 'entry'), templates: await mismatchedOwners(db, 'template') };
}

/**
 * Rebuilds every owner whose rows and `content` disagree from `content` — v66
 * before the drop, and the end of an import, where many paths have written
 * `content` with plain SQL. Reads the whole vault; not for the everyday path.
 */
export async function reconcileBlockRows(db: Database): Promise<void> {
  for (const kind of KINDS) {
    const ids = await mismatchedOwners(db, kind);
    if (ids.length) await rebuildOwners(db, kind, ids);
  }
}

/**
 * Gives an import's working copy the `content` column back, filled from the
 * rows, so that the import's converters for older files find every owner's
 * blocks there — including the owners the import does not touch, which
 * `reconcileBlockRows` would otherwise empty. A no-op where the column exists.
 */
export async function addContentColumns(db: Database): Promise<void> {
  for (const kind of KINDS) {
    if (await hasContentColumn(db, kind)) continue;
    const { table } = OWNER[kind];
    await db.execute(`ALTER TABLE ${table} ADD COLUMN content TEXT NOT NULL DEFAULT ''`);
    const ids = (await db.select<{ id: string }[]>(`SELECT id FROM ${table}`)).map((r) => r.id);
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const contents = await readContents(db, kind, chunk);
      const updates: Statement[] = [...contents]
        .filter(([, content]) => content !== '')
        .map(([id, content]) => [`UPDATE ${table} SET content = $1 WHERE id = $2`, [content, id]]);
      if (updates.length) await db.batch(updates);
    }
  }
}

/** The rows of every owner from what the import left in `content`, then the column goes again. */
export async function dropContentColumns(db: Database): Promise<void> {
  await reconcileBlockRows(db);
  for (const kind of KINDS) {
    if (await hasContentColumn(db, kind)) await db.execute(`ALTER TABLE ${OWNER[kind].table} DROP COLUMN content`);
  }
}
