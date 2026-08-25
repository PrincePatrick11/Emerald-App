/**
 * Die Übersetzung zwischen SQLite-Zeilen und den Typen aus `src/types`.
 *
 * SQLite kennt weder Boolean noch Array: Booleans liegen als `INTEGER` 0/1,
 * Listen als JSON-Text. Die Typen versprechen `boolean` und `string[]`. Diese
 * Umrechnung muss also irgendwo passieren — und sie gehört an genau eine
 * Stelle, nämlich hierher.
 *
 * Vorher war sie über acht Stores verteilt, in vier verschiedenen Schreibweisen
 * (`boolToInt()`, `x ? 1 : 0`, `=== false ? 0 : 1`,
 * `(r.x as unknown as number) !== 0`), und an zwei Stellen fehlte sie ganz:
 * `OperationCategory.is_builtin` und `TaskCategory.is_builtin` hielten `0`/`1`,
 * obwohl als `boolean` deklariert — weshalb der Code sie an Verzweigungen
 * wieder zu `number` zurückcasten musste.
 *
 * Beim Lesen `fromRow.*` benutzen, beim Schreiben `toInt` und `toJson`.
 */
import type {
  AltarCategory,
  AltarItem,
  AltarRecord,
  CategoryBase,
  InternalLink,
  JournalEntry,
  Operation,
  Routine,
  Tag,
  Task,
  TaskCategory,
  TaskLink,
  WikiArticle,
} from '../types';

/** Eine rohe Zeile, wie sie aus `db.select` kommt. */
export type DbRow = Record<string, unknown>;

/**
 * INTEGER 0/1 → boolean. `fallback` greift nur bei NULL/undefined, also für
 * Spalten, die vor ihrer Einführung keinen Wert hatten (etwa `show_sigil`, das
 * standardmäßig an ist).
 */
export function bool(v: unknown, fallback = false): boolean {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  return Number(v) !== 0;
}

/** boolean → INTEGER 0/1 für Parameterlisten. */
export function toInt(v: boolean | null | undefined, fallback = false): 0 | 1 {
  return (v ?? fallback) ? 1 : 0;
}

/**
 * JSON-Text → Array. Fällt bei kaputtem Inhalt auf `[]` zurück, statt zu
 * werfen: Eine unlesbare Tag-Liste darf nicht das Laden des ganzen Journals
 * verhindern.
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

/** Array → JSON-Text für Parameterlisten. */
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
 * Aufrufbar als `rows.map(fromRow.journalEntry)` — die Mapper ignorieren die
 * zusätzlichen Argumente, die `Array.map` mitgibt.
 */
export const fromRow = {
  journalEntry(r: DbRow): JournalEntry {
    return {
      id: str(r.id),
      title: str(r.title),
      content: str(r.content),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      tags: jsonArray(r.tags),
      moon_phase: nullableStr(r.moon_phase),
      mood: nullableStr(r.mood),
      paradigm_id: nullableStr(r.paradigm_id),
      linked_operation_ids: jsonArray(r.linked_operation_ids),
      linked_wiki_ids: jsonArray(r.linked_wiki_ids),
      is_bannung: bool(r.is_bannung),
      bannung_type_wiki_id: nullableStr(r.bannung_type_wiki_id),
      is_meditation: bool(r.is_meditation),
      meditation_duration: nullableNum(r.meditation_duration),
      meditation_type_wiki_id: nullableStr(r.meditation_type_wiki_id),
      deleted_at: nullableStr(r.deleted_at),
      entry_number: nullableNum(r.entry_number) ?? undefined,
    };
  },

  wikiArticle(r: DbRow): WikiArticle {
    return {
      id: str(r.id),
      title: str(r.title),
      slug: str(r.slug),
      content: str(r.content),
      category_id: str(r.category_id),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      tags: jsonArray(r.tags),
      deleted_at: nullableStr(r.deleted_at),
      cover_image: r.cover_image == null ? undefined : String(r.cover_image),
      icon: r.icon == null ? undefined : String(r.icon),
      entry_number: nullableNum(r.entry_number) ?? undefined,
    };
  },

  operation(r: DbRow): Operation {
    return {
      id: str(r.id),
      title: str(r.title),
      content: str(r.content),
      category_id: str(r.category_id),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      tags: jsonArray(r.tags),
      deleted_at: nullableStr(r.deleted_at),
      is_active: bool(r.is_active, true),
      end_date: nullableStr(r.end_date),
      version: nullableStr(r.version),
      entry_number: nullableNum(r.entry_number) ?? undefined,
      icon: r.icon == null ? undefined : String(r.icon),
      cover_image: r.cover_image == null ? undefined : String(r.cover_image),
      description: str(r.description),
      target_reveal_date: nullableStr(r.target_reveal_date),
      charging_technique_wiki_id: nullableStr(r.charging_technique_wiki_id),
      is_loaded: bool(r.is_loaded),
      intention_text: str(r.intention_text),
      letter_bank: jsonArray(r.letter_bank),
      implemented_letters: jsonArray(r.implemented_letters),
      // Diese drei sind standardmäßig an — vor ihrer Einführung gab es keinen
      // Wert, und ein fehlender Wert darf das Sigil nicht ausblenden.
      show_intention_in_properties: bool(r.show_intention_in_properties, true),
      show_letter_bank_in_properties: bool(r.show_letter_bank_in_properties, true),
      show_sigil: bool(r.show_sigil, true),
      // undefined bleibt undefined: die Listen-Query des operationStore laesst
      // drawing_data bewusst weg ("noch nicht geladen"); NULL aus der DB heisst
      // dagegen "hat keine Zeichnung".
      drawing_data: r.drawing_data === undefined ? undefined : nullableStr(r.drawing_data),
      thumbnail_data: nullableStr(r.thumbnail_data),
    };
  },

  task(r: DbRow): Task {
    return {
      id: str(r.id),
      title: str(r.title),
      description: str(r.description),
      category_id: str(r.category_id),
      priority: (['low', 'medium', 'high'] as const).includes(r.priority as 'low')
        ? (r.priority as Task['priority'])
        : 'medium',
      due_date: nullableStr(r.due_date),
      completed: bool(r.completed),
      completed_at: nullableStr(r.completed_at),
      parent_task_id: nullableStr(r.parent_task_id),
      sort_order: num(r.sort_order, 0),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      tags: jsonArray(r.tags),
      deleted_at: nullableStr(r.deleted_at),
    };
  },

  /** Für `operation_categories` und `wiki_categories` — gleicher Aufbau. */
  category(r: DbRow): CategoryBase {
    return {
      id: str(r.id),
      name: str(r.name),
      emoji: str(r.emoji),
      sort_order: num(r.sort_order, 0),
      is_builtin: bool(r.is_builtin),
    };
  },

  taskCategory(r: DbRow): TaskCategory {
    return { ...fromRow.category(r), deleted_at: nullableStr(r.deleted_at) };
  },

  altarCategory(r: DbRow): AltarCategory {
    return {
      id: str(r.id),
      name: str(r.name),
      emoji: str(r.emoji),
      sort_order: num(r.sort_order, 0),
    };
  },

  altar(r: DbRow): AltarRecord {
    return {
      id: str(r.id),
      title: str(r.title),
      intention: str(r.intention),
      background_preset: str(r.background_preset),
      background_image_data: nullableStr(r.background_image_data),
      background_overlay: num(r.background_overlay, 0.2),
      background_overlay_color: str(r.background_overlay_color),
      created_at: str(r.created_at),
      updated_at: str(r.updated_at),
      grid_enabled: bool(r.grid_enabled),
      grid_size: num(r.grid_size, 32),
      grid_opacity: num(r.grid_opacity, 0.06),
      grid_color: str(r.grid_color),
      snap_to_grid: bool(r.snap_to_grid),
      rotation_snap_enabled: bool(r.rotation_snap_enabled),
      rotation_snap_angle: num(r.rotation_snap_angle, 15),
      snap_scale_to_grid: bool(r.snap_scale_to_grid),
      resolution: str(r.resolution),
      thumbnail_data: nullableStr(r.thumbnail_data),
      icon_data: nullableStr(r.icon_data),
    };
  },

  altarItem(r: DbRow): AltarItem {
    return {
      id: str(r.id),
      name: str(r.name),
      emoji: str(r.emoji),
      category_id: str(r.category_id),
      note: str(r.note),
      image_data: r.image_data == null ? undefined : String(r.image_data),
    };
  },

  routine(r: DbRow): Routine {
    return {
      id: str(r.id),
      name: str(r.name),
      emoji: str(r.emoji),
      content: str(r.content),
      tags: jsonArray(r.tags),
      operation_ids: jsonArray(r.operation_ids),
      wiki_ids: jsonArray(r.wiki_ids),
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

  link(r: DbRow): InternalLink {
    return {
      source_id: str(r.source_id),
      source_type: r.source_type as InternalLink['source_type'],
      target_id: str(r.target_id),
      target_type: r.target_type as InternalLink['target_type'],
    };
  },
};
