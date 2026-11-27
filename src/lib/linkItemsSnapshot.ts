import i18n from '../i18n';
import { useCategoryStore } from '../store/categoryStore';
import { useEntryStore } from '../store/entryStore';
import { useTaskStore } from '../store/taskStore';
import type { LinkTitleOf } from './blocks/blockValue';
import { buildLinkItems, linkTitleIn, type SuggestionItem } from './linkItems';

/** The last list with its inputs: an export asks once per entry, over a vault that does not change meanwhile. */
let last: { deps: readonly unknown[]; items: SuggestionItem[] } | null = null;

/**
 * `buildLinkItems` over the current stores — the React-free variant of
 * `useLinkItems`, for the import and export paths.
 */
export function linkItemsSnapshot(): SuggestionItem[] {
  const entries = useEntryStore.getState().entries;
  const tasks = useTaskStore.getState().tasks;
  const categories = useCategoryStore.getState().categories;
  const deps = [i18n.language, entries, tasks, categories];
  if (last && last.deps.every((d, i) => d === deps[i])) return last.items;
  last = { deps, items: buildLinkItems({ entries, tasks, categories }, i18n.t) };
  return last.items;
}

/** The React-free variant of `useLinkTitle`: a link target's current title, as the app shows it. */
export function linkTitleSnapshot(): LinkTitleOf {
  return linkTitleIn(linkItemsSnapshot());
}
