import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEntryStore } from '../store/entryStore';
import { useTaskStore } from '../store/taskStore';
import { useCategoryStore } from '../store/categoryStore';
import { buildLinkItems, linkItemsByKey, linkTitleIn, resolveLink, type ResolvedLink } from '../lib/linkItems';
import type { LinkTitleOf } from '../lib/blocks/blockValue';
import type { SuggestionItem } from '../components/editors/text/SuggestionList';

/** The last result together with its inputs — shared across all callers. */
let shared: { deps: readonly unknown[]; items: SuggestionItem[] } | null = null;

/**
 * Every text editor of an entry calls `useLinkItems` — a `useMemo` per
 * instance computed the same list over the whole vault as many times as
 * editors are open. For the same inputs (store arrays are identical until
 * the next change) the result of the first call is returned.
 */
function sharedLinkItems(deps: readonly unknown[], build: () => SuggestionItem[]): SuggestionItem[] {
  if (shared && shared.deps.length === deps.length && shared.deps.every((d, i) => d === deps[i])) return shared.items;
  shared = { deps, items: build() };
  return shared.items;
}

/**
 * The React side of `buildLinkItems` — that is where it says what the list
 * contains and why. Here only the store subscriptions and the (shared) memo.
 */
export function useLinkItems(): SuggestionItem[] {
  const { t } = useTranslation();
  const entries = useEntryStore((s) => s.entries);
  const categories = useCategoryStore((s) => s.categories);
  const tasks = useTaskStore((s) => s.tasks);

  return useMemo(
    () => sharedLinkItems(
      [t, entries, tasks, categories],
      () => buildLinkItems({ entries, tasks, categories }, t),
    ),
    [t, entries, tasks, categories],
  );
}

/**
 * What one link shows (`resolveLink`): its live target, or a stand-in when the
 * target is in the trash or deleted for good. Re-renders when the target is
 * renamed, deleted or restored.
 */
export function useLinkTarget(link: { id: string; targetKind: string; label?: string | null }): ResolvedLink {
  const { t } = useTranslation();
  return resolveLink(linkItemsByKey(useLinkItems()), link, t);
}

/**
 * The current title of a link target by its ID, `undefined` once it is gone —
 * for values that name a link (`blockValueText`). Re-renders on a rename.
 */
export function useLinkTitle(): LinkTitleOf {
  const items = useLinkItems();
  return useMemo(() => linkTitleIn(items), [items]);
}
