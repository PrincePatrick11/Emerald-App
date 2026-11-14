import type { TrashKind, ViewId } from '../lib/modules';

/**
 * The kind of an entry as the modules show it — journal, wiki or operation.
 * Not stored: an entry has no kind of its own, it follows from which
 * built-in dashboard's filter its category falls into (`entryKindOf`,
 * `lib/dashboards.ts`). Keys the per-kind texts and icons (untitled title,
 * fallback emoji, trash groups, search hits).
 */
export type EntryKind = 'journal' | 'wiki' | 'operation';

/** An entry kind or a task — what lists, search hits and link chips show. */
export type ContentType = EntryKind | 'task';

/**
 * What a link points at (`task_links.target_type`, the chip's
 * `data-entry-type`, drag payloads): an entry — of whatever kind — or a task.
 */
export type LinkTargetKind = 'entry' | 'task';

/**
 * An entry from `entries`. It has no type: what it is follows from its
 * category, which dashboards show it and with which template it started.
 *
 * The moon phase of an entry of the category Journal follows from
 * `created_at` (`entryMoonPhase`).
 */
export interface Entry {
  id: string;
  title: string;
  content: string; // HTML, as TipTap's getHTML() returns it
  /** At most one category; `null` = none. */
  category_id: string | null;
  created_at: string;
  updated_at: string;
  /** Tag IDs (`lib/tagRefs.ts`) — those of tags in the trash stay in place, invisible. */
  tags: string[];
  deleted_at: string | null;
  /** Running number over all entries, unique. */
  entry_number?: number;
  /** Custom icon (emoji or image). */
  icon?: string;
  /** Cover image. */
  cover_image?: string;
}

/**
 * A row of the global `categories` table — one list for entries and tasks.
 * `is_builtin` holds for `journal`, `sigils` and `altars`; the display name
 * goes through `lib/categories.categoryLabel`.
 */
export interface Category {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
  is_builtin: boolean;
  /** The template a new entry of this category starts with — `null`: the vault's default. */
  template_id: string | null;
  deleted_at: string | null;
}

/** Which entries a dashboard shows. A missing key does not narrow. */
export interface DashboardFilter {
  /** The entry's category is one of these. */
  categories?: string[];
  /** The entry carries at least one of these tags. */
  tags?: string[];
}

export interface DashboardSort {
  by: 'created' | 'title' | 'updated';
  dir: 'asc' | 'desc';
}

/** The key of a built-in dashboard — at the same time its fixed ID. */
export type BuiltinDashboard = 'all' | 'journal' | 'wiki' | 'operations';

/**
 * A row of `dashboards`: a view over entries by filter rules. The built-in
 * ones carry their key in `builtin` and as ID; an empty `name` shows the
 * translated name of the built-in.
 */
export interface Dashboard {
  id: string;
  builtin: BuiltinDashboard | null;
  name: string;
  icon: string;
  position: number;
  filter: DashboardFilter;
  sort: DashboardSort;
  /** How the dashboard draws its entries — empty until dashboards can be built. */
  display: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

/**
 * A picture of "Images" with details (`images`, since v56): a stored file of
 * the vault with a name, tags and a note. Every other file of the vault is
 * listed too, unnamed, as `StoredImage` from the folder.
 */
export interface VaultImage {
  id: string;
  /** The stored file name (`storedImageName`). */
  file: string;
  name: string;
  /** Tag IDs, as with entries. */
  tags: string[];
  note: string;
  created_at: string;
  updated_at: string;
}

export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskLink {
  id: string;
  task_id: string;
  target_id: string;
  target_type: LinkTargetKind;
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
