import { useCallback } from 'react';
import { useUIStore } from '../store/uiStore';

export type CollapseScope = 'journal' | 'wiki' | 'operations' | 'tasks' | 'altar-library' | 'tags' | 'images';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Collapsed state of a module's category groups (tasks, wiki, operations,
 * the library in the altar dashboard, and tags).
 *
 * The state lives in the uiStore, not in the view: MainArea unmounts the views
 * on a module switch, so a useState would be empty again after every rail
 * click. It is a preference and persists, per vault (`vaultPrefs`) — the ids
 * are the categories of that vault.
 *
 * `defaultCollapsed` inverts the default (tags: many groups, the list of
 * headers is the overview). The set in the store then holds the *expanded*
 * ids; `isCollapsed` and `expand` hide that.
 */
export function useCollapsedSet(scope: CollapseScope, { defaultCollapsed = false }: { defaultCollapsed?: boolean } = {}) {
  const deviating = useUIStore((s) => s.collapsedGroups[scope]) ?? EMPTY;
  const toggleInStore = useUIStore((s) => s.toggleCollapsedGroup);
  const removeInStore = useUIStore((s) => s.removeCollapsedGroups);
  const addInStore = useUIStore((s) => s.addCollapsedGroups);

  const toggle = useCallback((id: string) => toggleInStore(scope, id), [toggleInStore, scope]);
  const isCollapsed = useCallback(
    (id: string) => deviating.has(id) !== defaultCollapsed,
    [deviating, defaultCollapsed],
  );
  /** Expands specific groups (e.g. a deep link from search). */
  const expand = useCallback(
    (...ids: string[]) => (defaultCollapsed ? addInStore : removeInStore)(scope, ids),
    [addInStore, removeInStore, scope, defaultCollapsed],
  );

  return { isCollapsed, toggle, expand };
}
