import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEntryStore } from '../store/entryStore';
import { useTaskStore } from '../store/taskStore';
import { useAltarStore } from '../store/altarStore';
import { useCategoryStore } from '../store/categoryStore';
import { useSettingsStore } from '../store/settingsStore';
import { buildLinkItems } from '../lib/linkItems';
import type { SuggestionItem } from '../components/editor/SuggestionList';

/** Das letzte Ergebnis samt Eingaben — geteilt über alle Aufrufer. */
let shared: { deps: readonly unknown[]; items: SuggestionItem[] } | null = null;

/**
 * Jeder Text-Editor eines Eintrags ruft `useLinkItems` — ein `useMemo` je
 * Instanz rechnete dieselbe Liste über den ganzen Vault so oft, wie Editoren
 * offen sind. Bei denselben Eingaben (Store-Arrays sind bis zur nächsten
 * Änderung identisch) gibt es das Ergebnis des ersten zurück.
 */
function sharedLinkItems(deps: readonly unknown[], build: () => SuggestionItem[]): SuggestionItem[] {
  if (shared && shared.deps.length === deps.length && shared.deps.every((d, i) => d === deps[i])) return shared.items;
  shared = { deps, items: build() };
  return shared.items;
}

/**
 * Die React-Seite von `buildLinkItems` — dort steht, was die Liste enthält und
 * warum. Hier nur die Store-Abos und das (geteilte) Memo.
 */
export function useLinkItems(): SuggestionItem[] {
  const { t } = useTranslation();
  const entries = useEntryStore((s) => s.entries.journal);
  const articles = useEntryStore((s) => s.entries.wiki);
  const operations = useEntryStore((s) => s.entries.operation);
  const categories = useCategoryStore((s) => s.categories);
  const tasks = useTaskStore((s) => s.tasks);
  const altars = useAltarStore((s) => s.altars);
  const showMoonPhase = useSettingsStore((s) => s.settings.journal.moonPhase);

  return useMemo(
    () => sharedLinkItems(
      [t, entries, articles, operations, tasks, categories, altars, showMoonPhase],
      () => buildLinkItems({ entries, tasks, operations, articles, categories, altars, showMoonPhase }, t),
    ),
    [t, entries, articles, operations, tasks, categories, altars, showMoonPhase],
  );
}
