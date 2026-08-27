/**
 * Store-Schicht der Modul-Registry (`lib/modules.ts`): welcher Store lädt
 * welches Modul, und wie werden Papierkorb-Einträge je Typ wiederhergestellt
 * bzw. endgültig gelöscht.
 *
 * Import-Regel dieser Datei: nur Content-Stores (journal/wiki/operation/task/
 * altar/tag/routine) — niemals uiStore, vaultStore oder trashStore, die
 * ihrerseits hierher zeigen (dürfen). Alle Zugriffe laufen zur Laufzeit über
 * `getState()`, nicht zur Import-Zeit.
 */
import { useJournalStore } from './journalStore';
import { useWikiStore } from './wikiStore';
import { useOperationStore } from './operationStore';
import { useTaskStore } from './taskStore';
import { useAltarStore } from './altarStore';
import { useTagStore } from './tagStore';
import { useRoutineStore } from './routineStore';
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
  wiki_category: {
    restore: (id) => useWikiStore.getState().restoreWikiCategory(id),
    permanentlyDelete: (id) => useWikiStore.getState().permanentlyDeleteWikiCategory(id),
  },
  operation_category: {
    restore: (id) => useOperationStore.getState().restoreCategory(id),
    permanentlyDelete: (id) => useOperationStore.getState().permanentlyDeleteCategory(id),
  },
  tag: {
    restore: (id) => useTagStore.getState().restoreTag(id),
    permanentlyDelete: (id) => useTagStore.getState().permanentlyDeleteTag(id),
  },
  task: {
    restore: (id) => useTaskStore.getState().restoreTask(id),
    permanentlyDelete: (id) => useTaskStore.getState().permanentlyDeleteTask(id),
  },
  task_category: {
    restore: (id) => useTaskStore.getState().restoreCategory(id),
    permanentlyDelete: (id) => useTaskStore.getState().permanentlyDeleteCategory(id),
  },
};

/**
 * Die kanonische Lade-Sequenz: erst Tags, dann Kategorien (Wiki-Kategorien und
 * Operations-fetchAll, das seine Kategorien mitlädt), dann alle Inhalte plus
 * Routinen. Genutzt von AppShell (Erstladung), vaultStore (Vault-Wechsel) und
 * dbBackup (Import) — vorher drei handgepflegte Kopien derselben Liste.
 *
 * Warum sequenziert: keine harte Datenabhängigkeit (kein Fetcher liest einen
 * anderen Store), sondern Darstellung — stehen Tags und Kategorien vor den
 * Inhalten, rendern Listen nie einen Frame lang unaufgelöste Kategorie- oder
 * Tag-Namen. Bei lokalem SQLite kostet das Mikrosekunden; wer es flacher will,
 * darf zu einem Promise.all zusammenziehen, handelt sich aber den Flash ein.
 */
export async function reloadAllStores(): Promise<void> {
  await useTagStore.getState().fetchTags();
  await Promise.all([
    useWikiStore.getState().fetchCategories(),
    // operations.reload() lädt Operationen samt Kategorien in einem Zug —
    // deshalb läuft es hier und nicht noch einmal in der Inhaltsphase.
    moduleWiring.operations.reload(),
  ]);
  await Promise.all([
    ...ENTRY_MODULE_IDS.filter((id) => id !== 'operations').map((id) => moduleWiring[id].reload()),
    useRoutineStore.getState().fetchRoutines(),
  ]);
}

/** Gezielter Reload einzelner Module (Emerald-Import): Tags + genannte Inhalte. */
export async function reloadModules(ids: readonly EntryModuleId[]): Promise<void> {
  await useTagStore.getState().fetchTags();
  await Promise.all(ids.map((id) => moduleWiring[id].reload()));
}
