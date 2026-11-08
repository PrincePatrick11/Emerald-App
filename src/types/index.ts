import type { CanvasBackground } from '../components/editors/canvas/background';
import type { PaintDoc } from '../lib/paint/document';
import type { TrashKind, ViewId } from '../lib/modules';

export type ContentType = 'journal' | 'wiki' | 'operation' | 'task' | 'altar';

/** The entry kinds of the `entries` table — the modules with a block stack. */
export type EntryType = 'journal' | 'wiki' | 'operation';

/**
 * An entry from `entries` — journal, wiki or operation. What sets the three
 * apart lives in the content (blocks); `type` only says which module it
 * belongs to, and a type change changes exactly that (`entryTypeChange`).
 *
 * The moon phase of a journal entry follows from `created_at`
 * (`entryMoonPhase`); status, sigils, paradigm, banishing, meditation and the
 * linked entries have been blocks or link chips in the content since v36–v42.
 */
export interface Entry {
  id: string;
  type: EntryType;
  title: string;
  content: string; // HTML, as TipTap's getHTML() returns it
  /** `null` = no category, the normal case for a new entry since v39 — always in the journal. */
  category_id: string | null;
  created_at: string;
  updated_at: string;
  /** Tag IDs (`lib/tagRefs.ts`) — those of tags in the trash stay in place, invisible. */
  tags: string[];
  deleted_at: string | null;
  entry_number?: number;
  /** Custom icon (emoji or image) — wiki and operations only. */
  icon?: string;
  /** Cover image — wiki and operations only. */
  cover_image?: string;
}

/**
 * A row of the global `categories` table — the same list for wiki,
 * operations, tasks and altar items. `is_builtin` applies only to `other`
 * and `sigils`; the display name goes through `lib/categories.categoryLabel`.
 */
export interface Category {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
  is_builtin: boolean;
  deleted_at: string | null;
}

export interface TrashedItem {
  id: string;
  title: string;
  type: TrashKind;
  deleted_at: string;
  category?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export type MoonPhase =
  | 'new'
  | 'waxing_crescent'
  | 'first_quarter'
  | 'waxing_gibbous'
  | 'full'
  | 'waning_gibbous'
  | 'last_quarter'
  | 'waning_crescent';

export interface AltarGuide {
  id: string;
  orientation: 'vertical' | 'horizontal';
  at: number;
}

export interface AltarRecord {
  id: string;
  title: string;
  background_preset: string;
  background_image_data: string | null;
  background_overlay: number;
  background_overlay_color: string;
  created_at: string;
  updated_at: string;
  grid_enabled: boolean;
  grid_size: number;
  grid_opacity: number;
  grid_color: string;
  snap_to_grid: boolean;
  rotation_snap_enabled: boolean;
  rotation_snap_angle: number;
  snap_scale_to_grid: boolean;
  resolution: string;
  /** Guide lines pulled out of the canvas editor's rulers; `at` in percent of the altar's width or height. */
  guides: AltarGuide[];
  /** The guides cannot be moved or removed. */
  guides_locked: boolean;
  /**
   * The background as the canvas editor sets it; `null` until it is first
   * changed there, and then the older `background_preset` and overlay are
   * shown. Its picture is the `background_image_data` column's image or one
   * of the app's own (`/backgrounds/…`).
   */
  canvas_background: CanvasBackground | null;
  thumbnail_data?: string | null;
  icon_data?: string | null;
  /** In the trash since — the store only holds altars without it. */
  deleted_at?: string | null;
}

export interface AltarItem {
  id: string;
  name: string;
  emoji: string;
  /** `null` = no category, the normal case for a new entry since v39. */
  category_id: string | null;
  note: string;
  image_data?: string;
  /** Only for sorting the library — the column already existed in
   *  `altar_items`, it just never made it into the type. */
  created_at: string;
  updated_at: string;
}

/**
 * What sits on an altar: an item from the library (a row of
 * `altar_placements`), or a shape or text drawn on the altar itself (kept in
 * `altars.elements`, see `lib/altarElements.ts`). The store holds both in one
 * list so stacking, the sidebar and the edit snapshot treat them alike.
 */
export type AltarPlacementKind = 'item' | 'shape' | 'text' | 'drawing' | 'symbol';

/** `triangle` and `hexagon` come from older altars; new shapes with corners are polygons. */
export type AltarShapeType = 'rect' | 'ellipse' | 'polygon' | 'triangle' | 'star' | 'hexagon';

/** A drawn shape. Sizes in pixels at the reference width of 1920. */
export interface AltarShapeStyle {
  type: AltarShapeType;
  fill: string | null;
  stroke: string | null;
  stroke_width: number;
  corner_radius: number;
  /** A polygon's corners or a star's points; missing: six and five. */
  sides?: number;
}

/** A drawn text. The size in pixels at the reference width of 1920. */
export interface AltarTextStyle {
  content: string;
  font: 'serif' | 'book' | 'sans';
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
}

/** A symbol of the canvas editor's library: its path in a box of 100 × 100, the line weight in those units. */
export interface AltarSymbolStyle {
  symbol: string;
  d: string;
  color: string;
  weight: number;
  fill: string | null;
}

export interface AltarPlacement {
  id: string;
  altar_id?: string;
  kind: AltarPlacementKind;
  /** The library item; empty for a shape or text. */
  item_id: string;
  // name, emoji, category_id and image_data come from altar_items and are
  // joined in on load — they are not columns of altar_placements.
  name: string;
  emoji: string;
  /** `null` = no category, the normal case for a new entry since v39. */
  category_id: string | null;
  x: number;
  y: number;
  z_index: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  /** The group it is selected and moved with on the canvas; elements of one group share it. */
  group?: string;
  image_data?: string;
  /** Only for `kind: 'drawing'`: the painted document (`lib/paint/document.ts`). */
  drawing?: PaintDoc;
  /** Only for `kind: 'shape'`. */
  shape?: AltarShapeStyle;
  /** Only for `kind: 'text'`. */
  text?: AltarTextStyle;
  /** Only for `kind: 'symbol'`. */
  symbol?: AltarSymbolStyle;
}

export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskLink {
  id: string;
  task_id: string;
  target_id: string;
  target_type: ContentType;
}

export interface Task {
  id: string;
  title: string;
  /** `null` = no category, the normal case for a new entry since v39. */
  category_id: string | null;
  priority: TaskPriority;
  completed: boolean;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * A character pair of a language's alphabet: `from` is the character (or
 * character sequence) of the own script, `to` that of the language. Multi-letter
 * pairs are explicitly allowed — "th" → "ᚦ" is exactly the case for which the
 * transliteration tries the longest match first (see `lib/lexicon.ts`).
 */
export interface AlphabetPair {
  from: string;
  to: string;
}

/** A language of the lexicon. Its vocabulary sits alongside as `LexiconEntry`. */
export interface Language {
  id: string;
  name: string;
  /** Emoji or image data URL, as with custom blocks and templates. */
  icon: string;
  alphabet: AlphabetPair[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * A vocabulary item. `term` is in the language, `translation` in the user's
 * own — the translate field reads the pair in both directions.
 */
export interface LexiconEntry {
  id: string;
  language_id: string;
  term: string;
  translation: string;
  pronunciation: string;
  note: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ActiveView {
  // ViewId instead of the old ad-hoc union: via ContentType it also contained
  // 'operation' (singular), which was never a valid view type.
  type: ViewId;
  id?: string;
  mode?: 'view' | 'edit';
  /** Freshly created and never confirmed with "Done" — Cancel discards
   *  the entry again instead of just returning to the last saved state.
   *  Set by every "New" handler and dropped on save. */
  isNew?: boolean;
}
