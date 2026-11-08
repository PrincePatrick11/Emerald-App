/**
 * The translation between SQLite rows and the types from `src/types`.
 *
 * SQLite has neither boolean nor array: booleans are stored as `INTEGER` 0/1,
 * lists as JSON text. The types promise `boolean` and `string[]`. This
 * conversion therefore has to happen somewhere — and it belongs in exactly one
 * place, namely here.
 *
 * Previously it was spread across eight stores, in four different spellings
 * (`boolToInt()`, `x ? 1 : 0`, `=== false ? 0 : 1`,
 * `(r.x as unknown as number) !== 0`), and in two places it was missing entirely:
 * `OperationCategory.is_builtin` and `TaskCategory.is_builtin` held `0`/`1`,
 * although declared as `boolean` — which is why the code had to cast them
 * back to `number` at branches.
 *
 * Use `fromRow.*` when reading, `toInt` and `toJson` when writing.
 */
import type {
  AltarItem,
  AltarRecord,
  Category,
  Entry,
  EntryType,
  Language,
  LexiconEntry,
  Tag,
  Task,
  TaskLink,
  VaultImage,
} from '../types';
import {
  DEFAULT_DEFINITION_ICON, parseDefinitionDisplay, parseDefinitionElements, type BlockDefinition,
} from './blocks/definitions';
import { DEFAULT_TEMPLATE_ICON, parseAssignments, type Template } from './blocks/templates';
import { DEFAULT_LANGUAGE_ICON, parseAlphabet } from './lexicon';
import { parseAltarSettings } from './altarSettings';

/** A raw row as it comes from `db.select`. */
export type DbRow = Record<string, unknown>;

/**
 * INTEGER 0/1 → boolean. `fallback` only applies to NULL/undefined, i.e. for
 * columns that had no value before they were introduced (switches that are
 * on by default).
 */
export function bool(v: unknown, fallback = false): boolean {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  return Number(v) !== 0;
}

/** boolean → INTEGER 0/1 for parameter lists. */
export function toInt(v: boolean | null | undefined, fallback = false): 0 | 1 {
  return (v ?? fallback) ? 1 : 0;
}

/**
 * JSON text → array. Falls back to `[]` on broken content instead of
 * throwing: an unreadable tag list must not prevent the whole journal
 * from loading.
 */
export function jsonArray<T = string>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Array → JSON text for parameter lists. */
export function toJson(v: readonly unknown[] | null | undefined): string {
  return JSON.stringify(v ?? []);
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const nullableStr = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown, fallback: number): number =>
  v == null || Number.isNaN(Number(v)) ? fallback : Number(v);
const nullableNum = (v: unknown): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v);

/** The column has a CHECK — anything else ends up in the journal instead of blowing up the list. */
const entryType = (v: unknown): EntryType => (v === 'wiki' || v === 'operation' ? v : 'journal');

/**
 * Callable as `rows.map(fromRow.entry)` — the mappers ignore the
 * extra arguments that `Array.map` passes.
 */
export const fromRow = {
  entry(r: DbRow): Entry {
    return {
      id: str(r.id),
      type: entryType(r.type),
      title: str(r.title),
      content: str(r.content),
      category_id: nullableStr(r.category_id),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      tags: jsonArray(r.tags),
      deleted_at: nullableStr(r.deleted_at),
      entry_number: nullableNum(r.entry_number) ?? undefined,
      icon: r.icon == null ? undefined : String(r.icon),
      cover_image: r.cover_image == null ? undefined : String(r.cover_image),
    };
  },

  task(r: DbRow): Task {
    return {
      id: str(r.id),
      title: str(r.title),
      category_id: nullableStr(r.category_id),
      priority: (['low', 'medium', 'high'] as const).includes(r.priority as 'low')
        ? (r.priority as Task['priority'])
        : 'medium',
      completed: bool(r.completed),
      parent_task_id: nullableStr(r.parent_task_id),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  category(r: DbRow): Category {
    return {
      id: str(r.id),
      name: str(r.name),
      emoji: str(r.emoji),
      sort_order: num(r.sort_order, 0),
      is_builtin: bool(r.is_builtin),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  /** `elements`/`display` go through the same validation as the copy in the content — the row can come from an import. */
  blockDefinition(r: DbRow): BlockDefinition {
    return {
      id: str(r.id),
      name: str(r.name),
      icon: str(r.icon) || DEFAULT_DEFINITION_ICON,
      elements: parseDefinitionElements(r.elements),
      display: parseDefinitionDisplay(r.display),
      revision: Math.max(1, Math.trunc(num(r.revision, 1))),
      sort_order: num(r.sort_order, 0),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  /** `assignments` goes through `parseAssignments` — the row can come from an import. */
  template(r: DbRow): Template {
    return {
      id: str(r.id),
      name: str(r.name),
      icon: str(r.icon) || DEFAULT_TEMPLATE_ICON,
      title: str(r.title),
      content: str(r.content),
      tags: jsonArray<unknown>(r.tags).filter((t): t is string => typeof t === 'string'),
      assignments: parseAssignments(r.assignments),
      sort_order: num(r.sort_order, 0),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  language(r: DbRow): Language {
    return {
      id: str(r.id),
      name: str(r.name),
      icon: str(r.icon) || DEFAULT_LANGUAGE_ICON,
      alphabet: parseAlphabet(r.alphabet),
      sort_order: num(r.sort_order, 0),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  lexiconEntry(r: DbRow): LexiconEntry {
    return {
      id: str(r.id),
      language_id: str(r.language_id),
      term: str(r.term),
      translation: str(r.translation),
      pronunciation: str(r.pronunciation),
      note: str(r.note),
      sort_order: num(r.sort_order, 0),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
    };
  },

  altar(r: DbRow): AltarRecord {
    return {
      id: str(r.id),
      title: str(r.title),
      ...parseAltarSettings(r.settings),
      background_image_data: nullableStr(r.background_image_data),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      thumbnail_data: nullableStr(r.thumbnail_data),
      icon_data: nullableStr(r.icon_data),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  altarItem(r: DbRow): AltarItem {
    return {
      id: str(r.id),
      name: str(r.name),
      emoji: str(r.emoji),
      category_id: nullableStr(r.category_id),
      note: str(r.note),
      image_data: r.image_data == null ? undefined : String(r.image_data),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
    };
  },

  image(r: DbRow): VaultImage {
    return {
      id: str(r.id),
      file: str(r.file),
      name: str(r.name),
      tags: jsonArray<unknown>(r.tags).filter((t): t is string => typeof t === 'string'),
      note: str(r.note),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
    };
  },

  tag(r: DbRow): Tag {
    return { id: str(r.id), name: str(r.name), color: str(r.color) };
  },

  taskLink(r: DbRow): TaskLink {
    return {
      id: str(r.id),
      task_id: str(r.task_id),
      target_id: str(r.target_id),
      target_type: r.target_type as TaskLink['target_type'],
    };
  },
};
