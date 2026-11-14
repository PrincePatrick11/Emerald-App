import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEntriesByKind } from './useDashboardEntries';
import { useTaskStore } from '../store/taskStore';
import { useCategoryStore } from '../store/categoryStore';
import { useSettingsStore } from '../store/settingsStore';
import { buildLinkItems } from '../lib/linkItems';
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
  const { journal: entries, wiki: articles, operation: operations } = useEntriesByKind();
  const categories = useCategoryStore((s) => s.categories);
  const tasks = useTaskStore((s) => s.tasks);
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);

  return useMemo(
    () => sharedLinkItems(
      [t, entries, articles, operations, tasks, categories, showMoonPhase],
      () => buildLinkItems({ entries, tasks, operations, articles, categories, showMoonPhase }, t),
    ),
    [t, entries, articles, operations, tasks, categories, showMoonPhase],
  );
}
