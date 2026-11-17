import { entryMoonPhase, MOON_PHASE_SYMBOLS } from './moonPhase';

/** The icon of an entry that has neither one of its own, a moon phase nor a category. */
export const DEFAULT_ENTRY_ICON = '📄';

/** The icon of a task without a category. */
export const DEFAULT_TASK_ICON = '✅';

/** The fallback icon of a link target that carries none: entry or task. */
export function defaultLinkIcon(kind: string): string {
  return kind === 'task' ? DEFAULT_TASK_ICON : DEFAULT_ENTRY_ICON;
}

/**
 * The icon of an entry — in lists, tabs, link chips, the left list and the
 * export. One rule for every entry, whatever dashboard shows it:
 * its own (emoji or uploaded icon), else its moon phase (category Journal,
 * with the vault setting on — `entryMoonPhase`), else its category's emoji,
 * else `DEFAULT_ENTRY_ICON`. An emoji or an icon file name: `isImageIcon`
 * tells them apart.
 */
export function entryIcon(
  entry: { icon?: string | null; created_at: string; category_id: string | null },
  category: { emoji: string } | null | undefined,
  showMoonPhase: boolean,
): string {
  if (entry.icon) return entry.icon;
  const phase = entryMoonPhase(entry, showMoonPhase);
  if (phase) return MOON_PHASE_SYMBOLS[phase];
  return category?.emoji || DEFAULT_ENTRY_ICON;
}
