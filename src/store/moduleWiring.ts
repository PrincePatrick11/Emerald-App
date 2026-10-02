/**
 * Store-Schicht der Modul-Registry (`lib/modules.ts`): welcher Store lädt
 * welches Modul, und wie werden Papierkorb-Einträge je Typ wiederhergestellt
 * bzw. endgültig gelöscht.
 *
 * Import-Regel dieser Datei: nur Content-Stores (entry/task/altar/tag/category/
 * blockDefinition/template/lexicon) — niemals uiStore, vaultStore oder trashStore,
 * die ihrerseits hierher zeigen (dürfen). Alle Zugriffe laufen zur Laufzeit
 * über `getState()`, nicht zur Import-Zeit.
 */
import { useEntryStore } from './entryStore';
import { useTaskStore } from './taskStore';
import { useAltarStore } from './altarStore';
import { useTagStore, type TaggedType } from './tagStore';
import { useCategoryStore } from './categoryStore';
import { useBlockDefinitionStore } from './blockDefinitionStore';
import { useTemplateStore } from './templateStore';
import { useLexiconStore } from './lexiconStore';
import { ENTRY_MODULE_IDS, type EntryModuleId, type TrashKind } from '../lib/modules';

/**
 * Lädt den Inhalt eines Moduls neu aus der aktiven DB. Journal, Wiki und
 * Operationen teilen sich einen Store und damit dieselbe Funktion — die
 * Reload-Helfer unten rufen sie je Aufruf nur einmal.
 */
const reloadEntries = (options?: ReloadOptions) => useEntryStore.getState().fetchEntries(options);

/** `keepLoaded`: schon geladene Inhalte bleiben (`fetchEntries`) — nur nach einem Import. */
type ReloadOptions = { keepLoaded?: boolean };

export const moduleWiring: Record<EntryModuleId, { reload: (options?: ReloadOptions) => Promise<void> }> = {
  journal: { reload: reloadEntries },
  tasks: { reload: () => useTaskStore.getState().fetchAll() },
  operations: { reload: reloadEntries },
  wiki: { reload: reloadEntries },
  altar: { reload: () => useAltarStore.getState().fetchAltars() },
};

/**
 * Nach dem Wiederherstellen: IDs von Tags, die es nicht mehr gibt, fallen weg
 * (`dropUnknownTagIds`) — für alles, was Tags trägt.
 */
async function withLiveTags(type: TaggedType, id: string, restored: Promise<void>): Promise<void> {
  await restored;
  await useTagStore.getState().dropUnknownTagIds(type, id);
}

export const trashWiring: Record<TrashKind, {
  restore: (id: string) => Promise<void>;
  permanentlyDelete: (id: string) => Promise<void>;
}> = {
  journal: {
    restore: (id) => withLiveTags('journal', id, useEntryStore.getState().restoreEntry(id)),
    permanentlyDelete: (id) => useEntryStore.getState().permanentlyDeleteEntry(id),
  },
  wiki: {
    restore: (id) => withLiveTags('wiki', id, useEntryStore.getState().restoreEntry(id)),
    permanentlyDelete: (id) => useEntryStore.getState().permanentlyDeleteEntry(id),
  },
  operation: {
    restore: (id) => withLiveTags('operation', id, useEntryStore.getState().restoreEntry(id)),
    permanentlyDelete: (id) => useEntryStore.getState().permanentlyDeleteEntry(id),
  },
  category: {
    restore: async (id) => { await useCategoryStore.getState().restoreCategory(id); },
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
  template: {
    restore: (id) => withLiveTags('template', id, useTemplateStore.getState().restoreTemplate(id)),
    permanentlyDelete: (id) => useTemplateStore.getState().permanentlyDeleteTemplate(id),
  },
  language: {
    restore: (id) => useLexiconStore.getState().restoreLanguage(id),
    permanentlyDelete: (id) => useLexiconStore.getState().permanentlyDeleteLanguage(id),
  },
  altar: {
    restore: (id) => useAltarStore.getState().restoreAltar(id),
    permanentlyDelete: async (id) => {
      await useAltarStore.getState().permanentlyDeleteAltar(id);
      // Die `task_links` auf den Altar sind aus der Datenbank — hier, damit
      // `altarStore` den Aufgaben-Store nicht importieren muss.
      useTaskStore.setState((s) => ({ links: s.links.filter((link) => link.target_id !== id) }));
    },
  },
  altarItem: {
    restore: (id) => useAltarStore.getState().restoreItem(id),
    permanentlyDelete: (id) => useAltarStore.getState().permanentlyDeleteItem(id),
  },
};

/**
 * Die kanonische Lade-Sequenz: erst Tags, Kategorien, eigene Blöcke, Vorlagen
 * und das Lexikon, dann alle Inhalte. Genutzt von AppShell (Erstladung), vaultStore (Vault-Wechsel)
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
    useTemplateStore.getState().fetchTemplates(),
    useLexiconStore.getState().fetchLexicon(),
  ]);
  await reloadEach(ENTRY_MODULE_IDS);
}

/**
 * Gezielter Reload einzelner Module (Emerald-Import): Tags, Kategorien,
 * eigene Blöcke, Vorlagen, das Lexikon und die genannten Inhalte — die ersten
 * fünf immer, weil ein Import neue anlegen kann.
 */
export async function reloadModules(ids: readonly EntryModuleId[]): Promise<void> {
  await Promise.all([
    useTagStore.getState().fetchTags(),
    useCategoryStore.getState().fetchCategories(),
    useBlockDefinitionStore.getState().fetchDefinitions(),
    useTemplateStore.getState().fetchTemplates(),
    useLexiconStore.getState().fetchLexicon(),
  ]);
  // Ein Import schreibt über die Stores: was an Inhalten schon geladen ist, stimmt.
  await reloadEach(ids, { keepLoaded: true });
}

/** Lädt die Module neu — Journal, Wiki und Operationen teilen sich dabei eine Abfrage. */
function reloadEach(ids: readonly EntryModuleId[], options?: ReloadOptions): Promise<unknown> {
  const reloads = new Set(ids.map((id) => moduleWiring[id].reload));
  return Promise.all([...reloads].map((reload) => reload(options)));
}
