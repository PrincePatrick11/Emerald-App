import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useTaskStore } from '../store/taskStore';
import { useAltarStore } from '../store/altarStore';
import { buildLinkItems } from '../lib/linkItems';
import type { SuggestionItem } from '../components/editor/SuggestionList';

/**
 * Die React-Seite von `buildLinkItems` — dort steht, was die Liste enthält und
 * warum. Hier nur die Store-Abos und das Memo.
 */
export function useLinkItems(): SuggestionItem[] {
  const { t } = useTranslation();
  const entries = useJournalStore((s) => s.entries);
  const articles = useWikiStore((s) => s.articles);
  const wikiCategories = useWikiStore((s) => s.wikiCategories);
  const operations = useOperationStore((s) => s.operations);
  const opCategories = useOperationStore((s) => s.categories);
  const tasks = useTaskStore((s) => s.tasks);
  const taskCategories = useTaskStore((s) => s.categories);
  const altars = useAltarStore((s) => s.altars);

  return useMemo(
    () => buildLinkItems(
      { entries, tasks, taskCategories, operations, opCategories, articles, wikiCategories, altars },
      t,
    ),
    [t, entries, articles, wikiCategories, operations, opCategories, tasks, taskCategories, altars],
  );
}
