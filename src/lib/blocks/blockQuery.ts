import type Database from '../sqlite';
import { FIELDS_BLOCK_TYPE } from './fields';

/**
 * Asking the block rows for the values of fields — the first piece of
 * filtering by block values (#37). A fields block keeps its values in
 * `blocks.data` as `{ "values": { "<element id>": value } }`
 * (`readValuesJson` in `fields.ts`); SQLite's JSON functions read them there,
 * without parsing a block in JavaScript.
 *
 * The values are those of the element kinds kept in the JSON (short text,
 * number, date, select by option ID, toggle, checklist, moon); text, link and
 * image elements keep theirs as markup in the block's slots and are not
 * reached here.
 *
 * Kept small on purpose: one condition on one element. What a filter UI needs
 * beyond it (several conditions, sorting by a value) builds on `fieldValueSql`.
 */

export type FieldCondition =
  /** The value is this one — a text, a number, or a toggle's `true`/`false`. */
  | { op: 'equals'; value: string | number | boolean }
  /** The value as text holds this, regardless of case (ASCII). */
  | { op: 'contains'; value: string }
  /** No value, or an empty text — in a block that has the element. */
  | { op: 'empty' }
  /** Any value but an empty text. */
  | { op: 'notEmpty' };

export interface FieldQuery {
  /** The element's ID (its key in `values`). */
  elementId: string;
  condition: FieldCondition;
  /** The block type holding the element; fields blocks by default. */
  blockType?: string;
  /** Entries in the trash too. */
  includeDeleted?: boolean;
}

/** Element IDs as the app makes them; anything else is refused rather than quoted into a JSON path. */
const ELEMENT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** The JSON path of an element's value in `blocks.data`. */
export function fieldValuePath(elementId: string): string {
  if (!ELEMENT_ID_RE.test(elementId)) throw new Error(`fieldValuePath: unusable element ID ${JSON.stringify(elementId)}`);
  return `$.values."${elementId}"`;
}

/**
 * The SQL expression for an element's value in the block row `alias`, with
 * the JSON path bound as `$<param>` — for a query that builds its own WHERE.
 * `NULL` where the block has no such value or its JSON is broken.
 */
export function fieldValueSql(alias: string, param: number): string {
  return `CASE WHEN json_valid(${alias}.data) THEN json_extract(${alias}.data, $${param}) END`;
}

/** The IDs of the entries with a block whose element meets the condition, in no particular order. */
export async function entriesWithFieldValue(db: Database, query: FieldQuery): Promise<string[]> {
  const value = fieldValueSql('b', 2);
  const params: unknown[] = [query.blockType ?? FIELDS_BLOCK_TYPE, fieldValuePath(query.elementId)];
  let where: string;
  const { condition } = query;
  switch (condition.op) {
    case 'equals':
      params.push(typeof condition.value === 'boolean' ? (condition.value ? 1 : 0) : condition.value);
      where = `${value} = $3`;
      break;
    case 'contains':
      params.push(condition.value.toLowerCase());
      where = `instr(lower(CAST(${value} AS TEXT)), $3) > 0`;
      break;
    case 'empty':
      // Only blocks that have the element: any other fields block has no value for it either.
      params.push(query.elementId);
      where = `(${value} IS NULL OR ${value} = '')
        AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(b.config) THEN b.config END, '$.elements') el
                     WHERE json_extract(el.value, '$.id') = $3)`;
      break;
    case 'notEmpty':
      where = `(${value} IS NOT NULL AND ${value} <> '')`;
      break;
  }
  const rows = await db.select<{ id: string }[]>(
    `SELECT DISTINCT e.id
       FROM blocks b JOIN entries e ON e.id = b.entry_id
      WHERE b.type = $1 AND ${where}${query.includeDeleted ? '' : ' AND e.deleted_at IS NULL'}`,
    params,
  );
  return rows.map((r) => r.id);
}
