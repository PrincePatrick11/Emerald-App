import { useDeferredValue, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAltarStore } from '../store/altarStore';
import { useJournalStore } from '../store/journalStore';
import { useOperationStore } from '../store/operationStore';
import { useTagStore } from '../store/tagStore';
import { useTaskStore } from '../store/taskStore';
import { useWikiStore } from '../store/wikiStore';
import { searchCorpus, type SearchCategory, type SearchCorpus, type SearchResults } from '../lib/globalSearch';

/**
 * The store side of the global search: it assembles the corpus and hands it to
 * `lib/globalSearch`, which does the matching without knowing where the arrays
 * came from.
 *
 * Category names are resolved here rather than there because built-in ones are
 * named by a locale key — searching `wiki.categories.ritual`'s raw `name` would
 * hunt for the English word in a German vault.
 */
function useSearchCorpus(): SearchCorpus {
  const { t } = useTranslation();

  const journal = useJournalStore((s) => s.entries);
  const wiki = useWikiStore((s) => s.articles);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const operations = useOperationStore((s) => s.operations);
  const operationCategories = useOperationStore((s) => s.categories);
  const tasks = useTaskStore((s) => s.tasks);
  const taskCategories = useTaskStore((s) => s.categories);
  const altars = useAltarStore((s) => s.altars);
  const altarItems = useAltarStore((s) => s.items);
  const altarCategories = useAltarStore((s) => s.categories);
  const tags = useTagStore((s) => s.tags);

  const categories = useMemo<SearchCategory[]>(() => [
    ...wikiCategories.map((c) => ({
      id: c.id,
      name: c.is_builtin ? t(`wiki.categories.${c.id}`) : c.name,
      module: 'wiki' as const,
    })),
    ...operationCategories.map((c) => ({
      id: c.id,
      name: c.is_builtin ? t(`operations.categories.${c.id}`) : c.name,
      module: 'operations' as const,
    })),
    // Task and altar categories carry no built-in variant that the locales
    // rename — both are shown by their stored `name` everywhere else too.
    ...taskCategories.filter((c) => !c.deleted_at).map((c) => ({
      id: c.id, name: c.name, module: 'tasks' as const,
    })),
    ...altarCategories.map((c) => ({
      id: c.id, name: c.name, module: 'altar' as const,
    })),
  ], [wikiCategories, operationCategories, taskCategories, altarCategories, t]);

  return useMemo(
    () => ({ journal, wiki, operations, tasks, altars, altarItems, tags, categories }),
    [journal, wiki, operations, tasks, altars, altarItems, tags, categories],
  );
}

export interface GlobalSearchState {
  results: SearchResults;
  /**
   * The query the results actually came from — deferred and trimmed, exactly as
   * `searchCorpus` saw it. The field's live value is a keystroke ahead and may
   * carry whitespace the matcher dropped, so highlighting the hits against it
   * would leave rows unmarked.
   */
  query: string;
  /** True while the field is ahead of the results — the list is one query old. */
  pending: boolean;
}

/**
 * Runs `query` against every module.
 *
 * `useDeferredValue` rather than a debounce timer: typing stays responsive
 * because React keeps the old result on screen while the new one is computed,
 * and there is no interval to tune — the delay is however long the search
 * actually takes, which on a small vault is no delay at all.
 *
 * The search and the cut are two memos on purpose. `limit` only feeds the
 * second one, so showing another page re-slices the list that is already
 * there instead of scoring the corpus again — which is the whole point of
 * paging in a search that runs on every keystroke.
 */
export function useGlobalSearch(query: string, limit: number): GlobalSearchState {
  const corpus = useSearchCorpus();
  const deferredQuery = useDeferredValue(query);
  const effectiveQuery = deferredQuery.trim();

  const all = useMemo(() => searchCorpus(corpus, effectiveQuery), [corpus, effectiveQuery]);
  const results = useMemo(
    () => ({ hits: all.slice(0, limit), total: all.length }),
    [all, limit],
  );

  return { results, query: effectiveQuery, pending: deferredQuery !== query };
}
