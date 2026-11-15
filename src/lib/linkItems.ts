import type { TFunction } from 'i18next';
import { entryMoonPhase } from './moonPhase';
import { DEFAULT_ENTRY_ICON, DEFAULT_TASK_ICON, entryIcon } from './entryIcon';
import { displayTitle } from './entryTitle';
import { categoryLabel, lookupCategory } from './categories';
import { isImageIcon } from './helpers';
import type { Category, Entry, LinkTargetKind, Task } from '../types';

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
  entryType: LinkTargetKind;
  label: string;
  /** Emoji of the entry's category, where there is one. */
  category?: string;
  /** Travels into the node attrs on insertion and thus into the stored HTML. */
  icon?: string;
  /**
   * For display only, never for storing — an uploaded icon image, which has
   * no business in the node attrs (`splitIcon`). Falls back to `icon` and from
   * there to `DEFAULT_ENTRY_ICON`.
   */
  displayIcon?: string;
  /**
   * Translated name of the target's category — the heading under which an
   * appended link lands in the entry. An entry with a moon phase (category
   * Journal) shows the phase instead.
   */
  categoryLabel?: string;
  /**
   * `updated_at` of the target — for sorting only. Without a search term, the link picker
   * shows the most recently edited entries and tasks.
   */
  updatedAt?: string;
  entry_number?: number;
}

/**
 * All linkable entries and tasks as one list — the single source of truth
 * for which icon, which label and which category a link target carries.
 * Used by the `[[` autocomplete, the link picker, the
 * sidebar's linking field (all via `useLinkItems`) and by the
 * `.emerald` import/export, which needs the same mapping without React.
 *
 * A pure function over store snapshots: the hook memoizes it, the
 * import/export paths call it with `getState()` and `i18n.t` directly.
 *
 * Entries first, then tasks.
 *
 * Deleted entries are already filtered out by the stores (`deleted_at IS NULL`
 * on load), so no second filter is needed here.
 */
export interface LinkItemSources {
  entries: readonly Entry[];
  tasks: readonly Task[];
  /** The one global list — entries and tasks both point into it. */
  categories: readonly Category[];
  /** The vault setting `journal.moonPhase` — whether entries of the category Journal show their phase. */
  showMoonPhase: boolean;
}

/**
 * Separates the display icon from the stored icon. An uploaded icon (a file
 * name in `icons/`) must NOT end up in `icon`: that travels on insertion into
 * the node attrs and thus into the stored content of every entry that links
 * the target, where a name of a file that may be gone is worth nothing (the
 * chip resolves its icon live). The emoji fallback is stored, the image is
 * displayed (`iconSrc`).
 */
function splitIcon(icon: string | null | undefined, emojiFallback: string) {
  if (icon && isImageIcon(icon)) return { icon: emojiFallback, displayIcon: icon };
  return { icon: icon || emojiFallback, displayIcon: undefined };
}

export function buildLinkItems(s: LinkItemSources, t: TFunction): SuggestionItem[] {
  const catById = new Map(s.categories.map((c) => [c.id, c]));
  return [
    ...s.entries.map((e) => {
      const cat = lookupCategory(catById, e.category_id);
      const phase = entryMoonPhase(e, s.showMoonPhase);
      return {
        id: e.id,
        entryType: 'entry' as const,
        label: displayTitle(t, 'entry', e.title),
        category: cat?.emoji,
        ...splitIcon(entryIcon(e, cat, s.showMoonPhase), cat?.emoji || DEFAULT_ENTRY_ICON),
        categoryLabel: phase ? t(`moonPhase.${phase}`) : categoryLabel(t, cat),
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
        icon: cat?.emoji || DEFAULT_TASK_ICON,
        categoryLabel: categoryLabel(t, cat),
        updatedAt: task.updated_at,
      };
    }),
  ];
}

/**
 * `entry:id` or `task:id` → item. The key under which link chips are looked
 * up — chips and items carry the same target kind (`entry`/`task`).
 */
export function linkItemKey(target: { id: string; entryType: string }): string {
  return `${target.entryType === 'task' ? 'task' : 'entry'}:${target.id}`;
}

export function linkItemsByKey(items: SuggestionItem[]): Map<string, SuggestionItem> {
  return new Map(items.map((i) => [linkItemKey(i), i]));
}
