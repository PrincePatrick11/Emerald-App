/**
 * Store layer of the module registry (`lib/modules.ts`): which store loads
 * which module, and how trash entries are restored
 * or permanently deleted per type.
 *
 * Import rule of this file: content stores only (entry/task/tag/category/
 * blockDefinition/template/lexicon) — never uiStore, vaultStore or trashStore,
 * which in turn point here (they may). All access happens at runtime
 * via `getState()`, not at import time.
 */
import { useEntryStore } from './entryStore';
import { useTaskStore } from './taskStore';
import { useTagStore, type TaggedType } from './tagStore';
import { useCategoryStore } from './categoryStore';
import { useBlockDefinitionStore } from './blockDefinitionStore';
import { useTemplateStore } from './templateStore';
import { useLexiconStore } from './lexiconStore';
import { useImageStore } from './imageStore';
import { restorePicture } from './imageActions';
import { useSymbolStore } from './symbolStore';
import { ENTRY_MODULE_IDS, type EntryModuleId, type TrashKind } from '../lib/modules';

/**
 * Reloads the content of a module from the active DB. Journal, wiki and
 * operations share one store and thus the same function — the
 * reload helpers below call it only once per invocation.
 */
const reloadEntries = (options?: ReloadOptions) => useEntryStore.getState().fetchEntries(options);

/** `keepLoaded`: already loaded contents stay (`fetchEntries`) — only after an import. */
type ReloadOptions = { keepLoaded?: boolean };

export const moduleWiring: Record<EntryModuleId, { reload: (options?: ReloadOptions) => Promise<void> }> = {
  journal: { reload: reloadEntries },
  tasks: { reload: () => useTaskStore.getState().fetchAll() },
  operations: { reload: reloadEntries },
  wiki: { reload: reloadEntries },
};

/**
 * After restoring: IDs of tags that no longer exist are dropped
 * (`dropUnknownTagIds`) — for everything that carries tags.
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
  image: {
    restore: async (id) => { await restorePicture(id); },
    permanentlyDelete: (id) => useImageStore.getState().permanentlyDeleteImage(id),
  },
};

/**
 * The canonical load sequence: first tags, categories, custom blocks, templates
 * and the lexicon, then all contents. Used by AppShell (initial load), vaultStore (vault switch)
 * and dbBackup (import) — previously three hand-maintained copies of the same list.
 *
 * Why sequenced: not a hard data dependency (no fetcher reads another
 * store), but presentation — with tags and categories ahead of the
 * contents, lists never render unresolved category or tag names for even
 * a frame. With local SQLite this costs microseconds; anyone who wants it flatter
 * may collapse it into a Promise.all, but takes on the flash.
 */
export async function reloadAllStores(): Promise<void> {
  await Promise.all([
    useTagStore.getState().fetchTags(),
    useCategoryStore.getState().fetchCategories(),
    useBlockDefinitionStore.getState().fetchDefinitions(),
    useTemplateStore.getState().fetchTemplates(),
    useLexiconStore.getState().fetchLexicon(),
    useImageStore.getState().fetchImages(),
    useSymbolStore.getState().fetchSymbols(),
  ]);
  await reloadEach(ENTRY_MODULE_IDS);
}

/**
 * Targeted reload of individual modules (Emerald import): tags, categories,
 * custom blocks, templates, the lexicon and the named contents — the first
 * five always, because an import can create new ones.
 */
export async function reloadModules(ids: readonly EntryModuleId[]): Promise<void> {
  await Promise.all([
    useTagStore.getState().fetchTags(),
    useCategoryStore.getState().fetchCategories(),
    useBlockDefinitionStore.getState().fetchDefinitions(),
    useTemplateStore.getState().fetchTemplates(),
    useLexiconStore.getState().fetchLexicon(),
    useSymbolStore.getState().fetchSymbols(),
    useImageStore.getState().fetchImages(),
  ]);
  // An import writes through the stores: whatever content is already loaded is correct.
  await reloadEach(ids, { keepLoaded: true });
}

/** Reloads the modules — journal, wiki and operations share one query. */
function reloadEach(ids: readonly EntryModuleId[], options?: ReloadOptions): Promise<unknown> {
  const reloads = new Set(ids.map((id) => moduleWiring[id].reload));
  return Promise.all([...reloads].map((reload) => reload(options)));
}
