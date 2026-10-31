import type { TFunction } from 'i18next';
import { parseBlocks, serializeBlocks } from './blockHtml';
import { fieldFallbackText, translatedOr } from './blockAttrs';
import { instantiateDefinition, type BlockDefinition } from './definitions';
import { parseFields, serializeFields } from './fields';

/**
 * Status, end date and version of operations were fixed columns up to v40,
 * with their own filter, a dot in the list and chips under the title. Since
 * v41 they are a block: the copy of the custom block "Status" (Active — yes/no,
 * end date, version), at the very top of the content. The block is only
 * created for operations that had set any of these; the definition only if
 * there is such an operation — after that it is a custom block like any
 * other, renamable, editable and deletable.
 *
 * One converter for all paths by which legacy data comes in: migration
 * v41, backup import (`.emeralddb` up to version 6), `.emerald` and
 * Markdown import. Pure and DOM-free — the migration runs without a browser.
 */

/** Fixed ID: migration and imports from different vaults hit the same definition. */
export const STATUS_DEFINITION_ID = 'core-status';

export interface LegacyStatus {
  isActive: boolean;
  endDate: string | null;
  version: string | null;
}

/** Had the operation set anything? "Active" without end date and version was the normal state. */
export function hasLegacyStatus(status: LegacyStatus): boolean {
  return !status.isActive || !!status.endDate?.trim() || !!status.version?.trim();
}

/**
 * The "Status" definition, labelled in the current language — like the
 * starter set of categories. The labels end up permanently in the definition
 * and copies; if i18n is not ready yet (`t` returns the key), "blocks.status.name"
 * would stay there forever. Better English then.
 */
export function statusDefinition(t: TFunction, now: string): BlockDefinition {
  const label = (key: string, fallback: string) => translatedOr(t, key, fallback);
  return {
    id: STATUS_DEFINITION_ID,
    name: label('blocks.status.name', 'Status'),
    icon: '📌',
    elements: [
      { id: 'active', kind: 'toggle', label: label('blocks.status.active', 'Active') },
      { id: 'end-date', kind: 'date', label: label('blocks.status.endDate', 'End date') },
      { id: 'version', kind: 'shorttext', label: label('blocks.status.version', 'Version') },
    ],
    display: { readHideEmpty: true, readOnly: false, showTitle: true },
    revision: 1,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * A date as the date block stores it (`YYYY-MM-DD`). The column held
 * ISO; a Markdown import brings "Sep 10, 2026". Unreadable values stay
 * raw — the block then shows it as text instead of losing it.
 */
function isoDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The content with the status block in front — where the chips under the title used to be. */
export function withLegacyStatus(content: string, status: LegacyStatus, def: BlockDefinition, t: TFunction): string {
  const text = fieldFallbackText(t);
  const block = instantiateDefinition(def, text);
  const model = parseFields(block);
  const values: Record<string, string | boolean> = { active: status.isActive };
  if (status.endDate?.trim()) values['end-date'] = isoDate(status.endDate);
  if (status.version?.trim()) values.version = status.version.trim();
  // On top of the definition's defaults: a field someone added to the status keeps its own.
  const filled = serializeFields(block, { ...model, values: { ...model.values, ...values } }, text);
  return serializeBlocks([filled, ...parseBlocks(content)]);
}

/** The legacy status of an operation row — from the database or from a backup (then unchecked). */
export function legacyStatusOfRow(row: Record<string, unknown>): LegacyStatus {
  return {
    isActive: row.is_active == null ? true : Number(row.is_active) !== 0,
    endDate: typeof row.end_date === 'string' ? row.end_date : null,
    version: typeof row.version === 'string' ? row.version : null,
  };
}

/**
 * Rewrite operation rows with legacy status: status block into the content,
 * columns to their base values. Rows without legacy status come back
 * unchanged. `definition` is the definition used — `existing` if it
 * already exists, otherwise a new one — or `null` if no row needed it.
 */
export function convertLegacyStatusRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  t: TFunction,
  now: string,
  existing?: BlockDefinition,
): { rows: T[]; definition: BlockDefinition | null } {
  let definition: BlockDefinition | null = null;
  const out = rows.map((row) => {
    const status = legacyStatusOfRow(row);
    if (!hasLegacyStatus(status)) return row;
    definition ??= existing ?? statusDefinition(t, now);
    return {
      ...row,
      content: withLegacyStatus(typeof row.content === 'string' ? row.content : '', status, definition, t),
      is_active: 1,
      end_date: null,
      version: null,
    };
  });
  return { rows: out, definition };
}
