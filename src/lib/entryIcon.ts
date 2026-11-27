import { entryBlockSummary } from './blocks/entrySummary';
import { resolveProperty } from './blocks/entryProperties';

/** The icon of an entry that has neither one of its own, one a block suggests, nor a category. */
export const DEFAULT_ENTRY_ICON = '📄';

/** The icon of a task without a category. */
export const DEFAULT_TASK_ICON = '✅';

/** The fallback icon of a link target that carries none: entry or task. */
export function defaultLinkIcon(kind: string): string {
  return kind === 'task' ? DEFAULT_TASK_ICON : DEFAULT_ENTRY_ICON;
}

/**
 * The icon of an entry — in lists, tabs, the entry's header, link chips, the
 * left list and the export. One rule for every entry, whatever dashboard
 * shows it, in the order of the properties (`resolveProperty`): its own
 * (emoji or uploaded icon), else the one a block suggests
 * (`BlockProperties.icon`, e.g. the moon phase of its day — before the own
 * one if the block's type does not let it be overridden), else its
 * category's emoji, else `DEFAULT_ENTRY_ICON`. An emoji or an icon file
 * name: `isImageIcon` tells them apart.
 */
export function entryIcon(
  entry: { id: string; content: string; icon?: string | null; created_at: string; category_id: string | null },
  category: { emoji: string } | null | undefined,
): string {
  const own = resolveProperty(entry.icon, entryBlockSummary(entry).properties.icon, null);
  if (own) return own.value;
  return category?.emoji || DEFAULT_ENTRY_ICON;
}
