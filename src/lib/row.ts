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
  Category,
  Dashboard,
  Entry,
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
import { DEFAULT_TEMPLATE_ICON, type Template } from './blocks/templates';
import { DEFAULT_LANGUAGE_ICON, parseAlphabet } from './lexicon';
import { isBuiltinDashboard, parseDashboardDisplay, parseDashboardFilter, parseDashboardSort } from './dashboards';

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

/**
 * Callable as `rows.map(fromRow.entry)` — the mappers ignore the
 * extra arguments that `Array.map` passes.
 */
export const fromRow = {
  entry(r: DbRow): Entry {
    return {
      id: str(r.id),
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
      template_id: nullableStr(r.template_id),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  /** `filter`/`sort`/`display` are validated — the row can come from an import or another device. */
  dashboard(r: DbRow): Dashboard {
    return {
      id: str(r.id),
      // A built-in key counts only on its own row: another row naming it would take the module over.
      builtin: isBuiltinDashboard(r.builtin) && r.id === r.builtin ? r.builtin : null,
      name: str(r.name),
      icon: str(r.icon),
      position: num(r.position, 0),
      filter: parseDashboardFilter(r.filter),
      sort: parseDashboardSort(r.sort),
      display: parseDashboardDisplay(r.display),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
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
      sort_order: num(r.sort_order, 0),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  template(r: DbRow): Template {
    return {
      id: str(r.id),
      name: str(r.name),
      icon: str(r.icon) || DEFAULT_TEMPLATE_ICON,
      title: str(r.title),
      content: str(r.content),
      tags: jsonArray<unknown>(r.tags).filter((t): t is string => typeof t === 'string'),
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
      target_type: r.target_type === 'task' ? 'task' : 'entry',
    };
  },
};
