import type Database from '../sqlite';
import { replaceOwnerBlocks, withContents, type BlockOwnerKind, type Statement } from '../blockStore';
import { BLOCK_STACK_COLUMN } from '../schema';

/**
 * The block stack of an entry or a template on the wire: a column `content`,
 * the block HTML of its rows (`contentOf`), as before v66. The rows of
 * `blocks` and `block_refs` stay local (their `row_id` means nothing on another
 * device); a change to them is logged as a change of their owner's `content`
 * (`blockTriggerDdl` in `tracking.ts`), and an incoming `content` replaces the
 * owner's rows (`stackStatements`). So the format, the conflict rules and
 * devices of an older version stay as they were.
 *
 * DOM-free: it also runs in node (`scripts/sync-check.mjs`).
 */

/** The virtual column — the block stack as a backup file's row carries it too. */
export const STACK_COLUMN = BLOCK_STACK_COLUMN;

/** Which owner kind a synced table's rows are, if they have a block stack. */
export function stackOwnerKind(table: string): BlockOwnerKind | null {
  return table === 'entries' ? 'entry' : table === 'templates' ? 'template' : null;
}

/** Rows of `table` with their block stack as `content` — what goes on the wire. In place; other tables untouched. */
export async function withStacks<T extends Record<string, unknown>>(db: Database, table: string, rows: T[]): Promise<T[]> {
  const kind = stackOwnerKind(table);
  return kind ? withContents(db, kind, rows) : rows;
}

/** A row without its block stack — what goes into the table itself. */
export function withoutStack(table: string, row: Record<string, unknown>): Record<string, unknown> {
  if (!stackOwnerKind(table) || !(STACK_COLUMN in row)) return row;
  const { [STACK_COLUMN]: _stack, ...rest } = row;
  return rest;
}

/**
 * The statements that make `content` the owner's block rows, replacing what
 * it had. `commit` remembers them as saved once the batch went through.
 */
export function stackStatements(
  table: string, id: string, content: unknown, now: string,
): { statements: Statement[]; commit: () => void } {
  const kind = stackOwnerKind(table);
  if (!kind) return { statements: [], commit: () => {} };
  const plan = replaceOwnerBlocks({ kind, id }, typeof content === 'string' ? content : '', now, { hasRows: true });
  return { statements: plan.statements, commit: plan.commit };
}
