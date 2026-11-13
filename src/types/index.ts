import type { TrashKind, ViewId } from '../lib/modules';

export type ContentType = 'journal' | 'wiki' | 'operation' | 'task';

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
 * operations and tasks. `is_builtin` applies only to `other`
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
