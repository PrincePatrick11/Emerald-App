import type { TFunction } from 'i18next';
import { entryMoonPhase, journalIcon } from './moonPhase';
import { DEFAULT_ENTRY_EMOJI } from './modules';
import { displayTitle } from './entryTitle';
import { categoryLabel, lookupCategory } from './categories';
import { isImageIcon } from './helpers';
import type { Category, ContentType, Entry, Task } from '../types';

/**
 * A linkable entry, as seen by the `[[` autocomplete, the
 * link picker, the linking field and the import/export paths.
 *
 * It lives here and not with `SuggestionList`: `buildLinkItems` below is the
 * source of these values, and `lib/` modules (import/export) need the type
 * without importing a React component. `SuggestionList` passes it on for
 * the components that get it from there.
 */
export interface SuggestionItem {
  id: string;
  entryType: ContentType;
  label: string;
  /** Emoji of the entry's category, where there is one. */
  category?: string;
  /** Travels into the node attrs on insertion and thus into the stored HTML. */
  icon?: string;
  /**
   * For display only, never for storing — an uploaded icon image, which has
   * no business in the node attrs (`splitIcon`). Falls back to `icon` and from
   * there to `DEFAULT_ENTRY_EMOJI`.
   */
  displayIcon?: string;
  /**
   * Translated name of the category the entry is in within its module —
   * the heading under which an appended link lands in the entry. Journal
   * has no categories and uses the moon phase (that is what "category" is called there
   * when sorting too) — or, if the vault does not show it, the module name.
   */
  categoryLabel?: string;
  /**
   * `updated_at` of the target — for sorting only. Without a search term, the link picker
   * shows the most recently edited entries, so that it is not simply
   * the first module of the list that appears there.
   */
  updatedAt?: string;
  entry_number?: number;
}

/**
 * All linkable entries of all modules as one list — the single source of truth
 * for which icon, which label and which category a link target carries.
 * Used by the `[[` autocomplete, the link picker, the
 * sidebar's linking field (all via `useLinkItems`) and by the
 * `.emerald` import/export, which needs the same mapping without React.
 *
 * A pure function over store snapshots: the hook memoizes it, the
 * import/export paths call it with `getState()` and `i18n.t` directly.
 *
 * Block order = rail order (registry): journal, task, operation,
 * wiki — nothing enforces that, it is written here by hand.
 *
 * Deleted entries are already filtered out by the stores (`deleted_at IS NULL`
 * on load), so no second filter is needed here.
 */
export interface LinkItemSources {
  entries: Entry[];
  tasks: Task[];
  operations: Entry[];
  articles: Entry[];
  /** The one global list — tasks, operations and articles all point into it. */
  categories: Category[];
  /** The vault setting `journal.moonPhase` — whether journal entries show their phase. */
  showMoonPhase: boolean;
}

/**
 * Separates the display icon from the stored icon. An uploaded image (data URL, blob,
 * vault filename) must NOT end up in `icon`: that travels on insertion into
 * the node attrs and thus into the stored content of every entry that links
 * the target — a data URL inflates it there by its full size without ever being
 * read (the chip resolves its icon live). The emoji fallback is stored,
 * the image is displayed.
 */
function splitIcon(icon: string | null | undefined, emojiFallback: string) {
  if (icon && isImageIcon(icon)) return { icon: emojiFallback, displayIcon: icon };
  return { icon: icon || emojiFallback, displayIcon: undefined };
}

export function buildLinkItems(s: LinkItemSources, t: TFunction): SuggestionItem[] {
  const catById = new Map(s.categories.map((c) => [c.id, c]));
  return [
    ...s.entries.map((e) => {
      const phase = entryMoonPhase(e, s.showMoonPhase);
      return {
        id: e.id,
        entryType: 'journal' as const,
        label: displayTitle(t, 'journal', e.title),
        icon: journalIcon(e, s.showMoonPhase),
        categoryLabel: phase ? t(`moonPhase.${phase}`) : t('nav.journal'),
        updatedAt: e.updated_at,
        entry_number: e.entry_number,
      };
    }),
    ...s.tasks.map((task) => {
      const cat = lookupCategory(catById, task.category_id);
      return {
        id: task.id,
        entryType: 'task' as const,
        label: displayTitle(t, 'task', task.title),
        category: cat?.emoji,
        icon: cat?.emoji || DEFAULT_ENTRY_EMOJI.task,
        categoryLabel: categoryLabel(t, cat),
        updatedAt: task.updated_at,
      };
    }),
    ...s.operations.map((o) => {
      const cat = lookupCategory(catById, o.category_id);
      return {
        id: o.id,
        entryType: 'operation' as const,
        label: displayTitle(t, 'operation', o.title),
        category: cat?.emoji,
        ...splitIcon(o.icon, cat?.emoji || DEFAULT_ENTRY_EMOJI.operation),
        categoryLabel: categoryLabel(t, cat),
        updatedAt: o.updated_at,
        entry_number: o.entry_number,
      };
    }),
    ...s.articles.map((a) => {
      const cat = lookupCategory(catById, a.category_id);
      return {
        id: a.id,
        entryType: 'wiki' as const,
        label: displayTitle(t, 'wiki', a.title),
        category: cat?.emoji,
        ...splitIcon(a.icon, cat?.emoji ?? DEFAULT_ENTRY_EMOJI.wiki),
        categoryLabel: categoryLabel(t, cat),
        updatedAt: a.updated_at,
        entry_number: a.entry_number,
      };
    }),
  ];
}

/**
 * `entry:id` or `task:id` → item. The key under which link chips are looked
 * up. A chip carries the target kind (`entry`/`task`), an item its display
 * kind (journal, wiki, …) — both map onto the same key.
 */
export function linkItemKey(target: { id: string; entryType: string }): string {
  return `${target.entryType === 'task' ? 'task' : 'entry'}:${target.id}`;
}

export function linkItemsByKey(items: SuggestionItem[]): Map<string, SuggestionItem> {
  return new Map(items.map((i) => [linkItemKey(i), i]));
}
