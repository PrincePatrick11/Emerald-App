/**
 * Store-Schicht der Modul-Registry (`lib/modules.ts`): welcher Store lädt
 * welches Modul, und wie werden Papierkorb-Einträge je Typ wiederhergestellt
 * bzw. endgültig gelöscht.
 *
 * Import-Regel dieser Datei: nur Content-Stores (journal/wiki/operation/task/
 * altar/tag/routine/category/blockDefinition) — niemals uiStore, vaultStore oder trashStore,
 * die ihrerseits hierher zeigen (dürfen). Alle Zugriffe laufen zur Laufzeit
 * über `getState()`, nicht zur Import-Zeit.
 */
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTaskStore } from './taskStore';
import { useAltarStore } from './altarStore';
import { useTagStore } from './tagStore';
import { useRoutineStore } from './routineStore';
import { useCategoryStore } from './categoryStore';
import { useBlockDefinitionStore } from './blockDefinitionStore';
import { ENTRY_MODULE_IDS, type EntryModuleId, type TrashKind } from '../lib/modules';

/** Lädt den Inhalt eines Moduls neu aus der aktiven DB. */
export const moduleWiring: Record<EntryModuleId, { reload: () => Promise<void> }> = {
  journal: { reload: () => useJournalStore.getState().fetchEntries() },
  tasks: { reload: () => useTaskStore.getState().fetchAll() },
  operations: { reload: () => useOperationStore.getState().fetchAll() },
  wiki: { reload: () => useWikiStore.getState().fetchArticles() },
  altar: { reload: () => useAltarStore.getState().fetchAltars() },
};

export const trashWiring: Record<TrashKind, {
  restore: (id: string) => Promise<void>;
  permanentlyDelete: (id: string) => Promise<void>;
}> = {
  journal: {
    restore: (id) => useJournalStore.getState().restoreEntry(id),
    permanentlyDelete: (id) => useJournalStore.getState().permanentlyDeleteEntry(id),
  },
  wiki: {
    restore: (id) => useWikiStore.getState().restoreArticle(id),
    permanentlyDelete: (id) => useWikiStore.getState().permanentlyDeleteArticle(id),
  },
  operation: {
    restore: (id) => useOperationStore.getState().restoreOperation(id),
    permanentlyDelete: (id) => useOperationStore.getState().permanentlyDeleteOperation(id),
  },
  category: {
    restore: (id) => useCategoryStore.getState().restoreCategory(id),
    permanentlyDelete: (id) => useCategoryStore.getState().permanentlyDeleteCategory(id),
  },
  tag: {
    restore: (id) => useTagStore.getState().restoreTag(id),
    permanentlyDelete: (id) => useTagStore.getState().permanentlyDeleteTag(id),
  },
  task: {
    restore: (id) => useTaskStore.getState().restoreTask(id),
    permanentlyDelete: (id) => useTaskStore.getState().permanentlyDeleteTask(id),
  },
  blockDefinition: {
    restore: (id) => useBlockDefinitionStore.getState().restoreDefinition(id),
    permanentlyDelete: (id) => useBlockDefinitionStore.getState().permanentlyDeleteDefinition(id),
  },
};

/**
 * Die kanonische Lade-Sequenz: erst Tags und Kategorien, dann alle Inhalte
 * plus Routinen. Genutzt von AppShell (Erstladung), vaultStore (Vault-Wechsel)
 * und dbBackup (Import) — vorher drei handgepflegte Kopien derselben Liste.
 *
 * Warum sequenziert: keine harte Datenabhängigkeit (kein Fetcher liest einen
 * anderen Store), sondern Darstellung — stehen Tags und Kategorien vor den
 * Inhalten, rendern Listen nie einen Frame lang unaufgelöste Kategorie- oder
 * Tag-Namen. Bei lokalem SQLite kostet das Mikrosekunden; wer es flacher will,
 * darf zu einem Promise.all zusammenziehen, handelt sich aber den Flash ein.
 */
export async function reloadAllStores(): Promise<void> {
  await Promise.all([
    useTagStore.getState().fetchTags(),
    useCategoryStore.getState().fetchCategories(),
    useBlockDefinitionStore.getState().fetchDefinitions(),
  ]);
  await Promise.all([
    ...ENTRY_MODULE_IDS.map((id) => moduleWiring[id].reload()),
    useRoutineStore.getState().fetchRoutines(),
  ]);
}

/**
 * Gezielter Reload einzelner Module (Emerald-Import): Tags, Kategorien,
 * eigene Blöcke und die genannten Inhalte — die ersten drei immer, weil ein
 * Import neue anlegen kann.
 */
export async function reloadModules(ids: readonly EntryModuleId[]): Promise<void> {
  await Promise.all([
    useTagStore.getState().fetchTags(),
    useCategoryStore.getState().fetchCategories(),
    useBlockDefinitionStore.getState().fetchDefinitions(),
  ]);
  await Promise.all(ids.map((id) => moduleWiring[id].reload()));
}
