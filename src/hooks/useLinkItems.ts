import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useJournalStore } from '../store/journalStore';
import { useWikiStore } from '../store/wikiStore';
import { useOperationStore } from '../store/operationStore';
import { useTaskStore } from '../store/taskStore';
import { useAltarStore } from '../store/altarStore';
import { useCategoryStore } from '../store/categoryStore';
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
  const operations = useOperationStore((s) => s.operations);
  const categories = useCategoryStore((s) => s.categories);
  const tasks = useTaskStore((s) => s.tasks);
  const altars = useAltarStore((s) => s.altars);

  return useMemo(
    () => buildLinkItems(
      { entries, tasks, operations, articles, categories, altars },
      t,
    ),
    [t, entries, articles, operations, tasks, categories, altars],
  );
}
